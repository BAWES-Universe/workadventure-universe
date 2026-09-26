import { describe, expect, it, vi } from "vitest";
import { get, readable, writable } from "svelte/store";

const sceneHolder = vi.hoisted(() => ({ scene: undefined as unknown }));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => {
            if (!sceneHolder.scene) throw new Error("Not the Game Scene");
            return sceneHolder.scene;
        },
        tryGetCurrentGameScene: () => sceneHolder.scene,
    },
}));
vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: {
        isLogged: () => false,
        getLocalUser: () => undefined,
        getChatId: () => undefined,
        getName: () => "Me",
    },
}));
vi.mock("../../Stores/MediaStore", () => ({ availabilityStatusStore: writable(0) }));
vi.mock("../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { localSpaceUser } from "../localSpaceUser";

describe("localSpaceUser picture", () => {
    it("has no picture yet, instead of throwing, while a reconnect swaps the map", () => {
        sceneHolder.scene = undefined;
        const user = localSpaceUser("Me");
        let picture: string | undefined = "not read";
        expect(() => {
            const unsubscribe = user.pictureStore.subscribe((value) => {
                picture = value;
            });
            unsubscribe();
        }).not.toThrow();
        expect(picture).toBeUndefined();
    });

    it("shows the player's picture once there is a map", () => {
        sceneHolder.scene = { CurrentPlayer: { pictureStore: readable("woka.png") } };
        const user = localSpaceUser("Me");
        expect(get(user.pictureStore)).toBe("woka.png");
    });
});
