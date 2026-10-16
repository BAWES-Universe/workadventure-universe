import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenewedTokenMemo } from "../../src/pusher/services/RenewedTokenMemo";

describe("RenewedTokenMemo", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("hands out the remembered answer to a repeat of the same token, with one renewal", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockResolvedValue("renewed");
        expect(await memo.renew("old", "u", renew)).toBe("renewed");
        expect(await memo.renew("old", "u", renew)).toBe("renewed");
        expect(renew).toHaveBeenCalledTimes(1);
    });

    it("keeps renewals of different tokens apart", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockResolvedValueOnce("for a").mockResolvedValueOnce("for b");
        expect(await memo.renew("a", "u", renew)).toBe("for a");
        expect(await memo.renew("b", "u", renew)).toBe("for b");
        expect(renew).toHaveBeenCalledTimes(2);
    });

    it("shares one renewal between calls that overlap", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        let finish: (value: string) => void = () => {};
        const renew = vi.fn().mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                })
        );
        const first = memo.renew("old", "u", renew);
        const second = memo.renew("old", "u", renew);
        finish("renewed");
        expect(await first).toBe("renewed");
        expect(await second).toBe("renewed");
        expect(renew).toHaveBeenCalledTimes(1);
    });

    it("renews again once the answer is older than the time limit", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
        expect(await memo.renew("old", "u", renew)).toBe("first");
        vi.setSystemTime(Date.now() + 59_000);
        expect(await memo.renew("old", "u", renew)).toBe("first");
        vi.setSystemTime(Date.now() + 2_000);
        expect(await memo.renew("old", "u", renew)).toBe("second");
        expect(renew).toHaveBeenCalledTimes(2);
    });

    it("does not remember a renewal that failed (null)", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("renewed");
        expect(await memo.renew("old", "u", renew)).toBeNull();
        expect(await memo.renew("old", "u", renew)).toBe("renewed");
        expect(renew).toHaveBeenCalledTimes(2);
    });

    it("does not remember a renewal that threw", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("renewed");
        await expect(memo.renew("old", "u", renew)).rejects.toThrow("boom");
        expect(await memo.renew("old", "u", renew)).toBe("renewed");
    });

    it("forgets a player's answers, and keeps one still running from being remembered", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 10);
        const renew = vi.fn().mockResolvedValue("renewed");
        await memo.renew("old", "u", renew);
        await memo.renew("other", "someone-else", renew);
        let finish: (value: string) => void = () => {};
        const running = memo.renew(
            "running",
            "u",
            () =>
                new Promise<string>((resolve) => {
                    finish = resolve;
                })
        );

        memo.forgetPlayer("u");
        finish("renewed while signing out");
        expect(await running).toBe("renewed while signing out");

        renew.mockClear();
        await memo.renew("old", "u", renew);
        await memo.renew("running", "u", renew);
        expect(renew).toHaveBeenCalledTimes(2);
        // Another player's answer is untouched.
        await memo.renew("other", "someone-else", renew);
        expect(renew).toHaveBeenCalledTimes(2);
    });

    it("never holds more than its limit, dropping the oldest first", async () => {
        const memo = new RenewedTokenMemo<string>(60_000, 2);
        const renew = vi.fn().mockImplementation(() => Promise.resolve("renewed"));
        await memo.renew("a", "u", renew);
        await memo.renew("b", "u", renew);
        await memo.renew("c", "u", renew);
        expect(renew).toHaveBeenCalledTimes(3);
        await memo.renew("b", "u", renew);
        await memo.renew("c", "u", renew);
        expect(renew).toHaveBeenCalledTimes(3);
        await memo.renew("a", "u", renew);
        expect(renew).toHaveBeenCalledTimes(4);
    });
});
