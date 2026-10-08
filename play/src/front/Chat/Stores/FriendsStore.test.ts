import { get } from "svelte/store";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import type { FriendsListAnswer, FriendsUpdateMessage } from "@workadventure/messages";
import { ConnectionClosedError } from "../../Connection/ConnectionClosedError";
import type { FriendsConnection } from "./FriendsStore";
import { createFriendsStore, FRIENDS_RETRY_DELAYS_MS, relationshipsOf } from "./FriendsStore";

function list(names: string[] = []): FriendsListAnswer {
    return {
        friends: names.map((name) => ({
            uuid: `uuid-${name}`,
            name,
            chatId: "",
            lastSeenAt: "",
            presence: { online: false, locationHidden: false, availabilityStatus: 0, sessions: [] },
        })),
        incoming: [],
        outgoing: [],
        blocked: [],
    };
}

function fakeConnection(answers: Array<FriendsListAnswer | Error>) {
    const updates = new Subject<FriendsUpdateMessage>();
    const queryFriendsList = vi.fn(() => {
        const next = answers.shift() ?? list();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const connection: FriendsConnection = {
        queryFriendsList,
        queryFriendAction: vi.fn(() => Promise.resolve({ relationship: "request_sent", error: "" })),
        queryFriendSearch: vi.fn(() => Promise.resolve([])),
        queryFriendSettings: vi.fn(() => Promise.resolve(undefined)),
        friendsUpdateMessageStream: updates.asObservable(),
    };
    return { connection, updates, queryFriendsList };
}

describe("friendsStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("stays signed out for guests and asks for nothing", () => {
        const store = createFriendsStore();
        const { connection, queryFriendsList } = fakeConnection([]);
        store.attach(connection, false);
        expect(get(store)).toEqual({ status: "signedOut" });
        expect(queryFriendsList).not.toHaveBeenCalled();
    });

    it("loads the list, then applies presence updates to it", async () => {
        const store = createFriendsStore();
        const { connection, updates } = fakeConnection([list(["Sara"])]);
        store.attach(connection, true);
        expect(get(store).status).toBe("loading");
        await vi.runOnlyPendingTimersAsync();
        expect(get(store)).toEqual({ status: "ready", list: list(["Sara"]) });

        const presence = {
            online: true,
            locationHidden: false,
            availabilityStatus: AvailabilityStatus.ONLINE,
            sessions: [],
        };
        updates.next({ update: { $case: "presence", presence: { uuid: "uuid-Sara", presence } } });
        const state = get(store);
        expect(state.status === "ready" && state.list.friends[0].presence).toEqual(presence);
    });

    it("keeps the last list when a reload fails, and retries", async () => {
        const store = createFriendsStore();
        const { connection, updates, queryFriendsList } = fakeConnection([
            list(["Sara"]),
            new Error("down"),
            list(["Sara", "Tariq"]),
        ]);
        store.attach(connection, true);
        await vi.runOnlyPendingTimersAsync();

        updates.next({ update: { $case: "listChanged", listChanged: {} } });
        await vi.advanceTimersByTimeAsync(300);
        expect(get(store)).toEqual({ status: "failed", list: list(["Sara"]) });

        await vi.advanceTimersByTimeAsync(FRIENDS_RETRY_DELAYS_MS[0]);
        expect(get(store)).toEqual({ status: "ready", list: list(["Sara", "Tariq"]) });
        expect(queryFriendsList).toHaveBeenCalledTimes(3);
    });

    it("turns friends off when this server has none, without retrying", async () => {
        const store = createFriendsStore();
        const { connection, queryFriendsList } = fakeConnection([new Error("friends_unavailable")]);
        store.attach(connection, true);
        await vi.runOnlyPendingTimersAsync();
        expect(get(store)).toEqual({ status: "signedOut" });
        await vi.advanceTimersByTimeAsync(FRIENDS_RETRY_DELAYS_MS[0] * 2);
        expect(queryFriendsList).toHaveBeenCalledTimes(1);
    });

    it("does not retry on a connection that closed", async () => {
        const store = createFriendsStore();
        const { connection, queryFriendsList } = fakeConnection([new ConnectionClosedError("Socket closed")]);
        store.attach(connection, true);
        await vi.runOnlyPendingTimersAsync();
        await vi.advanceTimersByTimeAsync(FRIENDS_RETRY_DELAYS_MS[0] * 2);
        expect(queryFriendsList).toHaveBeenCalledTimes(1);
    });

    it("stops on a closing connection, keeps the list, and leaves a newer connection alone", async () => {
        const store = createFriendsStore();
        const first = fakeConnection([list(["Sara"]), new Error("down")]);
        store.attach(first.connection, true);
        await vi.runOnlyPendingTimersAsync();
        first.updates.next({ update: { $case: "listChanged", listChanged: {} } });
        await vi.advanceTimersByTimeAsync(300);
        store.detach(first.connection);
        await vi.advanceTimersByTimeAsync(FRIENDS_RETRY_DELAYS_MS[0] * 2);
        expect(first.queryFriendsList).toHaveBeenCalledTimes(2);
        expect(get(store).status).toBe("failed");
        expect(get(store)).toMatchObject({ list: list(["Sara"]) });

        const second = fakeConnection([list(["Tariq"])]);
        store.attach(second.connection, true);
        store.detach(first.connection);
        await vi.runOnlyPendingTimersAsync();
        expect(get(store)).toEqual({ status: "ready", list: list(["Tariq"]) });
    });

    it("ignores the answer of a previous connection", async () => {
        const store = createFriendsStore();
        let release: (answer: FriendsListAnswer) => void = () => undefined;
        const first = fakeConnection([]);
        first.connection.queryFriendsList = () =>
            new Promise<FriendsListAnswer>((resolve) => {
                release = resolve;
            });
        store.attach(first.connection, true);
        const second = fakeConnection([list(["Tariq"])]);
        store.attach(second.connection, true);
        await vi.runOnlyPendingTimersAsync();
        release(list(["Old"]));
        await vi.runOnlyPendingTimersAsync();
        expect(get(store)).toEqual({ status: "ready", list: list(["Tariq"]) });
    });

    it("reloads after an action", async () => {
        const store = createFriendsStore();
        const { connection, queryFriendsList } = fakeConnection([list(), list()]);
        store.attach(connection, true);
        await vi.runOnlyPendingTimersAsync();
        expect(await store.act("uuid-Sara", "request")).toEqual({ relationship: "request_sent", error: "" });
        await vi.advanceTimersByTimeAsync(300);
        expect(queryFriendsList).toHaveBeenCalledTimes(2);
    });
});

describe("relationshipsOf", () => {
    it("reads each person's standing from the list", () => {
        const answer = list(["Sara"]);
        answer.incoming = [{ uuid: "uuid-in", name: "In", sharedWorld: "", at: "" }];
        answer.outgoing = [{ uuid: "uuid-out", name: "Out", sharedWorld: "", at: "" }];
        answer.blocked = [{ uuid: "uuid-b", name: "B" }];
        expect(Object.fromEntries(relationshipsOf(answer))).toEqual({
            "uuid-Sara": "friends",
            "uuid-in": "request_received",
            "uuid-out": "request_sent",
            "uuid-b": "blocked_by_me",
        });
    });
});
