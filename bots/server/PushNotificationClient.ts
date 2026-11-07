import { timingSafeEqual } from "crypto";
import axios from "axios";
import express, { type Request, type Response, type Router } from "express";

/**
 * PushNotificationClient enables autonomous bots and server-side game event hooks
 * in `bots/` to dispatch targeted notifications (`all`, `user:{id}`, `room:{roomId}`)
 * through the backend `/api/push/send` gateway.
 */

export interface BotPushNotificationPayload {
    target: string;
    title: string;
    body: string;
    url?: string;
    chatRoomId?: string;
}

export interface BotUserNotificationEvent {
    userId: string;
    title: string;
    body: string;
    url?: string;
    chatRoomId?: string;
}

export interface BotRoomNotificationEvent {
    roomId: string;
    title: string;
    body: string;
    url?: string;
    chatRoomId?: string;
}

export interface BotBroadcastNotificationEvent {
    title: string;
    body: string;
    url?: string;
}

export interface BotPushNotificationResult {
    dryRun: boolean;
    matched: number;
    sent: number;
    forwarded: boolean;
    skippedReason?: string;
}

export interface PushNotificationClientOptions {
    baseUrl?: string;
    serviceToken?: string;
}

const DEFAULT_PUSH_API_URL = "http://localhost:8080";

function resolveDefaultBaseUrl(): string {
    return (
        process.env.PUSH_API_URL ||
        process.env.WORKADVENTURE_URL ||
        process.env.PUSHER_URL ||
        DEFAULT_PUSH_API_URL
    );
}

function normalizeHttpBaseUrl(value: string): string {
    return value
        .trim()
        .replace(/^ws:\/\//, "http://")
        .replace(/^wss:\/\//, "https://")
        .replace(/\/+$/, "");
}

function extractBotToken(req: Request): string | undefined {
    const auth = req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
        return auth.slice("Bearer ".length).trim();
    }
    return req.header("x-bot-service-token")?.trim();
}

export function isBotServiceTokenValid(candidate: string | undefined, expected: string | undefined): boolean {
    if (!candidate || !expected) {
        return false;
    }
    const candidateBuf = Buffer.from(candidate);
    const expectedBuf = Buffer.from(expected);
    if (candidateBuf.length !== expectedBuf.length) {
        return false;
    }
    return timingSafeEqual(candidateBuf, expectedBuf);
}

export function parseBotPushPayload(body: unknown): BotPushNotificationPayload | null {
    if (!body || typeof body !== "object") {
        return null;
    }
    const candidate = body as Record<string, unknown>;
    if (!isRequiredStringTriple(candidate)) {
        return null;
    }
    return {
        target: String(candidate.target),
        title: String(candidate.title),
        body: String(candidate.body),
        ...(typeof candidate.url === "string" ? { url: candidate.url } : {}),
        ...(typeof candidate.chatRoomId === "string" ? { chatRoomId: candidate.chatRoomId } : {}),
    };
}

function isRequiredStringTriple(candidate: Record<string, unknown>): boolean {
    if (typeof candidate.target !== "string" || !candidate.target.trim()) {
        return false;
    }
    return typeof candidate.title === "string" && typeof candidate.body === "string";
}

export class PushNotificationClient {
    private readonly baseUrl: string;
    private readonly serviceToken: string;

    constructor(options: PushNotificationClientOptions = {}) {
        this.baseUrl = options.baseUrl ?? resolveDefaultBaseUrl();
        this.serviceToken = options.serviceToken ?? (process.env.PUSH_SERVICE_TOKEN || "");
    }

    public isConfigured(): boolean {
        return Boolean(this.baseUrl.trim()) && Boolean(this.serviceToken.trim());
    }

    public async notifyUser(event: BotUserNotificationEvent): Promise<BotPushNotificationResult> {
        return this.send({
            target: `user:${event.userId}`,
            title: event.title,
            body: event.body,
            url: event.url,
            chatRoomId: event.chatRoomId,
        });
    }

    public async notifyRoom(event: BotRoomNotificationEvent): Promise<BotPushNotificationResult> {
        return this.send({
            target: `room:${event.roomId}`,
            title: event.title,
            body: event.body,
            url: event.url,
            chatRoomId: event.chatRoomId,
        });
    }

    public async notifyAll(event: BotBroadcastNotificationEvent): Promise<BotPushNotificationResult> {
        return this.send({
            target: "all",
            title: event.title,
            body: event.body,
            url: event.url,
        });
    }

    public async send(payload: BotPushNotificationPayload): Promise<BotPushNotificationResult> {
        if (!this.isConfigured()) {
            return {
                dryRun: true,
                matched: 0,
                sent: 0,
                forwarded: false,
                skippedReason: "push-service-not-configured",
            };
        }

        const response = await axios.post(`${normalizeHttpBaseUrl(this.baseUrl)}/api/push/send`, payload, {
            headers: {
                Authorization: `Bearer ${this.serviceToken}`,
            },
            timeout: 5000,
        });

        const data = (response.data ?? {}) as Record<string, unknown>;
        return {
            dryRun: Boolean(data.dryRun),
            matched: Number(data.matched ?? 0),
            sent: Number(data.sent ?? 0),
            forwarded: true,
            ...(typeof data.skippedReason === "string" ? { skippedReason: data.skippedReason } : {}),
        };
    }
}

/**
 * Creates an Express router mounting `POST /api/bots/notifications/send` so bot
 * behaviors and external webhooks authenticated with `BOT_SERVICE_TOKEN` can
 * trigger player or room notifications.
 */
export function createBotPushNotificationRouter(
    client: PushNotificationClient = new PushNotificationClient()
): Router {
    const router = express.Router();
    router.post("/api/bots/notifications/send", async (req: Request, res: Response): Promise<void> => {
        if (!isBotServiceTokenValid(extractBotToken(req), process.env.BOT_SERVICE_TOKEN)) {
            res.status(401).json({ error: "Invalid or missing bot service token" });
            return;
        }
        const payload = parseBotPushPayload(req.body);
        if (!payload) {
            res.status(400).json({ error: "Invalid bot push notification payload" });
            return;
        }
        try {
            const result = await client.send(payload);
            res.status(202).json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Push dispatch failed";
            res.status(502).json({ error: message });
        }
    });
    return router;
}
