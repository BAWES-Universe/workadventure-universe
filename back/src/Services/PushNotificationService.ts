import crypto from "crypto";
import { z } from "zod";
import {
    APNS_AUTH_TOKEN,
    APNS_BUNDLE_ID,
    APNS_HOST,
    FCM_API_URL,
    FCM_SERVER_KEY,
    PUSH_VAPID_PRIVATE_KEY,
    PUSH_VAPID_PUBLIC_KEY,
    PUSH_VAPID_SUBJECT,
} from "../Enum/PushEnvironmentVariable";

/**
 * PushNotificationService manages device registration and multi-channel push delivery
 * across Android (FCM), iOS (APNs), and browser PWAs (Web Push / VAPID).
 * Raw native tokens and Web Push encryption keys remain internal to the service
 * while API responses expose only a deterministic SHA-256 registration identifier.
 */

export const PushNotificationPlatform = z.enum(["web", "android", "ios", "native"]);

export const PushNotificationSubscription = z
    .object({
        endpoint: z.string().url(),
        keys: z.object({
            p256dh: z.string().min(1),
            auth: z.string().min(1),
        }),
    })
    .passthrough();

const MAX_PUSH_REGISTRATIONS = 10_000;

const isValidPushTarget = (target: string): boolean => {
    if (target === "all") {
        return true;
    }
    return target.startsWith("user:") || target.startsWith("room:");
};

export const PushNotificationRegistrationRequest = z
    .object({
        token: z.string().min(8).max(4096).optional(),
        subscription: PushNotificationSubscription.optional(),
        platform: PushNotificationPlatform,
        userId: z.string().min(1).max(256).optional(),
        roomId: z.string().min(1).max(512).optional(),
        deviceId: z.string().min(1).max(256).optional(),
    })
    .refine((value) => value.token !== undefined || value.subscription !== undefined, {
        message: "Either token or subscription must be provided",
    });

export const PushNotificationSendRequest = z.object({
    target: z.string().min(1).max(768).refine(isValidPushTarget, {
        message: 'Target must be "all", "user:<id>", or "room:<id>"',
    }),
    title: z.string().min(1).max(128),
    body: z.string().min(1).max(1024),
    url: z.string().min(1).max(2048).optional(),
    chatRoomId: z.string().min(1).max(256).optional(),
    tag: z.string().min(1).max(128).optional(),
    dryRun: z.boolean().optional(),
});

export type PushNotificationRegistrationRequest = z.infer<typeof PushNotificationRegistrationRequest>;
export type PushNotificationSendRequest = z.infer<typeof PushNotificationSendRequest>;

export interface PushNotificationRegistration {
    id: string;
    platform: z.infer<typeof PushNotificationPlatform>;
    userId?: string;
    roomId?: string;
    deviceId?: string;
    createdAt: string;
    updatedAt: string;
}

interface StoredPushNotificationRegistration extends PushNotificationRegistration {
    token?: string;
    subscription?: z.infer<typeof PushNotificationSubscription>;
}

export interface PushNotificationSendResult {
    dryRun: boolean;
    matched: number;
    sent: number;
    failed: number;
    evicted: number;
    skippedReason?: string;
}

export interface PushHttpOutboundRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
}

export interface PushHttpOutboundResponse {
    status: number;
}

export type PushHttpSender = (request: PushHttpOutboundRequest) => Promise<PushHttpOutboundResponse>;

export interface PushProviderConfig {
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    vapidSubject?: string;
    fcmServerKey?: string;
    fcmApiUrl?: string;
    apnsAuthToken?: string;
    apnsBundleId?: string;
    apnsHost?: string;
    httpSender?: PushHttpSender;
}

type SingleDeliveryOutcome = "sent" | "failed" | "evicted" | "unconfigured";

const defaultHttpSender: PushHttpSender = async (request: PushHttpOutboundRequest): Promise<PushHttpOutboundResponse> => {
    const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
    });
    return { status: response.status };
};

function defaultProviderConfig(): PushProviderConfig {
    return {
        vapidPublicKey: PUSH_VAPID_PUBLIC_KEY,
        vapidPrivateKey: PUSH_VAPID_PRIVATE_KEY,
        vapidSubject: PUSH_VAPID_SUBJECT,
        fcmServerKey: FCM_SERVER_KEY,
        fcmApiUrl: FCM_API_URL,
        apnsAuthToken: APNS_AUTH_TOKEN,
        apnsBundleId: APNS_BUNDLE_ID,
        apnsHost: APNS_HOST,
    };
}

function isSuccessStatus(status: number): boolean {
    return status >= 200 && status < 300;
}

function isEvictionStatus(status: number): boolean {
    return status === 404 || status === 410;
}

export class PushNotificationService {
    private registrations = new Map<string, StoredPushNotificationRegistration>();
    private readonly config: PushProviderConfig;
    private readonly httpSender: PushHttpSender;

    constructor(config: PushProviderConfig = defaultProviderConfig()) {
        this.config = config;
        this.httpSender = config.httpSender ?? defaultHttpSender;
    }

    /**
     * Registers or updates a native FCM/APNs token or Web Push subscription.
     * Evicts the oldest entry when the in-memory registration cap is reached.
     */
    public register(request: PushNotificationRegistrationRequest): PushNotificationRegistration {
        const parsed = PushNotificationRegistrationRequest.parse(request);
        const id = this.getRegistrationId(parsed);
        const now = new Date().toISOString();
        const existing = this.registrations.get(id);
        this.evictOldestIfFull(Boolean(existing));

        const registration: StoredPushNotificationRegistration = {
            id,
            platform: parsed.platform,
            userId: parsed.userId ?? existing?.userId,
            roomId: parsed.roomId ?? existing?.roomId,
            deviceId: parsed.deviceId ?? existing?.deviceId,
            token: parsed.token ?? existing?.token,
            subscription: parsed.subscription ?? existing?.subscription,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.registrations.set(id, registration);
        return this.toPublicRegistration(registration);
    }

    /**
     * Removes a device registration by its public SHA-256 identifier.
     */
    public unregister(registrationId: string): boolean {
        return this.registrations.delete(registrationId);
    }

    /**
     * Lists all active registrations with raw tokens and subscription keys redacted.
     */
    public listPublicRegistrations(): PushNotificationRegistration[] {
        return Array.from(this.registrations.values()).map((entry) => this.toPublicRegistration(entry));
    }

    /**
     * Matches target registrations and dispatches notifications across Web Push, FCM, and APNs.
     * Subscriptions returning HTTP 404 or 410 from the upstream gateway are automatically evicted.
     */
    public async send(request: PushNotificationSendRequest, dryRun = false): Promise<PushNotificationSendResult> {
        const parsed = PushNotificationSendRequest.parse(request);
        const effectiveDryRun = parsed.dryRun ?? dryRun;
        const matches = this.findRegistrations(parsed.target);

        if (effectiveDryRun || matches.length === 0) {
            return { dryRun: effectiveDryRun, matched: matches.length, sent: 0, failed: 0, evicted: 0 };
        }

        return this.dispatchToMatches(matches, parsed);
    }

    private async dispatchToMatches(
        matches: StoredPushNotificationRegistration[],
        payload: PushNotificationSendRequest
    ): Promise<PushNotificationSendResult> {
        const counts = { sent: 0, failed: 0, evicted: 0, unconfigured: 0 };
        for (const registration of matches) {
            const outcome = await this.deliverRegistration(registration, payload);
            counts[outcome] += 1;
        }

        const totalFailed = counts.failed + counts.evicted;
        const skippedReason =
            counts.unconfigured > 0 && counts.sent === 0 ? "delivery-provider-not-configured" : undefined;

        return {
            dryRun: false,
            matched: matches.length,
            sent: counts.sent,
            failed: totalFailed,
            evicted: counts.evicted,
            ...(skippedReason ? { skippedReason } : {}),
        };
    }

    private async deliverRegistration(
        registration: StoredPushNotificationRegistration,
        payload: PushNotificationSendRequest
    ): Promise<SingleDeliveryOutcome> {
        const outbound = this.buildOutboundRequest(registration, payload);
        if (!outbound) {
            return "unconfigured";
        }

        const status = await this.deliverSingle(outbound);
        if (isSuccessStatus(status)) {
            return "sent";
        }
        if (isEvictionStatus(status)) {
            this.registrations.delete(registration.id);
            return "evicted";
        }
        return "failed";
    }

    private async deliverSingle(outbound: PushHttpOutboundRequest): Promise<number> {
        try {
            const response = await this.httpSender(outbound);
            return response.status;
        } catch {
            return 502;
        }
    }

    private buildOutboundRequest(
        registration: StoredPushNotificationRegistration,
        payload: PushNotificationSendRequest
    ): PushHttpOutboundRequest | null {
        if (registration.platform === "web") {
            return this.buildWebPushRequest(registration, payload);
        }
        if (registration.platform === "ios" && this.hasApnsCredentials()) {
            return this.buildApnsRequest(registration, payload);
        }
        return this.buildFcmRequest(registration, payload);
    }

    private hasWebPushCredentials(): boolean {
        return Boolean(this.config.vapidPublicKey) && Boolean(this.config.vapidPrivateKey);
    }

    private hasApnsCredentials(): boolean {
        return Boolean(this.config.apnsAuthToken) && Boolean(this.config.apnsBundleId);
    }

    private buildWebPushRequest(
        registration: StoredPushNotificationRegistration,
        payload: PushNotificationSendRequest
    ): PushHttpOutboundRequest | null {
        if (!registration.subscription || !this.hasWebPushCredentials()) {
            return null;
        }
        const subject = this.config.vapidSubject ?? "mailto:admin@universe.bawes.net";
        return {
            url: registration.subscription.endpoint,
            headers: {
                "content-type": "application/json",
                TTL: "86400",
                Authorization: `vapid t=${this.createVapidToken(registration.subscription.endpoint, subject)}, k=${
                    this.config.vapidPublicKey
                }`,
            },
            body: JSON.stringify({
                title: payload.title,
                body: payload.body,
                url: payload.url,
                chatRoomId: payload.chatRoomId,
                tag: payload.tag,
            }),
        };
    }

    private buildFcmRequest(
        registration: StoredPushNotificationRegistration,
        payload: PushNotificationSendRequest
    ): PushHttpOutboundRequest | null {
        if (!registration.token || !this.config.fcmServerKey) {
            return null;
        }
        return {
            url: this.config.fcmApiUrl ?? "https://fcm.googleapis.com/fcm/send",
            headers: {
                "content-type": "application/json",
                Authorization: `key=${this.config.fcmServerKey}`,
            },
            body: JSON.stringify({
                to: registration.token,
                notification: {
                    title: payload.title,
                    body: payload.body,
                    ...(payload.url ? { click_action: payload.url } : {}),
                },
                data: {
                    title: payload.title,
                    body: payload.body,
                    ...(payload.url ? { url: payload.url } : {}),
                    ...(payload.chatRoomId ? { chatRoomId: payload.chatRoomId } : {}),
                },
            }),
        };
    }

    private buildApnsRequest(
        registration: StoredPushNotificationRegistration,
        payload: PushNotificationSendRequest
    ): PushHttpOutboundRequest | null {
        if (!registration.token || !this.hasApnsCredentials()) {
            return null;
        }
        const host = (this.config.apnsHost ?? "https://api.push.apple.com").replace(/\/+$/, "");
        return {
            url: `${host}/3/device/${encodeURIComponent(registration.token)}`,
            headers: {
                "content-type": "application/json",
                authorization: `bearer ${this.config.apnsAuthToken ?? ""}`,
                "apns-topic": this.config.apnsBundleId ?? "",
                "apns-push-type": "alert",
            },
            body: JSON.stringify({
                aps: {
                    alert: { title: payload.title, body: payload.body },
                    sound: "default",
                },
                ...(payload.url ? { url: payload.url } : {}),
                ...(payload.chatRoomId ? { chatRoomId: payload.chatRoomId } : {}),
            }),
        };
    }

    private createVapidToken(endpoint: string, subject: string): string {
        const origin = new URL(endpoint).origin;
        const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
        const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
        const claims = Buffer.from(JSON.stringify({ aud: origin, exp, sub: subject })).toString("base64url");
        const signature = crypto
            .createHmac("sha256", this.config.vapidPrivateKey ?? "")
            .update(`${header}.${claims}`)
            .digest("base64url");
        return `${header}.${claims}.${signature}`;
    }

    private evictOldestIfFull(isExistingRegistration: boolean): void {
        if (isExistingRegistration || this.registrations.size < MAX_PUSH_REGISTRATIONS) {
            return;
        }
        const oldestRegistrationId = this.registrations.keys().next().value;
        if (oldestRegistrationId !== undefined) {
            this.registrations.delete(oldestRegistrationId);
        }
    }

    private findRegistrations(target: string): StoredPushNotificationRegistration[] {
        const values = Array.from(this.registrations.values());
        if (target === "all") {
            return values;
        }
        if (target.startsWith("user:")) {
            const userId = target.slice("user:".length);
            return values.filter((registration) => registration.userId === userId);
        }
        const roomId = target.slice("room:".length);
        return values.filter((registration) => registration.roomId === roomId);
    }

    private getRegistrationId(request: PushNotificationRegistrationRequest): string {
        const targetKey = request.token ?? request.subscription?.endpoint ?? "";
        return crypto.createHash("sha256").update(`${request.platform}:${targetKey}`).digest("hex");
    }

    private toPublicRegistration(registration: StoredPushNotificationRegistration): PushNotificationRegistration {
        return {
            id: registration.id,
            platform: registration.platform,
            ...(registration.userId !== undefined ? { userId: registration.userId } : {}),
            ...(registration.roomId !== undefined ? { roomId: registration.roomId } : {}),
            ...(registration.deviceId !== undefined ? { deviceId: registration.deviceId } : {}),
            createdAt: registration.createdAt,
            updatedAt: registration.updatedAt,
        };
    }
}
