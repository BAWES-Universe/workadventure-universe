import type { Express, Request, Response } from "express";
import { getMobileVersionPayload } from "../Services/MobileVersionService";

export class VersionController {
    constructor(private app: Express) {
        this.app.get("/api/version", this.version.bind(this));
    }

    private version(req: Request, res: Response): void {
        res.status(200).json(getMobileVersionPayload());
    }
}
