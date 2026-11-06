import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({ api: { sayBotHello: vi.fn() } }));
vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { stopSample } from "../voicePlayer";
import VoiceHello from "./page/VoiceHello.svelte";

/** A player that plays until the test says it is over (or broken). */
class FakeAudio {
    static last: FakeAudio | undefined;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = false;
    constructor(readonly src: string) {
        FakeAudio.last = this;
    }
    play() {
        return Promise.resolve();
    }
    pause() {
        this.paused = true;
    }
}

const settle = async () => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
};

/** The error the bot server's answer becomes in the game (BotApiService.fetchBotServer). */
const refused = (status: number, body: Record<string, unknown>) =>
    Object.assign(new Error(String(body.error)), { status, body });

describe("Hear <bot> say hello (#1852)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;
    const revoked: string[] = [];

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("Audio", FakeAudio);
        revoked.length = 0;
        // jsdom has no object URLs: the page's own are blob: addresses it hands back to be let go
        URL.revokeObjectURL = (url: string) => void revoked.push(url);
        FakeAudio.last = undefined;
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        stopSample();
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const button = () => target.querySelector<HTMLButtonElement>("[data-testid=bot-voice-hello]")!;
    const click = async () => {
        button().click();
        await settle();
    };

    async function mount(props: Partial<{ paidByKey: string | null; locale: string }> = {}) {
        const refresh = vi.fn();
        const component = new VoiceHello({
            target,
            props: { botId: "b1", botName: "Hala", paidByKey: null, locale: "en-US", ...props },
        });
        component.$on("refresh", refresh);
        destroy = () => component.$destroy();
        await settle();
        return refresh;
    }

    it("is one row that says what it does and what it costs: a voice reply on Universe AI", async () => {
        await mount();
        expect(text()).toBe(
            "Hear Hala say hello Hala answers in its own words, with this voice and style. Uses 1 of your voice replies."
        );
        expect(button().disabled).toBe(false);
        expect(mocks.api.sayBotHello).not.toHaveBeenCalled();
    });

    it("says a few characters of the key when a lent key pays", async () => {
        await mount({ paidByKey: "your ElevenLabs key" });
        expect(text()).toContain("Uses a few characters of your ElevenLabs key.");
        expect(text()).not.toContain("voice replies");
    });

    it("asks in the language the game is read in, then plays the hello with its words, and goes back when it is over", async () => {
        let hello: (value: { text: string; url: string }) => void = () => undefined;
        mocks.api.sayBotHello.mockImplementation(
            () =>
                new Promise((resolve) => {
                    hello = resolve;
                })
        );
        await mount({ locale: "ar-SA" });
        await click();
        expect(mocks.api.sayBotHello).toHaveBeenCalledWith("b1", "ar-SA");
        // The bot is still writing: the row waits and cannot be tapped again
        expect(text()).toContain("Hala is thinking of a hello…");
        expect(button().disabled).toBe(true);
        expect(button().getAttribute("aria-busy")).toBe("true");
        hello({ text: "Hi, I’m Hala. What can I get you today?", url: "blob:hello-1" });
        await settle();
        expect(FakeAudio.last?.src).toBe("blob:hello-1");
        expect(text()).toContain("Hala is saying hello…");
        expect(target.querySelector("[data-testid=bot-voice-hello-line]")?.textContent?.trim()).toBe(
            "“Hi, I’m Hala. What can I get you today?”"
        );
        expect(button().disabled).toBe(false);
        // Over: the row is what it was, and the audio is let go
        FakeAudio.last!.onended?.();
        await settle();
        expect(text()).toContain("Hear Hala say hello");
        expect(revoked).toEqual(["blob:hello-1"]);
    });

    it("stops when the row is tapped while it plays", async () => {
        mocks.api.sayBotHello.mockResolvedValue({ text: "Hello!", url: "blob:hello-2" });
        await mount();
        await click();
        expect(text()).toContain("Hala is saying hello…");
        await click();
        expect(FakeAudio.last?.paused).toBe(true);
        expect(text()).toContain("Hear Hala say hello");
        expect(mocks.api.sayBotHello).toHaveBeenCalledTimes(1);
    });

    it("greys out when the voice replies are used up, says when they are back, and lets go then", async () => {
        mocks.api.sayBotHello.mockRejectedValue(
            refused(429, { error: "used_up", resetsAt: "2026-11-06T18:40:00.000Z" })
        );
        await mount();
        // After it is on the page: the page's own wait for the voice replies to come back is the timer under test
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        vi.setSystemTime(new Date("2026-11-06T16:00:00Z"));
        button().click();
        await vi.advanceTimersByTimeAsync(10);
        expect(button().disabled).toBe(true);
        expect(text()).toContain("Your voice replies are used up until");
        expect(text()).toContain("The samples above still play, free.");
        expect(text()).not.toContain("couldn’t say hello");
        await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        expect(button().disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(41 * 60 * 1000);
        expect(button().disabled).toBe(false);
        expect(text()).toContain("Uses 1 of your voice replies.");
    });

    it("says it could not, and can be tried again, when nothing was said", async () => {
        mocks.api.sayBotHello.mockRejectedValueOnce(refused(502, { error: "no_words" }));
        const refresh = await mount();
        await click();
        expect(target.querySelector("[data-testid=bot-voice-hello-failed]")?.textContent?.trim()).toBe(
            "Hala couldn’t say hello just now. Try again."
        );
        expect(button().disabled).toBe(false);
        // Nothing about the voice changed, so the page is not asked to look again
        expect(refresh).not.toHaveBeenCalled();
        mocks.api.sayBotHello.mockResolvedValueOnce({ text: "Hello!", url: "blob:hello-3" });
        await click();
        expect(target.querySelector("[data-testid=bot-voice-hello-failed]")).toBeNull();
        expect(text()).toContain("Hala is saying hello…");
    });

    it("asks the page to look again when the voice company refused the key, or the voice was turned off", async () => {
        mocks.api.sayBotHello.mockRejectedValueOnce(
            refused(502, { error: "provider", providerStatus: 401, rejected: true })
        );
        const refresh = await mount();
        await click();
        expect(refresh).toHaveBeenCalledTimes(1);
        mocks.api.sayBotHello.mockRejectedValueOnce(refused(409, { error: "voice_off", reason: "off" }));
        await click();
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("says it could not when the audio cannot be played", async () => {
        mocks.api.sayBotHello.mockResolvedValue({ text: "Hello!", url: "blob:hello-4" });
        await mount();
        await click();
        FakeAudio.last!.onerror?.();
        await settle();
        expect(target.querySelector("[data-testid=bot-voice-hello-failed]")).not.toBeNull();
        expect(revoked).toEqual(["blob:hello-4"]);
    });

    it("is written in Arabic too", async () => {
        loadLocale("ar-SA");
        setLocale("ar-SA");
        try {
            await mount();
            expect(text()).toContain("استمع إلى تحية Hala");
            expect(text()).toContain("يستهلك ردًّا صوتيًّا واحدًا من ردودك");
        } finally {
            setLocale("en-US");
        }
    });
});
