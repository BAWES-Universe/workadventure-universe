import { z } from "zod";
import type { Request, Response } from "express";
import Debug from "debug";
import * as Sentry from "@sentry/node";
import { adminService } from "../services/AdminService";
import { validatePostQuery, validateQuery } from "../services/QueryValidator";
import type { ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { authenticated } from "../middlewares/Authenticated";
import { BAN_APPEAL_MAX_LENGTH } from "../services/BanDetails";
import { BaseHttpController } from "./BaseHttpController";

const debug = Debug("pusher:requests");

/**
 * The ban screen's data: the player's ban from the world of a room, and their one appeal against it.
 */
export class BanController extends BaseHttpController {
    routes(): void {
        this.getBanDetails();
        this.sendBanAppeal();
    }

    /**
     * @openapi
     * /ban/details:
     *   get:
     *     description: The player's ban from the world of a room (end date, reason, appeal), from the admin.
     *     parameters:
     *      - name: "Authorization"
     *        in: "header"
     *        required: true
     *        type: "string"
     *        description: The player's authentication token
     *      - name: "roomUrl"
     *        in: "query"
     *        required: true
     *        type: "string"
     *        example: "https://play.workadventu.re/@/teamSlug/worldSlug/roomSlug"
     *     responses:
     *       200:
     *         description: "{ banned, worldName?, expiresAt?, reason?, appeal? }"
     *       401:
     *         description: Missing or invalid token
     *       502:
     *         description: The admin could not be reached or sent an unexpected answer
     */
    private getBanDetails(): void {
        this.app.options("/ban/details", (req: Request, res: Response) => {
            res.status(200).send("");
            return;
        });

        this.app.get("/ban/details", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            debug(`BanController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(req, res, z.object({ roomUrl: z.string() }));
            if (query === undefined) {
                return;
            }
            if (!res.userIdentifier) {
                res.status(401).send("Undefined userIdentifier");
                return;
            }

            try {
                res.status(200).json(await adminService.getBanDetails(res.userIdentifier, query.roomUrl));
            } catch (e) {
                console.error("Could not get the ban details", e);
                Sentry.captureException(e);
                res.status(502).send("Could not get the ban details");
            }
            return;
        });
    }

    /**
     * @openapi
     * /ban/appeal:
     *   post:
     *     description: Sends the player's one appeal against their ban from the world of a room to its admins.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: "object"
     *             properties:
     *               roomUrl:
     *                 type: string
     *                 required: true
     *                 example: "https://play.workadventu.re/@/teamSlug/worldSlug/roomSlug"
     *               text:
     *                 type: string
     *                 required: true
     *                 description: The appeal, 1 to 1000 characters
     *     responses:
     *       200:
     *         description: "{ ok: true }"
     *       404:
     *         description: '{ error: "not_banned" }'
     *       409:
     *         description: '{ error: "already_appealed" }'
     */
    private sendBanAppeal(): void {
        this.app.options("/ban/appeal", (req: Request, res: Response) => {
            res.status(200).send("");
            return;
        });

        this.app.post("/ban/appeal", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            debug(`BanController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const body = validatePostQuery(
                req,
                res,
                z.object({
                    roomUrl: z.string(),
                    text: z.string().trim().min(1).max(BAN_APPEAL_MAX_LENGTH),
                })
            );
            if (body === undefined) {
                return;
            }
            if (!res.userIdentifier) {
                res.status(401).send("Undefined userIdentifier");
                return;
            }

            try {
                const result = await adminService.sendBanAppeal(res.userIdentifier, body.roomUrl, body.text);
                if (result === "already_appealed") res.status(409).json({ error: result });
                else if (result === "not_banned") res.status(404).json({ error: result });
                else res.status(200).json({ ok: true });
            } catch (e) {
                console.error("Could not send the ban appeal", e);
                Sentry.captureException(e);
                res.status(502).send("Could not send the ban appeal");
            }
            return;
        });
    }
}
