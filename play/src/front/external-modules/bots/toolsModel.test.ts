import { describe, expect, it } from "vitest";
import {
    briefNames,
    exampleHeading,
    headingOf,
    readBotToolSettings,
    readServerTools,
    searchTools,
    toCheck,
    toolLabel,
    toolsUnder,
    usedHeadings,
    type ServerTool,
} from "./toolsModel";

const tool = (over: Partial<ServerTool> & { id: string; name: string }): ServerTool => ({
    title: null,
    description: null,
    suggestedHeading: null,
    suggestionSource: null,
    heading: null,
    state: "notConfirmedYet",
    confirmedBy: null,
    movedBy: null,
    ...over,
});

const tools: ServerTool[] = [
    tool({
        id: "1",
        name: "list_issues",
        title: "List issues",
        suggestedHeading: "looksUp",
        suggestionSource: "server",
    }),
    tool({
        id: "2",
        name: "get_issue",
        title: "Get issue",
        suggestedHeading: "looksUp",
        suggestionSource: "server",
        state: "confirmed",
    }),
    tool({
        id: "3",
        name: "save_comment",
        title: "Save comment",
        description: "Add a comment to an issue",
        suggestedHeading: "changesThings",
        suggestionSource: "description",
    }),
    tool({
        id: "4",
        name: "delete_comment",
        suggestedHeading: "changesThings",
        suggestionSource: "server",
        heading: "deletesOrSends",
        state: "confirmed",
        confirmedBy: "Sara",
        movedBy: "Sara",
    }),
    tool({ id: "5", name: "mystery" }),
];

describe("the bot page's tool headings (game #1655, Orbit #738)", () => {
    it("reads Orbit's answer, with defaults for anything it leaves out", () => {
        const read = readServerTools({
            serverId: "s1",
            state: "confirmed",
            policyRevision: 7,
            settings: { looksUp: "off", changesThings: "nonsense" },
            tools: [
                {
                    id: "t1",
                    name: "save_issue",
                    title: "Save issue",
                    suggestedHeading: "changesThings",
                    suggestionSource: "server",
                    heading: null,
                    state: "confirmed",
                    confirmedBy: { name: "Sara" },
                    movedBy: null,
                },
                { nonsense: true },
            ],
        });
        expect(read.state).toBe("confirmed");
        expect(read.policyRevision).toBe(7);
        expect(read.settings).toEqual({
            looksUp: "off",
            makesNew: "rightAway",
            changesThings: "asksFirst",
            deletesOrSends: "asksFirst",
        });
        expect(read.tools).toHaveLength(1);
        expect(read.tools[0]).toMatchObject({ name: "save_issue", confirmedBy: "Sara", movedBy: null });
        expect(() => readServerTools({})).toThrow();
    });

    it("keeps a suggestion's source only when there is a suggestion", () => {
        const read = readServerTools({
            serverId: "s1",
            tools: [{ id: "t1", name: "x", suggestionSource: "server" }],
        });
        expect(read.tools[0].suggestionSource).toBeNull();
        expect(read.state).toBe("notConfirmedYet");
    });

    it("reads the bot's asking settings, with Orbit's defaults and no limit as null", () => {
        expect(readBotToolSettings({})).toEqual({ askBeforeMaking: 5, askWhichWay: "rarely", cardWaitMinutes: 10 });
        expect(readBotToolSettings({ askBeforeMaking: null, askWhichWay: "never", cardWaitMinutes: 30 })).toEqual({
            askBeforeMaking: null,
            askWhichWay: "never",
            cardWaitMinutes: 30,
        });
        expect(readBotToolSettings({ askWhichWay: "sometimes" }).askWhichWay).toBe("rarely");
    });

    it("puts a tool where a person chose, else where it was suggested, else nowhere yet", () => {
        expect(headingOf(tools[0])).toBe("looksUp");
        expect(headingOf(tools[3])).toBe("deletesOrSends");
        expect(headingOf(tools[4])).toBeNull();
        expect(toolsUnder(tools, "looksUp").map((t) => t.id)).toEqual(["1", "2"]);
        expect(toolsUnder(tools, "changesThings").map((t) => t.id)).toEqual(["3"]);
        expect(toolsUnder(tools, "unsorted").map((t) => t.id)).toEqual(["5"]);
    });

    it("shows only the headings that have tools, and the unsorted ones last", () => {
        expect(usedHeadings(tools)).toEqual(["looksUp", "changesThings", "deletesOrSends", "unsorted"]);
        expect(usedHeadings([])).toEqual([]);
    });

    it("counts what is still to check", () => {
        expect(toCheck(tools)).toBe(3);
        expect(toCheck(tools.filter((t) => t.state === "confirmed"))).toBe(0);
    });

    it("names a tool by its own title, else its name", () => {
        expect(toolLabel(tools[0])).toBe("List issues");
        expect(toolLabel(tools[3])).toBe("delete_comment");
    });

    it("lists the first three names and how many more", () => {
        expect(briefNames(tools)).toEqual({ names: ["List issues", "Get issue", "Save comment"], more: 2 });
        expect(briefNames(tools.slice(0, 2))).toEqual({ names: ["List issues", "Get issue"], more: 0 });
    });

    it("finds tools by title, name or description, and finds none for an empty search", () => {
        expect(searchTools(tools, "comment").map((t) => t.id)).toEqual(["3", "4"]);
        expect(searchTools(tools, "  ISSUE ").map((t) => t.id)).toEqual(["1", "2", "3"]);
        expect(searchTools(tools, "")).toEqual([]);
        expect(searchTools(tools, "zzz")).toEqual([]);
    });

    it("gives an example heading that is never the one on screen", () => {
        expect(exampleHeading("looksUp")).toBe("deletesOrSends");
        expect(exampleHeading("deletesOrSends")).toBe("changesThings");
        expect(exampleHeading("unsorted")).toBe("deletesOrSends");
    });
});
