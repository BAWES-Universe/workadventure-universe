import { beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getTemplateLists: vi.fn<() => Promise<unknown>>(),
    getTemplatePreview: vi.fn<(id: string) => Promise<unknown>>(),
    starTemplate: vi.fn<(id: string, starred: boolean) => Promise<unknown>>(),
    getTemplateOfBrick: vi.fn<(id: string) => Promise<unknown>>(),
    getMakerTemplate: vi.fn<(id: string) => Promise<unknown>>(),
    lookAtTemplate: vi.fn<(id: string, choices: Record<string, unknown>) => Promise<unknown>>(),
    shareTemplate: vi.fn<(id: string, request: Record<string, unknown>) => Promise<unknown>>(),
    stopSharingTemplate: vi.fn<(id: string) => Promise<unknown>>(),
    getMadeFrom: vi.fn<(id: string) => Promise<unknown>>(),
    takeTemplateUpdate: vi.fn<(id: string, version: number, take: string[]) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: orbit }));

import {
    joinNames,
    missingNeeds,
    parseMadeFromView,
    parseMakerTemplate,
    parseTemplateCard,
    parseTemplateLists,
    parseTemplateLook,
    parseTemplatePreview,
    parseUsedTemplate,
} from "../Templates/Template";
import {
    choicesBody,
    readMadeFrom,
    readMakerTemplate,
    readTemplateLists,
    readTemplateLook,
    readTemplateOfBrick,
    readTemplatePreview,
    setTemplateStar,
    shareTemplateLook,
    stopSharingTemplate,
    takeTemplateUpdate,
} from "../Templates/Templates";

const card = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    brickId: "b1",
    name: "Music companion",
    description: "makes songs",
    look: "brick-violet",
    firstThing: "Make a jingle",
    maker: { name: "Omar" },
    version: 2,
    starred: true,
    mine: false,
    ...over,
});
const need = (over: Record<string, unknown> = {}) => ({
    kind: "app",
    key: "ace-step",
    label: "ACE-Step",
    required: true,
    ready: false,
    ...over,
});
const refused = (status: number, code?: string) => Object.assign(new Error("refused"), { status, code });

describe("Brick templates (#2008)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    describe("reading what Orbit sends", () => {
        it("keeps a whole card and leaves out one that is not", () => {
            expect(parseTemplateCard(card())).toEqual({
                id: "t1",
                brickId: "b1",
                name: "Music companion",
                description: "makes songs",
                look: "brick-violet",
                firstThing: "Make a jingle",
                makerName: "Omar",
                version: 2,
                starred: true,
                mine: false,
            });
            expect(parseTemplateCard(card({ id: "" }))).toBeUndefined();
            expect(parseTemplateCard(card({ name: 5 }))).toBeUndefined();
            expect(parseTemplateCard("x")).toBeUndefined();
        });

        it("reads the three lists, each only with whole cards", () => {
            expect(
                parseTemplateLists({ starred: [card(), { id: "bad" }, null], picks: [card({ id: "t2" })], met: "x" })
            ).toMatchObject({ starred: [{ id: "t1" }], picks: [{ id: "t2" }], met: [] });
            expect(parseTemplateLists(undefined)).toEqual({ starred: [], picks: [], met: [] });
        });

        it("reads the look before creating: needs, routines, and whether setup is required", () => {
            const read = parseTemplatePreview({
                template: {
                    ...card(),
                    instructions: "Make songs.",
                    needs: [
                        need(),
                        { kind: "robot", key: "x", label: "X" },
                        need({ key: "k2", label: "Maps", required: false }),
                    ],
                    setupRequired: true,
                    routines: [
                        { kind: "reminder", words: "Every Friday", condition: null },
                        { kind: "goal", words: "no" },
                    ],
                },
            });
            expect(read?.instructions).toBe("Make songs.");
            expect(read?.setupRequired).toBe(true);
            expect(read?.needs.map((one) => one.key)).toEqual(["ace-step", "k2"]);
            expect(read?.routines).toEqual([{ kind: "reminder", words: "Every Friday", condition: null }]);
            expect(parseTemplatePreview({})).toBeUndefined();
        });

        it("names what the main job still lacks, never an optional need", () => {
            const needs = parseTemplatePreview({
                template: {
                    ...card(),
                    needs: [
                        need(),
                        need({ key: "k2", label: "Maps", required: false }),
                        need({ key: "k3", ready: true }),
                    ],
                },
            })!.needs;
            expect(missingNeeds(needs).map((one) => one.key)).toEqual(["ace-step"]);
        });

        it("says names the way a sentence does", () => {
            expect(joinNames([], "and")).toBe("");
            expect(joinNames(["Gmail"], "and")).toBe("Gmail");
            expect(joinNames(["Gmail", "Notion"], "and")).toBe("Gmail and Notion");
            expect(joinNames(["Gmail", "Notion", "Slack"], "and")).toBe("Gmail, Notion and Slack");
        });

        it("reads a look before sharing, and a secret always blocks", () => {
            const look = parseTemplateLook({
                look: {
                    name: "Beat",
                    description: null,
                    look: "brick-teal",
                    instructions: "Be nice",
                    firstThing: null,
                    needs: [need()],
                    routines: [],
                    findings: [
                        { kind: "secret", where: "instructions", what: "an AI or API key", sample: "sk-abc…" },
                        { kind: "x" },
                    ],
                    blocked: false,
                    token: "tok",
                },
            });
            expect(look?.token).toBe("tok");
            expect(look?.findings).toHaveLength(1);
            // The flag said no, the finding said secret: it blocks
            expect(look?.blocked).toBe(true);
            expect(parseTemplateLook({ look: { name: "Beat" } })).toBeUndefined();
        });

        it("reads the maker's group, with the choices and the routines that could go along", () => {
            const group = parseMakerTemplate({
                template: {
                    shared: true,
                    stopped: false,
                    audience: "everyone",
                    version: 2,
                    madeFrom: 14,
                    hasChanges: true,
                    choices: { leaveOutLook: true, firstThing: "Hi", optionalNeeds: ["k"], routines: ["r1", 5] },
                    routineChoices: [
                        { id: "r1", kind: "reminder", words: "Every Friday", condition: null },
                        { kind: "reminder", words: "no id" },
                    ],
                },
            });
            expect(group).toMatchObject({ shared: true, madeFrom: 14, hasChanges: true, version: 2 });
            expect(group?.choices).toEqual({
                leaveOutLook: true,
                firstThing: "Hi",
                optionalNeeds: ["k"],
                routines: ["r1"],
            });
            expect(group?.routineChoices.map((one) => one.id)).toEqual(["r1"]);
            expect(parseMakerTemplate({ template: { shared: false } })?.choices).toEqual({
                leaveOutLook: false,
                optionalNeeds: [],
                routines: [],
            });
        });

        it("reads what a Brick made from a template needs and the update it is offered", () => {
            const view = parseMadeFromView({
                madeFrom: { templateName: "Music companion", maker: { name: "Omar" }, version: 1, shared: true },
                setup: { needs: [need()], setupRequired: true, routinesOff: 2 },
                update: {
                    version: 2,
                    changes: [
                        { field: "instructions", mine: "old", theirs: "new" },
                        {
                            field: "routines",
                            mine: null,
                            theirs: [{ kind: "reminder", words: "Every Friday", condition: null }],
                        },
                        { field: "secrets", theirs: "no" },
                        { field: "firstThing", theirs: "" },
                    ],
                },
            });
            expect(view?.setup).toMatchObject({ setupRequired: true, routinesOff: 2 });
            expect(view?.update?.changes.map((change) => change.field)).toEqual(["instructions", "routines"]);
            expect(view?.update?.changes[1].routines).toHaveLength(1);
            // Nothing is offered when nothing whole is in it
            expect(
                parseMadeFromView({
                    madeFrom: { templateName: "A", maker: {}, version: 1 },
                    update: { version: 2, changes: [] },
                })?.update
            ).toBeUndefined();
            expect(parseMadeFromView({ setup: {} })).toBeUndefined();
        });

        it("reads the answer to Create Brick", () => {
            const used = parseUsedTemplate({
                brick: { id: "n1" },
                madeFrom: { templateName: "A", maker: { name: "Omar" }, version: 1, shared: true },
                setup: { needs: [], setupRequired: false, routinesOff: 1 },
                routines: { added: 1, leftOut: 2 },
            });
            expect(used).toMatchObject({ routinesAdded: 1, routinesLeftOut: 2 });
            expect(used?.view?.setup.routinesOff).toBe(1);
            expect(parseUsedTemplate({})).toBeUndefined();
        });
    });

    describe("asking Orbit", () => {
        it("says 'not found' apart from 'could not read'", async () => {
            orbit.getTemplatePreview.mockRejectedValueOnce(refused(404));
            expect(await readTemplatePreview("t1")).toEqual({ ok: false, why: "gone" });
            orbit.getTemplatePreview.mockRejectedValueOnce(new Error("offline"));
            expect(await readTemplatePreview("t1")).toEqual({ ok: false, why: "failed" });
            orbit.getTemplatePreview.mockResolvedValueOnce({ template: { id: "no name" } });
            expect(await readTemplatePreview("t1")).toEqual({ ok: false, why: "failed" });
            orbit.getTemplatePreview.mockResolvedValueOnce({ template: card() });
            expect(await readTemplatePreview("t1")).toMatchObject({ ok: true, value: { id: "t1" } });
        });

        it("reads the lists, and a list that cannot be read is a failure rather than an empty one", async () => {
            orbit.getTemplateLists.mockResolvedValueOnce({ starred: [card()], picks: [], met: [] });
            expect(await readTemplateLists()).toMatchObject({ ok: true, value: { starred: [{ id: "t1" }] } });
            orbit.getTemplateLists.mockRejectedValueOnce(new Error("offline"));
            expect(await readTemplateLists()).toEqual({ ok: false, why: "failed" });
            orbit.getTemplateLists.mockResolvedValueOnce(null);
            expect(await readTemplateLists()).toEqual({ ok: false, why: "failed" });
            orbit.getTemplateLists.mockResolvedValueOnce({ error: "unavailable" });
            expect(await readTemplateLists()).toEqual({ ok: false, why: "failed" });
            orbit.getTemplateLists.mockResolvedValueOnce({ starred: [], picks: [], met: [] });
            expect(await readTemplateLists()).toEqual({ ok: true, value: { starred: [], picks: [], met: [] } });
        });

        it("stars and unstars, and says when that did not work", async () => {
            orbit.starTemplate.mockResolvedValue({ starred: true });
            expect(await setTemplateStar("t1", true)).toBe(true);
            expect(orbit.starTemplate).toHaveBeenCalledWith("t1", true);
            orbit.starTemplate.mockRejectedValueOnce(new Error("offline"));
            expect(await setTemplateStar("t1", false)).toBe(false);
        });

        it("puts nothing on a card when it cannot tell whether the Brick shares a template", async () => {
            orbit.getTemplateOfBrick.mockResolvedValueOnce({ template: card() });
            expect((await readTemplateOfBrick("b1"))?.id).toBe("t1");
            orbit.getTemplateOfBrick.mockResolvedValueOnce({ template: null });
            expect(await readTemplateOfBrick("b1")).toBeUndefined();
            orbit.getTemplateOfBrick.mockRejectedValueOnce(new Error("offline"));
            expect(await readTemplateOfBrick("b1")).toBeUndefined();
        });
    });

    describe("sharing", () => {
        const look = parseTemplateLook({
            look: { name: "Beat", token: "tok", needs: [], routines: [], findings: [] },
        })!;
        const choices = { leaveOutLook: false, optionalNeeds: [], routines: [] };

        it("sends only the maker's choices and the look's token, never the Brick's own words", async () => {
            orbit.shareTemplate.mockResolvedValueOnce({ template: { shared: true, version: 1, choices } });
            const done = await shareTemplateLook(
                "b1",
                look,
                { ...choices, firstThing: "Hi", routines: ["r1"] },
                "everyone"
            );
            expect(done).toMatchObject({ done: true, template: { shared: true } });
            expect(orbit.shareTemplate).toHaveBeenCalledWith("b1", {
                leaveOutLook: false,
                firstThing: "Hi",
                optionalNeeds: [],
                routines: ["r1"],
                audience: "everyone",
                token: "tok",
            });
        });

        it("leaves the first thing out of the request while the maker has not written one", () => {
            expect(choicesBody(choices)).toEqual({ leaveOutLook: false, optionalNeeds: [], routines: [] });
            expect(choicesBody({ ...choices, firstThing: "" })).toMatchObject({ firstThing: "" });
        });

        it("says when the Brick changed since the look, when a secret is in it, and when it is gone", async () => {
            orbit.shareTemplate.mockRejectedValueOnce(refused(409, "changed"));
            expect(await shareTemplateLook("b1", look, choices)).toEqual({ done: false, why: "changed" });
            orbit.shareTemplate.mockRejectedValueOnce(refused(422, "secret"));
            expect(await shareTemplateLook("b1", look, choices)).toEqual({ done: false, why: "secret" });
            orbit.shareTemplate.mockRejectedValueOnce(refused(404));
            expect(await shareTemplateLook("b1", look, choices)).toEqual({ done: false, why: "gone" });
            orbit.shareTemplate.mockRejectedValueOnce(refused(500));
            expect(await shareTemplateLook("b1", look, choices)).toEqual({ done: false, why: "failed" });
        });

        it("reads the look and the group, and stops sharing", async () => {
            orbit.lookAtTemplate.mockResolvedValueOnce({ look: { name: "Beat", token: "tok" } });
            expect(await readTemplateLook("b1", choices, "everyone")).toMatchObject({
                ok: true,
                value: { token: "tok" },
            });
            orbit.getMakerTemplate.mockResolvedValueOnce({ template: { shared: false } });
            expect(await readMakerTemplate("b1")).toMatchObject({ ok: true, value: { shared: false } });
            orbit.stopSharingTemplate.mockResolvedValueOnce({ template: { shared: false, stopped: true } });
            expect(await stopSharingTemplate("b1")).toMatchObject({ stopped: true });
            orbit.stopSharingTemplate.mockRejectedValueOnce(new Error("offline"));
            expect(await stopSharingTemplate("b1")).toBeUndefined();
        });
    });

    describe("a Brick made from a template", () => {
        it("tells a Brick that was not made from one from a read that failed", async () => {
            orbit.getMadeFrom.mockRejectedValueOnce(refused(404));
            expect(await readMadeFrom("b1")).toEqual({ ok: false, why: "gone" });
            orbit.getMadeFrom.mockRejectedValueOnce(new Error("offline"));
            expect(await readMadeFrom("b1")).toEqual({ ok: false, why: "failed" });
        });

        it("takes the parts the owner picked, and says how many routines did not fit", async () => {
            orbit.takeTemplateUpdate.mockResolvedValueOnce({
                madeFrom: { templateName: "A", maker: { name: "Omar" }, version: 2, shared: true },
                setup: { needs: [], setupRequired: false, routinesOff: 1 },
                update: null,
                routines: { added: 1, leftOut: 2 },
            });
            const done = await takeTemplateUpdate("b1", 2, ["instructions", "routines"]);
            expect(orbit.takeTemplateUpdate).toHaveBeenCalledWith("b1", 2, ["instructions", "routines"]);
            expect(done).toMatchObject({ done: true, routinesAdded: 1, routinesLeftOut: 2 });
            if (done.done) expect(done.view?.update).toBeUndefined();
        });

        it("reads the offer again when the template changed under the review", async () => {
            orbit.takeTemplateUpdate.mockRejectedValueOnce(refused(409, "changed"));
            expect(await takeTemplateUpdate("b1", 2, [])).toEqual({ done: false, why: "changed" });
            orbit.takeTemplateUpdate.mockRejectedValueOnce(refused(500));
            expect(await takeTemplateUpdate("b1", 2, [])).toEqual({ done: false, why: "failed" });
        });
    });
});
