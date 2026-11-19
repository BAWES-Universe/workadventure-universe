import { beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    addMyApp: vi.fn<(app: unknown) => Promise<unknown>>(),
    disconnectMyApp: vi.fn<(id: string) => Promise<unknown>>(),
}));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));

import {
    cleanupsInProgress,
    findAndRemove,
    removeApp,
    resetCleanupsForTests,
    setCleanupDelaysForTests,
    settledCleanups,
} from "../AppCleanup";
import { destinationOf } from "../AddApp";

const withStatus = (status: number) => Object.assign(new Error(`API error: ${status}`), { status });
const body = { name: "Zapier", serverUrl: "https://a.example.com/mcp", authType: "none" as const, requestKey: "k1" };

describe("taking away an App nobody finished (#2001)", () => {
    beforeEach(() => {
        game.addMyApp.mockReset();
        game.disconnectMyApp.mockReset();
        resetCleanupsForTests();
        setCleanupDelaysForTests([1]);
    });

    it("asks again until Orbit confirms the delete", async () => {
        game.disconnectMyApp
            .mockRejectedValueOnce(new Error("no answer"))
            .mockRejectedValueOnce(withStatus(503))
            .mockResolvedValueOnce(undefined);
        await removeApp("app-1");
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(3);
        expect(cleanupsInProgress()).toBe(0);
    });

    it("counts an App that is not there as gone, and stops on an answer that will not change", async () => {
        game.disconnectMyApp.mockRejectedValueOnce(withStatus(404));
        await removeApp("app-1");
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(1);
        game.disconnectMyApp.mockRejectedValueOnce(withStatus(403));
        await removeApp("app-2");
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(2);
    });

    it("finds the App an unanswered try made, with the same key, and removes that one id even when the removal is retried", async () => {
        game.addMyApp.mockResolvedValue({ id: "app-9" });
        game.disconnectMyApp.mockRejectedValueOnce(withStatus(500)).mockResolvedValueOnce(undefined);
        await findAndRemove(body);
        // the App was found once; only its removal was asked again
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(game.addMyApp).toHaveBeenCalledWith(body);
        expect(game.disconnectMyApp).toHaveBeenNthCalledWith(1, "app-9");
        expect(game.disconnectMyApp).toHaveBeenNthCalledWith(2, "app-9");
    });

    it("asks again, with the same key, when Orbit answers with no id it can read, and removes the App once it has one", async () => {
        game.addMyApp.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "app-1" });
        game.disconnectMyApp.mockResolvedValue(undefined);
        await findAndRemove(body);
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(game.addMyApp).toHaveBeenNthCalledWith(2, body);
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("keeps looking while Orbit does not answer, but not after a refusal (nothing was made) or a used key", async () => {
        game.addMyApp.mockRejectedValueOnce(new Error("no answer")).mockRejectedValueOnce(withStatus(429));
        game.addMyApp.mockResolvedValueOnce({ id: "app-1" });
        game.disconnectMyApp.mockResolvedValue(undefined);
        await findAndRemove(body);
        expect(game.addMyApp).toHaveBeenCalledTimes(3);
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        game.addMyApp.mockReset();
        game.addMyApp.mockRejectedValueOnce(withStatus(400));
        await findAndRemove(body);
        game.addMyApp.mockRejectedValueOnce(withStatus(409));
        await findAndRemove(body);
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
    });

    it("settles when every clean-up has made its first attempt, without waiting for the retries", async () => {
        setCleanupDelaysForTests([600_000]);
        game.disconnectMyApp.mockRejectedValue(new Error("no answer"));
        void removeApp("app-1");
        await settledCleanups();
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(1);
        expect(cleanupsInProgress()).toBe(1);
        resetCleanupsForTests();
        expect(cleanupsInProgress()).toBe(0);
    });
});

describe("destinationOf", () => {
    it("is where a link goes, in lower case, and nothing for what is not a link", () => {
        expect(destinationOf("https://Tools.Example.com/mcp?x=1")).toBe("tools.example.com");
        expect(destinationOf(" https://tools.example.com:8443/a ")).toBe("tools.example.com:8443");
        expect(destinationOf("not a link")).toBe("");
        expect(destinationOf("")).toBe("");
    });
});
