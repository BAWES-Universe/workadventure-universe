import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { templateSync } from "./templateSync";

describe("parts taken from a template that a Brick's page has not read yet (#2008)", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    const later = <T>() => {
        let resolve: (value: T) => void = () => undefined;
        let reject: (error: unknown) => void = () => undefined;
        const promise = new Promise<T>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        return { promise, resolve, reject };
    };

    it("reads once and shows what was taken", async () => {
        const read = vi.fn(() => Promise.resolve("fresh"));
        const apply = vi.fn();
        const sync = templateSync(read, apply);
        sync.add(["instructions"]);
        expect(sync.waitsFor(["instructions"])).toBe(true);
        expect(await sync.sync()).toBe(true);
        expect(apply).toHaveBeenCalledWith("fresh", ["instructions"]);
        expect(sync.waitsFor(["instructions"])).toBe(false);
        // Nothing waiting: no read
        expect(await sync.sync()).toBe(true);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("shares one read between two looks that overlap, so the older answer never comes back after the newer", async () => {
        const answer = later<string>();
        const read = vi.fn(() => answer.promise);
        const apply = vi.fn();
        const sync = templateSync(read, apply);
        sync.add(["instructions"]);
        const taking = sync.sync();
        const saving = sync.sync();
        answer.resolve("fresh");
        expect(await Promise.all([taking, saving])).toEqual([true, true]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it("keeps parts taken while a read was on its way for another read", async () => {
        const first = later<string>();
        const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("newer");
        const apply = vi.fn();
        const sync = templateSync(read, apply);
        sync.add(["description"]);
        const done = sync.sync();
        sync.add(["instructions"]);
        first.resolve("older");
        expect(await done).toBe(true);
        expect(apply).toHaveBeenNthCalledWith(1, "older", ["description"]);
        expect(apply).toHaveBeenNthCalledWith(2, "newer", ["instructions"]);
        expect(sync.waitsFor(["description", "instructions"])).toBe(false);
    });

    it("keeps a part that is taken again while a read of it is on its way, so the newer text is read too", async () => {
        const first = later<string>();
        const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("newer");
        const apply = vi.fn();
        const sync = templateSync(read, apply);
        sync.add(["instructions"]);
        const done = sync.sync();
        sync.add(["instructions"]);
        expect(sync.waitsFor(["instructions"])).toBe(true);
        first.resolve("older");
        expect(await done).toBe(true);
        expect(read).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenNthCalledWith(2, "newer", ["instructions"]);
        expect(sync.waitsFor(["instructions"])).toBe(false);
    });

    it("says it could not, keeps what is waiting, and succeeds on the next try", async () => {
        const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("fresh");
        const apply = vi.fn();
        const sync = templateSync(read, apply);
        sync.add(["instructions"]);
        expect(await sync.sync()).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(sync.waitsFor(["instructions"])).toBe(true);
        expect(await sync.sync()).toBe(true);
        expect(apply).toHaveBeenCalledWith("fresh", ["instructions"]);
        expect(sync.waitsFor(["instructions"])).toBe(false);
    });

    it("forgets what was waiting when another Brick's page opens", () => {
        const sync = templateSync(() => Promise.resolve("fresh"), vi.fn());
        sync.add(["instructions"]);
        sync.clear();
        expect(sync.waitsFor(["instructions"])).toBe(false);
    });
});
