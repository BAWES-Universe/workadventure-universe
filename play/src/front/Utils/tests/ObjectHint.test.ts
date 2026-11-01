import { describe, expect, it } from "vitest";
import { escapeMarkdown, getObjectNearHint, isClickSetting, type HintSetting } from "../ObjectHint";

const SPACE = "[SPACE]";
const DEFAULT = "Press [SPACE] to interact with it";
const hint = (settings: HintSetting[], asMarkdown = true) => getObjectNearHint(settings, SPACE, DEFAULT, asMarkdown);
const link = (buttonLabel: string, extra: Partial<HintSetting> = {}): HintSetting => ({
    type: "openWebsite",
    link: "https://example.com",
    buttonLabel,
    ...extra,
});
const clickSound = (buttonLabel: string): HintSetting => ({ type: "playAudio", startsOn: "click", buttonLabel });
const rangeSound = (buttonLabel: string): HintSetting => ({ type: "playAudio", startsOn: "range", buttonLabel });

describe("What counts as a click on an object", () => {
    it("is a link or a file with a link, or a sound that does not play in range", () => {
        expect(isClickSetting(link("A"))).toBe(true);
        expect(isClickSetting({ type: "openFile", link: "a.pdf" })).toBe(true);
        expect(isClickSetting(clickSound("A"))).toBe(true);
        expect(isClickSetting({ type: "playAudio" })).toBe(true);
    });

    it("is not an empty link, a sound in range or a description", () => {
        expect(isClickSetting(link("A", { link: "" }))).toBe(false);
        expect(isClickSetting(rangeSound("A"))).toBe(false);
        expect(isClickSetting({ type: "entityDescriptionProperties" })).toBe(false);
    });
});

describe("The hint over an object when you walk near it (#1740)", () => {
    it("shows the Toast Message when one is set, even with a Button Label", () => {
        expect(hint([link("Open the menu", { triggerMessage: "Hello!" })])).toBe("Hello!");
    });

    it("shows the Toast Message of any setting of the object", () => {
        expect(hint([clickSound("Play"), link("Open", { triggerMessage: "Hello!" })])).toBe("Hello!");
    });

    it("ignores a Toast Message on the description", () => {
        const description = { type: "entityDescriptionProperties", triggerMessage: "No" };
        expect(hint([description, link("Open the menu")])).toBe("[SPACE] Open the menu");
    });

    it("names the key and the label when a click does one thing", () => {
        expect(hint([link("Open the menu")])).toBe("[SPACE] Open the menu");
    });

    it("trims the label", () => {
        expect(hint([link("  Open the menu  ")])).toBe("[SPACE] Open the menu");
    });

    it("keeps the usual hint when a click does two things", () => {
        expect(hint([link("Open the menu"), clickSound("Play")])).toBe(DEFAULT);
    });

    it("keeps the usual hint when the label is empty", () => {
        expect(hint([link("")])).toBe(DEFAULT);
        expect(hint([link("   ")])).toBe(DEFAULT);
        expect(hint([{ type: "openWebsite", link: "https://example.com" }])).toBe(DEFAULT);
    });

    it("keeps the usual hint when a link is left empty", () => {
        expect(hint([link("Open the menu", { link: "" })])).toBe(DEFAULT);
    });

    it("keeps the usual hint when a click does nothing (a sound in range alone)", () => {
        expect(hint([rangeSound("Play")])).toBe(DEFAULT);
    });

    it("does not count a sound that plays in range as a second thing", () => {
        expect(hint([rangeSound("Play"), link("Open the menu")])).toBe("[SPACE] Open the menu");
    });

    it("shows a label as typed once it goes through Markdown", () => {
        expect(hint([link("*Hi* _there_ [x](y) <b>")])).toBe("[SPACE] \\*Hi\\* \\_there\\_ \\[x\\]\\(y\\) \\<b\\>");
        expect(escapeMarkdown("one\ntwo")).toBe("one two");
    });

    it("leaves the label as typed for the editor's plain-text preview", () => {
        expect(hint([link("*Hi* _there_")], false)).toBe("[SPACE] *Hi* _there_");
    });
});
