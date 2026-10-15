import { describe, expect, it } from "vitest";
import { isChatSearchOpen } from "../ChatSearchOpen";

describe("isChatSearchOpen", () => {
    it("is closed by default: the footer shows Invite, search and +", () => {
        expect(isChatSearchOpen({ opened: false, value: "", focusRequested: false })).toBe(false);
    });

    it("is open once the search button opened it, with or without text", () => {
        expect(isChatSearchOpen({ opened: true, value: "", focusRequested: false })).toBe(true);
        expect(isChatSearchOpen({ opened: true, value: "bob", focusRequested: false })).toBe(true);
    });

    it("opens by itself when something filled the text in (Find people after a proximity chat)", () => {
        expect(isChatSearchOpen({ opened: false, value: "Bob", focusRequested: false })).toBe(true);
    });

    it("opens by itself when something asked for the focus (New message)", () => {
        expect(isChatSearchOpen({ opened: false, value: "", focusRequested: true })).toBe(true);
    });

    it("counts a text of spaces as text: it filters nothing but must not hide the field the person is typing in", () => {
        expect(isChatSearchOpen({ opened: false, value: " ", focusRequested: false })).toBe(true);
    });
});
