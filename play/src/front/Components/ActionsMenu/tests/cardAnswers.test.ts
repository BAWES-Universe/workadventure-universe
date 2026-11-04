import { describe, expect, it, vi } from "vitest";
import { CARD_ANSWER_KEPT_MS, CardAnswers } from "../cardAnswers";

describe("card answers", () => {
    it("keeps an answer for under half a minute only, so a change in Orbit shows the next time a card opens", () => {
        expect(CARD_ANSWER_KEPT_MS).toBeGreaterThan(0);
        expect(CARD_ANSWER_KEPT_MS).toBeLessThan(30 * 1000);
    });

    it("asks once per person while the answer is fresh", async () => {
        let now = 0;
        const ask = vi.fn().mockResolvedValue("yes");
        const answers = new CardAnswers<string>(ask, undefined, () => now);
        expect(await answers.get("sara")).toBe("yes");
        now = CARD_ANSWER_KEPT_MS - 1;
        expect(await answers.get("sara")).toBe("yes");
        expect(ask).toHaveBeenCalledTimes(1);
        await answers.get("omar");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("shows what changed in Orbit the next time a card opens after the answer has gone stale", async () => {
        let now = 0;
        const ask = vi.fn().mockResolvedValueOnce("yes").mockResolvedValueOnce("no");
        const answers = new CardAnswers<string>(ask, undefined, () => now);
        expect(await answers.get("sara")).toBe("yes");
        now = CARD_ANSWER_KEPT_MS;
        expect(await answers.get("sara")).toBe("no");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("does not keep an answer that is worth keeping for no time", async () => {
        const ask = vi.fn().mockResolvedValue(null);
        const answers = new CardAnswers<null>(ask, () => 0);
        await answers.get("sara");
        await answers.get("sara");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("lets a second look share the question still on its way", async () => {
        let answer: (value: string) => void = () => undefined;
        const ask = vi.fn().mockReturnValue(
            new Promise<string>((resolve) => {
                answer = resolve;
            })
        );
        const answers = new CardAnswers<string>(ask);
        const first = answers.get("sara");
        const second = answers.get("sara");
        answer("yes");
        expect(await first).toBe("yes");
        expect(await second).toBe("yes");
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it("does not keep a question that failed", async () => {
        const ask = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("yes");
        const answers = new CardAnswers<string>(ask);
        await expect(answers.get("sara")).rejects.toThrow("down");
        expect(await answers.get("sara")).toBe("yes");
    });

    it("asks again once an answer has been kept as long as it is worth", async () => {
        let now = 0;
        const ask = vi.fn().mockResolvedValue(null);
        const answers = new CardAnswers<null>(
            ask,
            () => 1000,
            () => now
        );
        await answers.get("sara");
        now = 999;
        await answers.get("sara");
        expect(ask).toHaveBeenCalledTimes(1);
        now = 1000;
        await answers.get("sara");
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it("forgets an answer on request", async () => {
        const ask = vi.fn().mockResolvedValue("yes");
        const answers = new CardAnswers<string>(ask, undefined, () => 0);
        await answers.get("sara");
        answers.forget("sara");
        await answers.get("sara");
        expect(ask).toHaveBeenCalledTimes(2);
    });
});
