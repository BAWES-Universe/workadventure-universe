import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import {
    FORGET_RETRY_DELAYS_MS,
    forgetRememberedRooms,
    forgetRememberedRoomsAndRetry,
    rememberRoomToForget,
    retryForgettingRememberedRooms,
} from "../roomsToForget";

const me = "@me:matrix.test";

function fakeClient(
    options: { forget?: (roomId: string) => Promise<unknown>; memberships?: Record<string, string> } = {}
) {
    const forget = vi.fn(options.forget ?? (() => Promise.resolve({})));
    const client = {
        forget,
        getRoom: (roomId: string) => {
            const membership = options.memberships?.[roomId];
            return membership ? { getMyMembership: () => membership } : null;
        },
    } as unknown as Pick<MatrixClient, "forget" | "getRoom">;
    return { client, forget };
}

describe("rooms that were left but could not be forgotten", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("forgets a room that was written down and stops asking once it worked", async () => {
        rememberRoomToForget(me, "!a:matrix.test");
        const { client, forget } = fakeClient();

        await forgetRememberedRooms(client, me);
        await forgetRememberedRooms(client, me);

        expect(forget).toHaveBeenCalledOnce();
        expect(forget).toHaveBeenCalledWith("!a:matrix.test");
    });

    it("writes a room down once, however often it fails", async () => {
        rememberRoomToForget(me, "!a:matrix.test");
        rememberRoomToForget(me, "!a:matrix.test");
        const { client, forget } = fakeClient();

        await forgetRememberedRooms(client, me);

        expect(forget).toHaveBeenCalledOnce();
    });

    it("keeps a room whose forget fails, and lets it go after five tries in all", async () => {
        rememberRoomToForget(me, "!a:matrix.test"); // the first try is the failed delete itself
        const { client, forget } = fakeClient({ forget: () => Promise.reject(new Error("offline")) });

        await forgetRememberedRooms(client, me);
        await forgetRememberedRooms(client, me);
        await forgetRememberedRooms(client, me);
        expect(forget).toHaveBeenCalledTimes(3);

        await forgetRememberedRooms(client, me); // the fifth try in all: it fails and the room is let go
        await forgetRememberedRooms(client, me);
        expect(forget).toHaveBeenCalledTimes(4);
    });

    it("does not forget a room that shows as joined or invited", async () => {
        rememberRoomToForget(me, "!joined:matrix.test");
        rememberRoomToForget(me, "!invited:matrix.test");
        const { client, forget } = fakeClient({
            memberships: { "!joined:matrix.test": "join", "!invited:matrix.test": "invite" },
        });

        await forgetRememberedRooms(client, me);

        expect(forget).not.toHaveBeenCalled();
    });

    it("forgets a room later that still showed as joined because the sync had not brought the leave yet", async () => {
        rememberRoomToForget(me, "!a:matrix.test");
        const memberships: Record<string, string> = { "!a:matrix.test": "join" };
        const { client, forget } = fakeClient({ memberships });

        await forgetRememberedRooms(client, me);
        expect(forget).not.toHaveBeenCalled();

        memberships["!a:matrix.test"] = "leave"; // the sync arrived
        await forgetRememberedRooms(client, me);
        expect(forget).toHaveBeenCalledExactlyOnceWith("!a:matrix.test");
    });

    it("lets a room that shows as joined go after five tries in all (it was really joined again)", async () => {
        rememberRoomToForget(me, "!a:matrix.test");
        const { client, forget } = fakeClient({ memberships: { "!a:matrix.test": "join" } });

        for (let run = 0; run < 5; run++) {
            // eslint-disable-next-line no-await-in-loop
            await forgetRememberedRooms(client, me);
        }
        expect(localStorage.getItem("universe:matrix:rooms-to-forget:" + me)).toBeNull();
        expect(forget).not.toHaveBeenCalled();
    });

    it("keeps a room written down while a run is going", async () => {
        rememberRoomToForget(me, "!first:matrix.test");
        let release: (() => void) | undefined;
        const { client } = fakeClient({
            forget: () =>
                new Promise((resolve) => {
                    release = () => resolve({});
                }),
        });

        const running = forgetRememberedRooms(client, me);
        rememberRoomToForget(me, "!second:matrix.test");
        release?.();
        await running;

        const stored = JSON.parse(localStorage.getItem("universe:matrix:rooms-to-forget:" + me) ?? "[]");
        expect(stored).toEqual([{ roomId: "!second:matrix.test", attempts: 1 }]);
    });

    it("keeps the list per account", async () => {
        rememberRoomToForget("@other:matrix.test", "!other:matrix.test");
        const { client, forget } = fakeClient();

        await forgetRememberedRooms(client, me);

        expect(forget).not.toHaveBeenCalled();
    });

    it("runs once at a time", async () => {
        rememberRoomToForget(me, "!a:matrix.test");
        let release: (() => void) | undefined;
        const { client, forget } = fakeClient({
            forget: () =>
                new Promise((resolve) => {
                    release = () => resolve({});
                }),
        });

        const first = forgetRememberedRooms(client, me);
        const second = forgetRememberedRooms(client, me);
        release?.();
        await Promise.all([first, second]);

        expect(forget).toHaveBeenCalledOnce();
    });

    it("ignores a damaged list", async () => {
        localStorage.setItem("universe:matrix:rooms-to-forget:" + me, "{not json");
        const { client, forget } = fakeClient();

        await forgetRememberedRooms(client, me);

        expect(forget).not.toHaveBeenCalled();
    });

    describe("trying again while the tab stays open", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it("waits longer before each new try", () => {
            expect(FORGET_RETRY_DELAYS_MS).toEqual([10_000, 30_000, 60_000, 120_000, 300_000]);
        });

        it("tries again after every wait until the room is forgotten, then stops", async () => {
            vi.useFakeTimers();
            rememberRoomToForget(me, "!a:matrix.test");
            const failures = [new Error("offline"), new Error("offline")];
            const { client, forget } = fakeClient({
                forget: () => {
                    const failure = failures.shift();
                    return failure ? Promise.reject(failure) : Promise.resolve({});
                },
            });

            retryForgettingRememberedRooms(client, me);
            await vi.advanceTimersByTimeAsync(9_999);
            expect(forget).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(forget).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(29_999);
            expect(forget).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(forget).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(59_999);
            expect(forget).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(forget).toHaveBeenCalledTimes(3);
            expect(localStorage.length).toBe(0);

            await vi.advanceTimersByTimeAsync(600_000);
            expect(forget).toHaveBeenCalledTimes(3);
        });

        it("has one chain of tries per account, however many rooms ask", async () => {
            vi.useFakeTimers();
            rememberRoomToForget(me, "!a:matrix.test");
            const { client, forget } = fakeClient();

            retryForgettingRememberedRooms(client, me);
            retryForgettingRememberedRooms(client, me);
            await vi.advanceTimersByTimeAsync(600_000);

            expect(forget).toHaveBeenCalledOnce();
        });

        it("after a reload during an outage, keeps trying once the start's own try failed, until the room is forgotten", async () => {
            // N02 of the v0.3.5 re-audit: the start tried once, failed, and nothing tried again while the tab stayed open.
            vi.useFakeTimers();
            rememberRoomToForget(me, "!a:matrix.test"); // written down before the reload
            let serverDown = true;
            const { client, forget } = fakeClient({
                forget: () => (serverDown ? Promise.reject(new Error("offline")) : Promise.resolve({})),
            });

            await forgetRememberedRoomsAndRetry(client, me);
            expect(forget).toHaveBeenCalledTimes(1);
            expect(localStorage.length).toBe(1);

            // Only the server comes back: no reload, reconnect or new delete.
            serverDown = false;
            await vi.advanceTimersByTimeAsync(10_000);
            expect(forget).toHaveBeenCalledTimes(2);
            expect(localStorage.length).toBe(0);

            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(forget).toHaveBeenCalledTimes(2);
        });

        it("starts no chain of tries at start when everything written down was forgotten", async () => {
            vi.useFakeTimers();
            rememberRoomToForget(me, "!a:matrix.test");
            const { client, forget } = fakeClient();

            await forgetRememberedRoomsAndRetry(client, me);
            expect(forget).toHaveBeenCalledOnce();

            // A room written down later without its own chain: no chain from the start picks it up.
            localStorage.setItem(
                "universe:matrix:rooms-to-forget:" + me,
                JSON.stringify([{ roomId: "!b", attempts: 1 }])
            );
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(forget).toHaveBeenCalledOnce();
            localStorage.clear();
        });

        it("lets a room go after its fifth try in all, and the chain ends with it", async () => {
            vi.useFakeTimers();
            rememberRoomToForget(me, "!a:matrix.test");
            const { client, forget } = fakeClient({ forget: () => Promise.reject(new Error("offline")) });

            retryForgettingRememberedRooms(client, me);
            await vi.advanceTimersByTimeAsync(3_600_000);

            expect(forget).toHaveBeenCalledTimes(4);
            expect(localStorage.length).toBe(0);
        });
    });
});
