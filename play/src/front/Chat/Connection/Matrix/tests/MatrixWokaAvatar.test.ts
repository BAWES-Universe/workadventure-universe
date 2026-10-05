import { describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import {
    WOKA_AVATAR_ACCOUNT_DATA,
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
