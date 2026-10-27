import { describe, expect, it } from "vitest";
import { readArtifactField, readArtifactLine } from "../../../src/front/Artifacts/artifactCard";
import { whenLabel } from "../../../src/front/Artifacts/whenLabel";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("readArtifactLine", () => {
    it("reads the line a bot sends, with and without the kind", () => {
        expect(readArtifactLine(`::artifact:${ID}:2:app::Quests board`, true)).toEqual({
            id: ID,
            version: 2,
            title: "Quests board",
            kind: "app",
            maker: undefined,
        });
        expect(readArtifactLine(`::artifact:${ID}:1::Old card`, true)).toMatchObject({ version: 1, kind: undefined });
    });

    it("ignores the same line from a person, a missing body and anything malformed", () => {
        expect(readArtifactLine(`::artifact:${ID}:1:app::Hi`, false)).toBeUndefined();
        expect(readArtifactLine(undefined, true)).toBeUndefined();
        expect(readArtifactLine(`::artifact:not-an-id:1:app::Hi`, true)).toBeUndefined();
        expect(readArtifactLine(`::artifact:${ID}:0:app::Hi`, true)).toBeUndefined();
        expect(readArtifactLine(`::artifact:${ID}:1:movie::Hi`, true)).toBeUndefined();
        expect(readArtifactLine(`::artifact:${ID}:1:app::   `, true)).toBeUndefined();
        expect(readArtifactLine(`Look: ::artifact:${ID}:1:app::Hi`, true)).toBeUndefined();
    });
});

describe("readArtifactField", () => {
    const bot = "@bot_scout:chat.example.com";
    const content = (artifact: unknown): Record<string, unknown> => ({
        msgtype: "m.text",
        body: "Quests board",
        "universe.artifact": artifact,
    });

    it("reads the field of a bot's message", () => {
        expect(
            readArtifactField(
                bot,
                content({ id: ID, version: 3, title: " Quests board ", kind: "svg", maker: "Scout" })
            )
        ).toEqual({ id: ID, version: 3, title: "Quests board", kind: "svg", maker: "Scout" });
    });

    it("drops an unknown kind and a blank maker instead of refusing the card", () => {
        expect(readArtifactField(bot, content({ id: ID, version: 1, title: "A", kind: "movie", maker: " " }))).toEqual({
            id: ID,
            version: 1,
            title: "A",
            kind: undefined,
            maker: undefined,
        });
    });

    it("refuses a person's message, a notice and a broken field", () => {
        const field = { id: ID, version: 1, title: "A" };
        expect(readArtifactField("@alice:chat.example.com", content(field))).toBeUndefined();
        expect(readArtifactField(bot, { ...content(field), msgtype: "m.notice" })).toBeUndefined();
        expect(readArtifactField(bot, content({ ...field, id: "nope" }))).toBeUndefined();
        expect(readArtifactField(bot, content({ ...field, version: 0 }))).toBeUndefined();
        expect(readArtifactField(bot, content({ ...field, version: "1" }))).toBeUndefined();
        expect(readArtifactField(bot, content({ ...field, title: " " }))).toBeUndefined();
        expect(readArtifactField(bot, content(undefined))).toBeUndefined();
    });
});

describe("whenLabel", () => {
    const now = new Date(2026, 9, 26, 12, 0);

    it("shows only the time for today and the day for any other", () => {
        const today = whenLabel(new Date(2026, 9, 26, 5, 54).toISOString(), now);
        const earlier = whenLabel(new Date(2026, 9, 25, 5, 54).toISOString(), now);
        expect(today).not.toContain(",");
        expect(earlier).toContain(",");
        expect(earlier.endsWith(today)).toBe(true);
    });

    it("is empty for a date it cannot read", () => {
        expect(whenLabel("not a date", now)).toBe("");
    });
});
