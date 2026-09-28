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
import { KEY_HOLD_MS } from "./questActions";
import QuestInvitation from "./QuestInvitation.svelte";
import QuestOptions from "./QuestOptions.svelte";
import QuestPill from "./QuestPill.svelte";
import QuestsPill from "./QuestsPill.svelte";
import QuestCard from "./QuestCard.svelte";
import QuestLog from "./QuestLog.svelte";

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
        const { target } = mount(QuestPill, { label: "Find the Courtyard", cardId: "quest-card" });
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
    it("is a 44px button named by its objective and state, opening the card", async () => {
        const { target, instance } = mount(QuestPill, { label: "Find the Courtyard", cardId: "quest-card" });
        let opened: { keyboard: boolean } | undefined;
        instance.$on("open", (event: CustomEvent<{ keyboard: boolean }>) => (opened = event.detail));
        const pill = byTestId(target, "quest-pill");
        expect(pill?.tagName).toBe("BUTTON");
        expect(pill?.getAttribute("aria-expanded")).toBe("false");
        expect(pill?.getAttribute("aria-controls")).toBe("quest-card");
        expect(pill?.textContent).toContain("Find the Courtyard");
        // The objective is real, visible text next to the icon: never an icon-only badge.
        const label = byTestId(target, "quest-pill-label");
        expect(label?.textContent).toBe("Find the Courtyard");
        expect(label?.classList.contains("sr-only")).toBe(false);
        expect(label?.classList.contains("quest-pill-label")).toBe(true);
        expect(pill?.querySelector(".sr-only")).not.toBeNull();
        expect(pill?.querySelector("svg.quest-ring")?.getAttribute("aria-hidden")).toBe("true");
        pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        expect(opened).toEqual({ keyboard: true });
    });
});

describe("QuestsPill", () => {
    it("is a 44px button that opens the log, counting what there is to do", async () => {
        const { target, instance } = mount(QuestsPill, { count: 2 });
        let opened: { keyboard: boolean } | undefined;
        instance.$on("open", (event: CustomEvent<{ keyboard: boolean }>) => (opened = event.detail));
        const pill = byTestId(target, "quests-pill");
        expect(pill?.tagName).toBe("BUTTON");
        expect(pill?.classList.contains("quest-pill")).toBe(true);
        expect(pill?.querySelector(".u-count")?.textContent).toBe("2");
        pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        await tick();
        expect(opened).toEqual({ keyboard: false });

        instance.$set({ count: 0 });
        await tick();
        expect(pill?.querySelector(".u-count")).toBeNull();
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

    it("offers nothing to walk to once done (its payoff waiting), only Choose another", () => {
        const { target } = mount(QuestCard, { ...base, walkLabel: "Walk", done: true });
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-choose-another")).not.toBeNull();
    });
});

describe("QuestLog", () => {
    const entry = (path: QuestLogEntry["path"], status: QuestLogEntry["status"]): QuestLogEntry => ({
        path,
        status,
        title: path,
        description: `${path} description`,
        minutes: 1,
        origin: "Here · Lobby",
        reward: "badge",
    });

    it("groups entries Following, Accepted, Available, Done; Start, Follow and a still Following pill", async () => {
        const { target, instance } = mount(QuestLog, {
            entries: [entry("build", "done"), entry("meet", "available"), entry("explore", "tracked")],
            hidden: false,
        });
        const events: string[] = [];
        instance.$on("accept", (event: CustomEvent<string>) => events.push(`accept:${event.detail}`));
        instance.$on("track", (event: CustomEvent<string>) => events.push(`track:${event.detail}`));
        const order = [...target.querySelectorAll("[data-testid^='quest-log-']")]
            .map((element) => element.getAttribute("data-testid"))
            .filter((id) => id === "quest-log-meet" || id === "quest-log-explore" || id === "quest-log-build");
        expect(order).toEqual(["quest-log-explore", "quest-log-meet", "quest-log-build"]);
        // The followed entry is open: nothing to press, no untrack anywhere.
        const following = byTestId(target, "quest-log-following");
        expect(following?.tagName).toBe("SPAN");
        expect(following?.classList.contains("quest-btn")).toBe(true);
        expect(byTestId(target, "quest-log-set-aside")).toBeNull();
        expect(byTestId(target, "quest-log-remove-explore")).toBeNull();
        expect(byTestId(target, "quest-log-start-meet")).toBeNull();

        byTestId(target, "quest-log-meet")?.querySelector("button")?.click();
        await tick();
        const start = byTestId(target, "quest-log-start-meet");
        expect(start?.tagName).toBe("BUTTON");
        expect(start?.classList.contains("u-cta")).toBe(true);
        expect(byTestId(target, "quest-log-following")).toBeNull();
        start?.click();

        instance.$set({ entries: [entry("build", "accepted"), entry("explore", "tracked")] });
        await tick();
        byTestId(target, "quest-log-build")?.querySelector("button")?.click();
        await tick();
        byTestId(target, "quest-log-follow-build")?.click();
        // Done: the badge, nothing to press.
        instance.$set({ entries: [entry("build", "done")] });
        await tick();
        byTestId(target, "quest-log-build")?.querySelector("button")?.click();
        await tick();
        expect(byTestId(target, "quest-log-build")?.querySelectorAll(".quest-btn")).toHaveLength(0);
        expect(target.querySelector("a")).toBeNull();
        expect(events).toEqual(["accept:meet", "track:build"]);
    });

    it("keeps keyboard focus on an entry that moves to another section", async () => {
        const { target, instance } = mount(QuestLog, { entries: [entry("meet", "accepted")], hidden: false });
        instance.$on("track", () => instance.$set({ entries: [entry("meet", "tracked")] }));
        byTestId(target, "quest-log-meet")?.querySelector("button")?.click();
        await tick();
        const follow = byTestId(target, "quest-log-follow-meet");
        follow?.focus();
        follow?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        await tick();
        expect(document.activeElement).toBe(byTestId(target, "quest-log-meet")?.querySelector(".quest-row"));
    });

    it("has a tap-to-close backdrop on phones only, kept above the panel", () => {
        const { target } = mount(QuestLog, { entries: [], hidden: false });
        const backdrop = byTestId(target, "quest-log-backdrop");
        expect(backdrop?.classList.contains("md:hidden")).toBe(true);
        expect(backdrop?.classList.contains("inset-0")).toBe(false);
        expect(backdrop?.style.bottom).toMatch(/px$/);
    });

    it("closes on its close, Escape, and one tap on the map above it; the tap goes no further", async () => {
        const { target, instance } = mount(QuestLog, { entries: [], hidden: false });
        let closes = 0;
        instance.$on("close", () => closes++);
        expect(target.textContent).toContain("x");
        byTestId(target, "quest-log-close")?.click();
        escape(byTestId(target, "quest-log-hide"));
        const tap = new MouseEvent("click", { bubbles: true, cancelable: true });
        byTestId(target, "quest-log-backdrop")?.dispatchEvent(tap);
        await tick();
        expect(closes).toBe(3);
        expect(tap.defaultPrevented).toBe(true);
    });

    it("has one toggle for the quest bar, and the card width switch (dev) as buttons", async () => {
        const { target, instance } = mount(QuestLog, { entries: [], hidden: true, showWidthSwitch: true });
        const events: string[] = [];
        instance.$on("setHidden", (event: CustomEvent<boolean>) => events.push(`hidden:${event.detail}`));
        instance.$on("setWidth", (event: CustomEvent<string>) => events.push(`width:${event.detail}`));
        const toggle = byTestId(target, "quest-log-hide");
        expect(toggle?.tagName).toBe("BUTTON");
        expect(toggle?.classList.contains("quest-btn")).toBe(true);
        toggle?.click();
        byTestId(target, "quest-width-full")?.click();
        await tick();
        expect(events).toEqual(["hidden:false", "width:full"]);
        expect(byTestId(target, "quest-width-narrow")?.getAttribute("aria-pressed")).toBe("true");
        instance.$set({ dockWidth: "full" });
        await tick();
        expect(byTestId(target, "quest-width-full")?.getAttribute("aria-pressed")).toBe("true");
        expect(byTestId(target, "quest-log")?.classList.contains("quest-log-full")).toBe(true);
    });
});
