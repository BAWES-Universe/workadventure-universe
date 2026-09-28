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
import QuestPill from "./QuestPill.svelte";
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

describe("QuestPanel", () => {
    const entry = (path: QuestLogEntry["path"], status: QuestLogEntry["status"]): QuestLogEntry => ({
        path,
        status,
        title: path,
        line: `${path} objective`,
        description: `${path} description`,
        objective: `${path} objective`,
        body: `${path} body`,
        minutes: 1,
        giver: { kind: "bot", name: "Guide", portrait: "data:image/png;base64,AAAA" },
        origin: "Guide · Lobby",
        reward: "badge",
    });
    const base = { id: "quest-panel", world: EMPTY_QUEST_WORLD, doneCount: 1, total: 3, tracked: "explore" };
    const click = (element: Element | null | undefined) => (element as HTMLElement | null | undefined)?.click();

    it("lists In progress, Available, Done; a row opens that quest's details, Back returns to the list", async () => {
        const { target } = mount(QuestPanel, {
            ...base,
            entries: [entry("build", "done"), entry("meet", "available"), entry("explore", "tracked")],
        });
        const order = [...target.querySelectorAll("[data-testid^='quest-entry-']")].map((element) =>
            element.getAttribute("data-testid")
        );
        expect(order).toEqual(["quest-entry-explore", "quest-entry-meet", "quest-entry-build"]);
        // Every row is a button that opens details; none starts anything by itself.
        expect(byTestId(target, "quest-row-meet")?.tagName).toBe("BUTTON");
        expect(byTestId(target, "quest-row-build")?.querySelector(".quest-check")).not.toBeNull();
        expect(byTestId(target, "quest-row-reward-meet")).not.toBeNull();
        expect(target.querySelectorAll(".quest-progress-seg.lit")).toHaveLength(1);

        click(byTestId(target, "quest-row-meet"));
        await tick();
        expect(byTestId(target, "quest-detail-meet")).not.toBeNull();
        expect(byTestId(target, "quest-detail-description")?.textContent).toContain("meet description");
        expect(byTestId(target, "quest-detail-body")?.textContent).toContain("meet body");
        expect(byTestId(target, "quest-entry-explore")).toBeNull();
        click(byTestId(target, "quest-detail-back"));
        await tick();
        expect(byTestId(target, "quest-detail-meet")).toBeNull();
        expect(byTestId(target, "quest-entry-explore")).not.toBeNull();
    });

    it("an available quest: Accept, or Decline back to the list", async () => {
        const { target, instance } = mount(QuestPanel, {
            ...base,
            tracked: null,
            entries: [entry("meet", "available")],
        });
        const events: string[] = [];
        instance.$on("accept", (event: CustomEvent<string>) => events.push(`accept:${event.detail}`));
        click(byTestId(target, "quest-row-meet"));
        await tick();
        expect(byTestId(target, "quest-detail-abandon")).toBeNull();
        // Before accepting, the objective is just a line: no box to tick, no count, no map note.
        expect(target.querySelector(".quest-objective-box")).toBeNull();
        expect(byTestId(target, "quest-objective-count")).toBeNull();
        expect(byTestId(target, "quest-on-map")).toBeNull();
        click(byTestId(target, "quest-detail-decline"));
        await tick();
        expect(byTestId(target, "quest-detail-meet")).toBeNull();
        expect(events).toEqual([]);
        click(byTestId(target, "quest-row-meet"));
        await tick();
        click(byTestId(target, "quest-detail-accept"));
        expect(events).toEqual(["accept:meet"]);
    });

    it("the quest on the map: walk (or the editor) and Abandon, confirmed; another accepted one: Show on map", async () => {
        const { target, instance } = mount(QuestPanel, {
            ...base,
            entries: [entry("explore", "tracked"), entry("build", "accepted")],
            walkLabel: "Walk to the Courtyard",
            whereText: "Courtyard is north of you",
        });
        const events: string[] = [];
        for (const name of ["walk", "track", "abandon"]) {
            instance.$on(name, (event: CustomEvent<string | null>) => events.push(`${name}:${event.detail ?? ""}`));
        }
        click(byTestId(target, "quest-row-explore"));
        await tick();
        expect(byTestId(target, "quest-on-map")).not.toBeNull();
        expect(byTestId(target, "quest-objective-count")?.textContent).toBe("0/1");
        expect(byTestId(target, "quest-detail-explore")?.textContent).toContain("Courtyard is north of you");
        click(byTestId(target, "quest-detail-walk"));
        click(byTestId(target, "quest-detail-abandon"));
        await tick();
        // Abandon asks first; Keep it goes back.
        expect(byTestId(target, "quest-detail-walk")).toBeNull();
        click(byTestId(target, "quest-detail-keep"));
        await tick();
        click(byTestId(target, "quest-detail-abandon"));
        await tick();
        click(byTestId(target, "quest-detail-abandon-confirm"));
        await tick();
        expect(byTestId(target, "quest-detail-explore")).toBeNull();

        click(byTestId(target, "quest-row-build"));
        await tick();
        click(byTestId(target, "quest-detail-track"));
        expect(events).toEqual(["walk:", "abandon:explore", "track:build"]);
    });

    it("a done quest shows how it ended and nothing to press", async () => {
        const { target } = mount(QuestPanel, { ...base, entries: [entry("build", "done")] });
        click(byTestId(target, "quest-row-build"));
        await tick();
        expect(byTestId(target, "quest-detail-build")).not.toBeNull();
        expect(byTestId(target, "quest-detail-actions")).toBeNull();
    });

    it("keyboard: details focus Back, Back focuses the row it came from", async () => {
        const { target } = mount(QuestPanel, { ...base, tracked: null, entries: [entry("meet", "available")] });
        const row = byTestId(target, "quest-row-meet");
        row?.focus();
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        await tick();
        expect(document.activeElement).toBe(byTestId(target, "quest-detail-back"));
        byTestId(target, "quest-detail-back")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        await tick();
        expect(document.activeElement).toBe(byTestId(target, "quest-row-meet"));
    });

    it("stops the game reading movement keys only while keyboard focus is inside", () => {
        const { target } = mount(QuestPanel, { ...base, entries: [] });
        const close = target.querySelector(
            "[data-testid='quest-panel-close'] button, [data-testid='quest-panel-close']"
        );
        const focusVisible = vi.spyOn(Element.prototype, "matches");
        focusVisible.mockReturnValue(false);
        close?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(questInputFocusStore)).toBe(false);
        focusVisible.mockImplementation((selector: string) => selector === ":focus-visible");
        close?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(questInputFocusStore)).toBe(true);
        close?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
        expect(get(questInputFocusStore)).toBe(false);
        focusVisible.mockRestore();
    });

    it("closes on its close; Escape goes back from details, then closes; says when everything is done", async () => {
        const { target, instance } = mount(QuestPanel, { ...base, doneCount: 3, entries: [entry("meet", "done")] });
        let closes = 0;
        instance.$on("close", () => closes++);
        click(byTestId(target, "quest-row-meet"));
        await tick();
        escape(byTestId(target, "quest-detail-back"));
        await tick();
        expect(byTestId(target, "quest-detail-meet")).toBeNull();
        expect(closes).toBe(0);
        escape(byTestId(target, "quest-row-meet"));
        click(byTestId(target, "quest-panel-close"));
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
