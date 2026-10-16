import { z } from "zod";
import type { Request } from "express";
import Debug from "debug";
import * as Sentry from "@sentry/node";
import { adminService } from "../services/AdminService";
import { validateQuery } from "../services/QueryValidator";
import { describeError } from "../services/SafeErrorLog";
import type { ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { authenticated } from "../middlewares/Authenticated";
import { BaseHttpController } from "./BaseHttpController";

const debug = Debug("pusher:requests");

/**
 * What the player wears and wore lately in a room. The picker draws its Recent row from it and the "can't be worn
 * here" popup draws both outfits from it.
 */
export class WokaMineController extends BaseHttpController {
    routes(): void {
        this.app.options("/woka/mine", (req, res) => {
            res.status(200).send("");
            return;
        });

        this.app.get("/woka/mine", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            debug(`WokaMineController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(req, res, z.object({ roomUrl: z.string() }));
            if (query === undefined) {
                return;
            }

            // A guest wears what their device remembers: there is nothing on an account to tell.
            if (!res.userIdentifier || !res.isLogged) {
                res.status(404).send("Not found");
                return;
            }

            try {
                const mine = await adminService.getWokaMine(res.userIdentifier, query.roomUrl);
                if (mine === undefined) {
                    res.status(404).send("Not found");
                    return;
                }
                res.status(200).json(mine);
            } catch (err) {
                Sentry.captureException(`Cannot get woka/mine from admin API: ${describeError(err)}`);
                res.status(502).send("Error on getting data");
            }
            return;
        });
    }
}
