import { z } from "zod";
import type { Request, Response } from "express";
import Debug from "debug";
import type { ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { authenticated } from "../middlewares/Authenticated";
import { PerUserRateLimiter } from "../services/LinkPreviewService";
import { ArtifactsError, artifactsService } from "../services/ArtifactsService";
import type { ArtifactViewer } from "../services/ArtifactsService";
import { socketManager } from "../services/SocketManager";
import { isBubbleSpaceName } from "../services/SpaceJoinPolicy";
import { BaseHttpController } from "./BaseHttpController";

const debug = Debug("pusher:requests");

const MAX_ARTIFACT_REQUESTS_PER_USER_PER_MINUTE = 120;
const artifactRateLimiter = new PerUserRateLimiter(MAX_ARTIFACT_REQUESTS_PER_USER_PER_MINUTE, 60_000);

const ArtifactId = z.string().uuid();

/**
 * The chat the person opened the artifact from: the bubble's space (`nearby`, named as the bots name it) or the
 * Matrix room of a direct chat (`dm`). Only a bubble can be checked here, and only a bubble needs it: in a direct
 * chat the person is the one who asked for the artifact, and its owner may open it from anywhere.
 */
const Chat = z.object({ kind: z.enum(["nearby", "dm"]), ref: z.string().min(1).max(255) });

const OpenBody = z.object({
    chat: Chat.optional(),
    version: z.number().int().min(1).optional(),
});
const ViewerBody = z.object({ chat: Chat.optional() });

/** Who is looking and whether they are in the chat, as the pusher knows it (never as the browser claims it). */
export function viewerOf(
    userIdentifier: string,
    isLogged: boolean,
    chat: z.infer<typeof Chat> | undefined,
    isUserInSpace: (userIdentifier: string, spaceName: string) => boolean = (user, space) =>
        socketManager.isUserInSpace(user, space)
): ArtifactViewer {
    return {
        person: { signedIn: isLogged, identifier: userIdentifier },
        inChat: chat?.kind === "nearby" && isBubbleSpaceName(chat.ref) && isUserInSpace(userIdentifier, chat.ref),
        // Orbit counts inChat only when this is the chat the artifact was made in
        ...(chat ? { chat } : {}),
    };
}

function sendError(res: Response, error: unknown, what: string): void {
    if (error instanceof ArtifactsError) {
        res.status(error.status).json({ error: error.code });
        return;
    }
    // Never the artifact or the person: only that it broke
    console.error(`Could not ${what} an artifact:`, error instanceof Error ? error.message : "unknown error");
    res.status(502).json({ error: "artifacts_unavailable" });
}

/**
 * The browser's way to the live artifacts of the game (game #1422): opening one, its versions and its code. Orbit
 * holds the artifacts and decides who may see what; the pusher tells Orbit who is asking and whether they are in the
 * chat the artifact was made in.
 */
export class ArtifactController extends BaseHttpController {
    routes(): void {
        /**
         * @openapi
         * /artifacts/{id}/open:
         *   post:
         *     description: Opens a live artifact for the signed token's person. Answers with the artifact, the version to
         *       show (the latest unless one is asked for), the address its file is served from, and what the person may do.
         *     responses:
         *       200:
         *         description: The artifact and what the person may do with it
         *       404:
         *         description: No such artifact, or the person may not open it
         *       429:
         *         description: Too many requests; try again in a minute
         */
        this.app.options("/artifacts/:id/open", (req: Request, res: Response) => {
            res.status(200).send("");
        });
        this.app.options("/artifacts/:id/versions", (req: Request, res: Response) => {
            res.status(200).send("");
        });
        this.app.options("/artifacts/:id/versions/:number", (req: Request, res: Response) => {
            res.status(200).send("");
        });

        this.app.post("/artifacts/:id/open", [authenticated], async (req: Request, res: ResponseWithUserIdentifier) => {
            await this.answer(req, res, "open", async (viewer, id) => {
                const body = OpenBody.safeParse(req.body ?? {});
                if (!body.success) throw new ArtifactsError("invalid_request", 400);
                return artifactsService.open(id, viewer(body.data.chat), body.data.version);
            });
        });

        this.app.post(
            "/artifacts/:id/versions",
            [authenticated],
            async (req: Request, res: ResponseWithUserIdentifier) => {
                await this.answer(req, res, "list the versions of", async (viewer, id) => {
                    const body = ViewerBody.safeParse(req.body ?? {});
                    if (!body.success) throw new ArtifactsError("invalid_request", 400);
                    return { versions: await artifactsService.listVersions(id, viewer(body.data.chat)) };
                });
            }
        );

        this.app.post(
            "/artifacts/:id/versions/:number",
            [authenticated],
            async (req: Request, res: ResponseWithUserIdentifier) => {
                await this.answer(req, res, "read the code of", async (viewer, id) => {
                    const number = z.coerce.number().int().min(1).safeParse(req.params.number);
                    const body = ViewerBody.safeParse(req.body ?? {});
                    if (!number.success || !body.success) throw new ArtifactsError("invalid_request", 400);
                    return artifactsService.readCode(id, number.data, viewer(body.data.chat));
                });
            }
        );
    }

    private async answer(
        req: Request,
        res: ResponseWithUserIdentifier,
        what: string,
        handle: (viewer: (chat: z.infer<typeof Chat> | undefined) => ArtifactViewer, id: string) => Promise<unknown>
    ): Promise<void> {
        debug(`ArtifactController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
        const id = ArtifactId.safeParse(req.params.id);
        if (!id.success) {
            res.status(404).json({ error: "not_found" });
            return;
        }
        const user = res.userIdentifier;
        if (!user) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        if (!artifactRateLimiter.take(user)) {
            res.status(429).json({ error: "too_many_requests" });
            return;
        }
        try {
            const answer = await handle((chat) => viewerOf(user, res.isLogged ?? false, chat), id.data);
            res.setHeader("Cache-Control", "no-store");
            res.status(200).json(answer);
        } catch (error) {
            sendError(res, error, what);
        }
    }
}
