import type { Express, NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { PUSH_NOTIFICATIONS_DRY_RUN, PUSH_SERVICE_TOKEN, PUSH_VAPID_PUBLIC_KEY } from "../Enum/EnvironmentVariable";
import {
    PushNotificationRegistrationRequest,
    PushNotificationSendRequest,
    PushNotificationService,
} from "../Services/PushNotificationService";

const validatePushServiceTokenMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!PUSH_SERVICE_TOKEN) {
        res.status(401).send("No push service token configured!");
        return;
    }

    const authorization = req.header("authorization");
    const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    const token = bearerToken;

    if (token !== PUSH_SERVICE_TOKEN) {
        res.status(401).send("Invalid push service token sent!");
        return;
    }

    next();
};

export class PushNotificationController {
    constructor(private app: Express, private pushNotificationService = new PushNotificationService()) {
        this.getVapidPublicKey();
        this.register();
        this.send();
    }

    private getVapidPublicKey(): void {
        this.app.get("/api/push/vapid-public-key", (req: Request, res: Response): void => {
            res.status(200).json({
                publicKey: PUSH_VAPID_PUBLIC_KEY ?? null,
            });
        });
    }

    private register(): void {
        this.app.post("/api/push/register", (req: Request, res: Response): void => {
            const parsed = PushNotificationRegistrationRequest.safeParse(req.body);

            if (!parsed.success) {
                this.sendValidationError(res, parsed.error);
                return;
            }

            // User and room identity must be bound server-side once authenticated context is wired.
            const registration = this.pushNotificationService.register({
                platform: parsed.data.platform,
                ...(parsed.data.token !== undefined ? { token: parsed.data.token } : {}),
                ...(parsed.data.subscription !== undefined ? { subscription: parsed.data.subscription } : {}),
                ...(parsed.data.deviceId !== undefined ? { deviceId: parsed.data.deviceId } : {}),
            });
            res.status(201).json({ registration });
        });
    }

    private send(): void {
        this.app.post("/api/push/send", validatePushServiceTokenMiddleware, (req: Request, res: Response): void => {
            const parsed = PushNotificationSendRequest.safeParse(req.body);

            if (!parsed.success) {
                this.sendValidationError(res, parsed.error);
                return;
            }

            const result = this.pushNotificationService.send(parsed.data, PUSH_NOTIFICATIONS_DRY_RUN);
            res.status(202).json(result);
        });
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
