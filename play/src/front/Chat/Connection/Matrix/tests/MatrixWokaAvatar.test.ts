import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import {
    WOKA_AVATAR_ACCOUNT_DATA,
    WOKA_AVATAR_RETRY_DELAYS,
    WokaAvatarSaver,
    hashWoka,
    parseSavedWokaAvatar,
    saveWokaAvatar,
    shouldSaveWokaAvatar,
} from "../MatrixWokaAvatar";

describe("shouldSaveWokaAvatar", () => {
    const saved = { hash: "old", mxc: "mxc://x/woka" };

    it("saves when there is no picture yet", () => {
        expect(shouldSaveWokaAvatar(undefined, undefined, "new")).toBe(true);
        expect(shouldSaveWokaAvatar("", saved, "new")).toBe(true);
    });

    it("replaces the woka it saved before when the woka changed", () => {
        expect(shouldSaveWokaAvatar("mxc://x/woka", saved, "new")).toBe(true);
    });

    it("does nothing when the same woka is already saved", () => {
        expect(shouldSaveWokaAvatar("mxc://x/woka", saved, "old")).toBe(false);
    });

    it("keeps a picture they chose in another chat app", () => {
        expect(shouldSaveWokaAvatar("mxc://x/photo", saved, "new")).toBe(false);
        expect(shouldSaveWokaAvatar("mxc://x/photo", undefined, "new")).toBe(false);
    });
});

describe("parseSavedWokaAvatar", () => {
    it("reads only a complete record", () => {
        expect(parseSavedWokaAvatar({ hash: "h", mxc: "mxc://x/y" })).toEqual({ hash: "h", mxc: "mxc://x/y" });
        expect(parseSavedWokaAvatar({ hash: "h" })).toBeUndefined();
        expect(parseSavedWokaAvatar(undefined)).toBeUndefined();
    });
});

describe("saveWokaAvatar", () => {
    function fakeClient(avatar: string | undefined, saved: unknown) {
        return {
            getUserId: () => "@me:x",
            getAccountData: (type: string) =>
                type === WOKA_AVATAR_ACCOUNT_DATA && saved ? { getContent: () => saved } : undefined,
            getProfileInfo: vi.fn().mockResolvedValue({ avatar_url: avatar }),
            uploadContent: vi.fn(),
            setAvatarUrl: vi.fn(),
            setAccountData: vi.fn(),
        };
    }

    it("doesn't upload again when this woka is already the picture", async () => {
        const woka = "data:image/png;base64,AAAA";
        const client = fakeClient("mxc://x/woka", { hash: await hashWoka(woka), mxc: "mxc://x/woka" });

        await saveWokaAvatar(client as unknown as MatrixClient, woka);

        expect(client.uploadContent).not.toHaveBeenCalled();
        expect(client.setAvatarUrl).not.toHaveBeenCalled();
    });

    it("leaves a picture chosen elsewhere alone", async () => {
        const client = fakeClient("mxc://x/photo", undefined);

        await saveWokaAvatar(client as unknown as MatrixClient, "data:image/png;base64,AAAA");

        expect(client.uploadContent).not.toHaveBeenCalled();
    });

    it("saves nothing when the current picture can't be read", async () => {
        const client = fakeClient(undefined, undefined);
        client.getProfileInfo.mockRejectedValue(new Error("offline"));

        await expect(saveWokaAvatar(client as unknown as MatrixClient, "data:image/png;base64,AAAA")).rejects.toThrow();
        expect(client.uploadContent).not.toHaveBeenCalled();
    });
});

describe("WokaAvatarSaver", () => {
    const client = {} as MatrixClient;

    afterEach(() => vi.useRealTimers());

    it("tries again after a failed save", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
        const saver = new WokaAvatarSaver(client, save);

        saver.update("data:image/png;base64,AAAA");
        await saver.settled;
        expect(save).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(WOKA_AVATAR_RETRY_DELAYS[0]);
        await saver.settled;
        expect(save).toHaveBeenCalledTimes(2);
    });

    it("gives up after the last retry", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const save = vi.fn().mockRejectedValue(new Error("offline"));
        const saver = new WokaAvatarSaver(client, save);

        saver.update("data:image/png;base64,AAAA");
        // Each retry waits for the one before it.
        await WOKA_AVATAR_RETRY_DELAYS.reduce(async (previous, delay) => {
            await previous;
            await saver.settled;
            await vi.advanceTimersByTimeAsync(delay);
        }, Promise.resolve());
        await saver.settled;
        await vi.advanceTimersByTimeAsync(10 * 60_000);

        expect(save).toHaveBeenCalledTimes(WOKA_AVATAR_RETRY_DELAYS.length + 1);
    });

    it("saves only the latest woka, and stops retrying once stopped", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const save = vi.fn().mockRejectedValue(new Error("offline"));
        const saver = new WokaAvatarSaver(client, save);

        saver.update("data:image/png;base64,OLD");
        saver.update("data:image/png;base64,NEW");
        await saver.settled;
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(client, "data:image/png;base64,NEW");

        saver.stop();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(save).toHaveBeenCalledTimes(1);
    });
});
