import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => {
    const scope = {
        setLevel: vi.fn(),
        setTags: vi.fn(),
        setFingerprint: vi.fn(),
        setExtras: vi.fn(),
    };
    return {
        scope,
        captureException: vi.fn(),
        withScope: vi.fn((callback: (scope: unknown) => void) => callback(scope)),
    };
});
vi.mock("@sentry/svelte", () => ({ withScope: sentry.withScope, captureException: sentry.captureException }));

import { ResourceLoadError } from "../../Services/SuperLoaderPlugin";
import {
    reportWokaLoadFailure,
    reportWokaLoadStalled,
    resetWokaLoadReports,
    WOKA_STALL_REPORT_MS,
} from "../WokaLoadReporter";
import { lazyLoadPlayerCharacterTextures } from "../PlayerTexturesLoadingManager";

beforeAll(() => {
    vi.stubGlobal("Phaser", { Textures: { Texture: class {} } });
});

beforeEach(() => {
    resetWokaLoadReports();
    vi.clearAllMocks();
});

const failure = new ResourceLoadError('Failed loading "spritesheet": "a.png"', "body_1", "a.png", "load-error");

describe("reportWokaLoadFailure", () => {
    it("sends one warning when the stand-in was drawn, with ids, reason and the failing picture", () => {
        reportWokaLoadFailure("character", failure, {
            textures: [
                { id: "body_1", url: "a.png" },
                { id: "eyes_2", url: "b.png" },
            ],
            userId: 7,
        });

        expect(sentry.captureException).toHaveBeenCalledTimes(1);
        expect(sentry.scope.setLevel).toHaveBeenCalledWith("warning");
        expect(sentry.scope.setTags).toHaveBeenCalledWith({
            woka_source: "character",
            woka_outcome: "stand-in-drawn",
            woka_reason: "load-error",
        });
        expect(sentry.scope.setExtras).toHaveBeenCalledWith(
            expect.objectContaining({
                textureIds: ["body_1", "eyes_2"],
                failedTextureId: "body_1",
                failedTextureUrl: "a.png",
                userId: 7,
            })
        );
    });

    it("sends an error when the stand-in failed too, with both causes", () => {
        reportWokaLoadFailure("character", failure, { standInError: new Error("stand-in gone") });

        expect(sentry.scope.setLevel).toHaveBeenCalledWith("error");
        expect(sentry.scope.setTags).toHaveBeenCalledWith(expect.objectContaining({ woka_outcome: "nothing-drawn" }));
        expect(sentry.scope.setExtras).toHaveBeenCalledWith(expect.objectContaining({ standInError: "stand-in gone" }));
    });

    it("sends the same case only once, so a shared broken picture does not spam Sentry", () => {
        for (let i = 0; i < 50; i++) {
            reportWokaLoadFailure("character", failure, { userId: i });
        }
        expect(sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it("stops after a handful of different cases", () => {
        for (let i = 0; i < 50; i++) {
            reportWokaLoadFailure("character", new ResourceLoadError("x", `body_${i}`, `${i}.png`, "load-error"));
        }
        expect(sentry.captureException).toHaveBeenCalledTimes(15);
    });

    it("never throws into the drawing code if Sentry does", () => {
        sentry.withScope.mockImplementationOnce(() => {
            throw new Error("sentry down");
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(() => reportWokaLoadFailure("character", failure)).not.toThrow();
        warn.mockRestore();
    });
});

describe("a load that never finishes", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("is reported once after the wait, with the picture ids", async () => {
        vi.useFakeTimers();
        const CancelablePromise = (await import("cancelable-promise")).default;
        const loader = {
            spritesheet: () => new CancelablePromise(() => undefined),
            isSceneDestroyed: () => false,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lazyLoadPlayerCharacterTextures(loader as any, [{ id: "body_1", url: "a.png" }]);

        vi.advanceTimersByTime(WOKA_STALL_REPORT_MS - 1);
        expect(sentry.captureException).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(sentry.captureException).toHaveBeenCalledTimes(1);
        expect(sentry.scope.setTags).toHaveBeenCalledWith({
            woka_source: "loader",
            woka_outcome: "stalled",
            woka_reason: "no-answer",
        });
    });

    it("is not reported when the room was closed meanwhile", async () => {
        vi.useFakeTimers();
        const CancelablePromise = (await import("cancelable-promise")).default;
        const loader = {
            spritesheet: () => new CancelablePromise(() => undefined),
            isSceneDestroyed: () => true,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lazyLoadPlayerCharacterTextures(loader as any, [{ id: "body_1", url: "a.png" }]);
        vi.advanceTimersByTime(WOKA_STALL_REPORT_MS + 1);
        expect(sentry.captureException).not.toHaveBeenCalled();
    });

    it("is not reported when the pictures arrived", async () => {
        vi.useFakeTimers();
        const CancelablePromise = (await import("cancelable-promise")).default;
        const loader = {
            spritesheet: () => CancelablePromise.resolve({}),
            isSceneDestroyed: () => false,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await lazyLoadPlayerCharacterTextures(loader as any, [{ id: "body_1", url: "a.png" }]);
        vi.advanceTimersByTime(WOKA_STALL_REPORT_MS + 1);
        expect(sentry.captureException).not.toHaveBeenCalled();
    });

    it("sends the stall once even when asked twice", () => {
        reportWokaLoadStalled([{ id: "body_1", url: "a.png" }]);
        reportWokaLoadStalled([{ id: "body_1", url: "a.png" }]);
        expect(sentry.captureException).toHaveBeenCalledTimes(1);
    });
});
