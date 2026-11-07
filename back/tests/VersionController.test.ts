import type { Express, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_ANDROID_UPDATE_URL,
    DEFAULT_IOS_UPDATE_URL,
    DEFAULT_LATEST_NATIVE_VERSION,
    DEFAULT_MIN_NATIVE_VERSION,
    DEFAULT_WEB_VERSION,
    VersionController,
    buildVersionPayload,
    resolveWebVersion,
} from "../src/Controller/VersionController";

interface CapturedRoute {
    path: string;
    handler: (req: Request, res: Response) => void;
}

function createMockExpress(): { app: Express; routes: CapturedRoute[] } {
    const routes: CapturedRoute[] = [];
    const app = {
        get: vi.fn((path: string, handler: (req: Request, res: Response) => void) => {
            routes.push({ path, handler });
        }),
    } as unknown as Express;
    return { app, routes };
}

function createMockResponse(): { res: Response; headers: Map<string, string>; statusCode: () => number; body: () => unknown } {
    const headers = new Map<string, string>();
    let currentStatus = 200;
    let payload: unknown;
    const res = {
        setHeader: vi.fn((key: string, value: string) => {
            headers.set(key, value);
            return res;
        }),
        status: vi.fn((code: number) => {
            currentStatus = code;
            return res;
        }),
        json: vi.fn((data: unknown) => {
            payload = data;
            return res;
        }),
    } as unknown as Response;
    return { res, headers, statusCode: () => currentStatus, body: () => payload };
}

describe("VersionController", () => {
    it("returns default version metadata when no environment overrides are provided", () => {
        const payload = buildVersionPayload({ packageVersion: "dev" });
        expect(payload).toEqual({
            webVersion: DEFAULT_WEB_VERSION,
            minNativeVersion: DEFAULT_MIN_NATIVE_VERSION,
            latestNativeVersion: DEFAULT_LATEST_NATIVE_VERSION,
            updateUrl: {
                android: DEFAULT_ANDROID_UPDATE_URL,
                ios: DEFAULT_IOS_UPDATE_URL,
            },
        });
    });

    it("prefers explicit environment overrides for version gates and store URLs", () => {
        const payload = buildVersionPayload({
            webVersion: "2026.06.01",
            releaseVersion: "0.4.0",
            minNativeVersion: "1.1.0",
            latestNativeVersion: "1.3.0",
            androidUpdateUrl: "https://play.google.com/store/apps/details?id=net.bawes.universe.beta",
            iosUpdateUrl: "https://apps.apple.com/app/id1234567890",
        });
        expect(payload).toEqual({
            webVersion: "2026.06.01",
            minNativeVersion: "1.1.0",
            latestNativeVersion: "1.3.0",
            updateUrl: {
                android: "https://play.google.com/store/apps/details?id=net.bawes.universe.beta",
                ios: "https://apps.apple.com/app/id1234567890",
            },
        });
    });

    it("falls back to releaseVersion or non-dev packageVersion before default webVersion", () => {
        expect(resolveWebVersion({ releaseVersion: "2026.05.20", packageVersion: "0.4.0" })).toBe("2026.05.20");
        expect(resolveWebVersion({ packageVersion: "0.4.0" })).toBe("0.4.0");
        expect(resolveWebVersion({ packageVersion: "dev" })).toBe(DEFAULT_WEB_VERSION);
    });

    it("registers GET /api/version with Cache-Control no-store and 200 JSON payload", () => {
        const { app, routes } = createMockExpress();
        new VersionController(app);
        expect(routes).toHaveLength(1);
        expect(routes[0].path).toBe("/api/version");

        const { res, headers, statusCode, body } = createMockResponse();
        routes[0].handler({} as Request, res);
        expect(headers.get("Cache-Control")).toBe("no-store");
        expect(statusCode()).toBe(200);
        expect(body()).toMatchObject({
            minNativeVersion: DEFAULT_MIN_NATIVE_VERSION,
            latestNativeVersion: DEFAULT_LATEST_NATIVE_VERSION,
        });
    });
});
