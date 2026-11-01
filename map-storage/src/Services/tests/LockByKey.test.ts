import { describe, it, vi, expect } from "vitest";
import { LockByKey } from "../LockByKey";

describe("LockByKeys", () => {
    it("should free the lock when promise is rejected", async () => {
        const lock = new LockByKey<string>();

        const key = "myKey";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let reject: ((reason?: any) => void) | undefined;

        const spy = vi.fn();

        const firstPromise = new Promise((_, rej) => {
            reject = rej;
        });

        const secondPromise = () => {
            spy();
            return Promise.resolve();
        };

        lock.waitForLock(key, async () => {
            await firstPromise;
        }).catch(() => {});

        void lock.waitForLock(key, secondPromise);

        if (reject) reject();

        await secondPromise();

        expect(spy).toHaveBeenCalledOnce();
    });

    it("runs callers on the same key one at a time, in order, however many wait", async () => {
        const lock = new LockByKey<string>();
        const events: string[] = [];
        let running = 0;
        let mostAtOnce = 0;
        const job = (name: string) => async () => {
            running++;
            mostAtOnce = Math.max(mostAtOnce, running);
            events.push(`start ${name}`);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
            });
            events.push(`end ${name}`);
            running--;
        };

        await Promise.all(["a", "b", "c", "d"].map((name) => lock.waitForLock("key", job(name))));

        expect(mostAtOnce).toBe(1);
        expect(events).toEqual(["a", "b", "c", "d"].flatMap((name) => [`start ${name}`, `end ${name}`]));
    });

    it("keeps going after a caller in the line fails, and keeps other keys apart", async () => {
        const lock = new LockByKey<string>();
        const ran: string[] = [];
        const failing = lock.waitForLock("key", () => Promise.reject(new Error("boom")));
        const next = lock.waitForLock("key", () => {
            ran.push("next");
            return Promise.resolve();
        });
        const other = lock.waitForLock("other", () => {
            ran.push("other");
            return Promise.resolve();
        });
        await expect(failing).rejects.toThrow("boom");
        await Promise.all([next, other]);
        expect(ran.sort()).toEqual(["next", "other"]);
    });
});
