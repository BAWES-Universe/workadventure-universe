import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { readable } from "svelte/store";
import type { ChatUser } from "../../Connection/ChatConnection";

const world = vi.hoisted(() => ({
    users: [] as unknown[],
    requested: [] as string[],
    refreshStaleProviders: undefined as unknown as Mock,
}));
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            connection: {},
            userProviderMerger: Promise.resolve({
                usersByRoomStore: {
                    subscribe: (run: (value: unknown) => void) => {
                        run(new Map([["map", { roomName: "Map", users: world.users }]]));
                        return () => {};
                    },
                },
                refreshStaleProviders: () => world.refreshStaleProviders(),
            }),
        }),
    },
}));
vi.mock("../ChatPeopleStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    chatPeopleOf: () => ({ request: (chatId: string) => world.requested.push(chatId) }),
}));

import { requestChatPerson } from "../ChatPeopleLookup";

function user(chatId: string, extra: Partial<ChatUser> = {}): ChatUser {
    return { chatId, ...extra } as ChatUser;
}

describe("requestChatPerson", () => {
    beforeEach(() => {
        world.users = [];
        world.requested = [];
        world.refreshStaleProviders = vi.fn(() => Promise.resolve());
    });

    it("reads the world's members again for a member who is away, which has a saved Woka in the list", async () => {
        world.users = [user("@away:m", { storedWoka: readable("stored.png") })];

        requestChatPerson("@away:m");

        await vi.waitFor(() => expect(world.refreshStaleProviders).toHaveBeenCalledOnce());
        expect(world.requested).toEqual([]);
    });

    it("asks Orbit, and does not read the members again, for someone the world does not cover", async () => {
        world.users = [user("@chat:m")];

        requestChatPerson("@chat:m");

        await vi.waitFor(() => expect(world.requested).toEqual(["@chat:m"]));
        expect(world.refreshStaleProviders).not.toHaveBeenCalled();
    });

    it("leaves someone who is in the room alone: their avatar is live", async () => {
        world.users = [
            user("@live:m", {
                spaceUserId: "7",
                pictureStore: readable("live.png"),
                storedWoka: readable("stored.png"),
            }),
        ];

        requestChatPerson("@live:m");
        await Promise.resolve();
        await Promise.resolve();

        expect(world.refreshStaleProviders).not.toHaveBeenCalled();
        expect(world.requested).toEqual([]);
    });
});
