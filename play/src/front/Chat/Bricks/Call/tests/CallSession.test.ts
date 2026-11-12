import { describe, expect, it } from "vitest";
import {
    botMayHear,
    botMaySpeak,
    callReducer,
    clock,
    isLive,
    micOwner,
    showsOnACall,
    startCall,
    type CallEvent,
    type CallState,
} from "../CallSession";

const T0 = 1_000_000;
const run = (state: CallState, ...events: CallEvent[]) => events.reduce(callReducer, state);
const live = (): CallState => run(startCall(T0), { type: "connected", now: T0 + 1000 });

describe("a call starts and connects", () => {
    it("waits for the bot to be heard before it is on", () => {
        const state = startCall(T0);
        expect(state.phase).toBe("connecting");
        expect(botMayHear(state)).toBe(false);
        expect(live().phase).toBe("on");
    });

    it("shows what the bot is doing: listening, speaking, working, waiting for the person's OK", () => {
        const base = live();
        expect(run(base, { type: "bot-speaking", speaking: true, now: T0 + 2000 }).doing).toBe("speaking");
        const working = run(base, { type: "bot-working", work: "search", line: "Looking it up", now: T0 + 2000 });
        expect(working).toMatchObject({ doing: "working", work: "search", workLine: "Looking it up" });
        expect(run(working, { type: "bot-working", work: undefined, now: T0 + 3000 }).doing).toBe("listening");
        expect(run(base, { type: "bot-waiting", waiting: true, now: T0 + 2000 }).doing).toBe("waiting");
    });

    it("answering the person's OK only leaves waiting: it never cuts short speaking or working", () => {
        const waiting = run(live(), { type: "bot-waiting", waiting: true, now: T0 + 1000 });
        expect(run(waiting, { type: "bot-waiting", waiting: false, now: T0 + 2000 }).doing).toBe("listening");
        const working = run(live(), { type: "bot-working", work: "search", line: "Looking it up", now: T0 + 1000 });
        expect(run(working, { type: "bot-waiting", waiting: false, now: T0 + 2000 })).toMatchObject({
            doing: "working",
            work: "search",
            workLine: "Looking it up",
        });
        const speaking = run(live(), { type: "bot-speaking", speaking: true, now: T0 + 1000 });
        expect(run(speaking, { type: "bot-waiting", waiting: false, now: T0 + 2000 }).doing).toBe("speaking");
    });

    it("the end of speech or of work only leaves its own state, so a quiet stretch never ends a busy call", () => {
        const working = run(live(), { type: "bot-working", work: "search", line: "Looking it up", now: T0 + 1000 });
        expect(run(working, { type: "bot-speaking", speaking: false, now: T0 + 2000 })).toMatchObject({
            doing: "working",
            work: "search",
        });
        const waiting = run(live(), { type: "bot-waiting", waiting: true, now: T0 + 1000 });
        expect(run(waiting, { type: "bot-speaking", speaking: false, now: T0 + 2000 }).doing).toBe("waiting");
        expect(run(waiting, { type: "bot-working", work: undefined, now: T0 + 2000 }).doing).toBe("waiting");
        const speaking = run(live(), { type: "bot-speaking", speaking: true, now: T0 + 1000 });
        expect(run(speaking, { type: "bot-working", work: undefined, now: T0 + 2000 }).doing).toBe("speaking");
        const ticked = run(
            working,
            { type: "bot-speaking", speaking: false, now: T0 + 2000 },
            { type: "tick", now: T0 + 900_000, quietMs: 60_000 }
        );
        expect(ticked.phase).toBe("on");
    });

    it("ignores the bot's doings before it is on, and after the call is over", () => {
        const connecting = startCall(T0);
        expect(run(connecting, { type: "bot-speaking", speaking: true, now: T0 })).toBe(connecting);
        const over = run(live(), { type: "end", by: "you" });
        expect(run(over, { type: "bot-speaking", speaking: true, now: T0 })).toBe(over);
        expect(isLive(over)).toBe(false);
    });
});

describe("someone walks up (check 64)", () => {
    it("shows one card and interrupts nobody: the call stays on and the bot still hears the person", () => {
        const state = run(live(), { type: "someone-here", id: "u1", name: "Sara" });
        expect(state.walkUp).toEqual({ id: "u1", name: "Sara" });
        expect(state.phase).toBe("on");
        expect(botMayHear(state)).toBe(true);
    });

    it("shows one card at a time, and none while the call is still connecting", () => {
        const first = run(live(), { type: "someone-here", id: "u1", name: "Sara" });
        expect(run(first, { type: "someone-here", id: "u2", name: "Omar" }).walkUp?.name).toBe("Sara");
        expect(run(startCall(T0), { type: "someone-here", id: "u1", name: "Sara" }).walkUp).toBeUndefined();
    });

    it("shows no card while the call is on hold, so a meeting or person hold is never overwritten", () => {
        const inMeeting = run(live(), { type: "meeting-joined" });
        const after = run(inMeeting, { type: "someone-here", id: "u1", name: "Sara" }, { type: "hold-and-talk" });
        expect(after.walkUp).toBeUndefined();
        expect(after.hold).toEqual({ kind: "meeting" });
        const withPerson = run(live(), { type: "someone-here", id: "u1", name: "Sara" }, { type: "hold-and-talk" });
        expect(run(withPerson, { type: "someone-here", id: "u2", name: "Omar" }).walkUp).toBeUndefined();
    });

    it("Not now keeps the call exactly as it was", () => {
        const before = live();
        const after = run(before, { type: "someone-here", id: "u1", name: "Sara" }, { type: "not-now" });
        expect(after).toEqual(before);
    });

    it("Hold call and talk holds first: the bot stops hearing and speaking, the microphone goes to the people", () => {
        const state = run(live(), { type: "someone-here", id: "u1", name: "Sara" }, { type: "hold-and-talk" });
        expect(state.phase).toBe("hold");
        expect(state.hold).toEqual({ kind: "person", name: "Sara" });
        expect(state.walkUp).toBeUndefined();
        expect(botMayHear(state)).toBe(false);
        expect(botMaySpeak(state)).toBe(false);
        expect(micOwner(state)).toBe("people");
    });

    it("Hold call and talk with no card showing does nothing", () => {
        const before = live();
        expect(run(before, { type: "hold-and-talk" })).toBe(before);
    });

    it("the microphone is never the bot's and the people's at once, in any phase", () => {
        const states: CallState[] = [
            startCall(T0),
            live(),
            run(live(), { type: "meeting-joined" }),
            run(live(), { type: "end", by: "you" }),
        ];
        expect(states.map(micOwner)).toEqual(["none", "bot", "people", "none"]);
    });
});

describe("hold and resume (check 64)", () => {
    it("only Resume call brings the call back: time, quiet and the other person leaving do not", () => {
        const held = run(live(), { type: "meeting-joined" });
        expect(held.hold).toEqual({ kind: "meeting" });
        const later = run(
            held,
            { type: "tick", now: T0 + 3_600_000, quietMs: 60_000 },
            { type: "heard", now: T0 + 3_600_001 }
        );
        expect(later.phase).toBe("hold");
        expect(botMayHear(later)).toBe(false);
        const back = run(later, { type: "resume", now: T0 + 3_700_000 });
        expect(back.phase).toBe("on");
        expect(back.hold).toBeUndefined();
        expect(botMayHear(back)).toBe(true);
    });

    it("a meeting joined while the call is still connecting puts it on hold the moment it connects", () => {
        const connecting = run(startCall(T0), { type: "meeting-joined" });
        expect(connecting.phase).toBe("connecting");
        expect(botMayHear(connecting)).toBe(false);
        const connected = run(connecting, { type: "connected", now: T0 + 1000 });
        expect(connected.phase).toBe("hold");
        expect(connected.hold).toEqual({ kind: "meeting" });
        expect(connected.meetingWhileConnecting).toBeUndefined();
        expect(botMayHear(connected)).toBe(false);
        expect(botMaySpeak(connected)).toBe(false);
        expect(run(connected, { type: "resume", now: T0 + 2000 }).phase).toBe("on");
    });

    it("resume does nothing when the call is not on hold", () => {
        const on = live();
        expect(run(on, { type: "resume", now: T0 + 5 })).toBe(on);
    });

    it("a meeting puts the call on hold and clears the card", () => {
        const state = run(live(), { type: "someone-here", id: "u1", name: "Sara" }, { type: "meeting-joined" });
        expect(state).toMatchObject({ phase: "hold", walkUp: undefined });
    });

    it("keeps counting the time while on hold", () => {
        const held = run(live(), { type: "meeting-joined" });
        expect(held.startedAt).toBe(T0);
    });
});

describe("a quiet stretch (check 65)", () => {
    it("ends a call that is on, once the stretch set in Limits has passed", () => {
        const on = live();
        expect(run(on, { type: "tick", now: T0 + 1000 + 59_999, quietMs: 60_000 }).phase).toBe("on");
        const ended = run(on, { type: "tick", now: T0 + 1000 + 60_000, quietMs: 60_000 });
        expect(ended).toMatchObject({ phase: "ended", endedBy: "quiet" });
    });

    it("anything said or done in the call starts the stretch again", () => {
        const on = run(live(), { type: "heard", now: T0 + 50_000 });
        expect(run(on, { type: "tick", now: T0 + 100_000, quietMs: 60_000 }).phase).toBe("on");
    });

    it("is not quiet while the bot speaks, works or waits for the person's OK, however long that takes", () => {
        const doings: Array<[CallEvent, CallEvent]> = [
            [
                { type: "bot-speaking", speaking: true, now: T0 + 1000 },
                { type: "bot-speaking", speaking: false, now: T0 + 5_000_000 },
            ],
            [
                { type: "bot-working", work: "search", line: "Looking it up", now: T0 + 1000 },
                { type: "bot-working", work: undefined, now: T0 + 5_000_000 },
            ],
            [
                { type: "bot-waiting", waiting: true, now: T0 + 1000 },
                { type: "bot-waiting", waiting: false, now: T0 + 5_000_000 },
            ],
        ];
        for (const [doing, finish] of doings) {
            const busy = run(live(), doing);
            expect(run(busy, { type: "tick", now: T0 + 9e9, quietMs: 60_000 }).phase).toBe("on");
            // Once it is done and nothing is said, the stretch starts from the moment it finished
            const done = run(busy, finish);
            expect(run(done, { type: "tick", now: T0 + 5_059_999, quietMs: 60_000 }).phase).toBe("on");
            expect(run(done, { type: "tick", now: T0 + 5_060_000, quietMs: 60_000 }).endedBy).toBe("quiet");
        }
    });

    it("never ends a call on hold, and never counts when no stretch is set", () => {
        const held = run(live(), { type: "meeting-joined" });
        expect(run(held, { type: "tick", now: T0 + 9e9, quietMs: 60_000 }).phase).toBe("hold");
        expect(run(live(), { type: "tick", now: T0 + 9e9, quietMs: 0 }).phase).toBe("on");
    });
});

describe("ending, and the passing label", () => {
    it("shows On a call to others while the call lasts, on hold too, and not after it ends", () => {
        const on = live();
        expect(showsOnACall(on)).toBe(true);
        expect(showsOnACall(run(on, { type: "meeting-joined" }))).toBe(true);
        expect(showsOnACall(run(on, { type: "end", by: "you" }))).toBe(false);
    });

    it("keeps how it ended and drops any card or hold", () => {
        const ended = run(live(), { type: "someone-here", id: "u1", name: "Sara" }, { type: "end", by: "unavailable" });
        expect(ended).toMatchObject({ phase: "ended", endedBy: "unavailable", walkUp: undefined, hold: undefined });
    });

    it("an ended call stays ended", () => {
        const ended = run(live(), { type: "end", by: "you" });
        expect(run(ended, { type: "resume", now: T0 })).toBe(ended);
        expect(run(ended, { type: "connected", now: T0 })).toBe(ended);
    });
});

describe("the time shown", () => {
    it("reads minutes and seconds, and hours past one", () => {
        expect(clock(0)).toBe("0:00");
        expect(clock(31_000)).toBe("0:31");
        expect(clock(372_000)).toBe("6:12");
        expect(clock(3_723_000)).toBe("1:02:03");
        expect(clock(-5)).toBe("0:00");
    });
});
