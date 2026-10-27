import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BotDmIntro from "./BotDmIntro.svelte";

describe("the start of a direct message with a bot (Orbit #491)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    it("tells the person the bot's owner sees that they chat, never what they say", () => {
        const target = document.createElement("ul");
        const intro = new BotDmIntro({ target, props: { name: "Nora" } });
        expect(target.textContent?.replace(/\s+/g, " ").trim()).toBe(
            "Nora Nora's owner can see that you chat with Nora, never what you say."
        );
        intro.$destroy();
    });
});
