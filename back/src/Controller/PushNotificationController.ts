import crypto from "crypto";
import type { Express, Request, Response } from "express";
import type { ZodError } from "zod";
import { PUSH_NOTIFICATIONS_DRY_RUN, PUSH_SERVICE_TOKEN, PUSH_VAPID_PUBLIC_KEY } from "../Enum/EnvironmentVariable";
import {
    PushNotificationRegistrationRequest,
    PushNotificationSendRequest,
    PushNotificationService,
} from "../Services/PushNotificationService";

/**
 * PushNotificationController exposes HTTP endpoints for browser VAPID key discovery,
 * native/web push token registration, device unregistration, and service-authenticated
 * notification dispatch triggered by server-side events or bots.
 */

export function extractServiceToken(req: Request): string | undefined {
    const authorization = req.header("authorization");
    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length).trim();
    }
    return req.header("x-push-service-token")?.trim();
}

export function isMatchingServiceToken(candidate: string | undefined, expected: string | undefined): boolean {
    if (!candidate || !expected) {
        return false;
    }
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    if (candidateBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

export class PushNotificationController {
    constructor(private app: Express, private pushNotificationService = new PushNotificationService()) {
        this.registerVapidPublicKeyRoute();
        this.registerSubscriptionRoute();
        this.registerUnregisterRoute();
        this.registerSendRoute();
    }

    private registerVapidPublicKeyRoute(): void {
        this.app.get("/api/push/vapid-public-key", (_req: Request, res: Response): void => {
            res.status(200).json({
                publicKey: PUSH_VAPID_PUBLIC_KEY ?? null,
            });
        });
    }

    private registerSubscriptionRoute(): void {
        this.app.post("/api/push/register", (req: Request, res: Response): void => {
            const parsed = PushNotificationRegistrationRequest.safeParse(req.body);
            if (!parsed.success) {
                this.sendValidationError(res, parsed.error);
                return;
            }

            const registration = this.pushNotificationService.register(parsed.data);
            res.status(201).json({ registration });
        });
    }

    private registerUnregisterRoute(): void {
        this.app.delete("/api/push/register/:id", (req: Request, res: Response): void => {
            const registrationId = String(req.params.id ?? "").trim();
            if (!registrationId) {
                res.status(400).json({ message: "Missing push registration id" });
                return;
            }

            const removed = this.pushNotificationService.unregister(registrationId);
            res.status(200).json({ removed });
        });
    }

    private registerSendRoute(): void {
        this.app.post("/api/push/send", async (req: Request, res: Response): Promise<void> => {
            if (!this.authorizeServiceRequest(req, res)) {
                return;
            }

            const parsed = PushNotificationSendRequest.safeParse(req.body);
            if (!parsed.success) {
                this.sendValidationError(res, parsed.error);
                return;
            }

            const result = await this.pushNotificationService.send(parsed.data, PUSH_NOTIFICATIONS_DRY_RUN);
            res.status(202).json(result);
        });
    }

    private authorizeServiceRequest(req: Request, res: Response): boolean {
        if (!PUSH_SERVICE_TOKEN) {
            res.status(401).send("No push service token configured!");
            return false;
        }

        const token = extractServiceToken(req);
        if (!isMatchingServiceToken(token, PUSH_SERVICE_TOKEN)) {
            res.status(401).send("Invalid push service token sent!");
            return false;
        }

        return true;
    }

    private sendValidationError(res: Response, error: ZodError): void {
        res.status(400).json({
            message: "Invalid push notification payload",
            issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        });
    }
}
