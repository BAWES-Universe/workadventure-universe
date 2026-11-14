import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
import { createCallStore } from "../CallStore";
import {
    createCallConnection,
    CALL_CONNECT_TIMEOUT_MS,
    PENDING_CALL_SPACE,
    type CallSpaceLike,
} from "../CallConnection";
import type { CallMicGate } from "../../../../Space/CallMicGate";
import type { CallResult } from "../../../../external-modules/bots/services/callFailure";

const SPACE = "call__abc";

function fakeSpace(initial: string[] = []) {
    const users = writable(new Map<string, unknown>(initial.map((id) => [id, {}])));
    const joined = new Subject<unknown>();
    const left = new Subject<unknown>();
    const gone = new Subject<void>();
    const space: CallSpaceLike = {
        getName: () => SPACE,
        usersStore: users,
        observeUserJoined: joined,
        observeUserLeft: left,
        onLeaveSpace: gone,
    };
    return { space, joined, left, gone, users };
}

function setup(
    options: { start?: CallResult; space?: ReturnType<typeof fakeSpace>; joinFails?: boolean; micOn?: boolean } = {}
) {
    const store = createCallStore(() => 1000);
    const fake = options.space ?? fakeSpace();
    const gates: Array<CallMicGate | undefined> = [];
    const deps = {
        store,
        startCall: vi.fn().mockResolvedValue(options.start ?? { started: true, spaceName: SPACE }),
        endCall: vi.fn().mockResolvedValue(true),
        joinSpace: vi
            .fn()
            .mockImplementation(() =>
                options.joinFails ? Promise.reject(new Error("no")) : Promise.resolve(fake.space)
            ),
        leaveSpace: vi.fn().mockResolvedValue(undefined),
        setGate: vi.fn((gate: CallMicGate | undefined) => gates.push(gate)),
        now: () => 2000,
    };
    const mic = { on: options.micOn ?? false };
    const microphone = {
        isOn: vi.fn(() => mic.on),
        turnOn: vi.fn(() => {
            mic.on = true;
        }),
        turnOff: vi.fn(() => {
            mic.on = false;
        }),
    };
    const connection = createCallConnection({ ...deps, microphone });
    return { connection, deps, store, fake, gates, microphone, mic, state: () => get(store)?.state };
}

describe("carrying a call with a Brick (game #2004)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("asks the bot server, joins the space it names, and is on once the bot is in it", async () => {
        const t = setup();
        expect(await t.connection.begin("b1", "Nora")).toEqual({ ok: true });
        expect(t.deps.startCall).toHaveBeenCalledWith("b1");
        expect(t.deps.joinSpace).toHaveBeenCalledWith(SPACE, expect.any(AbortSignal));
        expect(t.state()?.phase).toBe("connecting");
        t.fake.joined.next({});
        expect(t.state()?.phase).toBe("on");
    });

    it("is on at once when the bot was already in the space", async () => {
        const t = setup({ space: fakeSpace(["bot"]) });
        await t.connection.begin("b1", "Nora");
        expect(t.state()?.phase).toBe("on");
    });

    it("keeps the microphone out of the call until it is on, gives it to the call while on, and back to the people on hold", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        // Still connecting: nothing but the call's own space carries the microphone
        expect(t.gates.at(-1)).toEqual({ spaceName: SPACE, owner: "bot" });
        t.fake.joined.next({});
        expect(t.gates.at(-1)).toEqual({ spaceName: SPACE, owner: "bot" });
        t.store.send({ type: "someone-here", id: "p", name: "Sam" });
        t.store.send({ type: "hold-and-talk" });
        expect(t.gates.at(-1)).toEqual({ spaceName: SPACE, owner: "people" });
        t.store.send({ type: "resume", now: 3000 });
        expect(t.gates.at(-1)).toEqual({ spaceName: SPACE, owner: "bot" });
    });

    it("ends by the bot when the bot leaves the space, and tells the bot server, leaves the space and frees the microphone", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.fake.left.next({});
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "bot" });
        expect(t.deps.endCall).toHaveBeenCalledWith("b1");
        expect(t.deps.leaveSpace).toHaveBeenCalledWith(t.fake.space);
        expect(t.gates.at(-1)).toBeUndefined();
        expect(t.connection.isActive()).toBe(false);
    });

    it("ends once, however many ways say it is over", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.connection.end();
        t.fake.left.next({});
        t.store.send({ type: "end", by: "quiet" });
        expect(t.deps.endCall).toHaveBeenCalledTimes(1);
        expect(t.deps.leaveSpace).toHaveBeenCalledTimes(1);
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "you" });
    });

    it("ends the whole call when a quiet stretch ends it, or the person ends it from the bar", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.store.send({ type: "tick", now: 1_000_000, quietMs: 1000 });
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "quiet" });
        expect(t.deps.endCall).toHaveBeenCalledTimes(1);
        expect(t.gates.at(-1)).toBeUndefined();
    });

    it("gives up when the bot never comes into the space", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        vi.advanceTimersByTime(CALL_CONNECT_TIMEOUT_MS - 1);
        expect(t.state()?.phase).toBe("connecting");
        vi.advanceTimersByTime(1);
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "unavailable" });
        expect(t.deps.endCall).toHaveBeenCalledTimes(1);
    });

    it("gives up when the space is lost", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.fake.gone.next();
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "unavailable" });
    });

    it("passes on a refusal with the owner's own line, and leaves nothing running", async () => {
        const t = setup({ start: { started: false, failure: "not_allowed", reason: "Nora does not take calls" } });
        expect(await t.connection.begin("b1", "Nora")).toEqual({
            ok: false,
            failure: "not_allowed",
            reason: "Nora does not take calls",
        });
        expect(t.deps.joinSpace).not.toHaveBeenCalled();
        // Nothing of a call that never started is left on screen: the person can call again at once
        expect(t.state()).toBeUndefined();
        expect(t.connection.isActive()).toBe(false);
        expect(t.gates.at(-1)).toBeUndefined();
    });

    it("hangs the bot up when this browser cannot join the space", async () => {
        const t = setup({ joinFails: true });
        expect(await t.connection.begin("b1", "Nora")).toMatchObject({ ok: false, failure: "failed" });
        expect(t.deps.endCall).toHaveBeenCalledWith("b1");
        expect(t.gates.at(-1)).toBeUndefined();
        expect(t.state()).toBeUndefined();
    });

    it("keeps the microphone out of every space from the moment Call is tapped, before it is turned on", async () => {
        const t = setup({ micOn: false });
        const order: string[] = [];
        t.deps.setGate.mockImplementation((gate: CallMicGate | undefined) => order.push(`gate:${gate?.spaceName}`));
        t.microphone.turnOn.mockImplementation(() => order.push("mic on"));
        await t.connection.begin("b1", "Nora");
        expect(order.slice(0, 2)).toEqual([`gate:${PENDING_CALL_SPACE}`, "mic on"]);
    });

    it("is not on until the bot is in the space: this person is listed in it too", async () => {
        const fake = fakeSpace(["me"]);
        const space = { ...fake.space, mySpaceUserId: "me" };
        const t = setup({ space: { ...fake, space } });
        await t.connection.begin("b1", "Nora");
        expect(t.state()?.phase).toBe("connecting");
        fake.joined.next({ spaceUserId: "me" });
        expect(t.state()?.phase).toBe("connecting");
        fake.joined.next({ spaceUserId: "bot" });
        expect(t.state()?.phase).toBe("on");
        fake.left.next({ spaceUserId: "me" });
        expect(t.state()?.phase).toBe("on");
    });

    it("takes one call at a time", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        expect(await t.connection.begin("b2", "Max")).toEqual({ ok: false, failure: "already_on_a_call" });
        expect(t.deps.startCall).toHaveBeenCalledTimes(1);
        t.connection.end();
        // Once the first call is over, another may begin
        expect(await t.connection.begin("b2", "Max")).toEqual({ ok: true });
    });

    it("still tells the bot, frees the microphone and lets the person call again when leaving the space throws at once", async () => {
        const t = setup();
        t.deps.leaveSpace.mockImplementation(() => {
            throw new Error("There is no game scene to leave a call in.");
        });
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.fake.gone.next();
        expect(t.state()).toMatchObject({ phase: "ended", endedBy: "unavailable" });
        expect(t.deps.endCall).toHaveBeenCalledWith("b1");
        expect(t.gates.at(-1)).toBeUndefined();
        expect(t.mic.on).toBe(false);
        expect(t.connection.isActive()).toBe(false);
    });

    it("tells the bot server when the person hangs up while it is still starting", async () => {
        const t = setup();
        let answer!: (value: CallResult) => void;
        t.deps.startCall.mockImplementation(
            () =>
                new Promise<CallResult>((resolve) => {
                    answer = resolve;
                })
        );
        const begun = t.connection.begin("b1", "Nora");
        t.connection.end();
        answer({ started: true, spaceName: SPACE });
        // The person hung up: nothing failed, so there is nothing to say
        expect(await begun).toEqual({ ok: false, failure: "cancelled" });
        expect(t.deps.joinSpace).not.toHaveBeenCalled();
        expect(t.deps.endCall).toHaveBeenCalled();
    });

    it("turns the microphone on when the call starts and off again when it ends, only if the call turned it on", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        expect(t.mic.on).toBe(true);
        t.fake.joined.next({});
        t.connection.end();
        expect(t.mic.on).toBe(false);
    });

    it("leaves a microphone the person had on exactly as it was", async () => {
        const t = setup({ micOn: true });
        await t.connection.begin("b1", "Nora");
        t.fake.joined.next({});
        t.connection.end();
        expect(t.microphone.turnOn).not.toHaveBeenCalled();
        expect(t.microphone.turnOff).not.toHaveBeenCalled();
        expect(t.mic.on).toBe(true);
    });

    it("does not turn the microphone off if the person turned it on themselves meanwhile and it was already on", async () => {
        const t = setup();
        await t.connection.begin("b1", "Nora");
        t.mic.on = false;
        t.connection.end();
        expect(t.microphone.turnOff).not.toHaveBeenCalled();
    });
});
