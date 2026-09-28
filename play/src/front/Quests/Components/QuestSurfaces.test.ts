import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { ComponentProps, ComponentType, SvelteComponent } from "svelte";
import { get, readable } from "svelte/store";

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => undefined },
}));
vi.mock("../../Phaser/Game/Say/SayManager", () => ({ popupJustClosed: vi.fn() }));
vi.mock("../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { popupJustClosed } from "../../Phaser/Game/Say/SayManager";
import { questInputFocusStore } from "../QuestInputFocusStore";
import type { QuestLogEntry } from "../QuestCopy";
import { EMPTY_QUEST_WORLD } from "../QuestWorld";
import { KEY_HOLD_MS } from "./questActions";
import QuestInvitation from "./QuestInvitation.svelte";
import QuestOptions from "./QuestOptions.svelte";
import QuestPill from "./QuestPill.svelte";
import QuestCard from "./QuestCard.svelte";
import QuestCelebration from "./QuestCelebration.svelte";
import QuestPanel from "./QuestPanel.svelte";

let component: SvelteComponent | undefined;

function mount<T extends SvelteComponent>(
    Component: ComponentType<T>,
    props: Record<string, unknown>
): { target: HTMLElement; instance: T } {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = new Component({ target, props: props as ComponentProps<T> });
    component = instance;
    return { target, instance };
}

function byTestId(target: HTMLElement, id: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function escape(element: Element | null) {
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

afterEach(() => {
    component?.$destroy();
    component = undefined;
    document.body.innerHTML = "";
});

describe("QuestInvitation", () => {
    it("offers the options first and a real decline; Escape does nothing", async () => {
        const { target, instance } = mount(QuestInvitation, { host: { kind: "none" }, eyebrow: "Lobby" });
        const events: string[] = [];
        instance.$on("showOptions", (event: CustomEvent<{ keyboard: boolean }>) =>
            events.push(`options:${event.detail.keyboard}`)
        );
        instance.$on("notNow", () => events.push("notNow"));

        const buttons = target.querySelectorAll("button");
        expect(buttons[0].dataset.testid).toBe("quest-show-options");
        expect(byTestId(target, "quest-invitation")?.getAttribute("role")).toBeNull();
        // Not a dialog: nothing inside takes focus by itself.
        expect(target.contains(document.activeElement)).toBe(false);

        byTestId(target, "quest-show-options")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        byTestId(target, "quest-show-options")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        byTestId(target, "quest-not-now")?.click();
        escape(byTestId(target, "quest-show-options"));
        await tick();
        expect(events).toEqual(["options:false", "options:true", "notNow"]);
    });
});

describe("quest controls and the game's keys", () => {
    afterEach(() => {
        vi.useRealTimers();
        questInputFocusStore.set(false);
    });

    it("a click or a tap leaves no focus on the control; a key press keeps it", () => {
        const { target } = mount(QuestInvitation, { host: { kind: "none" }, eyebrow: "Lobby" });
        const button = byTestId(target, "quest-not-now");
        button?.focus();
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(document.activeElement).not.toBe(button);

        button?.focus();
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        expect(document.activeElement).toBe(button);
    });

    it("Enter or Space on a control is not the game's: no Express, nothing activated, until the key is back up", () => {
        vi.useFakeTimers();
        const { target } = mount(QuestPill, { label: "Find the Courtyard", panelId: "quest-panel" });
        const pill = byTestId(target, "quest-pill");

        pill?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(popupJustClosed).toHaveBeenCalled();
        expect(get(questInputFocusStore)).toBe(true);
        pill?.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        // Still held while the game reads that keyup on its next frame.
        expect(get(questInputFocusStore)).toBe(true);
        vi.advanceTimersByTime(200);
        expect(get(questInputFocusStore)).toBe(false);

        // The press closed the surface, so its keyup lands elsewhere: the hold still ends.
        pill?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        expect(get(questInputFocusStore)).toBe(true);
        component?.$destroy();
        component = undefined;
        vi.advanceTimersByTime(KEY_HOLD_MS);
        expect(get(questInputFocusStore)).toBe(false);
    });
});

describe("QuestOptions", () => {
    const rows = [
        { path: "meet", title: "Meet someone", description: "Say hi", minutes: 2 },
        { path: "explore", title: "Explore this place", description: "Find the Courtyard.", minutes: 1 },
    ];

    it("lists only the rows it is given; a tap accepts, close and Escape go back", async () => {
        const { target, instance } = mount(QuestOptions, { host: { kind: "none" }, title: "What?", rows });
        const events: string[] = [];
        instance.$on("accept", (event: CustomEvent<string>) => events.push(`accept:${event.detail}`));
        instance.$on("close", () => events.push("close"));

        expect(byTestId(target, "quest-option-build")).toBeNull();
        const dialog = byTestId(target, "quest-options");
        expect(dialog?.getAttribute("role")).toBe("dialog");
        expect(dialog?.getAttribute("aria-modal")).toBe("false");
        // The close is first in focus order.
        expect(dialog?.querySelector("button")?.dataset.testid).toBe("quest-options-close");

        byTestId(target, "quest-option-explore")?.click();
        byTestId(target, "quest-options-close")?.click();
        escape(byTestId(target, "quest-option-meet"));
        await tick();
        expect(events).toEqual(["accept:explore", "close", "close"]);
    });

    it("stops the game reading movement keys only while keyboard focus is inside", () => {
        const { target } = mount(QuestOptions, { host: { kind: "none" }, title: "What?", rows });
        const close = byTestId(target, "quest-options-close");
        const focusVisible = vi.spyOn(Element.prototype, "matches");

        // A click or a tap focuses a button too, but must leave walking alone.
        focusVisible.mockReturnValue(false);
        close?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(questInputFocusStore)).toBe(false);

        // Keyboard focus: the game stops reading movement keys until focus leaves the surface.
        focusVisible.mockImplementation((selector: string) => selector === ":focus-visible");
        close?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(questInputFocusStore)).toBe(true);
        close?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
        expect(get(questInputFocusStore)).toBe(false);
        focusVisible.mockRestore();
    });
});

describe("QuestPill", () => {
    it("is a 44px button named by its objective and state, the handle of the panel", async () => {
        const { target, instance } = mount(QuestPill, {
            path: "explore",
            label: "Find the Courtyard",
            panelId: "quest-panel",
        });
        let toggled: { keyboard: boolean } | undefined;
        instance.$on("toggle", (event: CustomEvent<{ keyboard: boolean }>) => (toggled = event.detail));
        const pill = byTestId(target, "quest-pill");
        expect(pill?.tagName).toBe("BUTTON");
        expect(pill?.getAttribute("aria-expanded")).toBe("false");
        expect(pill?.getAttribute("aria-controls")).toBe("quest-panel");
        expect(pill?.textContent).toContain("Find the Courtyard");
        // The objective is real, visible text next to the icon: never an icon-only badge.
        const label = byTestId(target, "quest-pill-label");
        expect(label?.textContent).toBe("Find the Courtyard");
        expect(label?.classList.contains("sr-only")).toBe(false);
        expect(pill?.querySelector(".sr-only")).not.toBeNull();
        // No rosette, no empty ring: the chevron is the only end mark, and it is decoration.
        expect(pill?.querySelector("svg.quest-ring")).toBeNull();
        expect(byTestId(target, "quest-pill-chevron")?.getAttribute("aria-hidden")).toBe("true");
        pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        expect(toggled).toEqual({ keyboard: true });
        instance.$set({ open: true });
        await tick();
        expect(pill?.getAttribute("aria-expanded")).toBe("true");
        expect(pill?.classList.contains("quest-pill-open")).toBe(true);
    });

    it("wears the quest's own badge glyph next to the label, the lavender compass when nothing is on the map", async () => {
        const { target, instance } = mount(QuestPill, {
            path: "meet",
            label: "Say hello to someone",
            panelId: "quest-panel",
        });
        const glyph = byTestId(target, "quest-pill-glyph")?.querySelector("svg.quest-stamp");
        expect(glyph?.getAttribute("data-path")).toBe("meet");
        expect(glyph?.getAttribute("data-glyph-only")).toBe("true");
        expect(glyph?.getAttribute("aria-hidden")).toBe("true");
        expect(glyph?.querySelector(".ring")).toBeNull();
        expect(byTestId(target, "quest-pill-label")?.textContent).toBe("Say hello to someone");

        instance.$set({ path: null, label: "Quests", count: 2 });
        await tick();
        const compass = byTestId(target, "quest-pill-glyph")?.querySelector("svg.quest-stamp");
        expect(compass?.getAttribute("data-path")).toBe("explore");
        expect(compass?.getAttribute("style")).toContain("#c4b5fd");
        expect(byTestId(target, "quest-pill")?.querySelector(".u-count")?.textContent).toBe("2");
        instance.$set({ count: 0 });
        await tick();
        expect(byTestId(target, "quest-pill")?.querySelector(".u-count")).toBeNull();
    });

    it("runs a progress line along the bottom while walking, and pops the glyph once done", async () => {
        const { target, instance } = mount(QuestPill, {
            path: "explore",
            label: "Find the Courtyard",
            panelId: "quest-panel",
        });
        expect(byTestId(target, "quest-pill-progress")).toBeNull();
        instance.$set({ walking: true });
        await tick();
        expect(byTestId(target, "quest-pill-progress")?.getAttribute("aria-hidden")).toBe("true");
        instance.$set({ walking: false, done: true });
        await tick();
        expect(byTestId(target, "quest-pill-progress")).toBeNull();
        expect(byTestId(target, "quest-pill-glyph")?.classList.contains("quest-pill-pop")).toBe(true);
    });
});

describe("QuestCard", () => {
    const base = {
        id: "quest-card",
        host: { kind: "none" },
        eyebrow: "Lobby",
        title: "Find the Courtyard",
        body: "Walk to the Courtyard and step inside.",
    };

    it("has two real buttons: the walk as the primary, Choose another as glass; no links, no Show me", async () => {
        const { target, instance } = mount(QuestCard, { ...base, walkLabel: "Walk to the Courtyard" });
        const events: string[] = [];
        for (const name of ["close", "walk", "stopWalking", "chooseAnother"]) {
            instance.$on(name, () => events.push(name));
        }
        expect(byTestId(target, "quest-card")?.getAttribute("aria-labelledby")).toBe("quest-card-title");
        const walk = byTestId(target, "quest-walk");
        const choose = byTestId(target, "quest-choose-another");
        expect(walk?.tagName).toBe("BUTTON");
        expect(choose?.tagName).toBe("BUTTON");
        expect(walk?.classList.contains("u-cta")).toBe(true);
        expect(walk?.classList.contains("quest-btn")).toBe(true);
        expect(choose?.classList.contains("quest-ghost")).toBe(true);
        expect(target.querySelectorAll(".u-cta")).toHaveLength(1);
        expect(target.querySelector("a")).toBeNull();
        expect(byTestId(target, "quest-show-me")).toBeNull();
        expect(byTestId(target, "quest-switch")).toBeNull();
        expect(byTestId(target, "quest-set-aside")).toBeNull();
        walk?.click();
        choose?.click();
        byTestId(target, "quest-card-close")?.click();
        escape(choose);
        await tick();
        expect(events).toEqual(["walk", "chooseAnother", "close", "close"]);
    });

    it("reads Stop walking while walking, hides the walk without a place, keeps the description", async () => {
        const { target, instance } = mount(QuestCard, { ...base, walkLabel: "Walk", walking: false });
        const walk = byTestId(target, "quest-walk");
        walk?.focus();
        instance.$set({ walking: true });
        await tick();
        // The same button, so keyboard focus stays on it.
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-stop-walking")).toBe(walk);
        expect(document.activeElement).toBe(walk);

        instance.$set({ walkLabel: undefined, walking: false, whereDescription: "Courtyard is north of you" });
        await tick();
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-stop-walking")).toBeNull();
        // Focus was on it: it moves to Choose another, never to the page.
        expect(document.activeElement).toBe(byTestId(target, "quest-choose-another"));
        expect(byTestId(target, "quest-card")?.getAttribute("aria-describedby")).toBe(
            "quest-card-body quest-card-where"
        );
    });

    it("says when it is being read or used: focus inside, the pointer over it", () => {
        const { target, instance } = mount(QuestCard, { ...base, walkLabel: "Walk" });
        let engaged = 0;
        instance.$on("engage", () => engaged++);
        byTestId(target, "quest-walk")?.focus();
        expect(engaged).toBe(1);
        byTestId(target, "quest-card")?.dispatchEvent(new Event("pointerenter"));
        expect(engaged).toBe(2);
    });

    it("offers nothing to walk to once done (its celebration waiting), only Choose another", () => {
        const { target } = mount(QuestCard, { ...base, walkLabel: "Walk", done: true });
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-choose-another")).not.toBeNull();
    });

    it("offers the editor as the primary for Build, where there is nowhere to walk", async () => {
        const { target, instance } = mount(QuestCard, { ...base, editorLabel: "Open the map editor" });
        let opened = 0;
        instance.$on("openEditor", () => opened++);
        const editor = byTestId(target, "quest-open-editor");
        expect(editor?.classList.contains("u-cta")).toBe(true);
        editor?.click();
        expect(opened).toBe(1);
        instance.$set({ done: true });
        await tick();
        expect(byTestId(target, "quest-open-editor")).toBeNull();
    });
});

describe("QuestPanel", () => {
    const entry = (path: QuestLogEntry["path"], status: QuestLogEntry["status"]): QuestLogEntry => ({
        path,
        status,
        title: path,
        line: `${path} objective`,
        minutes: 1,
        giver: { kind: "bot", name: "Guide", portrait: "data:image/png;base64,AAAA" },
        origin: "Guide · Lobby",
        reward: "badge",
    });
    const base = { id: "quest-panel", world: EMPTY_QUEST_WORLD, doneCount: 1, total: 3, tracked: "explore" };

    it("groups rows In progress, Available, Done; one tap starts or puts on the map; done rows are ticked", async () => {
        const { target, instance } = mount(QuestPanel, {
            ...base,
            entries: [entry("build", "done"), entry("meet", "available"), entry("explore", "tracked")],
            trackedBody: "Walk to the Courtyard and step inside.",
            walkLabel: "Walk to the Courtyard",
        });
        const events: string[] = [];
        instance.$on("accept", (event: CustomEvent<string>) => events.push(`accept:${event.detail}`));
        instance.$on("track", (event: CustomEvent<string>) => events.push(`track:${event.detail}`));
        instance.$on("walk", () => events.push("walk"));
        const order = [...target.querySelectorAll("[data-testid^='quest-entry-']")].map((element) =>
            element.getAttribute("data-testid")
        );
        expect(order).toEqual(["quest-entry-explore", "quest-entry-meet", "quest-entry-build"]);
        // The giver's face on every open row; the one on the map says so and shows its sentence and walk.
        expect(
            byTestId(target, "quest-entry-explore")?.querySelector("[data-testid='quest-portrait'] img")
        ).not.toBeNull();
        expect(byTestId(target, "quest-on-map")).not.toBeNull();
        expect(byTestId(target, "quest-tracked-body")?.textContent).toBe("Walk to the Courtyard and step inside.");
        byTestId(target, "quest-panel-walk")?.click();
        // No Start, Follow or Following anywhere: the row itself is the control.
        expect(target.querySelector("[data-testid^='quest-log-start']")).toBeNull();
        expect(target.querySelector("[data-testid^='quest-log-follow']")).toBeNull();
        byTestId(target, "quest-row-meet")?.click();
        // Done: ticked, nothing to press.
        const done = byTestId(target, "quest-row-build");
        expect(done?.tagName).toBe("DIV");
        expect(done?.querySelector(".quest-check")).not.toBeNull();
        expect(byTestId(target, "quest-panel-progress")).not.toBeNull();
        expect(target.querySelectorAll(".quest-progress-seg.lit")).toHaveLength(1);
        expect(target.querySelector("a")).toBeNull();

        instance.$set({ entries: [entry("build", "accepted"), entry("explore", "tracked")] });
        await tick();
        byTestId(target, "quest-row-build")?.click();
        await tick();
        expect(events).toEqual(["walk", "accept:meet", "track:build"]);
    });

    it("keeps keyboard focus on a row that moves to another section", async () => {
        const { target, instance } = mount(QuestPanel, {
            ...base,
            tracked: null,
            entries: [entry("meet", "accepted")],
        });
        instance.$on("track", () => instance.$set({ tracked: "meet", entries: [entry("meet", "tracked")] }));
        const row = byTestId(target, "quest-row-meet");
        row?.focus();
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        await tick();
        expect(document.activeElement).toBe(byTestId(target, "quest-row-meet"));
    });

    it("closes on its close and Escape; says when everything is done", async () => {
        const { target, instance } = mount(QuestPanel, { ...base, doneCount: 3, entries: [] });
        let closes = 0;
        instance.$on("close", () => closes++);
        byTestId(target, "quest-panel-close")?.click();
        escape(byTestId(target, "quest-panel-close"));
        await tick();
        expect(closes).toBe(2);
        expect(byTestId(target, "quest-panel-all-done")).not.toBeNull();
        expect(byTestId(target, "quest-panel")?.getAttribute("role")).toBe("dialog");
    });
});

describe("QuestCelebration", () => {
    it("shows the badge and the giver's line for a quest, three badges for the chapter, and skips on a tap", async () => {
        const { target, instance } = mount(QuestCelebration, {
            kind: "quest",
            path: "meet",
            eyebrow: "Guide",
            line: "Good to meet you.",
            badgeLine: "First Hello badge earned",
            stampLabel: "First Hello badge",
        });
        let skips = 0;
        instance.$on("skip", () => skips++);
        const card = byTestId(target, "quest-celebration");
        expect(card?.tagName).toBe("BUTTON");
        expect(card?.querySelector("svg.quest-stamp")?.getAttribute("data-path")).toBe("meet");
        expect(card?.textContent).toContain("Good to meet you.");
        expect(byTestId(target, "quest-celebration-badge")?.textContent).toBe("First Hello badge earned");
        card?.click();
        escape(card);
        await tick();
        expect(skips).toBe(2);

        instance.$set({
            kind: "chapter",
            path: null,
            line: "All done.",
            badgeLine: "First Hello · Explorer · Builder",
        });
        await tick();
        expect(card?.querySelectorAll("svg.quest-stamp")).toHaveLength(3);
        expect(card?.getAttribute("data-kind")).toBe("chapter");
    });
});
