import { get, readable, writable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import type { UserProviderInterface } from "../UserProvider/UserProviderInterface";
import type { PartialChatUser } from "../Connection/ChatConnection";
import { UserProviderMerger } from "./UserProviderMerger";

describe("UserProviderMerger", () => {
    it("should merge and sort users by room", () => {
        // Mock data
        const userProvider1: UserProviderInterface = {
            users: writable<PartialChatUser[]>([
                {
                    chatId: "1",
                    username: "Alice",
                    roomName: "Room1",
                    playUri: "playUri1",
                    availabilityStatus: writable(AvailabilityStatus.ONLINE),
                },
                {
                    chatId: "2",
                    username: "Bob",
                    roomName: "Room2",
                    playUri: "playUri2",
                    availabilityStatus: writable(AvailabilityStatus.ONLINE),
                },
                {
                    chatId: "5",
                    username: "Eve",
                    roomName: "Room1",
                    playUri: "playUri1",
                    availabilityStatus: writable(AvailabilityStatus.ONLINE),
                },
            ]),
            setFilter: () => {
                return Promise.resolve();
            },
        };

        const userProvider2: UserProviderInterface = {
            users: writable<PartialChatUser[]>([
                { chatId: "2", username: "Charlie", isAdmin: true },
                { chatId: "3", username: "Charlie" },
                { chatId: "4", username: "Dave" },
            ]),
            setFilter: () => {
                return Promise.resolve();
            },
        };

        const userProviderMerger = new UserProviderMerger([userProvider1, userProvider2]);

        // Get the merged and sorted users by room
        const usersByRoom = get(userProviderMerger.usersByRoomStore);

        // Expected result
        expect(usersByRoom?.get("playUri1")?.roomName).toBe("Room1");

        expect(get(usersByRoom.get("playUri1")?.users[0].availabilityStatus || writable())).toBe(
            AvailabilityStatus.ONLINE
        );

        expect(usersByRoom?.get("playUri1")?.users[1].username).toBe("Eve");
        expect(usersByRoom?.get(undefined)?.users[0].username).toBe("Charlie");

        expect(get(usersByRoom.get(undefined)?.users[0].availabilityStatus || writable())).toBe(
            AvailabilityStatus.UNCHANGED
        );
    });
    it("keeps each tab of the same account (clones) as a separate person", () => {
        const worldProvider: UserProviderInterface = {
            users: writable<PartialChatUser[]>([
                {
                    chatId: "@me:matrix",
                    uuid: "uuid-me",
                    username: "Me",
                    playUri: "playUri1",
                    roomName: "Room1",
                    spaceUserId: "space-1",
                },
                {
                    chatId: "@me:matrix",
                    uuid: "uuid-me",
                    username: "Me",
                    playUri: "playUri2",
                    roomName: "Room2",
                    spaceUserId: "space-2",
                },
                {
                    chatId: "@bob:matrix",
                    uuid: "uuid-bob",
                    username: "Bob",
                    playUri: "playUri1",
                    spaceUserId: "space-3",
                },
            ]),
            setFilter: () => Promise.resolve(),
        };
        const chatProvider: UserProviderInterface = {
            users: writable<PartialChatUser[]>([
                { chatId: "@me:matrix", username: "Me", isAdmin: true },
                { chatId: "@bob:matrix", username: "Bob" },
            ]),
            setFilter: () => Promise.resolve(),
        };

        const usersByRoom = get(new UserProviderMerger([worldProvider, chatProvider]).usersByRoomStore);

        const room1 = usersByRoom.get("playUri1")?.users ?? [];
        const room2 = usersByRoom.get("playUri2")?.users ?? [];
        expect(room1.map((user) => user.spaceUserId).sort()).toEqual(["space-1", "space-3"]);
        expect(room2.map((user) => user.spaceUserId)).toEqual(["space-2"]);
        // Chat-only data (no space user id) is merged into every clone.
        expect(room1.find((user) => user.spaceUserId === "space-1")?.isAdmin).toBe(true);
        expect(room2[0].isAdmin).toBe(true);
        expect(room2[0].chatId).toBe("@me:matrix");
        // Nobody ends up in the "disconnected" group.
        expect(usersByRoom.get(undefined)).toBeUndefined();
    });
});

describe("UserProviderMerger pictures", () => {
    const provider = (users: PartialChatUser[]): UserProviderInterface => ({
        users: writable(users),
        setFilter: () => Promise.resolve(),
    });
    const stored = readable<string | undefined>("stored-woka");
    const matrixAvatar = readable<string | undefined>("matrix-avatar");
    const live = readable<string | undefined>("live-woka");
    const away = (extra: Partial<PartialChatUser> = {}): PartialChatUser[] => [
        { chatId: "@ada:chat", username: "Ada", pictureStore: readable(undefined), storedWoka: stored, ...extra },
    ];
    const pictureOf = (merger: UserProviderMerger) =>
        get([...get(merger.usersByRoomStore).values()][0].users[0].pictureStore ?? readable(undefined));

    it("shows an away person's saved Woka before the picture their chat account carries", () => {
        const merger = new UserProviderMerger([
            provider(away()),
            provider([{ chatId: "@ada:chat", username: "Ada", pictureStore: matrixAvatar }]),
        ]);
        expect(pictureOf(merger)).toBe("stored-woka");
    });

    it("keeps the chat account's picture for someone with no saved Woka", () => {
        const merger = new UserProviderMerger([
            provider(away({ storedWoka: undefined })),
            provider([{ chatId: "@ada:chat", username: "Ada", pictureStore: matrixAvatar }]),
        ]);
        expect(pictureOf(merger)).toBe("matrix-avatar");
    });

    it("shows the live avatar when they are in the world", () => {
        const merger = new UserProviderMerger([
            provider(away()),
            provider([{ chatId: "@ada:chat", username: "Ada", pictureStore: matrixAvatar }]),
            provider([
                {
                    chatId: "@ada:chat",
                    username: "Ada",
                    pictureStore: live,
                    spaceUserId: "space-1",
                    playUri: "playUri1",
                    roomName: "Room1",
                },
            ]),
        ]);
        expect(pictureOf(merger)).toBe("live-woka");
    });
});
