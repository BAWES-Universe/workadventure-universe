import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { get } from "svelte/store";

/** The room's history, oldest first, and what the fake timeline window did with it. */
const timeline = vi.hoisted(() => ({
    events: [] as unknown[],
    /** How many of the newest events the window holds once loaded (what the first sync gave). */
    initial: 8,
    paginateCalls: [] as number[],
    running: 0,
    maxRunning: 0,
    loadError: undefined as Error | undefined,
    paginateError: undefined as { onCall: number; error: Error } | undefined,
}));

vi.mock("matrix-js-sdk", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class FakeTimelineWindow {
        private start = 0;
        private end = 0;
        load(): Promise<void> {
            if (timeline.loadError) return Promise.reject(timeline.loadError);
            this.end = timeline.events.length;
            this.start = Math.max(0, this.end - timeline.initial);
            return Promise.resolve();
        }
        canPaginate(): boolean {
            return this.start > 0;
        }
        async paginate(_direction: unknown, size: number): Promise<boolean> {
            timeline.paginateCalls.push(size);
            const call = timeline.paginateCalls.length;
            timeline.running++;
            timeline.maxRunning = Math.max(timeline.maxRunning, timeline.running);
            // A request to the server.
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
            });
            timeline.running--;
            if (timeline.paginateError?.onCall === call) throw timeline.paginateError.error;
            const count = Math.min(size, this.start);
            this.start -= count;
            return count > 0;
        }
        unpaginate(delta: number): void {
            this.end -= delta;
        }
        getEvents(): unknown[] {
            return timeline.events.slice(this.start, this.end);
        }
    }
    return { ...actual, TimelineWindow: FakeTimelineWindow };
});

vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        isAChatRoomIsVisible: writable(false),
        navChat: writable("chat"),
        selectedChatMessageToReply: writable(null),
        botsChatIds: writable([]),
    };
});
vi.mock("../../../Stores/SelectRoomStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});
vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Connection/LocalUserStore", () => ({ localUserStore: {} }));
vi.mock("../../../../Notification/MessageNotification", () => ({ MessageNotification: class {} }));
vi.mock("../../../../Notification/NotificationManager", () => ({ notificationManager: {} }));
vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
    changingMatrixAvatarStore: () => ({ subscribe: () => () => {} }),
}));
vi.mock("../MatrixSecurity", () => ({
    matrixSecurity: { restoreRoomsMessages: () => Promise.resolve() },
}));
vi.mock("../MatrixChatRoomMember", () => ({ MatrixChatRoomMember: class {} }));
vi.mock("../MatrixChatMessage", () => ({
    MatrixChatMessage: class {
        readonly id: string;
        constructor(event: { getId: () => string }) {
            this.id = event.getId();
        }
    },
}));
vi.mock("../MatrixChatMessageReaction", () => ({ MatrixChatMessageReaction: class {} }));

import { MatrixChatRoom } from "../MatrixChatRoom";

let nextId = 0;
function message(): MatrixEvent {
    const id = `$m${++nextId}`;
    return {
        getId: () => id,
        getType: () => "m.room.message",
        isEncrypted: () => false,
        getRelation: () => undefined,
        getContent: () => ({ body: id }),
    } as unknown as MatrixEvent;
}
function reaction(target: string): MatrixEvent {
    const id = `$r${++nextId}`;
    return {
        getId: () => id,
        getType: () => "m.reaction",
        getSender: () => "@you:matrix.test",
        isEncrypted: () => false,
        getRelation: () => ({ rel_type: "m.annotation", event_id: target, key: "+1" }),
        getContent: () => ({ "m.relates_to": { rel_type: "m.annotation", event_id: target, key: "+1" } }),
    } as unknown as MatrixEvent;
}
function memberEvent(): MatrixEvent {
    const id = `$s${++nextId}`;
    return {
        getId: () => id,
        getType: () => "m.room.member",
        isEncrypted: () => false,
        getRelation: () => undefined,
    } as unknown as MatrixEvent;
}

function fakeRoom(options: { space?: boolean; membership?: string } = {}): Room {
    return {
        roomId: "!dm:matrix.test",
        name: "DM",
        myUserId: "@me:matrix.test",
        client: {
            getAccountData: () => undefined,
            getUserId: () => "@me:matrix.test",
        },
        getUnreadNotificationCount: () => 0,
        getMyMembership: () => options.membership ?? "join",
        getDMInviter: () => "@you:matrix.test",
        getMembers: () => [],
        getLiveTimeline: () => ({ getTimelineSet: () => ({}) }),
        hasEncryptionStateEvent: () => false,
        isSpaceRoom: () => options.space ?? false,
        getMxcAvatarUrl: () => undefined,
        getAvatarFallbackMember: () => undefined,
        getPendingEvents: () => [],
        on: () => {},
    } as unknown as Room;
}

/** The ids of the messages in the list, oldest first. */
function ids(room: MatrixChatRoom): string[] {
    return [...room.messages].map((m) => m.id);
}
const settle = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 40);
    });

describe("MatrixChatRoom loading messages", () => {
    beforeEach(() => {
        nextId = 0;
        timeline.events = [];
        timeline.initial = 8;
        timeline.paginateCalls = [];
        timeline.running = 0;
        timeline.maxRunning = 0;
        timeline.loadError = undefined;
        timeline.paginateError = undefined;
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    describe("first load", () => {
        it("fetches earlier events until a real message exists when the first events are only reactions", async () => {
            const oldest = message();
            const last = message();
            // 25 events of reactions and member changes after the last real message: 3 pages of 8 are not enough.
            timeline.events = [oldest, last];
            for (let i = 0; i < 25; i++) timeline.events.push(i % 2 === 0 ? reaction(last.getId()!) : memberEvent());

            const room = new MatrixChatRoom(fakeRoom());
            expect(get(room.isLoadingMessages)).toBe(true);
            await settle();

            expect(ids(room)).toEqual([oldest.getId(), last.getId()]);
            expect(get(room.isLoadingMessages)).toBe(false);
        });

        it("does not ask for more when the first events already hold a message", async () => {
            timeline.events = [message(), message(), message()];
            const room = new MatrixChatRoom(fakeRoom());
            await settle();

            expect(ids(room)).toHaveLength(3);
            expect(timeline.paginateCalls).toEqual([]);
            expect(get(room.isLoadingMessages)).toBe(false);
        });

        it("stops at the start of the history of a room with no message", async () => {
            timeline.events = Array.from({ length: 40 }, () => memberEvent());
            const room = new MatrixChatRoom(fakeRoom());
            await settle();

            expect(ids(room)).toEqual([]);
            expect(get(room.hasPreviousMessage)).toBe(false);
            expect(get(room.isLoadingMessages)).toBe(false);
        });

        it("does not backfill a space or a room that is not joined", async () => {
            timeline.events = [message(), ...Array.from({ length: 12 }, () => memberEvent())];
            const space = new MatrixChatRoom(fakeRoom({ space: true }));
            const invite = new MatrixChatRoom(fakeRoom({ membership: "invite" }));
            await settle();

            expect(timeline.paginateCalls).toEqual([]);
            expect(get(space.isLoadingMessages)).toBe(false);
            expect(get(invite.isLoadingMessages)).toBe(false);
        });

        it("stops loading when the first load fails", async () => {
            timeline.loadError = new Error("offline");
            const room = new MatrixChatRoom(fakeRoom());
            await settle();

            expect(get(room.isLoadingMessages)).toBe(false);
            expect(ids(room)).toEqual([]);
        });

        it("stops loading when the backfill fails", async () => {
            timeline.events = [message(), ...Array.from({ length: 20 }, () => memberEvent())];
            timeline.paginateError = { onCall: 1, error: new Error("offline") };
            const room = new MatrixChatRoom(fakeRoom());
            await settle();

            expect(get(room.isLoadingMessages)).toBe(false);
            expect(ids(room)).toEqual([]);
        });
    });

    describe("loadMorePreviousMessages", () => {
        /** A room whose window holds the last 8 events, with `count` real messages (and a reaction after each). */
        async function openedRoom(count: number) {
            const all: MatrixEvent[] = [];
            for (let i = 0; i < count; i++) {
                const m = message();
                all.push(m, reaction(m.getId()!));
            }
            timeline.events = all;
            const room = new MatrixChatRoom(fakeRoom());
            await settle();
            timeline.paginateCalls = [];
            return { room, messageIds: all.filter((e) => e.getType() === "m.room.message").map((e) => e.getId()!) };
        }

        it("collects at least 20 messages across pages, ignoring reactions", async () => {
            const { room, messageIds } = await openedRoom(100);
            const before = ids(room).length;
            expect(before).toBe(4);

            await room.loadMorePreviousMessages();

            // 30 events hold 15 messages: a second page is needed to reach 20.
            expect(timeline.paginateCalls).toEqual([30, 30]);
            expect(ids(room)).toEqual(messageIds.slice(100 - before - 30));
            expect(get(room.hasPreviousMessage)).toBe(true);
        });

        it("adds the messages in one update, older ones first", async () => {
            const { room, messageIds } = await openedRoom(100);
            const updates: string[][] = [];
            const unsubscribe = room.messages.subscribe((messages) => updates.push(Array.from(messages, (m) => m.id)));
            updates.length = 0;

            await room.loadMorePreviousMessages();

            unsubscribe();
            expect(updates).toHaveLength(1);
            expect(updates[0]).toEqual(messageIds.slice(100 - 4 - 30));
        });

        it("loads everything and says so when the history is shorter than a load", async () => {
            const { room, messageIds } = await openedRoom(12);

            await room.loadMorePreviousMessages();

            expect(ids(room)).toEqual(messageIds);
            expect(get(room.hasPreviousMessage)).toBe(false);

            timeline.paginateCalls = [];
            await room.loadMorePreviousMessages();
            expect(timeline.paginateCalls).toEqual([]);
            expect(ids(room)).toEqual(messageIds);
        });

        it("continues from where the last load stopped", async () => {
            const { room, messageIds } = await openedRoom(100);

            await room.loadMorePreviousMessages();
            await room.loadMorePreviousMessages();

            expect(ids(room)).toEqual(messageIds.slice(100 - 4 - 60));
            expect(new Set(ids(room)).size).toBe(ids(room).length);
        });

        it("does not paginate twice at once when called twice", async () => {
            const { room, messageIds } = await openedRoom(100);

            await Promise.all([room.loadMorePreviousMessages(), room.loadMorePreviousMessages()]);

            expect(timeline.maxRunning).toBe(1);
            expect(timeline.paginateCalls).toEqual([30, 30]);
            expect(ids(room)).toEqual(messageIds.slice(100 - 4 - 30));
        });

        it("waits for the first load, which fills the list on its own", async () => {
            const last = message();
            timeline.events = [message(), last, ...Array.from({ length: 30 }, () => memberEvent())];
            const room = new MatrixChatRoom(fakeRoom());

            // Asked before the room's first load is over: it must not paginate the same window as the backfill.
            await Promise.all([room.loadMorePreviousMessages(), room.loadMorePreviousMessages()]);

            expect(timeline.maxRunning).toBe(1);
            expect(ids(room)).toHaveLength(2);
            expect(new Set(ids(room)).size).toBe(2);
            expect(get(room.isLoadingMessages)).toBe(false);
        });

        it("keeps what it read when a later request fails, and can be asked again", async () => {
            const { room, messageIds } = await openedRoom(100);
            timeline.paginateError = { onCall: 2, error: new Error("offline") };

            await expect(room.loadMorePreviousMessages()).rejects.toThrow("offline");
            // The first page (15 messages) was read: it is in the list.
            expect(ids(room)).toEqual(messageIds.slice(100 - 4 - 15));

            timeline.paginateError = undefined;
            await room.loadMorePreviousMessages();
            expect(ids(room)).toEqual(messageIds.slice(100 - 4 - 15 - 30));
        });
    });
});
