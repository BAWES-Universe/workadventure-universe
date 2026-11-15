import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const MADE = "1c8d2e3f-2222-4333-8444-a55566667777";
// A third Brick: a device that was just told to make a chat goes on making it for a while, so each test opens its own
const THIRD = "2d9e3f40-3333-4444-8555-b66677778888";
const ME = "@omar:chat.test";
const chatIdOf = (brickId: string) => `@bot_${brickId}:chat.test`;

type FakeRoom = { id: string; members: Writable<{ id: string }[]> };

const game = vi.hoisted(() => ({
    connection: undefined as unknown,
    askDirectChat: vi.fn<(brickId: string, myChatId: string) => Promise<unknown>>(),
    openDirectChatRoom: vi.fn<(chatId: string) => Promise<unknown>>(),
    openChatRoom: vi.fn<(roomId: string) => Promise<void>>(),
    warn: vi.fn<(message: string) => void>(),
    openGuestBrickChat: vi.fn<() => unknown>(),
}));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getChatId: () => "@omar:chat.test" } }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { askDirectChat: game.askDirectChat },
}));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const store = await import("svelte/store");
    return { LL: store.readable({ chat: { chatsStillLoading: () => "Your chats are still loading." } }) };
});
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getChatConnection: () => Promise.resolve(game.connection) },
}));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../../Utils", () => ({ openChatRoom: game.openChatRoom, openDirectChatRoom: game.openDirectChatRoom }));
vi.mock("../GuestBrickStore", () => ({ openGuestBrickChat: game.openGuestBrickChat }));

import type { ChatConnectionInterface } from "../../Connection/ChatConnection";
import type { BrickCard } from "../Brick";
import { bricksWithoutChat, directChatWith, openBrickChat, openingBrickChats } from "../BrickChat";

function fakeRoom(id: string, memberIds: string[] = []): FakeRoom {
    return { id, members: writable(memberIds.map((member) => ({ id: member }))) };
}

/** A chat as a device holds it: its direct chats, and the one it has with each address (found through members). */
function fakeConnection() {
    const directRooms = writable<FakeRoom[]>([]);
    const rooms = writable<FakeRoom[]>([]);
    const connection = {
        directRooms,
        rooms,
        getDirectRoomFor: (chatId: string) =>
            get(directRooms).find((room) => get(room.members).some((member) => member.id === chatId)),
        getRoomByID: (roomId: string) => [...get(directRooms), ...get(rooms)].find((room) => room.id === roomId),
    };
    return { connection: connection as unknown as ChatConnectionInterface, directRooms, rooms };
}

const brick = (id: string, name: string): BrickCard => ({
    id,
    name,
    description: null,
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: id === BRICK,
    createdAt: "2026-11-11T10:00:00.000Z",
    hello: null,
});

/** Lets the coalesced look run. */
const settle = () => Promise.resolve();

describe("the direct chat this device has with someone", () => {
    it("is none until a chat with them is listed, and is found once it is", async () => {
        const { connection, directRooms } = fakeConnection();
        const chat = directChatWith(connection, chatIdOf(BRICK));
        const seen: (string | undefined)[] = [];
        const stop = chat.subscribe((room) => seen.push(room?.id));
        await settle();
        expect(seen.at(-1)).toBeUndefined();
        directRooms.set([fakeRoom("!other", [ME, "@sara:chat.test"])]);
        await settle();
        expect(seen.at(-1)).toBeUndefined();
        directRooms.set([fakeRoom("!other", [ME, "@sara:chat.test"]), fakeRoom("!brick", [ME, chatIdOf(BRICK)])]);
        await settle();
        expect(seen.at(-1)).toBe("!brick");
        stop();
    });

    it("is found when the members of a listed chat arrive after the chat itself", async () => {
        const { connection, directRooms } = fakeConnection();
        const room = fakeRoom("!brick");
        directRooms.set([room]);
        const chat = directChatWith(connection, chatIdOf(BRICK));
        const seen: (string | undefined)[] = [];
        const stop = chat.subscribe((found) => seen.push(found?.id));
        await settle();
        expect(seen.at(-1)).toBeUndefined();
        room.members.set([{ id: ME }, { id: chatIdOf(BRICK) }]);
        await settle();
        expect(seen.at(-1)).toBe("!brick");
        stop();
    });

    it("is none again when the chat is left, and stops watching when nobody looks", async () => {
        const { connection, directRooms } = fakeConnection();
        const room = fakeRoom("!brick", [ME, chatIdOf(BRICK)]);
        directRooms.set([room]);
        const chat = directChatWith(connection, chatIdOf(BRICK));
        const seen: (string | undefined)[] = [];
        const stop = chat.subscribe((found) => seen.push(found?.id));
        await settle();
        expect(seen.at(-1)).toBe("!brick");
        directRooms.set([]);
        await settle();
        expect(seen.at(-1)).toBeUndefined();
        stop();
        const count = seen.length;
        directRooms.set([room]);
        await settle();
        expect(seen).toHaveLength(count);
    });
});

describe("the Bricks that show in Chats as a row of their own", () => {
    it("are the ones this device has no chat with yet; a Brick's row goes once its chat exists", async () => {
        const { connection, directRooms } = fakeConnection();
        const byChatId = writable(
            new Map([
                [chatIdOf(BRICK), brick(BRICK, "Brick")],
                [chatIdOf(MADE), brick(MADE, "Recipe Brick")],
            ])
        );
        const without = bricksWithoutChat(connection, byChatId);
        let rows: BrickCard[] = [];
        const stop = without.subscribe((value) => (rows = value));
        await settle();
        expect(rows.map((row) => row.name)).toEqual(["Brick", "Recipe Brick"]);
        directRooms.set([fakeRoom("!brick", [ME, chatIdOf(BRICK)])]);
        await settle();
        expect(rows.map((row) => row.name)).toEqual(["Recipe Brick"]);
        directRooms.set([fakeRoom("!brick", [ME, chatIdOf(BRICK)]), fakeRoom("!made", [ME, chatIdOf(MADE)])]);
        await settle();
        expect(rows).toEqual([]);
        stop();
    });

    it("are none for someone with no Brick, and follow the Bricks as they are read", async () => {
        const { connection } = fakeConnection();
        const byChatId = writable(new Map<string, BrickCard>());
        const without = bricksWithoutChat(connection, byChatId);
        let rows: BrickCard[] = [];
        const stop = without.subscribe((value) => (rows = value));
        expect(rows).toEqual([]);
        byChatId.set(new Map([[chatIdOf(BRICK), brick(BRICK, "Brick")]]));
        await settle();
        expect(rows.map((row) => row.id)).toEqual([BRICK]);
        byChatId.set(new Map());
        await settle();
        expect(rows).toEqual([]);
        stop();
    });
});

describe("opening a Brick's chat from the game", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        game.openDirectChatRoom.mockImplementation((chatId) => Promise.resolve({ id: `chat with ${chatId}` }));
        game.openChatRoom.mockResolvedValue(undefined);
    });

    it("opens the Brick for guests from the chat this device keeps, and asks no server", async () => {
        const room = { id: "guest-brick" };
        game.openGuestBrickChat.mockReturnValue(room);
        await expect(openBrickChat("guest-brick")).resolves.toBe(room);
        expect(game.askDirectChat).not.toHaveBeenCalled();
        expect(game.openDirectChatRoom).not.toHaveBeenCalled();
    });

    it("asks the bot server who makes the chat, with the Brick and the person's own address", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(BRICK) });
        await expect(openBrickChat(BRICK)).resolves.toEqual({ id: `chat with ${chatIdOf(BRICK)}` });
        expect(game.askDirectChat).toHaveBeenCalledWith(BRICK, ME);
        expect(game.openDirectChatRoom).toHaveBeenCalledWith(chatIdOf(BRICK));
    });

    it("runs once for a Brick however often its row is tapped, and says so while it runs", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        let answer: (value: unknown) => void = () => undefined;
        game.askDirectChat.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const first = openBrickChat(MADE);
        const second = openBrickChat(MADE);
        expect(second).toBe(first);
        expect(get(openingBrickChats).has(MADE)).toBe(true);
        answer({ create: true, botChatId: chatIdOf(MADE) });
        await first;
        expect(game.askDirectChat).toHaveBeenCalledTimes(1);
        expect(game.openDirectChatRoom).toHaveBeenCalledTimes(1);
        expect(get(openingBrickChats).has(MADE)).toBe(false);
    });

    it("opens the chat the bot server knows by its id once this device lists it", async () => {
        const { connection, directRooms } = fakeConnection();
        game.connection = connection;
        // Listed, with members that have not loaded: the device cannot yet tell whose chat it is
        directRooms.set([fakeRoom("!known:chat.test")]);
        game.askDirectChat.mockResolvedValue({ roomId: "!known:chat.test" });
        await expect(openBrickChat(THIRD)).resolves.toMatchObject({ id: "!known:chat.test" });
        expect(game.openChatRoom).toHaveBeenCalledWith("!known:chat.test");
        expect(game.openDirectChatRoom).not.toHaveBeenCalled();
    });

    it("opens nothing, and breaks nothing, when the chat cannot be opened", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { connection } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockResolvedValue(undefined);
        game.openDirectChatRoom.mockRejectedValue(new Error("no chat server"));
        await expect(openBrickChat(THIRD)).resolves.toBeUndefined();
        expect(get(openingBrickChats).has(THIRD)).toBe(false);
        error.mockRestore();
    });
});
