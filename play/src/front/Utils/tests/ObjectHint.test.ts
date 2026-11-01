import { describe, expect, it } from "vitest";
import { escapeMarkdown, getObjectNearHint } from "../ObjectHint";

const SPACE = "[SPACE]";
const DEFAULT = "Press [SPACE] to interact with it";
const link = { type: "openWebsite" };

describe("The hint over an object when you walk near it (#1740)", () => {
    it("shows the Toast Message when one is set, even with a Button Label", () => {
        expect(getObjectNearHint([{ ...link, triggerMessage: "Hello!" }], ["Open the menu"], SPACE, DEFAULT)).toBe(
            "Hello!"
        );
    });

    it("shows the Toast Message of any setting of the object", () => {
        const settings = [{ type: "playAudio" }, { ...link, triggerMessage: "Hello!" }];
        expect(getObjectNearHint(settings, ["Play", "Open"], SPACE, DEFAULT)).toBe("Hello!");
    });

    it("ignores a Toast Message on the description", () => {
        const settings = [{ type: "entityDescriptionProperties", triggerMessage: "No" }, link];
        expect(getObjectNearHint(settings, ["Open the menu"], SPACE, DEFAULT)).toBe("[SPACE] Open the menu");
    });

    it("names the key and the label when a click does one thing", () => {
        expect(getObjectNearHint([link], ["Open the menu"], SPACE, DEFAULT)).toBe("[SPACE] Open the menu");
    });

    it("trims the label", () => {
        expect(getObjectNearHint([link], ["  Open the menu  "], SPACE, DEFAULT)).toBe("[SPACE] Open the menu");
    });

    it("keeps the usual hint when a click does two things", () => {
        expect(getObjectNearHint([link, link], ["Open the menu", "Play"], SPACE, DEFAULT)).toBe(DEFAULT);
    });

    it("keeps the usual hint when the label is empty", () => {
        expect(getObjectNearHint([link], [""], SPACE, DEFAULT)).toBe(DEFAULT);
        expect(getObjectNearHint([link], ["   "], SPACE, DEFAULT)).toBe(DEFAULT);
    });

    it("keeps the usual hint when a click does nothing (a sound in range alone)", () => {
        expect(getObjectNearHint([{ type: "playAudio" }], [], SPACE, DEFAULT)).toBe(DEFAULT);
    });

    it("shows a label as typed once it goes through Markdown", () => {
        expect(getObjectNearHint([link], ["*Hi* _there_ [x](y) <b>"], SPACE, DEFAULT)).toBe(
            "[SPACE] \\*Hi\\* \\_there\\_ \\[x\\]\\(y\\) \\<b\\>"
        );
        expect(escapeMarkdown("one\ntwo")).toBe("one two");
    });
});
