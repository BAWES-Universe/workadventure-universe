// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import QuestProof from "./QuestProof.svelte";
import { createQuestProofController } from "./QuestProofController";

let component: QuestProof | undefined;
afterEach(() => {
    component?.$destroy();
    component = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
});
async function trackedProof() {
    vi.useFakeTimers();
    const controller = createQuestProofController();
    controller.send({ type: "accept", path: "meet" });
    component = new QuestProof({ target: document.body, props: { controller, showScenarios: false } });
    await tick();
    return controller;
}
describe("quest proof idle tracker", () => {
    it("collapses after sixty idle seconds and retains the objective in its accessible label", async () => {
        await trackedProof();
        const pill = document.querySelector<HTMLButtonElement>('[data-testid="quest-pill"]');
        expect(pill?.classList.contains("is-idle")).toBe(false);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(pill?.classList.contains("is-idle")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await tick();
        expect(pill?.classList.contains("is-idle")).toBe(true);
        expect(pill?.getAttribute("aria-label")).toContain("Say hello");
        pill?.click();
        await tick();
        expect(document.querySelector('[data-testid="quest-card"]')).not.toBeNull();
    });
    it("does not collapse a keyboard-focused tracker", async () => {
        await trackedProof();
        const pill = document.querySelector<HTMLButtonElement>('[data-testid="quest-pill"]');
        pill?.focus();
        await vi.advanceTimersByTimeAsync(60_000);
        await tick();
        expect(pill?.classList.contains("is-idle")).toBe(false);
    });
    it("renders the earned stamp after both messages in the actual practice flow", async () => {
        await trackedProof();
        const clickText = async (label: string) => {
            const button = Array.from(document.querySelectorAll("button")).find((button) =>
                button.textContent?.trim().startsWith(label)
            );
            expect(button, label).toBeDefined();
            button?.click();
            await tick();
            await tick();
        };
        document.querySelector<HTMLButtonElement>('[data-testid="quest-pill"]')?.click();
        await tick();
        await clickText("Say hello");
        await clickText("Send hello");
        expect(document.querySelector('[data-testid="quest-payoff"]')).toBeNull();
        await clickText("Play the reply");
        expect(document.querySelector('[data-testid="quest-payoff"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="quest-card"]')).toBeNull();
    });
    it("renders a deferred earned stamp only after the busy surface closes", async () => {
        const controller = await trackedProof();
        component?.$set({ suppressed: true });
        await tick();
        controller.send({ type: "message", direction: "sent", session: 1 });
        controller.send({ type: "message", direction: "received", session: 1 });
        await tick();
        await tick();
        expect(document.querySelector('[data-testid="quest-payoff"]')).toBeNull();
        component?.$set({ suppressed: false });
        await tick();
        await tick();
        expect(document.querySelector('[data-testid="quest-payoff"]')).not.toBeNull();
    });
    it("focuses the close control when another entry point opens the log", async () => {
        const controller = await trackedProof();
        controller.openLog();
        await tick();
        await tick();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Close quests");
    });
    it("lets key releases reach the game even when a proof button owns focus", async () => {
        await trackedProof();
        const released = vi.fn();
        window.addEventListener("keyup", released);
        try {
            document
                .querySelector<HTMLButtonElement>('[data-testid="quest-pill"]')
                ?.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));
            expect(released).toHaveBeenCalledOnce();
        } finally {
            window.removeEventListener("keyup", released);
        }
    });
    it("clears the idle timer on destroy", async () => {
        await trackedProof();
        component?.$destroy();
        component = undefined;
        expect(vi.getTimerCount()).toBe(0);
    });
});
