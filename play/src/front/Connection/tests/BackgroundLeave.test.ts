import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackgroundLeaveClock } from "../BackgroundLeave";
import { BACKGROUND_LEAVE_AFTER_MS, BackgroundLeave, markLeftInBackground, waitToComeBack } from "../BackgroundLeave";

/** A clock whose timer only fires when the test says so. */
function fakeClock() {
    let timer: { handler: () => void } | undefined;
    const clock: BackgroundLeaveClock = {
        setTimeout: (handler) => {
            timer = { handler };
            return timer;
        },
        clearTimeout: (handle) => {
            if (handle === timer) timer = undefined;
        },
    };
    return {
        clock,
        fire() {
            const due = timer;
            timer = undefined;
            due?.handler();
        },
        get armed() {
            return timer !== undefined;
        },
    };
}

function setUp(hidden = true) {
    const time = fakeClock();
    const page = { hidden };
    const leave = vi.fn();
    const watch = new BackgroundLeave({ leave, isHidden: () => page.hidden, clock: time.clock });
    return { time, page, leave, watch };
}

describe("BackgroundLeave", () => {
    it("waits five minutes by default", () => {
        expect(BACKGROUND_LEAVE_AFTER_MS).toBe(5 * 60_000);
    });

    it("leaves once the person has been away and alone in the background for the whole time", () => {
        const { time, leave, watch } = setUp();
        watch.update(true);
        expect(leave).not.toHaveBeenCalled();
        time.fire();
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it("does not start the time while the person is here, in a call or on screen", () => {
        const { time, watch } = setUp();
        watch.update(false);
        expect(time.armed).toBe(false);
    });

    it("stops the time when someone comes near or the page comes back, and starts it again from zero", () => {
        const { time, leave, watch } = setUp();
        watch.update(true);
        watch.update(false);
        expect(time.armed).toBe(false);
        watch.update(true);
        expect(time.armed).toBe(true);
        time.fire();
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it("keeps the time running when the same state is reported again", () => {
        const { time, watch } = setUp();
        const setTimeout = vi.spyOn(time.clock, "setTimeout");
        watch.update(true);
        watch.update(true);
        expect(setTimeout).toHaveBeenCalledTimes(1);
    });

    it("stays when a timer held up while the page slept fires as the page comes back", () => {
        const { time, page, leave, watch } = setUp();
        watch.update(true);
        page.hidden = false;
        time.fire();
        expect(leave).not.toHaveBeenCalled();
        // The next time the person is away and alone, the time runs again.
        page.hidden = true;
        watch.update(true);
        time.fire();
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it("leaves only once", () => {
        const { time, leave, watch } = setUp();
        watch.update(true);
        time.fire();
        watch.update(false);
        watch.update(true);
        time.fire();
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it("does nothing once stopped", () => {
        const { time, leave, watch } = setUp();
        watch.update(true);
        watch.stop();
        expect(time.armed).toBe(false);
        watch.update(true);
        time.fire();
        expect(leave).not.toHaveBeenCalled();
    });
});

describe("waitToComeBack", () => {
    function fakeDocument(visibilityState: DocumentVisibilityState) {
        const listeners = new Set<() => void>();
        const doc = {
            visibilityState,
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
            show() {
                doc.visibilityState = "visible";
                listeners.forEach((listener) => listener());
            },
            get listening() {
                return listeners.size;
            },
        };
        return doc;
    }
    const asDocument = (doc: ReturnType<typeof fakeDocument>) =>
        doc as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

    afterEach(async () => {
        // Leave no mark behind for the next test.
        await waitToComeBack(asDocument(fakeDocument("visible")));
    });

    it("lets the connection start at once when the room was not left in the background", async () => {
        const doc = fakeDocument("hidden");
        await expect(waitToComeBack(asDocument(doc))).resolves.toBeUndefined();
        expect(doc.listening).toBe(0);
    });

    it("holds the connection until the page is on screen again, then only once", async () => {
        markLeftInBackground();
        const doc = fakeDocument("hidden");
        let started = false;
        const waiting = waitToComeBack(asDocument(doc)).then(() => (started = true));
        await Promise.resolve();
        expect(started).toBe(false);

        doc.show();
        await waiting;
        expect(started).toBe(true);
        expect(doc.listening).toBe(0);

        // The mark is used up: the connection after that starts at once.
        const later = fakeDocument("hidden");
        await waitToComeBack(asDocument(later));
        expect(later.listening).toBe(0);
    });

    it("starts at once when the page is already back on screen", async () => {
        markLeftInBackground();
        const doc = fakeDocument("visible");
        await waitToComeBack(asDocument(doc));
        expect(doc.listening).toBe(0);
    });
});
