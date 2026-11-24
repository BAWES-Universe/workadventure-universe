import { get, writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const MADE = "1c8d2e3f-2222-4333-8444-a55566667777";
// A third Brick: a device that was just told to make a chat goes on making it for a while, so each test opens its own
const THIRD = "2d9e3f40-3333-4444-8555-b66677778888";
const ME = "@omar:chat.test";
const chatIdOf = (brickId: string) => `@bot_${brickId}:chat.test`;

type FakeRoom = { id: string; members: Writable<{ id: string }[]> };
type FakeFolder = FakeRoom & { rooms: Writable<FakeRoom[]>; folders: Writable<FakeFolder[]> };

type OpenOptions = { show?: (room: unknown) => unknown; onFailure?: (error: unknown) => void };
const game = vi.hoisted(() => ({
    connection: undefined as unknown,
    askDirectChat: vi.fn<(brickId: string, myChatId: string) => Promise<unknown>>(),
    openDirectChatRoom: vi.fn<(chatId: string, options?: OpenOptions) => Promise<unknown>>(),
    showRoom: vi.fn<(room: unknown) => void>(),
    warn: vi.fn<(message: string) => void>(),
    openGuestBrickChat: vi.fn<() => unknown>(),
    signedIn: undefined as unknown,
    selected: undefined as unknown,
    bricks: undefined as unknown,
    byChatId: undefined as unknown,
}));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getChatId: () => "@omar:chat.test" } }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { askDirectChat: game.askDirectChat },
}));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const store = await import("svelte/store");
    return {
        LL: store.readable({
            chat: {
                chatsStillLoading: () => "Your chats are still loading.",
                failedToOpenRoom: ({ roomId }: { roomId: string }) => `Failed to open ${roomId}`,
            },
        }),
    };
});
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getChatConnection: () => Promise.resolve(game.connection) },
}));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../../Utils", () => ({ openDirectChatRoom: game.openDirectChatRoom, showRoom: game.showRoom }));
vi.mock("../GuestBrickStore", () => ({ openGuestBrickChat: game.openGuestBrickChat }));
vi.mock("../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    game.signedIn = store.writable(true);
    return { userIsConnected: game.signedIn };
});
vi.mock("../../Stores/SelectRoomStore", async () => {
    const store = await import("svelte/store");
    game.selected = store.writable(undefined);
    return { selectedRoomStore: game.selected };
});
vi.mock("../MyBricksStore", async () => {
    const store = await import("svelte/store");
    game.bricks = store.writable(undefined);
    game.byChatId = store.writable(new Map());
    return { myBricksStore: game.bricks, myBricksByChatId: game.byChatId };
});
vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));
vi.mock("../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable(undefined) };
});

import type { ChatConnectionInterface } from "../../Connection/ChatConnection";
import type { BrickCard } from "../Brick";
import { PendingBrickChatRoom } from "../PendingBrickChat";
import { bricksWithoutChat, directChatWith, openBrickChat, openingBrickChats, unopenedBricksOf } from "../BrickChat";

const signedIn = game.signedIn as Writable<boolean>;
const selected = game.selected as Writable<unknown>;
const myBricks = game.bricks as Writable<BrickCard[] | undefined>;
const myBricksByChatId = game.byChatId as Writable<Map<string, BrickCard>>;

function fakeRoom(id: string, memberIds: string[] = []): FakeRoom {
    return { id, members: writable(memberIds.map((member) => ({ id: member }))) };
}

function fakeFolder(id: string, rooms: FakeRoom[] = [], folders: FakeFolder[] = []): FakeFolder {
    return { ...fakeRoom(id), rooms: writable(rooms), folders: writable(folders) };
}

/** A chat as a device holds it: its direct chats, and the one it has with each address (found through members). */
function fakeConnection() {
    const directRooms = writable<FakeRoom[]>([]);
    const rooms = writable<FakeRoom[]>([]);
    const folders = writable<FakeFolder[]>([]);
    const connectionStatus = writable<"ONLINE" | "CONNECTING" | "OFFLINE">("ONLINE");
    const directChatPartners = writable<ReadonlySet<string> | undefined>(undefined);
    const connection = {
        directRooms,
        rooms,
        folders,
        connectionStatus,
        directChatPartners,
        getDirectRoomFor: (chatId: string) =>
            get(directRooms).find((room) => get(room.members).some((member) => member.id === chatId)),
        getRoomByID: (roomId: string) => {
            const seen = new Set<string>();
            const inside = (list: FakeFolder[]): FakeRoom | undefined => {
                for (const folder of list) {
                    if (seen.has(folder.id)) continue;
                    seen.add(folder.id);
                    const found = get(folder.rooms).find((room) => room.id === roomId) ?? inside(get(folder.folders));
                    if (found) return found;
                }
                return undefined;
            };
            return [...get(directRooms), ...get(rooms)].find((room) => room.id === roomId) ?? inside(get(folders));
        },
    };
    return {
        connection: connection as unknown as ChatConnectionInterface,
        directRooms,
        rooms,
        folders,
        connectionStatus,
        directChatPartners,
    };
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
        // As the game does: the room is opened, then shown the way the caller asks
        game.openDirectChatRoom.mockImplementation(async (chatId, options) => {
            const room = { id: `chat with ${chatId}` };
            if (options?.show) await options.show(room);
            else game.showRoom(room);
            return room;
        });
        myBricks.set(undefined);
        myBricksByChatId.set(new Map());
        signedIn.set(true);
        selected.set(undefined);
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
        expect(game.openDirectChatRoom).toHaveBeenCalledWith(chatIdOf(BRICK), expect.anything());
        // The Brick is not in the list the game read: no screen of its own, the chat is shown as before
        expect(game.showRoom).toHaveBeenCalledTimes(1);
        expect(game.showRoom).toHaveBeenCalledWith({ id: `chat with ${chatIdOf(BRICK)}` });
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
        expect(game.showRoom).toHaveBeenCalledWith(expect.objectContaining({ id: "!known:chat.test" }));
        expect(game.openDirectChatRoom).not.toHaveBeenCalled();
    });

    it("finds a chat that is kept only in a folder, even in one inside another, and does not loop on folders that hold each other", async () => {
        const { connection, folders } = fakeConnection();
        game.connection = connection;
        // A holds B, B holds A again and C, and the chat is in C
        const a = fakeFolder("!a:chat.test");
        const b = fakeFolder("!b:chat.test");
        const c = fakeFolder("!c:chat.test", [fakeRoom("!inside:chat.test")]);
        a.folders.set([b]);
        b.folders.set([a, c]);
        folders.set([a]);
        game.askDirectChat.mockResolvedValue({ roomId: "!inside:chat.test" });
        // it is there at once: the wait for the chats to load (ten seconds, and a warning) is not entered
        await expect(openBrickChat(THIRD)).resolves.toMatchObject({ id: "!inside:chat.test" });
        expect(game.showRoom).toHaveBeenCalledWith(expect.objectContaining({ id: "!inside:chat.test" }));
        expect(game.warn).not.toHaveBeenCalled();
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

describe("the Bricks the person never opened, as the chat button, the Chats tab and the row count them", () => {
    // Their own Bricks: what other tests opened is remembered as opened for the rest of the page
    const FIRST = "4f105262-5555-4666-8777-d88899990001";
    const SECOND = "4f105262-5555-4666-8777-d88899990002";
    const entries = [
        [chatIdOf(FIRST), brick(FIRST, "Brick")],
        [chatIdOf(SECOND), brick(SECOND, "Recipe Brick")],
    ] as const;

    beforeEach(() => {
        myBricks.set(undefined);
        myBricksByChatId.set(new Map());
    });

    function counting() {
        const chat = fakeConnection();
        const count = unopenedBricksOf(chat.connection);
        const seen: number[] = [];
        const stop = count.subscribe((ids) => seen.push(ids.size));
        return { ...chat, count, seen, stop };
    }
    const listBricks = () => {
        myBricks.set(entries.map(([, one]) => one));
        myBricksByChatId.set(new Map(entries.map(([chatId, one]) => [chatId, one])));
    };

    it("counts a Brick the account never made a chat with as one, once chats are online and the Bricks are listed", () => {
        const { count, directChatPartners, stop } = counting();
        // Not before: the chats are not loaded yet and the Bricks are not listed
        expect(get(count).size).toBe(0);
        listBricks();
        expect(get(count).size).toBe(0);
        directChatPartners.set(new Set());
        expect([...get(count)].sort()).toEqual([FIRST, SECOND].sort());
        stop();
    });

    it("never flashes a count while the chats are connecting or the Bricks are being read", () => {
        const { count, connectionStatus, directChatPartners, seen, stop } = counting();
        connectionStatus.set("CONNECTING");
        listBricks();
        directChatPartners.set(new Set());
        expect(get(count).size).toBe(0);
        connectionStatus.set("ONLINE");
        expect(get(count).size).toBe(2);
        expect(seen.slice(0, 4).every((one) => one === 0)).toBe(true);
        stop();
    });

    it("is the same on every device: a chat made on another one is in the account's list, so it does not count", () => {
        const { count, directChatPartners, stop } = counting();
        listBricks();
        directChatPartners.set(new Set([chatIdOf(FIRST)]));
        expect([...get(count)]).toEqual([SECOND]);
        stop();
    });

    it("does not count a Brick again after Clear chat or leaving its chat: the account's list still names it", () => {
        const { count, directRooms, directChatPartners, stop } = counting();
        listBricks();
        directRooms.set([fakeRoom("!chat:chat.test", [ME, chatIdOf(FIRST)])]);
        directChatPartners.set(new Set([chatIdOf(FIRST), chatIdOf(SECOND)]));
        expect(get(count).size).toBe(0);
        // Cleared: no room is left on this device, and the list is the same
        directRooms.set([]);
        expect(get(count).size).toBe(0);
        stop();
    });

    it("does not count a Brick whose chat is opening right now, and counts nothing for it afterwards", async () => {
        const { count, connection, directChatPartners, stop } = counting();
        listBricks();
        directChatPartners.set(new Set());
        game.connection = connection;
        let answer: (value: unknown) => void = () => undefined;
        game.askDirectChat.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        game.openDirectChatRoom.mockImplementation((chatId) => Promise.resolve({ id: `chat with ${chatId}` }));
        const opening = openBrickChat(SECOND);
        await settle();
        expect([...get(count)]).toEqual([FIRST]);
        answer({ create: true, botChatId: chatIdOf(SECOND) });
        await opening;
        stop();
    });

    it("a chat the connection cannot list (no list of direct chats) counts nothing", () => {
        const { count, directChatPartners, stop } = counting();
        listBricks();
        directChatPartners.set(undefined);
        expect(get(count).size).toBe(0);
        stop();
    });
});

describe("opening a Brick's chat on a screen of its own, before the chat exists", () => {
    // Each test opens its own Brick: a device that is told to make a chat goes on making it for a while
    let counter = 0;
    let NEW = "";
    type Sent = { words: string; starter?: string };

    /** The chat as the chat server will make it: the words sent to it are kept, in order. */
    function realRoom() {
        const sent: Sent[] = [];
        return {
            id: "!made:chat.test",
            sent,
            sendMessageConfirmed: vi.fn((words: string) => {
                sent.push({ words });
                return Promise.resolve();
            }),
            sendStarter: vi.fn((words: string, starter: string) => {
                sent.push({ words, starter });
                return Promise.resolve();
            }),
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        counter++;
        NEW = `3e0f4151-4444-4555-8666-c7778888${String(counter).padStart(4, "0")}`;
        myBricks.set([brick(NEW, "Recipe Brick")]);
        myBricksByChatId.set(new Map());
        signedIn.set(true);
        selected.set(undefined);
        game.showRoom.mockImplementation((room) => selected.set(room));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("opens the Brick's own screen as soon as it is tapped, and the chat takes its place when it is there", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        const real = realRoom();
        let finish: () => void = () => undefined;
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(NEW) });
        game.openDirectChatRoom.mockImplementation(async (_chatId, options) => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            await options?.show?.(real);
            return real;
        });
        const opening = openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        // At once: before the chat exists, and with the Brick's own name
        expect(game.showRoom).toHaveBeenCalledTimes(1);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        expect(screen).toBeInstanceOf(PendingBrickChatRoom);
        expect(get(screen.name)).toBe("Recipe Brick");
        expect(get(selected)).toBe(screen);
        finish();
        await opening;
        expect(game.showRoom).toHaveBeenCalledTimes(2);
        expect(game.showRoom).toHaveBeenLastCalledWith(real);
        expect(game.warn).not.toHaveBeenCalled();
    });

    it("sends what was written while the chat was made once, in order, and then shows the chat", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        const real = realRoom();
        let finish: () => void = () => undefined;
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(NEW) });
        game.openDirectChatRoom.mockImplementation(async (_chatId, options) => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            await options?.show?.(real);
            return real;
        });
        const opening = openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        screen.sendMessage("Can you send me a morning brief at 8?");
        screen.sendStarter("What can you do?", "ideas");
        screen.sendMessage("Thanks");
        // Faded: nothing reached the chat server, and nothing is claimed to have
        expect(real.sent).toEqual([]);
        expect(get(screen.messages).map((message) => get(message.sending!))).toEqual([true, true, true]);
        finish();
        await opening;
        expect(real.sent).toEqual([
            { words: "Can you send me a morning brief at 8?" },
            { words: "What can you do?", starter: "ideas" },
            { words: "Thanks" },
        ]);
        expect(game.showRoom).toHaveBeenLastCalledWith(real);
    });

    it("keeps the person on the screen after about 15 seconds: the faded words go back into the box with the loading message", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockReturnValue(
            new Promise(() => {
                // never answered
            })
        );
        void openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        screen.sendMessage("brief at 8?");
        await vi.advanceTimersByTimeAsync(14_000);
        expect(game.warn).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(game.warn).toHaveBeenCalledWith("Your chats are still loading.");
        expect(get(screen.textBack)).toBe("brief at 8?");
        expect(get(screen.messages)).toEqual([]);
        // Still on the screen; no chat was shown and nothing was sent anywhere
        expect(game.showRoom).toHaveBeenCalledTimes(1);
        expect(get(selected)).toBe(screen);
    });

    it("gives the words back with the same message when the chat cannot be opened at all", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { connection } = fakeConnection();
        game.connection = connection;
        let answer: (value: unknown) => void = () => undefined;
        game.askDirectChat.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        game.openDirectChatRoom.mockImplementation((_chatId, options) => {
            options?.onFailure?.(new Error("chat server down"));
            return Promise.resolve(undefined);
        });
        const opening = openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        screen.sendMessage("hello");
        answer({ create: true, botChatId: chatIdOf(NEW) });
        await opening;
        expect(game.warn).toHaveBeenCalledTimes(1);
        expect(game.warn).toHaveBeenCalledWith("Your chats are still loading.");
        expect(get(screen.textBack)).toBe("hello");
        expect(get(selected)).toBe(screen);
        error.mockRestore();
    });

    it("shows the chat when a Brick is tapped after an earlier try was left behind and the chat exists now", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { connection, directRooms } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(NEW) });
        game.openDirectChatRoom.mockImplementation((_chatId, options) => {
            options?.onFailure?.(new Error("chat server down"));
            return Promise.resolve(undefined);
        });
        await openBrickChat(NEW);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        expect(screen).toBeInstanceOf(PendingBrickChatRoom);
        // The person goes elsewhere; the chat is made later (here, on another device)
        selected.set(undefined);
        game.showRoom.mockClear();
        directRooms.set([fakeRoom("!there:chat.test", [ME, chatIdOf(NEW)])]);
        game.openDirectChatRoom.mockImplementation(async (chatId, options) => {
            const room = { id: `chat with ${chatId}` };
            if (options?.show) await options.show(room);
            else game.showRoom(room);
            return room;
        });
        await openBrickChat(NEW);
        expect(game.showRoom).toHaveBeenCalledTimes(1);
        expect(game.showRoom.mock.calls[0][0]).toMatchObject({ id: `chat with ${chatIdOf(NEW)}` });
        error.mockRestore();
    });

    it("sends the words again, once, when the person writes after a failed try and the chat is there now", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { connection } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockResolvedValue(undefined);
        game.openDirectChatRoom.mockImplementation((_chatId, options) => {
            options?.onFailure?.(new Error("chat server down"));
            return Promise.resolve(undefined);
        });
        await openBrickChat(NEW);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        expect(screen.failed).toBe(true);
        // The chat server is back: the next try makes the chat
        const real = realRoom();
        game.openDirectChatRoom.mockImplementation(async (_chatId, options) => {
            await options?.show?.(real);
            return real;
        });
        screen.sendMessage("hello again");
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(10);
        expect(real.sent).toEqual([{ words: "hello again" }]);
        expect(game.showRoom).toHaveBeenLastCalledWith(real);
        error.mockRestore();
    });

    it("does not pull the person back from where they went: the chat is made, what they wrote is sent, the screen stays elsewhere", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        const real = realRoom();
        let finish: () => void = () => undefined;
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(NEW) });
        game.openDirectChatRoom.mockImplementation(async (_chatId, options) => {
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
            await options?.show?.(real);
            return real;
        });
        const opening = openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        const screen = game.showRoom.mock.calls[0][0] as PendingBrickChatRoom;
        screen.sendMessage("brief at 8?");
        // Back to Chats before the chat is there
        selected.set(undefined);
        finish();
        await opening;
        expect(real.sent).toEqual([{ words: "brief at 8?" }]);
        expect(game.showRoom).toHaveBeenCalledTimes(1);
    });

    it("shows the screen that holds the person's words again when the Brick is tapped while its chat is made", async () => {
        const { connection } = fakeConnection();
        game.connection = connection;
        game.askDirectChat.mockReturnValue(
            new Promise(() => {
                // never answered
            })
        );
        const first = openBrickChat(NEW);
        await vi.advanceTimersByTimeAsync(0);
        const screen = game.showRoom.mock.calls[0][0];
        selected.set(undefined);
        expect(openBrickChat(NEW)).toBe(first);
        expect(game.showRoom).toHaveBeenCalledTimes(2);
        expect(game.showRoom).toHaveBeenLastCalledWith(screen);
    });

    it("opens no screen of its own when this device already has the chat, for a Brick it does not know, or when signed out", async () => {
        const { connection, directRooms } = fakeConnection();
        game.connection = connection;
        game.openDirectChatRoom.mockImplementation(async (chatId, options) => {
            const room = { id: `chat with ${chatId}` };
            if (options?.show) await options.show(room);
            else game.showRoom(room);
            return room;
        });
        directRooms.set([fakeRoom("!there:chat.test", [ME, chatIdOf(NEW)])]);
        await openBrickChat(NEW);
        expect(game.showRoom.mock.calls.every(([room]) => !(room instanceof PendingBrickChatRoom))).toBe(true);

        game.showRoom.mockClear();
        directRooms.set([]);
        game.askDirectChat.mockResolvedValue({ create: true, botChatId: chatIdOf(THIRD) });
        // Not in the list the game read
        await openBrickChat(THIRD);
        expect(game.showRoom.mock.calls.every(([room]) => !(room instanceof PendingBrickChatRoom))).toBe(true);
    });
});
