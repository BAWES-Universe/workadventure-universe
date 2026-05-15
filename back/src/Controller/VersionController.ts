import type { Express, Request, Response } from "express";
import { getAppVersionResponse } from "../Services/VersionService";

export class VersionController {
    constructor(private app: Express) {
        this.app.get("/api/version", this.version.bind(this));
    }

    private version(req: Request, res: Response): void {
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json(getAppVersionResponse());
    }
}
