import { describe, expect, it } from "vitest";
import { isValidEmote, MAX_EMOTE_LENGTH } from "../src/Services/EmoteValidator";

describe("EmoteValidator", () => {
    it.each(["👍", "❤️", "😂", "👏", "😍", "🙏"])("accepts menu emoji %s", (emoji) => {
        expect(isValidEmote(emoji)).toBe(true);
    });

    it.each([
        "👨‍👩‍👧‍👦",
        "👋🏽",
        "👩🏽‍🤝‍👩🏻",
        "🇰🇼",
        "1️⃣",
        "#️⃣",
        "*⃣",
        "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
        "👍❤️",
    ])("accepts composed emoji %s", (emoji) => {
        expect(isValidEmote(emoji)).toBe(true);
    });

    it.each([
        '<img src=x onerror=alert("XSS")>',
        "👍<img src=x onerror=alert(1)>",
        "<script>alert(1)</script>",
        "<b>x</b>",
        "hello",
        "",
        " ",
        "👍\n",
        "1",
        "1👍",
        "#",
        "\u200D",
        "\uFE0F",
        "🏽",
        "🇰",
        "👨‍",
    ])("refuses non-emoji input %j", (emote) => {
        expect(isValidEmote(emote)).toBe(false);
    });

    it("enforces the length limit", () => {
        expect(isValidEmote("👍".repeat(MAX_EMOTE_LENGTH / 2))).toBe(true);
        expect(isValidEmote("👍".repeat(MAX_EMOTE_LENGTH / 2 + 1))).toBe(false);
    });
});
