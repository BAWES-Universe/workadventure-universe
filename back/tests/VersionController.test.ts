import type { Express, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { VersionController } from "../src/Controller/VersionController";

describe("VersionController", () => {
    it("exposes mobile update metadata", () => {
        const routes = new Map<string, (req: Request, res: Response) => void>();
        const app = {
            get: (path: string, handler: (req: Request, res: Response) => void) => {
                routes.set(path, handler);
            },
        } as unknown as Express;
        const status = vi.fn().mockReturnThis();
        const json = vi.fn();
        const res = { status, json } as unknown as Response;

        new VersionController(app);
        routes.get("/api/version")?.({} as Request, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            webVersion: "dev",
            minNativeVersion: "1.0.0",
            latestNativeVersion: "1.0.0",
            updateUrl: {
                android: "https://play.google.com/store/apps/details?id=net.bawes.universe",
                ios: undefined,
            },
        });
    });
});
