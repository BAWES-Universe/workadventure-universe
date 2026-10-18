import { describe, expect, it } from "vitest";
import { chatTime } from "../MessageTime";

describe("chatTime", () => {
    it("shows a 12-hour time with AM or PM and no leading zero", () => {
        expect(chatTime(new Date(2026, 9, 17, 21, 5), "en-US")).toBe("9:05 PM");
        expect(chatTime(new Date(2026, 9, 17, 9, 5), "en-US")).toBe("9:05 AM");
    });
});
