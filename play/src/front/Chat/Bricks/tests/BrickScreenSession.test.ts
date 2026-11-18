import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createScreenSession,
    documentVisibility,
    SCREEN_RETRIES,
    SCREEN_RETRY_MS,
    SCREEN_SLOW_RETRY_MS,
    type ScreenMode,
    type ScreenSessionDeps,
} from "../Computer/BrickScreenSession";
import type { RfbConnection, RfbConstructor } from "../Computer/novnc";

class FakeRfb implements RfbConnection {
    static all: FakeRfb[] = [];
    viewOnly = false;
    scaleViewport = false;
    resizeSession = true;
    focusOnClick = false;
    background = "";
    disconnected = false;
    listeners: Record<string, Array<(event: Event) => void>> = {};
    constructor(public target: HTMLElement, public url: string, public options?: { wsProtocols?: string[] }) {
        FakeRfb.all.push(this);
    }
    addEventListener(type: string, listener: (event: Event) => void) {
        (this.listeners[type] ??= []).push(listener);
    }
    removeEventListener(type: string, listener: (event: Event) => void) {
        this.listeners[type] = (this.listeners[type] ?? []).filter((one) => one !== listener);
    }
    disconnect() {
        this.disconnected = true;
    }
    fire(type: string) {
        for (const listener of this.listeners[type] ?? []) listener(new Event(type));
    }
}

const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe("a Brick's screen connection", () => {
    let timers: Array<{ fn: () => void; ms: number; live: boolean }>;
    let live: boolean[];
    let deps: ScreenSessionDeps & { ticket: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> };
    const target = document.createElement("div");
    const asked = () => deps.ticket.mock.calls.map((call) => call[0] as ScreenMode);
    const runTimer = async () => {
        const next = timers.find((timer) => timer.live);
        if (!next) throw new Error("no timer");
        next.live = false;
        next.fn();
        await flush();
    };

    beforeEach(() => {
        FakeRfb.all = [];
        timers = [];
        live = [];
        deps = {
            ticket: vi.fn(() => Promise.resolve({ ticket: "t-1" })),
            socketUrl: (ticket: string) => `wss://bots.test/computer/screen?ticket=${ticket}`,
            load: vi.fn(() => Promise.resolve(FakeRfb as unknown as RfbConstructor)),
            setTimer: (fn, ms) => {
                const timer = { fn, ms, live: true };
                timers.push(timer);
                return timer;
            },
            clearTimer: (handle) => {
                (handle as { live: boolean }).live = false;
            },
        };
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it("watches by default: view only, scaled to fit, and the picture is only shown once it is connected", async () => {
        const session = createScreenSession(deps, target, (value) => live.push(value));
        session.want("watch");
        await flush();
        expect(asked()).toEqual(["watch"]);
        const [screen] = FakeRfb.all;
        expect(screen.url).toBe("wss://bots.test/computer/screen?ticket=t-1");
        expect(screen.options?.wsProtocols).toEqual(["binary"]);
        expect(screen).toMatchObject({
            viewOnly: true,
            scaleViewport: true,
            resizeSession: false,
            focusOnClick: false,
        });
        expect(live.at(-1)).toBe(false);
        screen.fire("connect");
        expect(live.at(-1)).toBe(true);
    });

    it("takes the mouse and keyboard only for the person who took over, with a new connection and an input ticket", async () => {
        const session = createScreenSession(deps, target, (value) => live.push(value));
        session.want("watch");
        await flush();
        session.want("input");
        await flush();
        expect(asked()).toEqual(["watch", "input"]);
        expect(FakeRfb.all[0].disconnected).toBe(true);
        expect(FakeRfb.all[1]).toMatchObject({ viewOnly: false, focusOnClick: true });
        // After the hand back it watches again, on a new connection
        session.want("watch");
        await flush();
        expect(FakeRfb.all[1].disconnected).toBe(true);
        expect(FakeRfb.all[2].viewOnly).toBe(true);
    });

    it("asking for what it already wants changes nothing", async () => {
        const session = createScreenSession(deps, target, () => undefined);
        session.want("watch");
        await flush();
        session.want("watch");
        await flush();
        expect(deps.ticket).toHaveBeenCalledTimes(1);
        expect(FakeRfb.all).toHaveLength(1);
    });

    it("asks again with a new ticket when the connection ends (the server closes it when the state changes), and keeps nothing from the old one", async () => {
        const session = createScreenSession(deps, target, (value) => live.push(value));
        session.want("watch");
        await flush();
        FakeRfb.all[0].fire("connect");
        deps.ticket.mockResolvedValueOnce({ ticket: "t-2" });
        FakeRfb.all[0].fire("disconnect");
        expect(live.at(-1)).toBe(false);
        expect(timers[0].ms).toBe(SCREEN_RETRY_MS);
        await runTimer();
        expect(FakeRfb.all[1].url).toContain("t-2");
    });

    it("leaves nothing to show when there is nothing to watch, and asks no ticket", async () => {
        const session = createScreenSession(deps, target, () => undefined);
        session.want("");
        await flush();
        expect(deps.ticket).not.toHaveBeenCalled();
        session.want("watch");
        await flush();
        session.want("");
        await flush();
        expect(FakeRfb.all[0].disconnected).toBe(true);
        expect(timers.filter((timer) => timer.live)).toHaveLength(0);
    });

    it("tries again when asking for a ticket does not go through, with a doubling wait, then slowly for as long as the screen is wanted", async () => {
        deps.ticket.mockResolvedValue("failed");
        const session = createScreenSession(deps, target, () => undefined);
        session.want("watch");
        await flush();
        const quick = Array.from({ length: SCREEN_RETRIES }, (_, i) => i);
        await quick.reduce(async (before, i) => {
            await before;
            expect(timers.at(-1)?.ms).toBe(SCREEN_RETRY_MS * 2 ** i);
            await runTimer();
        }, Promise.resolve());
        expect(deps.ticket).toHaveBeenCalledTimes(SCREEN_RETRIES + 1);
        // Not left stuck: a slow try is waiting, and when the ticket comes the screen opens without anyone touching the page
        expect(timers.at(-1)?.ms).toBe(SCREEN_SLOW_RETRY_MS);
        expect(timers.filter((timer) => timer.live)).toHaveLength(1);
        deps.ticket.mockResolvedValue({ ticket: "t-9" });
        await runTimer();
        expect(FakeRfb.all.at(-1)?.url).toContain("t-9");
    });

    it("treats no ticket (a resting computer, or input before the take over) like a try that did not work, so it is asked again soon", async () => {
        deps.ticket.mockResolvedValueOnce(undefined);
        const session = createScreenSession(deps, target, () => undefined);
        session.want("input");
        await flush();
        expect(FakeRfb.all).toHaveLength(0);
        await runTimer();
        expect(FakeRfb.all).toHaveLength(1);
    });

    it("drops a ticket that comes after the wish changed, and a connection that ends after it was let go", async () => {
        let resolve: (value: { ticket: string }) => void = () => undefined;
        deps.ticket.mockReturnValueOnce(
            new Promise((done) => {
                resolve = done;
            })
        );
        const session = createScreenSession(deps, target, () => undefined);
        session.want("watch");
        await flush();
        session.want("");
        resolve({ ticket: "late" });
        await flush();
        expect(FakeRfb.all).toHaveLength(0);
        session.want("watch");
        await flush();
        const [screen] = FakeRfb.all;
        session.destroy();
        screen.fire("disconnect");
        expect(timers.filter((timer) => timer.live)).toHaveLength(0);
        expect(screen.disconnected).toBe(true);
    });

    it("does not give up on a viewer that did not load: it tries again", async () => {
        deps.load.mockRejectedValueOnce(new Error("offline"));
        const session = createScreenSession(deps, target, () => undefined);
        session.want("watch");
        await flush();
        expect(FakeRfb.all).toHaveLength(0);
        await runTimer();
        expect(FakeRfb.all).toHaveLength(1);
    });

    describe("when the page is hidden", () => {
        /** A page whose visibility a test turns, and the listeners told. */
        function page(hidden = false) {
            const listeners: Array<() => void> = [];
            const state = {
                hidden,
                listeners,
                set(value: boolean) {
                    state.hidden = value;
                    for (const listener of [...listeners]) listener();
                },
                visibility: {
                    hidden: () => state.hidden,
                    onChange(listener: () => void) {
                        listeners.push(listener);
                        return () => {
                            listeners.splice(listeners.indexOf(listener), 1);
                        };
                    },
                },
            };
            return state;
        }

        it("closes the connection the moment the tab is hidden, and opens a new one with a new ticket when it is shown again", async () => {
            const tab = page();
            deps.visibility = tab.visibility;
            const session = createScreenSession(deps, target, (value) => live.push(value));
            session.want("watch");
            await flush();
            FakeRfb.all[0].fire("connect");
            tab.set(true);
            expect(FakeRfb.all[0].disconnected).toBe(true);
            expect(live.at(-1)).toBe(false);
            // Nothing is asked or retried while it is hidden, however long
            deps.ticket.mockResolvedValueOnce({ ticket: "t-2" });
            expect(timers.filter((timer) => timer.live)).toHaveLength(0);
            expect(asked()).toEqual(["watch"]);
            tab.set(false);
            await flush();
            expect(asked()).toEqual(["watch", "watch"]);
            expect(FakeRfb.all[1].url).toContain("t-2");
        });

        it("opens nothing for a page that starts hidden, and shows the screen when it is first seen", async () => {
            const tab = page(true);
            deps.visibility = tab.visibility;
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            await flush();
            expect(asked()).toEqual([]);
            expect(FakeRfb.all).toHaveLength(0);
            tab.set(false);
            await flush();
            expect(asked()).toEqual(["watch"]);
        });

        it("drops a connection that was still being made when the tab was hidden", async () => {
            const tab = page();
            deps.visibility = tab.visibility;
            let resolve: (value: { ticket: string }) => void = () => undefined;
            deps.ticket.mockImplementationOnce(
                () =>
                    new Promise((done) => {
                        resolve = done;
                    })
            );
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            await flush();
            tab.set(true);
            resolve({ ticket: "late" });
            await flush();
            expect(FakeRfb.all).toHaveLength(0);
        });

        it("ignores an old ticket that arrives after the page was shown again and connected with a fresh one", async () => {
            const tab = page();
            deps.visibility = tab.visibility;
            let resolve: (value: { ticket: string }) => void = () => undefined;
            deps.ticket.mockImplementationOnce(
                () =>
                    new Promise((done) => {
                        resolve = done;
                    })
            );
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            await flush();
            tab.set(true);
            tab.set(false);
            await flush();
            expect(FakeRfb.all).toHaveLength(1);
            const fresh = FakeRfb.all[0];
            resolve({ ticket: "stale" });
            await flush();
            // No second connection opened for the old ticket, and the fresh one is still the one that is up
            expect(FakeRfb.all).toHaveLength(1);
            expect(fresh.url).not.toContain("stale");
            expect(fresh.disconnected).not.toBe(true);
        });

        it("stops a retry that was waiting when the tab was hidden", async () => {
            const tab = page();
            deps.visibility = tab.visibility;
            deps.ticket.mockResolvedValueOnce("failed");
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            await flush();
            expect(timers.filter((timer) => timer.live)).toHaveLength(1);
            tab.set(true);
            expect(timers.filter((timer) => timer.live)).toHaveLength(0);
        });

        it("keeps what it is wanted to show while hidden, so a change of who has the keyboard shows when the tab is seen", async () => {
            const tab = page(true);
            deps.visibility = tab.visibility;
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            session.want("input");
            await flush();
            expect(asked()).toEqual([]);
            tab.set(false);
            await flush();
            expect(asked()).toEqual(["input"]);
            expect(FakeRfb.all[0].viewOnly).toBe(false);
        });

        it("stops listening for the tab when the screen is gone", async () => {
            const tab = page();
            deps.visibility = tab.visibility;
            const session = createScreenSession(deps, target, () => undefined);
            session.want("watch");
            await flush();
            expect(tab.listeners).toHaveLength(1);
            session.destroy();
            expect(tab.listeners).toHaveLength(0);
            tab.set(false);
            await flush();
            expect(asked()).toEqual(["watch"]);
        });

        it("reads the page's own visibility: hidden is a tab out of sight, and listening ends when told", () => {
            const seen: string[] = [];
            const spy = vi.spyOn(document, "visibilityState", "get");
            spy.mockReturnValue("visible");
            const watching = documentVisibility(document);
            expect(watching.hidden()).toBe(false);
            const stop = watching.onChange(() => seen.push(String(watching.hidden())));
            spy.mockReturnValue("hidden");
            document.dispatchEvent(new Event("visibilitychange"));
            expect(watching.hidden()).toBe(true);
            stop();
            document.dispatchEvent(new Event("visibilitychange"));
            expect(seen).toEqual(["true"]);
        });
    });
});
