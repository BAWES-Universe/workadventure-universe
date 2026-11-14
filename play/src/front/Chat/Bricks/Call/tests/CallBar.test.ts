import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run Svelte's server build, where onMount does nothing; the real BotMoodEmoji draws on mount
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

// The real Woka picture needs a running game scene; a stub shows who it was asked for
vi.mock("../../../../Components/Woka/WokaFromUserId.svelte", async () => ({
    default: (await import("./WokaStub.svelte")).default,
}));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import { callReducer, startCall, type CallEvent, type CallState } from "../CallSession";
import CallBar from "../CallBar.svelte";
import CallButton from "../CallButton.svelte";
import WalkUpCard from "../WalkUpCard.svelte";

const T0 = 1_000_000;
const run = (state: CallState, ...events: CallEvent[]) => events.reduce(callReducer, state);
const live = (): CallState => run(startCall(T0), { type: "connected", now: T0 });

describe("the call bar, the call button and the walk-up card (game #2004, mock Part 18)", () => {
    let target: HTMLElement;
    let view: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        view?.$destroy();
        view = undefined;
        target.remove();
    });

    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const button = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

    async function bar(state: CallState, extra: Record<string, unknown> = {}) {
        view = new CallBar({ target, props: { state, botName: "Brick", now: T0 + 372_000, ...extra } });
        await tick();
    }

    it("shows the call with the bot, its time and that it is listening (picture 2)", async () => {
        await bar(live());
        expect(byId("call-title")?.textContent).toBe("Call with Brick · 6:12");
        expect(byId("call-line")?.textContent?.trim()).toBe("Listening");
        expect(button("Microphone")).not.toBeNull();
        expect(button("End call")).not.toBeNull();
        expect(text()).not.toContain("Resume call");
    });

    it("says when the bot speaks and offers Stop speaking only then", async () => {
        await bar(run(live(), { type: "bot-speaking", speaking: true, now: T0 }));
        expect(byId("call-line")?.textContent?.trim()).toBe("Brick is speaking");
        expect(button("Stop speaking")).not.toBeNull();
    });

    it("says what the bot is doing while it works, and that it waits for the person's OK", async () => {
        await bar(run(live(), { type: "bot-working", work: "search", line: "Looking at flights", now: T0 }));
        expect(byId("call-line")?.textContent?.trim()).toBe("Looking at flights");
        view?.$destroy();
        view = undefined;
        target.innerHTML = "";
        await bar(run(live(), { type: "bot-waiting", waiting: true, now: T0 }));
        expect(byId("call-line")?.textContent?.trim()).toBe("Waiting for your OK on the screen");
        expect(byId("call-bar")?.classList.contains("wait")).toBe(true);
    });

    it("on hold for a meeting says so and has Resume call, with no microphone (picture 5)", async () => {
        await bar(run(live(), { type: "meeting-joined" }));
        expect(byId("call-title")?.textContent).toBe("On hold · 6:12");
        expect(byId("call-line")?.textContent?.trim()).toBe("You joined a meeting");
        expect(text()).toContain("Resume call");
        expect(button("Microphone")).toBeNull();
        expect(byId("call-bar")?.classList.contains("hold")).toBe(true);
    });

    it("on hold for a person says who the person is talking with", async () => {
        await bar(run(live(), { type: "someone-here", id: "u1", name: "Sara" }, { type: "hold-and-talk" }));
        expect(byId("call-line")?.textContent?.trim()).toBe("Talking with Sara");
    });

    it("its buttons call what they are for, and Resume is the only way back", async () => {
        const onResume = vi.fn();
        const onEnd = vi.fn();
        const onMute = vi.fn();
        await bar(live(), { onEnd, onMute, onResume });
        button("End call")?.click();
        button("Microphone")?.click();
        expect(onEnd).toHaveBeenCalledOnce();
        expect(onMute).toHaveBeenCalledOnce();
        expect(onResume).not.toHaveBeenCalled();
    });

    it("the bar can float over another chat, or the closed chat, and tapping it opens the call's chat", async () => {
        const onOpen = vi.fn();
        await bar(live(), { floating: true, onOpen });
        expect(byId("call-bar-wrap")?.classList.contains("floating")).toBe(true);
        target.querySelector<HTMLButtonElement>(".call-open")?.click();
        expect(onOpen).toHaveBeenCalledOnce();
    });

    it("the call button asks for a call, and says nothing about distance or who is nearest", async () => {
        const onCall = vi.fn();
        view = new CallButton({ target, props: { onCall } });
        await tick();
        button("Call")?.click();
        expect(onCall).toHaveBeenCalledOnce();
        expect(text().toLowerCase()).not.toMatch(/nearest|closest|distance/);
    });

    it("the walk-up card says who walked up and names who each button is for, each on its own action (picture 10)", async () => {
        const onHoldAndTalk = vi.fn();
        const onNotNow = vi.fn();
        view = new WalkUpCard({ target, props: { name: "Sara", botName: "Brick", onHoldAndTalk, onNotNow } });
        await tick();
        expect(text()).toContain("Sara walked up");
        expect(text()).toContain("Your call with Brick goes on hold until you tap Resume call.");
        const buttons = [...target.querySelectorAll<HTMLButtonElement>("button")];
        expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Stay with Brick", "Talk to Sara"]);
        buttons[0].click();
        expect(onNotNow).toHaveBeenCalledOnce();
        expect(onHoldAndTalk).not.toHaveBeenCalled();
        buttons[1].click();
        expect(onHoldAndTalk).toHaveBeenCalledOnce();
    });

    it("the walk-up card shows the person's own Woka, like the follow request card, and a plain initial only when there is none", async () => {
        view = new WalkUpCard({
            target,
            props: { name: "Sara", wokaId: "sara-uuid", botName: "Brick", onHoldAndTalk: vi.fn(), onNotNow: vi.fn() },
        });
        await tick();
        expect(byId("woka-stub")?.getAttribute("data-user-id")).toBe("sara-uuid");
        expect(byId("follow-woka-initial")).toBeNull();
        view.$destroy();
        // The scene cannot find her Woka (a reconnect, a scene change): her initial fills the frame, not an empty ring
        view = new WalkUpCard({
            target,
            props: { name: "Sara", wokaId: "missing", botName: "Brick", onHoldAndTalk: vi.fn(), onNotNow: vi.fn() },
        });
        await tick();
        expect(byId("follow-woka-initial")?.textContent?.trim()).toBe("S");
        view.$destroy();
        view = new WalkUpCard({
            target,
            props: { name: "Sara", botName: "Brick", onHoldAndTalk: vi.fn(), onNotNow: vi.fn() },
        });
        await tick();
        expect(byId("woka-stub")).toBeNull();
        expect(text()).toContain("S");
    });
});
