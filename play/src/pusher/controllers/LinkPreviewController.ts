import { z } from "zod";
import type { Request, Response } from "express";
import Debug from "debug";
import { validateQuery } from "../services/QueryValidator";
import type { ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { authenticated } from "../middlewares/Authenticated";
import { linkPreviewService } from "../services/LinkPreviewService";
import { BaseHttpController } from "./BaseHttpController";

const debug = Debug("pusher:requests");

export class LinkPreviewController extends BaseHttpController {
    routes(): void {
        /**
         * @openapi
         * /link-preview:
         *   get:
         *     description: Returns the title, description and image a public web page gives for link previews, for a
         *       link sent in the chat. The browser can't read other sites itself. Private and internal addresses are
         *       refused.
         *     parameters:
         *      - name: "url"
         *        in: "query"
         *        description: "The link to preview"
         *        type: "string"
         *        required: true
         *        example: "https://bawes.net"
         *     responses:
         *       200:
         *         description: The preview (siteName always, title, description and image when the page has them)
         *       422:
         *         description: The link can't be previewed (not public, not reachable, or not a page)
         */
        this.app.options("/link-preview", (req: Request, res: Response) => {
            res.status(200).send("");
            return;
        });

        this.app.get("/link-preview", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            debug(`LinkPreviewController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(
                req,
                res,
                z.object({
                    url: z.string().max(2048),
                })
            );
            if (query === undefined) {
                return;
            }

            try {
                const preview = await linkPreviewService.getPreview(query.url);
                res.setHeader("Cache-Control", "private, max-age=3600");
                res.status(200).json(preview);
            } catch (error) {
                debug(`No preview for ${query.url}: ${error}`);
                res.setHeader("Cache-Control", "private, max-age=600");
                res.status(422).send("This link can't be previewed");
            }
            return;
        });
    }
}
