import crypto from "crypto";
import { z } from "zod";

const PushNotificationPlatform = z.enum(["web", "android", "ios", "native"]);

const PushNotificationSubscription = z
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
    return target === "all" || target.startsWith("user:") || target.startsWith("room:");
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
    skippedReason?: string;
}

export class PushNotificationService {
    private registrations = new Map<string, StoredPushNotificationRegistration>();

    public register(request: PushNotificationRegistrationRequest): PushNotificationRegistration {
        const parsed = PushNotificationRegistrationRequest.parse(request);
        const id = this.getRegistrationId(parsed);
        const now = new Date().toISOString();
        const existing = this.registrations.get(id);
        const registration: StoredPushNotificationRegistration = {
            id,
            platform: parsed.platform,
            userId: parsed.userId,
            roomId: parsed.roomId,
            deviceId: parsed.deviceId,
            token: parsed.token,
            subscription: parsed.subscription,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        if (!existing && this.registrations.size >= MAX_PUSH_REGISTRATIONS) {
            const oldestRegistrationId = this.registrations.keys().next().value;

            if (oldestRegistrationId !== undefined) {
                this.registrations.delete(oldestRegistrationId);
            }
        }

        this.registrations.set(id, registration);

        return this.toPublicRegistration(registration);
    }

    public listPublicRegistrations(): PushNotificationRegistration[] {
        return Array.from(this.registrations.values()).map((registration) => this.toPublicRegistration(registration));
    }

    public send(request: PushNotificationSendRequest, dryRun: boolean): PushNotificationSendResult {
        const parsed = PushNotificationSendRequest.parse(request);
        const matches = this.findRegistrations(parsed.target);

        if (dryRun) {
            return {
                dryRun: true,
                matched: matches.length,
                sent: 0,
                skippedReason: "dry-run",
            };
        }

        return {
            dryRun: false,
            matched: matches.length,
            sent: 0,
            skippedReason: "delivery-provider-not-configured",
        };
    }

    private findRegistrations(target: string): StoredPushNotificationRegistration[] {
        const registrations = Array.from(this.registrations.values());

        if (target === "all") {
            return registrations;
        }

        if (target.startsWith("user:")) {
            const userId = target.slice("user:".length);
            return registrations.filter((registration) => registration.userId === userId);
        }

        if (target.startsWith("room:")) {
            const roomId = target.slice("room:".length);
            return registrations.filter((registration) => registration.roomId === roomId);
        }

        return [];
    }

    private getRegistrationId(request: PushNotificationRegistrationRequest): string {
        const stableToken = request.subscription?.endpoint ?? request.token;
        return crypto
            .createHash("sha256")
            .update(stableToken ?? "")
            .digest("hex");
    }

    private toPublicRegistration(registration: StoredPushNotificationRegistration): PushNotificationRegistration {
        return {
            id: registration.id,
            platform: registration.platform,
            userId: registration.userId,
            roomId: registration.roomId,
            deviceId: registration.deviceId,
            createdAt: registration.createdAt,
            updatedAt: registration.updatedAt,
        };
    }
}
