import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { i18nObject } from "../../../../i18n/i18n-util";

// "6 people · 21 bots" (#1389): each count says person or people, bot or bots, by its own number.
describe("people and bots counts", () => {
    beforeAll(() => {
        loadLocale("en-US");
        loadLocale("fr-FR");
        loadLocale("ar-SA");
    });

    it("says person and bot for one, people and bots for more", () => {
        const LL = i18nObject("en-US");
        expect(LL.chat.peopleTab.countPeople({ count: 1 })).toBe("1 person");
        expect(LL.chat.peopleTab.countPeople({ count: 6 })).toBe("6 people");
        expect(LL.chat.peopleTab.countBots({ count: 1 })).toBe("1 bot");
        expect(LL.chat.peopleTab.countBots({ count: 21 })).toBe("21 bots");
    });

    it("reads both counts in the title bar's label", () => {
        const LL = i18nObject("en-US");
        expect(
            LL.titleBar.hereWithBotsLabel({
                people: LL.chat.peopleTab.countPeople({ count: 6 }),
                bots: LL.chat.peopleTab.countBots({ count: 21 }),
            })
        ).toBe("6 people and 21 bots here. Open the people list.");
        expect(LL.titleBar.hereLabel({ people: LL.chat.peopleTab.countPeople({ count: 1 }) })).toBe(
            "1 person here. Open the people list."
        );
    });

    it("keeps the French and Arabic counts in their own plural forms", () => {
        expect(i18nObject("fr-FR").chat.peopleTab.countPeople({ count: 2 })).toBe("2 personnes");
        expect(i18nObject("fr-FR").chat.peopleTab.countPeople({ count: 1 })).toBe("1 personne");
        expect(i18nObject("ar-SA").chat.peopleTab.countPeople({ count: 2 })).toBe("2 شخصان");
        expect(i18nObject("ar-SA").chat.peopleTab.countBots({ count: 5 })).toBe("5 روبوتات");
    });
});
