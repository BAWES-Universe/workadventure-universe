import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VersionController as VersionControllerType } from "../src/Controller/VersionController";

const mobileEnvKeys = [
    "PLAY_URL",
    "MOBILE_WEB_VERSION",
    "MOBILE_MIN_NATIVE_VERSION",
    "MOBILE_LATEST_NATIVE_VERSION",
    "MOBILE_ANDROID_UPDATE_URL",
    "MOBILE_IOS_UPDATE_URL",
] as const;

interface VersionResponse {
    webVersion: string;
    minNativeVersion: string;
    latestNativeVersion: string;
    updateUrl: {
        android: string;
        ios?: string;
    };
}

async function loadVersionController(): Promise<typeof VersionControllerType> {
    vi.resetModules();
    process.env.PLAY_URL = "http://play.workadventure.localhost";
    const { VersionController } = await import("../src/Controller/VersionController");
    return VersionController;
}

function createRouteHarness(): {
    routes: Map<string, (req: Request, res: Response) => void>;
    app: Express;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn<(body: VersionResponse) => void>>;
    res: Response;
} {
    const routes = new Map<string, (req: Request, res: Response) => void>();
    const app = {
        get: (path: string, handler: (req: Request, res: Response) => void) => {
            routes.set(path, handler);
        },
    } as unknown as Express;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn<(body: VersionResponse) => void>();
    const res = { status, json } as unknown as Response;

    return { routes, app, status, json, res };
}

afterEach(() => {
    for (const key of mobileEnvKeys) {
        delete process.env[key];
    }
});

describe("VersionController", () => {
    it("exposes mobile update metadata", async () => {
        const VersionController = await loadVersionController();
        const { routes, app, status, json, res } = createRouteHarness();

        new VersionController(app);
        routes.get("/api/version")?.({} as Request, res);

        expect(status).toHaveBeenCalledWith(200);
        const payload = json.mock.calls[0]?.[0];
        expect(payload).toMatchObject({
            webVersion: "dev",
            minNativeVersion: "1.0.0",
            latestNativeVersion: "1.0.0",
            updateUrl: {
                android: "https://play.google.com/store/apps/details?id=net.bawes.universe",
            },
        });
        expect(payload?.updateUrl).not.toHaveProperty("ios");
    });

    it("exposes configured mobile update metadata", async () => {
        process.env.MOBILE_WEB_VERSION = "2026.05.15";
        process.env.MOBILE_MIN_NATIVE_VERSION = "1.2.3";
        process.env.MOBILE_LATEST_NATIVE_VERSION = "1.4.0";
        process.env.MOBILE_ANDROID_UPDATE_URL = "https://play.google.com/store/apps/details?id=net.bawes.custom";
        process.env.MOBILE_IOS_UPDATE_URL = "https://apps.apple.com/app/id1234567890";
        const VersionController = await loadVersionController();
        const { routes, app, status, json, res } = createRouteHarness();

        new VersionController(app);
        routes.get("/api/version")?.({} as Request, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            webVersion: "2026.05.15",
            minNativeVersion: "1.2.3",
            latestNativeVersion: "1.4.0",
            updateUrl: {
                android: "https://play.google.com/store/apps/details?id=net.bawes.custom",
                ios: "https://apps.apple.com/app/id1234567890",
            },
        });
    });

    it("keeps minimum and latest native versions distinct", async () => {
        process.env.MOBILE_MIN_NATIVE_VERSION = "1.0.0";
        process.env.MOBILE_LATEST_NATIVE_VERSION = "1.2.0";
        const VersionController = await loadVersionController();
        const { routes, app, json, res } = createRouteHarness();

        new VersionController(app);
        routes.get("/api/version")?.({} as Request, res);

        expect(json.mock.calls[0]?.[0]).toMatchObject({
            minNativeVersion: "1.0.0",
            latestNativeVersion: "1.2.0",
        });
    });
});
