import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { ADMIN_API_TOKEN } from "../enums/EnvironmentVariable";

export function adminToken(req: Request, res: Response, next: NextFunction): void {
    let token = req.header("admin-token"); // @deprecated, use the authorization header instead.
    token = token || req.header("authorization");

    if (!ADMIN_API_TOKEN) {
        res.status(401).end("No token configured!");
        return;
    }
    if (token !== ADMIN_API_TOKEN) {
        // The token that was sent is not logged: a caller with an old or mistyped token would write a real one to the logs.
        console.error("Admin access refused: the token sent is not the admin token");
        Sentry.captureException("Admin access refused: the token sent is not the admin token");
        res.status(401).end("Incorrect token");
        return;
    }

    next();
}
