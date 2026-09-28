import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { ComponentProps, ComponentType, SvelteComponent } from "svelte";
import { get, readable } from "svelte/store";

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => undefined },
}));
vi.mock("../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { questInputFocusStore } from "../QuestInputFocusStore";
import type { QuestLogEntry } from "../QuestCopy";
import QuestInvitation from "./QuestInvitation.svelte";
import QuestOptions from "./QuestOptions.svelte";
import QuestPill from "./QuestPill.svelte";
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
    it("offers the options first and a real decline, and Escape only hides it", async () => {
        const { target, instance } = mount(QuestInvitation, { host: { kind: "none" }, eyebrow: "Lobby" });
        const events: string[] = [];
        instance.$on("showOptions", (event: CustomEvent<{ keyboard: boolean }>) =>
            events.push(`options:${event.detail.keyboard}`)
        );
        instance.$on("notNow", () => events.push("notNow"));
        instance.$on("dismiss", () => events.push("dismiss"));

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
        expect(events).toEqual(["options:false", "options:true", "notNow", "dismiss"]);
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
        expect(pill?.querySelector(".sr-only")).not.toBeNull();
        expect(pill?.querySelector("svg.quest-ring")?.getAttribute("aria-hidden")).toBe("true");
        pill?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await tick();
        expect(opened).toEqual({ keyboard: true });
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

    it("has one primary Show me and a quiet row: walk, switch, set aside", async () => {
        const { target, instance } = mount(QuestCard, { ...base, walkLabel: "Walk to the Courtyard" });
        const events: string[] = [];
        for (const name of ["close", "showMe", "walk", "stopWalking", "switch", "setAside"]) {
            instance.$on(name, () => events.push(name));
        }
        expect(target.querySelectorAll(".u-cta")).toHaveLength(1);
        expect(byTestId(target, "quest-card")?.getAttribute("aria-labelledby")).toBe("quest-card-title");
        byTestId(target, "quest-show-me")?.click();
        byTestId(target, "quest-walk")?.click();
        byTestId(target, "quest-switch")?.click();
        byTestId(target, "quest-set-aside")?.click();
        byTestId(target, "quest-card-close")?.click();
        escape(byTestId(target, "quest-switch"));
        await tick();
        expect(events).toEqual(["showMe", "walk", "switch", "setAside", "close", "close"]);
    });

    it("reads Stop walking while walking, hides the walk without a place, keeps the description", async () => {
        const { target, instance } = mount(QuestCard, { ...base, walkLabel: "Walk", walking: true });
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-stop-walking")).not.toBeNull();

        instance.$set({ walkLabel: undefined, walking: false, showMeDescription: "Courtyard is north of you" });
        await tick();
        expect(byTestId(target, "quest-walk")).toBeNull();
        expect(byTestId(target, "quest-stop-walking")).toBeNull();
        expect(byTestId(target, "quest-card")?.getAttribute("aria-describedby")).toBe(
            "quest-card-body quest-card-where"
        );
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

    it("groups entries Tracked, Accepted, Available, Done and expands the tracked one", async () => {
        const { target } = mount(QuestLog, {
            entries: [entry("build", "done"), entry("meet", "available"), entry("explore", "tracked")],
            hidden: false,
        });
        const order = [...target.querySelectorAll("[data-testid^='quest-log-']")]
            .map((element) => element.getAttribute("data-testid"))
            .filter((id) => id === "quest-log-meet" || id === "quest-log-explore" || id === "quest-log-build");
        expect(order).toEqual(["quest-log-explore", "quest-log-meet", "quest-log-build"]);
        expect(byTestId(target, "quest-log-set-aside")).not.toBeNull();
        expect(byTestId(target, "quest-log-accept-meet")).toBeNull();
        byTestId(target, "quest-log-meet")?.querySelector("button")?.click();
        await tick();
        expect(byTestId(target, "quest-log-accept-meet")).not.toBeNull();
        expect(byTestId(target, "quest-log-set-aside")).toBeNull();
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

    it("hides and shows quests, and switches the card width (dev)", async () => {
        const { target, instance } = mount(QuestLog, { entries: [], hidden: true, showWidthSwitch: true });
        const events: string[] = [];
        instance.$on("setHidden", (event: CustomEvent<boolean>) => events.push(`hidden:${event.detail}`));
        instance.$on("setWidth", (event: CustomEvent<string>) => events.push(`width:${event.detail}`));
        byTestId(target, "quest-log-hide")?.click();
        byTestId(target, "quest-width-full")?.click();
        await tick();
        expect(events).toEqual(["hidden:false", "width:full"]);
        expect(byTestId(target, "quest-width-narrow")?.getAttribute("aria-pressed")).toBe("true");
    });
});
