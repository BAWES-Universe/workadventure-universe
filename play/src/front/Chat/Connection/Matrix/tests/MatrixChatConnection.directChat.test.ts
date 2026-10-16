import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Readable } from "svelte/store";
import { readable, writable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import type { MatrixRoomFolder } from "../MatrixRoomFolder";
import type { MatrixChatRoom } from "../MatrixChatRoom";
import type { MatrixSecurity } from "../MatrixSecurity";
import { MatrixChatConnection } from "../MatrixChatConnection";
import { ChatsStillLoadingError } from "../../ChatsStillLoadingError";

vi.mock("../MatrixChatRoom", () => ({ MatrixChatRoom: vi.fn() }));
vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({}) },
}));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({
    CharacterLayerManager: { wokaBase64: () => Promise.resolve("") },
}));
vi.mock("../../../../Enum/EnvironmentVariable.ts", () => ({ MATRIX_ADMIN_USER: "admin", MATRIX_DOMAIN: "domain" }));
vi.mock("../../../Stores/ChatStore.ts", () => ({ selectedRoomStore: writable(undefined) }));

const settle = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
    });

const ME = "@me:matrix.test";
const ALICE = "@alice:matrix.test";

interface FakeRoomOptions {
    type?: "direct" | "multiple";
    my?: string;
    members?: Record<string, string>;
    lastMessage?: number;
    /** The room has a name of its own (a group), and not the default one of a chat. */
    named?: boolean;
    /** The person whose invite carried the direct flag. */
    dmInviter?: string;
    /** The room sits in the list of this folder (see `addFolder`), and not in the top list. */
    folder?: string;
}

interface FakeFolder {
    roomList: MapStore<string, MatrixChatRoom>;
    folderList: MapStore<string, FakeFolder>;
}

describe("MatrixChatConnection: the chat with one person", () => {
    /** What the server has been asked to do. */
    let createRoom: ReturnType<typeof vi.fn>;
    let invite: ReturnType<typeof vi.fn>;
    let leave: ReturnType<typeof vi.fn>;
    let createMessagesRequest: ReturnType<typeof vi.fn>;
    /** The first member events of each room's history, as the server returns them. */
    let firstEvents: Record<string, unknown[]>;
    let setAccountData: ReturnType<typeof vi.fn>;
    let directMap: Record<string, string[]> | undefined;
    let sdkRooms: Map<string, unknown>;
    let connection: MatrixChatConnection;
    let rooms: Map<string, { id: string; membership: Record<string, ReturnType<typeof writable<string>>> }>;

    let folders: Map<string, FakeFolder>;

    /** Puts a folder (a space) in the top list of folders, or in another folder when given its id. */
    function addFolder(id: string, parent?: string): FakeFolder {
        const folder: FakeFolder = { roomList: new MapStore(), folderList: new MapStore() };
        folders.set(id, folder);
        const parentFolder = parent ? folders.get(parent) : undefined;
        if (parentFolder) parentFolder.folderList.set(id, folder);
        else connection["roomFolders"].set(id, folder as unknown as MatrixRoomFolder);
        return folder;
    }

    /** Puts a chat in the room list as the connection would hold it. */
    function addRoom(id: string, options: FakeRoomOptions = {}): MatrixChatRoom {
        const memberships: Record<string, ReturnType<typeof writable<string>>> = {};
        for (const [userId, membership] of Object.entries(options.members ?? { [ME]: "join", [ALICE]: "join" })) {
            memberships[userId] = writable(membership);
        }
        const room = {
            id,
            type: options.type ?? "direct",
            myMembership: writable(options.my ?? "join"),
            members: readable(
                Object.entries(memberships).map(([userId, membership]) => ({
                    id: userId,
                    membership: membership as Readable<string>,
                }))
            ),
            lastMessageTimestamp: options.lastMessage ?? 100,
            destroy: vi.fn(),
            hasOutdatedType: () => false,
        } as unknown as MatrixChatRoom;
        sdkRooms.set(id, {
            getDMInviter: () => options.dmInviter,
            currentState: {
                getStateEvents: () => (options.named ? { getContent: () => ({ name: "Project room" }) } : null),
            },
        });
        const folder = options.folder ? folders.get(options.folder) : undefined;
        if (folder) folder.roomList.set(id, room);
        else connection["roomList"].set(id, room);
        rooms.set(id, { id, membership: memberships });
        return room;
    }

    beforeEach(async () => {
        createRoom = vi.fn().mockResolvedValue({ room_id: "!new:matrix.test" });
        invite = vi.fn().mockResolvedValue({});
        leave = vi.fn().mockResolvedValue({});
        firstEvents = {};
        createMessagesRequest = vi.fn((roomId: string) => Promise.resolve({ chunk: firstEvents[roomId] ?? [] }));
        setAccountData = vi.fn().mockImplementation((_type: string, next: Record<string, string[]>) => {
            directMap = next;
            return Promise.resolve({});
        });
        directMap = undefined;
        sdkRooms = new Map();
        rooms = new Map();
        folders = new Map();
        const client = {
            isGuest: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            store: { startup: vi.fn() },
            initRustCrypto: vi.fn(),
            startClient: vi.fn(),
            getUserId: () => ME,
            getRoom: (id: string) => sdkRooms.get(id) ?? null,
            getAccountData: () => (directMap ? { getContent: () => directMap } : undefined),
            getSafeUserId: () => ME,
            // The list is read from the server before every save; the fake server holds `directMap`.
            http: {
                authedRequest: () =>
                    directMap
                        ? Promise.resolve(directMap)
                        : Promise.reject(Object.assign(new Error("not found"), { data: { errcode: "M_NOT_FOUND" } })),
            },
            setAccountData,
            createRoom,
            invite,
            leave,
            createMessagesRequest,
        } as unknown as MatrixClient;
        connection = new MatrixChatConnection(Promise.resolve(client), { subscribe: vi.fn() }, {
            isEncryptionRequiredAndNotSet: false,
        } as unknown as MatrixSecurity);
        await connection.init();
        Object.assign(connection, { isClientReady: true });
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("finding it", () => {
        it("finds a direct chat with just the two of us", () => {
            const room = addRoom("!chat");

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("finds nothing for someone you have no chat with", () => {
            addRoom("!chat");

            expect(connection.getDirectRoomFor("@bob:matrix.test")).toBeUndefined();
        });

        it("finds a chat that lost its direct type once the account lists it (the flag was lost on a profile change)", () => {
            const room = addRoom("!chat", { type: "multiple", named: true });
            directMap = { [ALICE]: ["!chat"] };

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("does not take a room for the chat just because it is the two of us: a group of two stays a group", () => {
            addRoom("!group", { type: "multiple" });

            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
        });

        it("does not take a named group of two for the chat", () => {
            addRoom("!group", { type: "multiple", named: true });

            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
        });

        it("does not take a room with a third person in it for the chat", () => {
            addRoom("!trio", { members: { [ME]: "join", [ALICE]: "join", "@bob:matrix.test": "invite" } });

            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
        });

        it("opens the one with the newest message when there are two", () => {
            addRoom("!old", { lastMessage: 10 });
            const newer = addRoom("!new", { lastMessage: 500 });
            addRoom("!middle", { lastMessage: 200 });

            expect(connection.getDirectRoomFor(ALICE)).toBe(newer);
        });

        it("finds the chat the other person deleted while I still have it", () => {
            const room = addRoom("!chat", { members: { [ME]: "join", [ALICE]: "leave" } });

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("finds an invitation from the person even when the room's members are not loaded", () => {
            const room = addRoom("!invite", { my: "invite", members: { [ME]: "invite" }, dmInviter: ALICE });

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("never finds a chat with yourself", () => {
            addRoom("!chat");

            expect(connection.getDirectRoomFor(ME)).toBeUndefined();
        });
    });

    describe("a chat inside a folder", () => {
        it("finds a direct chat that sits in a folder", () => {
            addFolder("!folder");
            const room = addRoom("!chat", { folder: "!folder" });
            directMap = { [ALICE]: ["!chat"] };

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("finds a direct chat that sits in a folder inside a folder", () => {
            addFolder("!outer");
            addFolder("!inner", "!outer");
            const room = addRoom("!chat", { folder: "!inner" });
            directMap = { [ALICE]: ["!chat"] };

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("opens that chat on every press of Message and makes no room", async () => {
            addFolder("!outer");
            addFolder("!inner", "!outer");
            const room = addRoom("!chat", { folder: "!inner" });
            directMap = { [ALICE]: ["!chat"] };

            await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);
            await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);

            expect(createRoom).not.toHaveBeenCalled();
        });

        it("keeps a group of the same two people in a folder separate from the chat", () => {
            addFolder("!folder");
            addRoom("!group", { type: "multiple", named: true, folder: "!folder" });
            const chat = addRoom("!chat", { folder: "!folder" });
            directMap = { [ALICE]: ["!chat"] };

            expect(connection.getDirectRoomFor(ALICE)).toBe(chat);
            expect(connection.getDirectRoomFor(ALICE)?.id).not.toBe("!group");
        });

        it("does not take a group in a folder for the chat", () => {
            addFolder("!folder");
            addRoom("!group", { type: "multiple", named: true, folder: "!folder" });

            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
        });

        it("counts a room that is in the top list and in its folder once", () => {
            addFolder("!folder");
            const room = addRoom("!chat");
            connection["roomFolders"].get("!folder")?.roomList.set("!chat", room);
            directMap = { [ALICE]: ["!chat"] };

            expect(connection["allRooms"]()).toHaveLength(1);
            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("repairs the direct list for a chat in a folder", async () => {
            addFolder("!folder");
            addRoom("!chat", { type: "multiple", dmInviter: ALICE, folder: "!folder" });

            connection["repairDirectAccountData"]();

            await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!chat"] }));
        });
    });

    describe("opening it", () => {
        it("opens the chat that exists and makes no new room", async () => {
            const room = addRoom("!chat");
            directMap = { [ALICE]: ["!chat"] };

            await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);

            expect(createRoom).not.toHaveBeenCalled();
            expect(invite).not.toHaveBeenCalled();
            expect(setAccountData).not.toHaveBeenCalled();
        });

        it("makes a room when there is no chat yet, and lists it", async () => {
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("the new chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            await expect(connection.createDirectRoom(ALICE)).resolves.toBe("the new chat");

            expect(createRoom).toHaveBeenCalledOnce();
            expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ is_direct: true, invite: [ALICE] }));
            expect(directMap).toEqual({ [ALICE]: ["!new:matrix.test"] });
        });

        it("invites the person back into the same room when they deleted the chat, and makes no new room", async () => {
            const room = addRoom("!chat", { members: { [ME]: "join", [ALICE]: "leave" } });
            directMap = { [ALICE]: ["!chat"] };

            await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);

            expect(invite).toHaveBeenCalledExactlyOnceWith("!chat", ALICE);
            expect(createRoom).not.toHaveBeenCalled();
        });

        it("does not invite someone who is still in the chat, or only invited", async () => {
            addRoom("!joined");
            await connection.createDirectRoom(ALICE);
            connection["roomList"].delete("!joined");
            addRoom("!invited", { members: { [ME]: "join", [ALICE]: "invite" } });
            await connection.createDirectRoom(ALICE);

            expect(invite).not.toHaveBeenCalled();
        });

        it("shows the error when the invite back fails, and does not make a room instead", async () => {
            addRoom("!chat", { members: { [ME]: "join", [ALICE]: "leave" } });
            invite.mockRejectedValue(new Error("forbidden"));

            await expect(connection.createDirectRoom(ALICE)).rejects.toBeDefined();

            expect(createRoom).not.toHaveBeenCalled();
        });

        it("lists a found chat that the account does not list yet", async () => {
            addRoom("!chat");

            await connection.createDirectRoom(ALICE);
            await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!chat"] }));
        });

        it("makes one room when Message is pressed twice for the same person at once", async () => {
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("the new chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            const [first, second] = await Promise.all([
                connection.createDirectRoom(ALICE),
                connection.createDirectRoom(ALICE),
            ]);

            expect(createRoom).toHaveBeenCalledOnce();
            expect(first).toBe(second);
        });

        it("makes a room for each person when Message is pressed for two people at once", async () => {
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("a chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            await Promise.all([connection.createDirectRoom(ALICE), connection.createDirectRoom("@bob:matrix.test")]);

            expect(createRoom).toHaveBeenCalledTimes(2);
        });

        it("makes another room after the first request is over (the chat was deleted meanwhile)", async () => {
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("a chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            await connection.createDirectRoom(ALICE);
            await connection.createDirectRoom(ALICE);

            expect(createRoom).toHaveBeenCalledTimes(2);
        });

        it("lets the next try through when a request fails", async () => {
            createRoom.mockRejectedValueOnce(new Error("offline"));
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("a chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            await expect(connection.createDirectRoom(ALICE)).rejects.toBeDefined();
            await expect(connection.createDirectRoom(ALICE)).resolves.toBe("a chat");
        });

        it("is busy while a room is made and free afterwards", async () => {
            const states: boolean[] = [];
            const stopWatching = connection.roomCreationInProgress.subscribe((busy) => states.push(busy));
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("a chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

            await Promise.all([connection.createDirectRoom(ALICE), connection.createDirectRoom("@bob:matrix.test")]);

            stopWatching();
            expect(states).toEqual([false, true, false]);
        });

        describe("before the first sync is over", () => {
            beforeEach(() => {
                connection["isClientReady"] = false;
                connection.connectionStatus.set("CONNECTING");
            });

            it("waits for the chats to load and then opens the one that is there, not a new room", async () => {
                const opening = connection.createDirectRoom(ALICE);
                await Promise.resolve();
                expect(createRoom).not.toHaveBeenCalled();

                const room = addRoom("!chat");
                Object.assign(connection, { isClientReady: true });
                connection.connectionStatus.set("ONLINE");

                await expect(opening).resolves.toBe(room);
                expect(createRoom).not.toHaveBeenCalled();
            });

            it("makes no room when the chats still have not loaded after a few seconds, and says so", async () => {
                vi.useFakeTimers();
                try {
                    const opening = connection.createDirectRoom(ALICE);
                    const failure = expect(opening).rejects.toBeInstanceOf(ChatsStillLoadingError);
                    await vi.advanceTimersByTimeAsync(8000);

                    await failure;
                    expect(createRoom).not.toHaveBeenCalled();
                    expect(setAccountData).not.toHaveBeenCalled();
                } finally {
                    vi.useRealTimers();
                }
            });

            it("does not wait when the connection failed before the first sync, and makes no room", async () => {
                connection.connectionStatus.set("ON_ERROR");

                await expect(connection.createDirectRoom(ALICE)).rejects.toBeInstanceOf(ChatsStillLoadingError);
                expect(createRoom).not.toHaveBeenCalled();
            });
        });
    });

    describe("groups are never taken for a chat, and never touched", () => {
        function stubRoomCreation() {
            vi.spyOn(
                connection as unknown as { waitForNextSync: () => Promise<void> },
                "waitForNextSync"
            ).mockResolvedValue();
            vi.spyOn(
                connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                "createAndAddNewRootRoom"
            ).mockReturnValue("a chat");
            sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });
        }

        it("keeps two groups with the very same people apart, and finds neither as the chat", () => {
            addRoom("!groupA", { type: "multiple", named: true });
            addRoom("!groupB", { type: "multiple", named: true });
            addRoom("!groupC", { type: "multiple" });

            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
            expect(connection["roomList"].has("!groupA")).toBe(true);
            expect(connection["roomList"].has("!groupB")).toBe(true);
            expect(connection["roomList"].has("!groupC")).toBe(true);
        });

        it("makes a chat with a person who is only in a group with me, and leaves the group alone", async () => {
            addRoom("!group", { type: "multiple", named: true });
            stubRoomCreation();

            await expect(connection.createDirectRoom(ALICE)).resolves.toBe("a chat");

            expect(createRoom).toHaveBeenCalledOnce();
            expect(invite).not.toHaveBeenCalled();
            expect(connection["roomList"].has("!group")).toBe(true);
        });

        it("keeps a chat with Alice and a group of just me and Alice separate, whichever order they come in", () => {
            const group = addRoom("!group", { type: "multiple", named: true, lastMessage: 900 });
            const chat = addRoom("!chat", { lastMessage: 10 });

            // The group has the newest message, and still is not the chat.
            expect(connection.getDirectRoomFor(ALICE)).toBe(chat);
            expect(connection.getDirectRoomFor(ALICE)).not.toBe(group);
        });

        it("does not invite anyone back into a group someone left", async () => {
            addRoom("!group", { type: "multiple", named: true, members: { [ME]: "join", [ALICE]: "leave" } });
            stubRoomCreation();

            await connection.createDirectRoom(ALICE);

            expect(invite).not.toHaveBeenCalled();
            expect(createRoom).toHaveBeenCalledOnce();
        });

        it("makes a new chat after the chat is deleted while a group of the same two people remains", async () => {
            addRoom("!group", { type: "multiple", named: true });
            stubRoomCreation();

            await connection.createDirectRoom(ALICE);

            expect(createRoom).toHaveBeenCalledOnce();
            expect(directMap).toEqual({ [ALICE]: ["!new:matrix.test"] });
        });

        it("lists a group of two as a group, not as a chat, when the account lists no chat for it", () => {
            addRoom("!group", { type: "multiple", named: true });
            const rooms$ = connection.rooms;
            let listed: unknown[] = [];
            const stop = rooms$.subscribe((value) => (listed = value));
            stop();

            expect(listed).toHaveLength(1);
            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();
        });

        it("creating a group does not look for a chat or invite anyone back", async () => {
            const lookup = vi.spyOn(connection, "getDirectRoomFor");
            addRoom("!chat", { members: { [ME]: "join", [ALICE]: "leave" } });

            await connection.createRoom({ name: "Team", invite: [ALICE] } as never);

            expect(lookup).not.toHaveBeenCalled();
            expect(invite).not.toHaveBeenCalled();
            expect(createRoom).toHaveBeenCalledOnce();
        });

        it("makes the second group with the same people just like the first", async () => {
            await connection.createRoom({ name: "Team", invite: [ALICE] } as never);
            await connection.createRoom({ name: "Team again", invite: [ALICE] } as never);

            expect(createRoom).toHaveBeenCalledTimes(2);
        });
    });

    describe("repairing the account's list of direct chats", () => {
        it("opening the chat waits for a repair that is running, and opens the chat it lists instead of making one", async () => {
            const room = addRoom("!chat", { type: "multiple", dmInviter: ALICE });
            let finishSave: (() => void) | undefined;
            setAccountData.mockImplementationOnce(
                (_type: string, next: Record<string, string[]>) =>
                    new Promise((resolve) => {
                        finishSave = () => {
                            directMap = next;
                            resolve({});
                        };
                    })
            );
            connection["repairDirectAccountData"]();
            await vi.waitFor(() => expect(finishSave).toBeDefined());

            const opening = connection.createDirectRoom(ALICE);
            await Promise.resolve();
            expect(createRoom).not.toHaveBeenCalled();
            finishSave?.();

            await expect(opening).resolves.toBe(room);
            expect(createRoom).not.toHaveBeenCalled();
        });

        it("opening the chat goes on after a few seconds when the repair is stuck", async () => {
            vi.useFakeTimers();
            try {
                addRoom("!stuck", { type: "multiple", dmInviter: ALICE });
                // The save of the repair takes far longer than opening a chat is willing to wait.
                setAccountData.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            setTimeout(() => resolve({}), 20_000);
                        })
                );
                vi.spyOn(
                    connection as unknown as { waitForNextSync: () => Promise<void> },
                    "waitForNextSync"
                ).mockResolvedValue();
                vi.spyOn(
                    connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                    "createAndAddNewRootRoom"
                ).mockReturnValue("a chat");
                sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

                connection["repairDirectAccountData"]();
                const opening = connection.createDirectRoom("@bob:matrix.test");
                await vi.advanceTimersByTimeAsync(4000);
                expect(createRoom).toHaveBeenCalledOnce();

                await vi.advanceTimersByTimeAsync(30_000);
                await expect(opening).resolves.toBe("a chat");
            } finally {
                vi.useRealTimers();
            }
        });

        it("counts a chat a repair listed as a direct chat before the client's own copy shows it", () => {
            const room = addRoom("!chat", { type: "multiple", dmInviter: ALICE });
            expect(connection.getDirectRoomFor(ALICE)).toBeUndefined();

            connection["repairedDirect"] = { [ALICE]: ["!chat"] };

            expect(connection.getDirectRoomFor(ALICE)).toBe(room);
        });

        it("lists a joined chat that still carries the direct flag of the invite and is not listed", async () => {
            addRoom("!chat", { type: "multiple", dmInviter: ALICE });

            connection["repairDirectAccountData"]();
            await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!chat"] }));
            expect(setAccountData).toHaveBeenCalledOnce();
        });

        it("saves all the missing ones in one write", async () => {
            addRoom("!one", { dmInviter: ALICE });
            addRoom("!two", { dmInviter: "@bob:matrix.test" });

            connection["repairDirectAccountData"]();
            await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledOnce());

            expect(directMap).toEqual({ [ALICE]: ["!one"], "@bob:matrix.test": ["!two"] });
        });

        it("saves nothing when the chats are listed already", () => {
            addRoom("!chat", { dmInviter: ALICE });
            directMap = { [ALICE]: ["!chat"] };

            connection["repairDirectAccountData"]();

            expect(setAccountData).not.toHaveBeenCalled();
        });

        it("leaves alone a chat I started (no flag), an invitation not accepted yet, and a group", () => {
            addRoom("!mine");
            addRoom("!pending", { my: "invite", dmInviter: ALICE });
            addRoom("!group", { type: "multiple", named: true });

            connection["repairDirectAccountData"]();

            expect(setAccountData).not.toHaveBeenCalled();
        });

        it("runs when the account's list arrives, and does not run again for the list it saved", async () => {
            addRoom("!chat", { dmInviter: ALICE });
            const event = { getType: () => EventType.Direct } as never;

            connection["onAccountDataEvent"](event);
            await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledOnce());
            connection["onAccountDataEvent"](event);

            expect(setAccountData).toHaveBeenCalledOnce();
        });

        describe("when the sdk lost the direct flag (the player's profile changed since they accepted)", () => {
            /** The invite that started a direct chat, as the server holds it. */
            const directInvite = (inviter: string, extra: object = {}) => ({
                type: "m.room.member",
                state_key: ME,
                sender: inviter,
                content: { membership: "invite", is_direct: true, ...extra },
            });

            it("lists a chat whose first invite was a direct invite from the other person", async () => {
                // The shape of the two accounts in #889: R1 was accepted, is_direct was true, m.direct has nothing.
                addRoom("!r1", { type: "multiple" });
                firstEvents["!r1"] = [
                    { type: "m.room.member", state_key: ALICE, sender: ALICE, content: { membership: "join" } },
                    directInvite(ALICE),
                ];

                connection["repairDirectAccountData"]();

                await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!r1"] }));
                expect(createMessagesRequest).toHaveBeenCalledOnce();
                expect(createMessagesRequest.mock.calls[0][1]).toBeNull();
                expect(createMessagesRequest.mock.calls[0][2]).toBeLessThanOrEqual(12);
            });

            it("then finds that chat for Message even though it is typed as a group", async () => {
                const room = addRoom("!r1", { type: "multiple" });
                firstEvents["!r1"] = [directInvite(ALICE)];

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(directMap).toBeDefined());

                expect(connection.getDirectRoomFor(ALICE)).toBe(room);
            });

            it("leaves a group of two alone: its invite had no direct flag", async () => {
                addRoom("!group", { type: "multiple", named: true });
                firstEvents["!group"] = [directInvite(ALICE, { is_direct: false })];
                addRoom("!group2", { type: "multiple", named: true });
                firstEvents["!group2"] = [{ ...directInvite(ALICE), content: { membership: "invite" } }];

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(createMessagesRequest).toHaveBeenCalledTimes(2));
                await settle();

                expect(setAccountData).not.toHaveBeenCalled();
            });

            it("lists a chat I made whose listing failed, from the direct invite I sent", async () => {
                addRoom("!mine", { type: "multiple" });
                firstEvents["!mine"] = [
                    { type: "m.room.member", state_key: ME, sender: ME, content: { membership: "join" } },
                    { ...directInvite(ME), state_key: ALICE },
                ];

                connection["repairDirectAccountData"]();

                await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!mine"] }));
            });

            it("does not list a group I made: its invites carry no direct flag", async () => {
                addRoom("!group", { type: "multiple" });
                firstEvents["!group"] = [{ ...directInvite(ME, { is_direct: false }), state_key: ALICE }];

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(createMessagesRequest).toHaveBeenCalledOnce());
                await settle();

                expect(setAccountData).not.toHaveBeenCalled();
            });

            it("does not take a direct invite sent by me, or one for somebody else", async () => {
                addRoom("!mine", { type: "multiple" });
                firstEvents["!mine"] = [directInvite(ME)];
                addRoom("!other", { type: "multiple" });
                firstEvents["!other"] = [{ ...directInvite(ALICE), state_key: "@bob:matrix.test" }];

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(createMessagesRequest).toHaveBeenCalledTimes(2));
                await settle();

                expect(setAccountData).not.toHaveBeenCalled();
            });

            it("does not read the history of rooms with more than two people, or ones the account lists", async () => {
                addRoom("!big", {
                    type: "multiple",
                    members: { [ME]: "join", [ALICE]: "join", "@bob:matrix.test": "join" },
                });
                addRoom("!listed", { type: "multiple" });
                directMap = { "@carol:matrix.test": ["!listed"] };

                connection["repairDirectAccountData"]();
                await settle();

                expect(createMessagesRequest).not.toHaveBeenCalled();
            });

            it("reads each room once per session, and again after a failed read", async () => {
                addRoom("!r1", { type: "multiple" });
                createMessagesRequest.mockRejectedValueOnce(new Error("offline"));

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(createMessagesRequest).toHaveBeenCalledOnce());
                await settle();
                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(createMessagesRequest).toHaveBeenCalledTimes(2));
                await settle();
                connection["repairDirectAccountData"]();
                await settle();

                expect(createMessagesRequest).toHaveBeenCalledTimes(2);
            });

            it("when the list cannot be saved, still finds the chat for Message, and tries the save again next time", async () => {
                const room = addRoom("!r1", { type: "multiple" });
                firstEvents["!r1"] = [directInvite(ALICE)];
                setAccountData.mockRejectedValueOnce(new Error("offline"));

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(setAccountData).toHaveBeenCalledOnce());
                await settle();

                // Not listed on the server, yet the invite says it is my chat with Alice: no second room is made.
                expect(directMap).toBeUndefined();
                expect(connection.getDirectRoomFor(ALICE)).toBe(room);

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!r1"] }));
                expect(createMessagesRequest).toHaveBeenCalledTimes(2);
            });

            it("lists two real chats with the same person, deletes neither, and opens the one with the newest message", async () => {
                // R1 and R2 of #889: both direct invites from the same person, both joined.
                addRoom("!r1", { type: "multiple", lastMessage: 900 });
                addRoom("!r2", { type: "multiple", lastMessage: 100 });
                firstEvents["!r1"] = [directInvite(ALICE)];
                firstEvents["!r2"] = [directInvite(ALICE)];

                connection["repairDirectAccountData"]();
                await vi.waitFor(() => expect(directMap?.[ALICE]).toHaveLength(2));

                expect(directMap?.[ALICE]).toEqual(expect.arrayContaining(["!r1", "!r2"]));
                expect(leave).not.toHaveBeenCalled();
                expect(connection["roomList"].has("!r1")).toBe(true);
                expect(connection["roomList"].has("!r2")).toBe(true);
                expect(connection.getDirectRoomFor(ALICE)?.id).toBe("!r1");
            });

            describe("when reading a first invite is slow", () => {
                const BOB = "@bob:matrix.test";

                /** The history of that room comes back only after that many milliseconds. */
                function readTakes(roomId: string, milliseconds: number): void {
                    createMessagesRequest.mockImplementation(
                        (id: string) =>
                            new Promise((resolve) => {
                                setTimeout(
                                    () => resolve({ chunk: firstEvents[id] ?? [] }),
                                    id === roomId ? milliseconds : 0
                                );
                            })
                    );
                }

                it("tells the player the chats are still loading, and makes no room, when the same person's read takes over 4 seconds", async () => {
                    vi.useFakeTimers();
                    try {
                        const room = addRoom("!r1", { type: "multiple" });
                        firstEvents["!r1"] = [directInvite(ALICE)];
                        readTakes("!r1", 10_000);

                        const opening = connection.createDirectRoom(ALICE);
                        const failure = expect(opening).rejects.toBeInstanceOf(ChatsStillLoadingError);
                        await vi.advanceTimersByTimeAsync(4000);
                        await failure;
                        expect(createRoom).not.toHaveBeenCalled();

                        // The repair finishes: the second press opens the same chat, and still makes no room.
                        await vi.advanceTimersByTimeAsync(7000);
                        await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);
                        expect(createRoom).not.toHaveBeenCalled();
                        expect(createMessagesRequest).toHaveBeenCalledOnce();
                    } finally {
                        vi.useRealTimers();
                    }
                });

                it("opens the chat as soon as its own read is over, without waiting for a slow unrelated room", async () => {
                    vi.useFakeTimers();
                    try {
                        const room = addRoom("!r1", { type: "multiple" });
                        firstEvents["!r1"] = [directInvite(ALICE)];
                        addRoom("!slow", { type: "multiple", members: { [ME]: "join", [BOB]: "join" } });
                        firstEvents["!slow"] = [directInvite(BOB)];
                        readTakes("!slow", 60_000);

                        const opening = connection.createDirectRoom(ALICE);
                        // Far less than the 4 seconds that opening a chat is willing to wait.
                        await vi.advanceTimersByTimeAsync(100);

                        await expect(opening).resolves.toBe(room);
                        expect(createRoom).not.toHaveBeenCalled();
                    } finally {
                        vi.useRealTimers();
                    }
                });

                it("remembers a room as soon as its own invite is read, even while another room is still being read", async () => {
                    vi.useFakeTimers();
                    try {
                        const room = addRoom("!r1", { type: "multiple" });
                        firstEvents["!r1"] = [directInvite(ALICE)];
                        addRoom("!slow", { type: "multiple", members: { [ME]: "join", [BOB]: "join" } });
                        firstEvents["!slow"] = [directInvite(BOB)];
                        readTakes("!slow", 60_000);

                        connection["repairDirectAccountData"]();
                        await vi.advanceTimersByTimeAsync(100);

                        expect(connection.getDirectRoomFor(ALICE)).toBe(room);
                        expect(connection.getDirectRoomFor(BOB)).toBeUndefined();
                    } finally {
                        vi.useRealTimers();
                    }
                });

                it("makes a chat with someone else at once while an unrelated room is slow", async () => {
                    vi.useFakeTimers();
                    try {
                        addRoom("!slow", { type: "multiple" });
                        firstEvents["!slow"] = [directInvite(ALICE)];
                        readTakes("!slow", 60_000);
                        vi.spyOn(
                            connection as unknown as { waitForNextSync: () => Promise<void> },
                            "waitForNextSync"
                        ).mockResolvedValue();
                        vi.spyOn(
                            connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                            "createAndAddNewRootRoom"
                        ).mockReturnValue("a chat");
                        sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

                        const opening = connection.createDirectRoom(BOB);
                        await vi.advanceTimersByTimeAsync(100);

                        await expect(opening).resolves.toBe("a chat");
                        expect(createRoom).toHaveBeenCalledOnce();
                    } finally {
                        vi.useRealTimers();
                    }
                });
            });

            describe("when reading a first invite fails", () => {
                const BOB = "@bob:matrix.test";

                /** The history of that room fails (the server is having trouble) until `recover` is called. */
                function readFails(roomId: string): { recover: () => void } {
                    let failing = true;
                    createMessagesRequest.mockImplementation((id: string) =>
                        failing && id === roomId
                            ? Promise.reject(new Error("503 Service Unavailable"))
                            : Promise.resolve({ chunk: firstEvents[id] ?? [] })
                    );
                    return {
                        recover: () => {
                            failing = false;
                        },
                    };
                }

                it("tells the player the chats are still loading, makes no room, and opens the same chat once the read works", async () => {
                    // N01 of the v0.3.5 re-audit: the read failed, so the room was taken for no chat and a second one was made.
                    const room = addRoom("!r1", { type: "multiple" });
                    firstEvents["!r1"] = [directInvite(ALICE)];
                    const server = readFails("!r1");

                    await expect(connection.createDirectRoom(ALICE)).rejects.toBeInstanceOf(ChatsStillLoadingError);
                    expect(createRoom).not.toHaveBeenCalled();

                    // Still failing: still no room.
                    await expect(connection.createDirectRoom(ALICE)).rejects.toBeInstanceOf(ChatsStillLoadingError);
                    expect(createRoom).not.toHaveBeenCalled();

                    server.recover();
                    await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);
                    expect(createRoom).not.toHaveBeenCalled();
                    expect(createMessagesRequest).toHaveBeenCalledTimes(3);
                });

                it("does the same for a chat inside a folder", async () => {
                    addFolder("!space");
                    const room = addRoom("!r1", { type: "multiple", folder: "!space" });
                    firstEvents["!r1"] = [directInvite(ALICE)];
                    const server = readFails("!r1");

                    await expect(connection.createDirectRoom(ALICE)).rejects.toBeInstanceOf(ChatsStillLoadingError);
                    expect(createRoom).not.toHaveBeenCalled();

                    server.recover();
                    await expect(connection.createDirectRoom(ALICE)).resolves.toBe(room);
                    expect(createRoom).not.toHaveBeenCalled();
                });

                it("still makes a chat with someone else when an unrelated room cannot be read", async () => {
                    addRoom("!r1", { type: "multiple" });
                    firstEvents["!r1"] = [directInvite(ALICE)];
                    readFails("!r1");
                    vi.spyOn(
                        connection as unknown as { waitForNextSync: () => Promise<void> },
                        "waitForNextSync"
                    ).mockResolvedValue();
                    vi.spyOn(
                        connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                        "createAndAddNewRootRoom"
                    ).mockReturnValue("a chat");
                    sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

                    await expect(connection.createDirectRoom(BOB)).resolves.toBe("a chat");
                    expect(createRoom).toHaveBeenCalledOnce();
                });

                it("makes a new chat once the read works and the room turns out to be a group, not a chat", async () => {
                    // Two of us in a room that was never a direct chat: a group of two stays a group.
                    addRoom("!group", { type: "multiple" });
                    firstEvents["!group"] = [];
                    const server = readFails("!group");
                    vi.spyOn(
                        connection as unknown as { waitForNextSync: () => Promise<void> },
                        "waitForNextSync"
                    ).mockResolvedValue();
                    vi.spyOn(
                        connection as unknown as { createAndAddNewRootRoom: (room: unknown) => unknown },
                        "createAndAddNewRootRoom"
                    ).mockReturnValue("a chat");
                    sdkRooms.set("!new:matrix.test", { roomId: "!new:matrix.test" });

                    await expect(connection.createDirectRoom(ALICE)).rejects.toBeInstanceOf(ChatsStillLoadingError);
                    expect(createRoom).not.toHaveBeenCalled();

                    server.recover();
                    await expect(connection.createDirectRoom(ALICE)).resolves.toBe("a chat");
                    expect(createRoom).toHaveBeenCalledOnce();
                });
            });
        });
    });
});
