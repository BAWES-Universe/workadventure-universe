import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getTemplateLists: vi.fn<() => Promise<unknown>>(),
    getTemplatePreview: vi.fn<(id: string) => Promise<unknown>>(),
    useTemplate: vi.fn<(id: string, name?: string) => Promise<unknown>>(),
    starTemplate: vi.fn<(id: string, on: boolean) => Promise<unknown>>(),
    getMakerTemplate: vi.fn<(id: string) => Promise<unknown>>(),
    lookAtTemplate: vi.fn<(id: string, choices: unknown) => Promise<unknown>>(),
    shareTemplate: vi.fn<(id: string, body: unknown) => Promise<unknown>>(),
    stopSharingTemplate: vi.fn<(id: string) => Promise<unknown>>(),
    getMadeFrom: vi.fn<(id: string) => Promise<unknown>>(),
    takeTemplateUpdate: vi.fn<(id: string, version: number, take: string[]) => Promise<unknown>>(),
    closeModal: vi.fn<() => void>(),
    closeAllModals: vi.fn<() => void>(),
    openModal: vi.fn<(component: unknown, props: Record<string, unknown>) => void>(),
    warn: vi.fn<(message: string) => void>(),
    makeFromTemplate: vi.fn<(id: string, name: string) => Promise<unknown>>(),
    openBrickPage: vi.fn<(id: string) => void>(),
    openBrickChat: vi.fn<(id: string) => Promise<void>>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the screens read on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("svelte-modals", () => ({
    closeModal: game.closeModal,
    closeAllModals: game.closeAllModals,
    openModal: game.openModal,
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getTemplateLists: game.getTemplateLists,
        getTemplatePreview: game.getTemplatePreview,
        useTemplate: game.useTemplate,
        starTemplate: game.starTemplate,
        getMakerTemplate: game.getMakerTemplate,
        lookAtTemplate: game.lookAtTemplate,
        shareTemplate: game.shareTemplate,
        stopSharingTemplate: game.stopSharingTemplate,
        getMadeFrom: game.getMadeFrom,
        takeTemplateUpdate: game.takeTemplateUpdate,
    },
}));
vi.mock("../MyBricksStore", () => ({ makeMyBrickFromTemplate: game.makeFromTemplate }));
vi.mock("../BrickChat", () => ({ openBrickChat: game.openBrickChat }));
vi.mock("../Templates/OpenBrick", () => ({ openBrickPage: game.openBrickPage }));
// The pictures are not what these tests are about
vi.mock(
    "../BrickPicture.svelte",
    async () => await import("../../../external-modules/bots/components/testStub.svelte")
);
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BrickMadeFrom from "../Templates/BrickMadeFrom.svelte";
import BrickTemplateGroup from "../Templates/BrickTemplateGroup.svelte";
import TemplateList from "../Templates/TemplateList.svelte";
import TemplateLookSheet from "../Templates/TemplateLookSheet.svelte";
import TemplateSheet from "../Templates/TemplateSheet.svelte";
import TemplateUpdateSheet from "../Templates/TemplateUpdateSheet.svelte";
import { NO_CHOICES, type TemplateUpdate } from "../Templates/Template";

const card = (id: string, name: string, maker: string, over: Record<string, unknown> = {}) => ({
    id,
    brickId: `src-${id}`,
    name,
    description: "makes songs and jingles",
    look: "brick-violet",
    firstThing: null,
    maker: { name: maker },
    version: 2,
    starred: false,
    mine: false,
    ...over,
});
const APP_NEED = { kind: "app", key: "ace-step", label: "ACE-Step", required: true, ready: false };
const template = (over: Record<string, unknown> = {}) => ({
    ...card("t1", "Melody", "Omar"),
    firstThing: "Make a 30-second jingle for my shop",
    instructions: "You are Melody, a music companion.",
    needs: [APP_NEED],
    setupRequired: true,
    routines: [
        {
            kind: "reminder",
            words: "Remind me every Friday",
            condition: null,
            cadence: { type: "daily", time: "09:00", days: [5] },
        },
    ],
    staysWithOriginal: ["memory", "chats"],
    ...over,
});
const look = (over: Record<string, unknown> = {}) => ({
    name: "Music Brick",
    description: "Jingles",
    look: "brick-teal",
    instructions: "You are Music Brick.",
    firstThing: "Make a jingle",
    needs: [{ kind: "app", key: "ace-step", label: "ACE-Step", required: true }],
    routines: [],
    audience: "everyone",
    neverCarried: [],
    findings: [],
    blocked: false,
    contentHash: "h",
    token: "tok",
    ...over,
});
const maker = (over: Record<string, unknown> = {}) => ({
    shared: false,
    stopped: false,
    audience: null,
    version: null,
    sharedAt: null,
    madeFrom: 0,
    hasChanges: false,
    choices: { leaveOutLook: false, routines: [], optionalNeeds: [] },
    routineChoices: [],
    latest: null,
    ...over,
});
const madeFrom = (over: Record<string, unknown> = {}) => ({
    madeFrom: { templateName: "Music companion", maker: { name: "Omar" }, version: 1, shared: true },
    setup: { needs: [APP_NEED], setupRequired: true, routinesOff: 0 },
    update: null,
    ...over,
});
const UPDATE = {
    version: 2,
    changes: [
        { field: "instructions", mine: "You are Beat.", theirs: "You are a music companion." },
        { field: "firstThing", mine: "Make a jingle", theirs: "Make a 30-second jingle" },
    ],
    needs: [],
};

// The same, as the game reads it
const READ_UPDATE: TemplateUpdate = {
    ...UPDATE,
    changes: UPDATE.changes.map((change) => ({ ...change, field: change.field as "instructions", routines: [] })),
};

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("Brick templates, the game half (#2008)", () => {
    let target: HTMLElement;
    let part: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        game.openBrickChat.mockResolvedValue(undefined);
        game.starTemplate.mockResolvedValue({ starred: true });
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        part?.$destroy();
        part = undefined;
        target.remove();
    });

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const click = async (id: string) => {
        byId(id)?.click();
        await settle();
    };

    describe("the look before creating", () => {
        async function open(props: Record<string, unknown> = {}) {
            part = new TemplateSheet({ target, props: { isOpen: true, templateId: "t1", ...props } });
            await settle();
        }

        it("shows what the new Brick starts with, what stays with the original and what it still needs", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            await open();
            expect(game.getTemplatePreview).toHaveBeenCalledWith("t1");
            expect(byId<HTMLInputElement>("templateName")?.value).toBe("Melody");
            expect(byId("templateStartsLook")).not.toBeNull();
            expect(byId("templateStartsFirst")?.textContent).toContain("Make a 30-second jingle for my shop");
            expect(byId("templateStartsRoutines")?.textContent).toContain("switched off");
            expect(byId("templateStays")).not.toBeNull();
            expect(byId("templateSetup")).not.toBeNull();
            expect(all("templateNeed").map((row) => row.textContent)).toEqual([expect.stringContaining("ACE-Step")]);
        });

        it("says nothing about setup when nothing is missing", async () => {
            game.getTemplatePreview.mockResolvedValue({
                template: template({ needs: [{ ...APP_NEED, ready: true }], setupRequired: false }),
            });
            await open();
            expect(byId("templateSetup")).toBeNull();
        });

        it("keeps the instructions behind a tap", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            await open();
            expect(byId("templateInstructions")).toBeNull();
            await click("templateReadInstructions");
            expect(byId("templateInstructions")?.textContent).toContain("You are Melody");
        });

        it("makes a NEW Brick with the typed name and opens its page when there is something to set up", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            game.makeFromTemplate.mockResolvedValue({
                brick: { id: "n1" },
                used: { view: { setup: { setupRequired: true } }, routinesAdded: 1, routinesLeftOut: 0 },
            });
            await open();
            const name = byId<HTMLInputElement>("templateName");
            if (name) {
                name.value = "Beat";
                name.dispatchEvent(new Event("input"));
            }
            await tick();
            await click("templateCreate");
            expect(game.makeFromTemplate).toHaveBeenCalledWith("t1", "Beat");
            expect(game.closeAllModals).toHaveBeenCalled();
            expect(game.openBrickPage).toHaveBeenCalledWith("n1");
            expect(game.openBrickChat).not.toHaveBeenCalled();
        });

        it("opens the chat when there is nothing to set up", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template({ needs: [], routines: [] }) });
            game.makeFromTemplate.mockResolvedValue({
                brick: { id: "n2" },
                used: { view: { setup: { setupRequired: false } }, routinesAdded: 0, routinesLeftOut: 0 },
            });
            await open();
            await click("templateCreate");
            expect(game.openBrickChat).toHaveBeenCalledWith("n2");
            expect(game.openBrickPage).not.toHaveBeenCalled();
        });

        it("says so, and keeps the sheet, when the Brick could not be made", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            game.makeFromTemplate.mockResolvedValue(undefined);
            await open();
            await click("templateCreate");
            expect(game.warn).toHaveBeenCalled();
            expect(game.closeAllModals).not.toHaveBeenCalled();
        });

        it("keeps a template for later with Star, and puts it back when Orbit refuses", async () => {
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            await open();
            await click("templateStar");
            expect(game.starTemplate).toHaveBeenCalledWith("t1", true);
            game.starTemplate.mockRejectedValue(new Error("offline"));
            await click("templateStar");
            expect(game.warn).toHaveBeenCalled();
        });

        it("says when the template is gone, and offers Try again when it could not be read", async () => {
            game.getTemplatePreview.mockRejectedValueOnce(Object.assign(new Error("nope"), { status: 404 }));
            await open();
            expect(byId("templateGone")).not.toBeNull();
            part?.$destroy();
            game.getTemplatePreview.mockRejectedValueOnce(new Error("offline"));
            await open();
            expect(byId("templateFailed")).not.toBeNull();
            game.getTemplatePreview.mockResolvedValue({ template: template() });
            await click("templateRetry");
            expect(byId("templateStartsLook")).not.toBeNull();
        });
    });

    describe("Start from a template", () => {
        it("lists Starred, Picks and Bricks you've met, and a row opens its look", async () => {
            game.getTemplateLists.mockResolvedValue({
                starred: [card("t1", "Music companion", "Omar", { starred: true })],
                picks: [card("t2", "Shop greeter", "Sara")],
                met: [card("t4", "Welcome Brick", "Sara")],
            });
            part = new TemplateList({ target, props: { isOpen: true } });
            await settle();
            expect(all("templateListSection")).toHaveLength(3);
            expect(all("templateRow")).toHaveLength(3);
            expect(text()).not.toMatch(/Popular|Trending/);
            all("templateRow")[1].click();
            expect(game.openModal).toHaveBeenCalledWith(TemplateSheet, { templateId: "t2" });
        });

        it("says when there is nothing yet, and when it could not be read", async () => {
            game.getTemplateLists.mockResolvedValueOnce({ starred: [], picks: [], met: [] });
            part = new TemplateList({ target, props: { isOpen: true } });
            await settle();
            expect(byId("templateListNone")).not.toBeNull();
            part.$destroy();
            game.getTemplateLists.mockRejectedValueOnce(new Error("offline"));
            part = new TemplateList({ target, props: { isOpen: true } });
            await settle();
            expect(byId("templateListFailed")).not.toBeNull();
        });
    });

    describe("the look before sharing", () => {
        const props = (over: Record<string, unknown> = {}) => ({
            isOpen: true,
            brickId: "b1",
            choices: NO_CHOICES,
            audience: null,
            shared: false,
            onShared: vi.fn(),
            ...over,
        });

        it("shows exactly what goes and shares it with the token it was shown", async () => {
            game.lookAtTemplate.mockResolvedValue({ look: look() });
            game.shareTemplate.mockResolvedValue({ template: maker({ shared: true, version: 1 }) });
            const given = props();
            part = new TemplateLookSheet({ target, props: given });
            await settle();
            expect(byId("templateLookName")).not.toBeNull();
            expect(byId("templateSecret")).toBeNull();
            await click("templateLookShare");
            expect(game.shareTemplate).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(game.shareTemplate.mock.calls[0])).toContain("tok");
            expect(given.onShared).toHaveBeenCalled();
            expect(game.closeModal).toHaveBeenCalled();
        });

        it("blocks Share while something that looks like a secret is in the Brick", async () => {
            game.lookAtTemplate.mockResolvedValue({
                look: look({
                    blocked: true,
                    findings: [{ kind: "secret", where: "instructions", what: "an AI or API key", sample: "sk-abc…" }],
                }),
            });
            part = new TemplateLookSheet({ target, props: props() });
            await settle();
            expect(byId("templateSecret")?.textContent).toContain("API key");
            expect(byId<HTMLButtonElement>("templateLookShare")?.disabled).toBe(true);
            await click("templateLookShare");
            expect(game.shareTemplate).not.toHaveBeenCalled();
        });

        it("reads the look again and says it changed when Orbit answers 409", async () => {
            game.lookAtTemplate.mockResolvedValue({ look: look() });
            game.shareTemplate.mockRejectedValue(Object.assign(new Error("changed"), { status: 409, code: "changed" }));
            part = new TemplateLookSheet({ target, props: props() });
            await settle();
            await click("templateLookShare");
            expect(byId("templateLookChanged")).not.toBeNull();
            expect(game.lookAtTemplate).toHaveBeenCalledTimes(2);
            expect(game.closeModal).not.toHaveBeenCalled();
        });

        it("says when the look could not be read", async () => {
            game.lookAtTemplate.mockRejectedValue(new Error("offline"));
            part = new TemplateLookSheet({ target, props: props() });
            await settle();
            expect(byId("templateLookFailed")).not.toBeNull();
        });
    });

    describe("the Template group on a Brick's page", () => {
        async function open() {
            part = new BrickTemplateGroup({
                target,
                props: { brickId: "b1", name: "Beat", open: true, onToggle: () => undefined },
            });
            await settle();
        }

        it("offers Share as a template when it is not shared, with what goes along as plain rows", async () => {
            game.getMakerTemplate.mockResolvedValue({
                template: maker({ latest: null, routineChoices: [] }),
            });
            game.lookAtTemplate.mockResolvedValue({ look: look() });
            await open();
            expect(byId("brickTemplate")).not.toBeNull();
            expect(byId("templateShare")).not.toBeNull();
            expect(byId("templateStop")).toBeNull();
        });

        it("shows how many Bricks were made from it, and Stop sharing", async () => {
            game.getMakerTemplate.mockResolvedValue({
                template: maker({ shared: true, version: 2, madeFrom: 14, audience: "everyone", latest: look() }),
            });
            game.stopSharingTemplate.mockResolvedValue({ template: maker({ stopped: true }) });
            await open();
            expect(byId("templateShared")?.textContent).toContain("14");
            expect(byId("templateShareLatest")).toBeNull();
            await click("templateStop");
            expect(game.stopSharingTemplate).toHaveBeenCalledWith("b1");
            expect(byId("templateShared")).toBeNull();
        });

        it("offers Share your latest changes only when there are some", async () => {
            game.getMakerTemplate.mockResolvedValue({
                template: maker({ shared: true, version: 2, madeFrom: 3, hasChanges: true, latest: look() }),
            });
            await open();
            expect(byId("templateShareLatest")).not.toBeNull();
        });

        it("does not say it needs nothing when what it needs could not be read, and reads it again on Try again", async () => {
            game.getMakerTemplate.mockResolvedValue({ template: maker() });
            game.lookAtTemplate.mockRejectedValueOnce(new Error("offline"));
            await open();
            expect(byId("templateNoNeeds")).toBeNull();
            expect(byId("templateNeedsFailed")).not.toBeNull();
            game.lookAtTemplate.mockResolvedValue({ look: look({ needs: [] }) });
            await click("templateNeedsRetry");
            expect(byId("templateNeedsFailed")).toBeNull();
            expect(byId("templateNoNeeds")).not.toBeNull();
        });

        it("reads the template again when the group opens, so Share your latest changes shows after an edit", async () => {
            game.getMakerTemplate.mockResolvedValueOnce({
                template: maker({ shared: true, version: 2, madeFrom: 3, hasChanges: false, latest: look() }),
            });
            game.lookAtTemplate.mockResolvedValue({ look: look() });
            part = new BrickTemplateGroup({
                target,
                props: { brickId: "b1", name: "Beat", open: false, onToggle: () => undefined },
            });
            await settle();
            expect(byId("templateShareLatest")).toBeNull();
            game.getMakerTemplate.mockResolvedValue({
                template: maker({ shared: true, version: 2, madeFrom: 3, hasChanges: true, latest: look() }),
            });
            (part as unknown as { $set: (props: Record<string, unknown>) => void }).$set({ open: true });
            await settle();
            expect(byId("templateShareLatest")).not.toBeNull();
        });
    });

    describe("the card at the top of a Brick made from a template", () => {
        const props = (over: Record<string, unknown> = {}) => ({
            brickId: "n1",
            name: "Beat",
            onOpenGroup: vi.fn(),
            onConnect: vi.fn(),
            ...over,
        });

        it("says Setup required with one Connect per missing app, and where it was made from", async () => {
            game.getMadeFrom.mockResolvedValue(madeFrom());
            const given = props();
            part = new BrickMadeFrom({ target, props: given });
            await settle();
            expect(byId("brickSetupRequired")).not.toBeNull();
            expect(byId("brickMadeFromLine")?.textContent).toContain("Music companion");
            expect(byId("brickMadeFromLine")?.textContent).toContain("Omar");
            await click("brickSetupConnect");
            expect(given.onConnect).toHaveBeenCalledWith("ACE-Step");
        });

        it("says nothing about setup once everything is connected, and says routines are switched off", async () => {
            game.getMadeFrom.mockResolvedValue(
                madeFrom({ setup: { needs: [{ ...APP_NEED, ready: true }], setupRequired: false, routinesOff: 2 } })
            );
            part = new BrickMadeFrom({ target, props: props() });
            await settle();
            expect(byId("brickSetupRequired")).toBeNull();
            expect(byId("brickRoutinesOff")).not.toBeNull();
        });

        it("shows nothing at all for a Brick that was not made from a template", async () => {
            game.getMadeFrom.mockRejectedValue(Object.assign(new Error("nope"), { status: 404 }));
            part = new BrickMadeFrom({ target, props: props() });
            await settle();
            expect(byId("brickMadeFrom")).toBeNull();
        });

        it("reads the setup again when the page says something changed, so a computer that was given stops being asked for", async () => {
            game.getMadeFrom.mockResolvedValueOnce(madeFrom());
            part = new BrickMadeFrom({ target, props: props({ refreshKey: "computer" }) });
            await settle();
            expect(byId("brickSetupRequired")).not.toBeNull();
            game.getMadeFrom.mockResolvedValue(
                madeFrom({ setup: { needs: [{ ...APP_NEED, ready: true }], setupRequired: false, routinesOff: 0 } })
            );
            (part as unknown as { $set: (props: Record<string, unknown>) => void }).$set({ refreshKey: undefined });
            await settle();
            expect(byId("brickSetupRequired")).toBeNull();
        });

        it("shows the newest read, never an older answer that comes back late", async () => {
            game.getMadeFrom.mockResolvedValueOnce(madeFrom());
            part = new BrickMadeFrom({ target, props: props({ refreshKey: "a" }) });
            await settle();
            expect(byId("brickSetupRequired")).not.toBeNull();
            // The page asks again, and that answer is slow
            let answerSlow: (value: unknown) => void = () => undefined;
            game.getMadeFrom.mockReturnValueOnce(
                new Promise((resolve) => {
                    answerSlow = resolve;
                })
            );
            const set = (part as unknown as { $set: (props: Record<string, unknown>) => void }).$set;
            set.call(part, { refreshKey: "b" });
            await settle();
            // It asks a third time, and that answer is quick: everything is connected
            game.getMadeFrom.mockResolvedValueOnce(
                madeFrom({ setup: { needs: [{ ...APP_NEED, ready: true }], setupRequired: false, routinesOff: 0 } })
            );
            set.call(part, { refreshKey: "c" });
            await settle();
            expect(byId("brickSetupRequired")).toBeNull();
            // The slow, older answer arrives last and must not bring Setup required back
            answerSlow(madeFrom());
            await settle();
            expect(byId("brickSetupRequired")).toBeNull();
        });

        it("reads again when the page changes before the first read came back, so an early answer is not kept", async () => {
            let answerFirst: (value: unknown) => void = () => undefined;
            game.getMadeFrom.mockReturnValueOnce(
                new Promise((resolve) => {
                    answerFirst = resolve;
                })
            );
            part = new BrickMadeFrom({ target, props: props({ refreshKey: "a" }) });
            await settle();
            // A computer was given while the first read was on its way: the second read says everything is connected
            game.getMadeFrom.mockResolvedValue(
                madeFrom({ setup: { needs: [{ ...APP_NEED, ready: true }], setupRequired: false, routinesOff: 0 } })
            );
            (part as unknown as { $set: (props: Record<string, unknown>) => void }).$set({ refreshKey: "b" });
            await settle();
            answerFirst(madeFrom());
            await settle();
            expect(game.getMadeFrom).toHaveBeenCalledTimes(2);
            expect(byId("brickMadeFrom")).not.toBeNull();
            expect(byId("brickSetupRequired")).toBeNull();
        });

        it("offers Review when the template was updated", async () => {
            game.getMadeFrom.mockResolvedValue(madeFrom({ update: UPDATE }));
            part = new BrickMadeFrom({ target, props: props() });
            await settle();
            expect(byId("brickTemplateUpdated")).not.toBeNull();
            await click("brickTemplateReview");
            expect(game.openModal).toHaveBeenCalledWith(
                TemplateUpdateSheet,
                expect.objectContaining({ brickId: "n1", makerName: "Omar" })
            );
        });
    });

    describe("Template updated", () => {
        const props = (over: Record<string, unknown> = {}) => ({
            isOpen: true,
            brickId: "n1",
            name: "Beat",
            makerName: "Omar",
            update: READ_UPDATE,
            onDone: vi.fn(),
            ...over,
        });

        it("starts with nothing picked, and Keep mine takes nothing", async () => {
            game.takeTemplateUpdate.mockResolvedValue(madeFrom());
            const given = props();
            part = new TemplateUpdateSheet({ target, props: given });
            await settle();
            expect(all("templateUpdateChange")).toHaveLength(2);
            expect(byId<HTMLButtonElement>("templateTake")?.disabled).toBe(true);
            await click("templateKeepMine");
            expect(game.takeTemplateUpdate).toHaveBeenCalledWith("n1", 2, []);
            expect(given.onDone).toHaveBeenCalled();
        });

        it("takes only what was picked", async () => {
            game.takeTemplateUpdate.mockResolvedValue(madeFrom());
            const given = props();
            part = new TemplateUpdateSheet({ target, props: given });
            await settle();
            all("templateUpdateChange")[1].click();
            await tick();
            await click("templateTake");
            expect(game.takeTemplateUpdate).toHaveBeenCalledWith("n1", 2, ["firstThing"]);
            expect(given.onDone).toHaveBeenCalledWith(expect.anything(), ["firstThing"]);
        });

        it("says the template changed again when Orbit answers 409, and keeps the sheet open", async () => {
            game.takeTemplateUpdate.mockRejectedValue(Object.assign(new Error("changed"), { status: 409 }));
            game.getMadeFrom.mockResolvedValue(madeFrom({ update: { ...UPDATE, version: 3 } }));
            part = new TemplateUpdateSheet({ target, props: props() });
            await settle();
            await click("templateKeepMine");
            expect(byId("templateUpdateAgain")).not.toBeNull();
            expect(game.closeModal).not.toHaveBeenCalled();
        });
    });
});
