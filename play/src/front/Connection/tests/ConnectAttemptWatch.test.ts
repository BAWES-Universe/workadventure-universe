import { describe, expect, it, vi } from "vitest";
import type { ConnectAttemptWatchEnv } from "../ConnectAttemptWatch";
import { CONNECT_ATTEMPT_TIMEOUT_MS, RESUME_STALE_ATTEMPT_MS, watchConnectAttempt } from "../ConnectAttemptWatch";

function fakeEnv() {
    let time = 0;
    let timers: { at: number; handler: () => void; id: number }[] = [];
    let nextId = 1;
    const listeners = new Set<() => void>();
    const document = {
        visibilityState: "visible" as DocumentVisibilityState,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const env = {
        now: () => time,
        setTimeout: (handler: () => void, ms: number) => {
            const id = nextId++;
            timers.push({ at: time + ms, handler, id });
            return id;
        },
        clearTimeout: (id: unknown) => {
            timers = timers.filter((timer) => timer.id !== id);
        },
        document,
    };
    return {
        env: env as unknown as ConnectAttemptWatchEnv,
        listeners,
        advance(ms: number) {
            time += ms;
            const due = timers.filter((timer) => timer.at <= time);
            timers = timers.filter((timer) => timer.at > time);
            due.forEach((timer) => timer.handler());
        },
        setVisibility(state: DocumentVisibilityState) {
            document.visibilityState = state;
            [...listeners].forEach((listener) => listener());
        },
    };
}

describe("watchConnectAttempt", () => {
    it("drops an attempt that neither joins nor fails within the time limit", () => {
        const fake = fakeEnv();
        const giveUp = vi.fn();
        watchConnectAttempt(giveUp, fake.env);

        fake.advance(CONNECT_ATTEMPT_TIMEOUT_MS - 1);
        expect(giveUp).not.toHaveBeenCalled();
        fake.advance(1);

        expect(giveUp).toHaveBeenCalledWith("timeout", CONNECT_ATTEMPT_TIMEOUT_MS);
    });

    it("drops a pending attempt at once when the page comes back, if it has waited a while", () => {
        const fake = fakeEnv();
        const giveUp = vi.fn();
        watchConnectAttempt(giveUp, fake.env);

        fake.setVisibility("hidden");
        fake.advance(RESUME_STALE_ATTEMPT_MS);
        fake.setVisibility("visible");

        expect(giveUp).toHaveBeenCalledWith("resume", RESUME_STALE_ATTEMPT_MS);
        // Once only.
        fake.advance(CONNECT_ATTEMPT_TIMEOUT_MS);
        expect(giveUp).toHaveBeenCalledTimes(1);
    });

    it("leaves a fresh attempt alone when the page comes back", () => {
        const fake = fakeEnv();
        const giveUp = vi.fn();
        watchConnectAttempt(giveUp, fake.env);

        fake.advance(1_000);
        fake.setVisibility("visible");

        expect(giveUp).not.toHaveBeenCalled();
    });

    it("stops watching once the attempt joins or fails", () => {
        const fake = fakeEnv();
        const giveUp = vi.fn();
        const settled = watchConnectAttempt(giveUp, fake.env);

        settled();
        fake.advance(CONNECT_ATTEMPT_TIMEOUT_MS * 2);
        fake.setVisibility("visible");

        expect(giveUp).not.toHaveBeenCalled();
        expect(fake.listeners.size).toBe(0);
    });
});
