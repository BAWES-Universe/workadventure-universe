import { describe, expect, it } from "vitest";
import { appLinkId } from "../AppLink";
import {
    choiceIsComplete,
    limitChoices,
    parseShare,
    pickedTitles,
    shareRefusal,
    startingChoice,
    toggled,
} from "../AppShare";

const view = (over: Record<string, unknown> = {}) => ({
    shareable: true,
    shared: true,
    reachable: true,
    limits: { usesPerDayEveryone: 50, usesPerDayPerson: 5 },
    usedToday: 3,
    jobs: [
        {
            tool: "search",
            title: "Search the web",
            description: "Looks things up",
            heading: "lookUp",
            picked: true,
            needsPicking: false,
            inputs: [
                { name: "query", required: true, picked: true },
                { name: "max_results", required: false, picked: false },
            ],
            returns: { names: ["title", "url"], picked: ["title"] },
        },
    ],
    ...over,
});

describe("reading what Orbit says is shared (#2006)", () => {
    it("reads the limits, today's uses and each job", () => {
        const share = parseShare(view());
        expect(share).toMatchObject({
            shareable: true,
            shared: true,
            reachable: true,
            usesPerDayEveryone: 50,
            usesPerDayPerson: 5,
            usedToday: 3,
        });
        expect(share?.jobs[0]).toMatchObject({
            tool: "search",
            title: "Search the web",
            picked: true,
            needsPicking: false,
        });
        expect(pickedTitles(share!)).toEqual(["Search the web"]);
    });

    it("is nothing at all when the answer is not that, or a job or a limit cannot be read", () => {
        expect(parseShare(undefined)).toBeUndefined();
        expect(parseShare({})).toBeUndefined();
        expect(parseShare(view({ limits: { usesPerDayEveryone: "many", usesPerDayPerson: 5 } }))).toBeUndefined();
        expect(parseShare(view({ jobs: [{ title: "No tool" }] }))).toBeUndefined();
        expect(parseShare(view({ jobs: [{ tool: "x", inputs: [{ required: true }] }] }))).toBeUndefined();
    });

    it("does not read a job whose answer is not said on purpose as one that gives its whole answer", () => {
        const job = (returns: unknown) => view({ jobs: [{ ...view().jobs[0], returns }] });
        // A list of fields, or null for the whole answer: both are said on purpose
        expect(parseShare(job({ names: null, picked: null }))?.jobs[0].returns).toEqual({ names: null, picked: null });
        expect(parseShare(job({ names: ["title"], picked: ["title"] }))?.jobs[0].returns).toEqual({
            names: ["title"],
            picked: ["title"],
        });
        // Anything else is not: it is not offered at all, so nothing more than the owner means can be shared
        for (const bad of [
            { names: {}, picked: ["title"] },
            { names: "all", picked: null },
            { names: ["title"], picked: "title" },
            { names: ["title"] },
            { picked: null },
            {},
            null,
            "everything",
        ]) {
            expect(parseShare(job(bad))).toBeUndefined();
        }
    });

    it("starts a job not shared yet with what it cannot work without, and the whole answer", () => {
        const job = parseShare(view({ shared: false }))!.jobs[0];
        const unshared = { ...job, picked: false, returns: { names: ["title", "url"], picked: null } };
        expect(startingChoice(unshared)).toEqual({ tool: "search", inputs: ["query"], returns: ["title", "url"] });
    });

    it("keeps a shared job as the owner left it, and a job whose app names no fields gives its whole answer", () => {
        const job = parseShare(view())!.jobs[0];
        expect(startingChoice(job)).toEqual({ tool: "search", inputs: ["query"], returns: ["title"] });
        const plain = { ...job, inputs: [], returns: { names: null, picked: null } };
        expect(startingChoice(plain)).toEqual({ tool: "search", inputs: [], returns: null });
    });

    it("never reads a shared job's picked fields as the whole answer when its app stopped naming its fields", () => {
        const job = parseShare(view())!.jobs[0];
        const unnamed = { ...job, returns: { names: null, picked: ["title"] } };
        expect(startingChoice(unnamed)).toEqual({ tool: "search", inputs: ["query"], returns: ["title"] });
    });

    it("checks a choice has what the job needs and something coming back", () => {
        const job = parseShare(view())!.jobs[0];
        expect(choiceIsComplete(job, { tool: "search", inputs: ["query"], returns: ["title"] })).toBe(true);
        expect(choiceIsComplete(job, { tool: "search", inputs: [], returns: ["title"] })).toBe(false);
        expect(choiceIsComplete(job, { tool: "search", inputs: ["query"], returns: [] })).toBe(false);
        const plain = { ...job, returns: { names: null, picked: null } };
        expect(choiceIsComplete(plain, { tool: "search", inputs: ["query"], returns: null })).toBe(true);
    });

    it("adds and takes out a name, in the order the app gives them", () => {
        expect(toggled(["a", "c"], "b", ["a", "b", "c"])).toEqual(["a", "b", "c"]);
        expect(toggled(["a", "b"], "a", ["a", "b", "c"])).toEqual(["b"]);
    });

    it("offers the limit already set when it is not among the starting values", () => {
        expect(limitChoices("everyone", 50)).toEqual([20, 50, 100, 200, 500]);
        expect(limitChoices("person", 7)).toEqual([3, 5, 7, 10, 20, 50]);
    });

    it("shows Orbit's own words for a refusal it worded, and the plain line for anything else", () => {
        const refused = (status: number, message: string) => Object.assign(new Error(message), { status });
        expect(shareRefusal(refused(400, "That asks for something the job does not take"), "plain")).toBe(
            "That asks for something the job does not take"
        );
        expect(shareRefusal(refused(503, "The app could not be reached just now"), "plain")).toBe(
            "The app could not be reached just now"
        );
        expect(shareRefusal(refused(500, "boom"), "plain")).toBe("plain");
        expect(shareRefusal(refused(400, "API error 400: {...}"), "plain")).toBe("plain");
        expect(shareRefusal(new Error("offline"), "plain")).toBe("plain");
    });
});

describe("the link in the note to the owner (#2006)", () => {
    it("is an app's id after #apps=, and nothing else", () => {
        expect(appLinkId("#apps=conn_1")).toBe("conn_1");
        expect(appLinkId("#apps=")).toBeUndefined();
        expect(appLinkId("#apps=a/../b")).toBeUndefined();
        expect(appLinkId("#apps")).toBeUndefined();
        expect(appLinkId("https://example.com/#apps=x")).toBeUndefined();
        expect(appLinkId(null)).toBeUndefined();
    });
});
