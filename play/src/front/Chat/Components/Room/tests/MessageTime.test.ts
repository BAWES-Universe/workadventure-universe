import { describe, expect, it } from "vitest";
import { chatTime } from "../MessageTime";

describe("chatTime", () => {
    // Some ICU builds put a narrow no-break space (U+202F) before AM/PM instead of a plain space.
    const plainSpaces = (text: string) => text.replace(/\u202F/g, " ");

    it("shows a 12-hour time with AM or PM and no leading zero", () => {
        expect(plainSpaces(chatTime(new Date(2026, 9, 17, 21, 5), "en-US"))).toBe("9:05 PM");
        expect(plainSpaces(chatTime(new Date(2026, 9, 17, 9, 5), "en-US"))).toBe("9:05 AM");
    });
});
