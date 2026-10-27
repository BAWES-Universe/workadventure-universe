import { describe, expect, it } from "vitest";
import { sayBrief } from "./sayBrief";

const NONE = "Nothing set";

describe("sayBrief", () => {
    it("shows the first line of a multi-line instruction with dots after it and no quotes", () => {
        const brief = sayBrief("You are a friendly guide.\nAlways greet visitors.\nNever share secrets.", NONE);
        expect(brief).toBe("You are a friendly guide.…");
        expect(brief).not.toContain('"');
    });

    it("shows a one-line instruction as it is, with no dots and no quotes", () => {
        expect(sayBrief("You are a friendly guide.", NONE)).toBe("You are a friendly guide.");
    });

    it("does not add dots for blank lines or spaces after the first line", () => {
        expect(sayBrief("You are a friendly guide.\n\n   \n", NONE)).toBe("You are a friendly guide.");
        expect(sayBrief("  You are a friendly guide.  \n \n\t\n", NONE)).toBe("You are a friendly guide.");
    });

    it("adds dots when text follows after blank lines", () => {
        expect(sayBrief("Be kind.\n\n\nAnd brief.", NONE)).toBe("Be kind.…");
    });

    it("returns the none text for an empty or blank instruction", () => {
        expect(sayBrief(undefined, NONE)).toBe(NONE);
        expect(sayBrief("", NONE)).toBe(NONE);
        expect(sayBrief("  \n \t ", NONE)).toBe(NONE);
    });
});
