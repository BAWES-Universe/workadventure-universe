import { describe, expect, it, vi } from "vitest";
import { CardAnswers } from "../cardAnswers";

describe("card answers", () => {
    it("asks once per person and gives the kept answer the next time", async () => {
        const ask = vi.fn().mockResolvedValue("yes");
        const answers = new CardAnswers<string>(ask);
        expect(await answers.get("sara")).toBe("yes");
        expect(await answers.get("sara")).toBe("yes");
        expect(ask).toHaveBeenCalledTimes(1);
        await answers.get("omar");
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
        const answers = new CardAnswers<string>(ask);
        await answers.get("sara");
        answers.forget("sara");
        await answers.get("sara");
        expect(ask).toHaveBeenCalledTimes(2);
    });
});
