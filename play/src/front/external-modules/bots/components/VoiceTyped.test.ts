import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({ api: { sayBotHello: vi.fn(), checkBotVoiceName: vi.fn() } }));
vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { stopSample } from "../voicePlayer";
import VoiceTyped from "./page/VoiceTyped.svelte";

const settle = async () => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
};

/** The error the bot server's answer becomes in the game (BotApiService.fetchBotServer). */
const refused = (status: number, body: Record<string, unknown>) =>
    Object.assign(new Error(String(body.error)), { status, body });
const notTaken = () => refused(502, { error: "provider", providerStatus: 404, rejected: false });

describe("A voice name typed for a speech server of the person's own (#1874)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.api.checkBotVoiceName.mockResolvedValue(undefined);
        URL.revokeObjectURL = () => undefined;
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        stopSample();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const field = () => target.querySelector<HTMLInputElement>("[data-testid=bot-voice-typed]")!;
    const error = () => target.querySelector("[data-testid=bot-voice-typed-error]");
    const useButton = (mode: "door" | "change" = "door") =>
        target.querySelector<HTMLButtonElement>(`[data-testid=${mode === "door" ? "bot-voice-go" : "bot-voice-use"}]`)!;
    const type = async (value: string) => {
        field().value = value;
        field().dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
    };

    async function mount(props: Partial<{ mode: "door" | "change"; currentName: string; busy: boolean }> = {}) {
        const onUse = vi.fn();
        const refresh = vi.fn();
        const onBack = vi.fn();
        const component = new VoiceTyped({
            target,
            props: {
                botId: "b1",
                botName: "Hala",
                server: "your speech server",
                serverStart: "Your speech server",
                source: { providerId: "my-server", model: "kokoro" },
                onUse,
                onBack,
                ...props,
            },
        });
        component.$on("refresh", refresh);
        destroy = () => component.$destroy();
        await settle();
        return { onUse, refresh, onBack };
    }

    it("at the door asks for the name where the voice list would be, and has nothing to use until one is typed", async () => {
        await mount();
        expect(text()).toContain("Voice on your speech server");
        expect(text()).toContain(
            "Your speech server doesn’t list its voices. Type a voice’s name exactly as your server uses it."
        );
        expect(field().placeholder).toBe("Voice name, such as af_heart");
        expect(useButton().textContent?.trim()).toBe("Use this voice");
        expect(useButton().disabled).toBe(true);
        expect(text()).toContain("Hear this voice say hello");
        expect(text()).toContain("A short line said by your speech server. Free: no voice company is paid.");
    });

    it("is a plain field for a name: 16px, no autocorrect, no capitals, up to 255 characters", async () => {
        await mount();
        expect(field().type).toBe("text");
        expect(field().maxLength).toBe(255);
        expect(field().getAttribute("autocapitalize")).toBe("off");
        expect(field().getAttribute("autocorrect")).toBe("off");
        expect(field().getAttribute("autocomplete")).toBe("off");
        expect(field().getAttribute("spellcheck")).toBe("false");
        expect(field().getAttribute("aria-label")).toBe("Voice name");
    });

    it("names the voice on the hello row and on Use once a name is typed", async () => {
        await mount();
        await type("  bm_george ");
        expect(text()).toContain("Hear bm_george say hello");
        expect(useButton().textContent?.trim()).toBe("Use bm_george");
        expect(useButton().disabled).toBe(false);
    });

    it("hears the typed name before it is kept, from the server the door is on, and saves nothing by doing so", async () => {
        mocks.api.sayBotHello.mockResolvedValue({ text: "Hello!", url: "blob:x" });
        class Audio {
            onended = null;
            onerror = null;
            play() {
                return Promise.resolve();
            }
            pause() {}
        }
        vi.stubGlobal("Audio", Audio);
        const { onUse } = await mount();
        await type("bm_george");
        target.querySelector<HTMLButtonElement>("[data-testid=bot-voice-hello]")!.click();
        await settle();
        expect(mocks.api.sayBotHello).toHaveBeenCalledWith("b1", "en-US", {
            voiceId: "bm_george",
            source: { providerId: "my-server", model: "kokoro" },
        });
        expect(onUse).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("on Use asks the server once more, quietly, and keeps the name only when audio came back", async () => {
        let answer: () => void = () => undefined;
        mocks.api.checkBotVoiceName.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    answer = resolve;
                })
        );
        const { onUse } = await mount();
        await type("bm_george");
        useButton().click();
        await settle();
        expect(mocks.api.checkBotVoiceName).toHaveBeenCalledWith("b1", "en-US", {
            voiceId: "bm_george",
            source: { providerId: "my-server", model: "kokoro" },
        });
        // While it asks the button says so and cannot be pressed twice
        expect(useButton().textContent?.trim()).toBe("Checking bm_george…");
        expect(useButton().disabled).toBe(true);
        expect(onUse).not.toHaveBeenCalled();
        answer();
        await settle();
        expect(onUse).toHaveBeenCalledTimes(1);
        expect(onUse).toHaveBeenCalledWith("bm_george");
        expect(error()).toBeNull();
    });

    it("says in one red line that the server did not take the name, and keeps nothing", async () => {
        mocks.api.checkBotVoiceName.mockRejectedValue(notTaken());
        const { onUse } = await mount();
        await type("nope");
        useButton().click();
        await settle();
        expect(onUse).not.toHaveBeenCalled();
        expect(error()?.textContent?.trim()).toBe(
            "Your speech server didn’t take “nope” as a voice name. Check how your server spells it, then try again."
        );
        expect(error()?.getAttribute("role")).toBe("alert");
        expect(field().getAttribute("aria-invalid")).toBe("true");
        // The same name is not tried again; another one clears the line
        expect(useButton().disabled).toBe(true);
        await type("nope2");
        expect(error()).toBeNull();
        expect(useButton().disabled).toBe(false);
    });

    it("says the server did not answer when it is down, and lets the same name be tried again", async () => {
        mocks.api.checkBotVoiceName.mockRejectedValueOnce(refused(503, { error: "unavailable" }));
        const { onUse } = await mount();
        await type("af_heart");
        useButton().click();
        await settle();
        expect(onUse).not.toHaveBeenCalled();
        expect(error()?.textContent?.trim()).toBe("Your speech server didn’t answer. Is it running and the tunnel up?");
        expect(useButton().disabled).toBe(false);
        useButton().click();
        await settle();
        expect(onUse).toHaveBeenCalledWith("af_heart");
        expect(error()).toBeNull();
    });

    it("says the line about a name the server did not take when hearing it, too", async () => {
        mocks.api.sayBotHello.mockRejectedValue(notTaken());
        await mount();
        await type("nope");
        target.querySelector<HTMLButtonElement>("[data-testid=bot-voice-hello]")!.click();
        await settle();
        expect(error()?.textContent).toContain("didn’t take “nope” as a voice name");
        expect(target.querySelector("[data-testid=bot-voice-hello-failed]")).toBeNull();
    });

    it("asks the page to look again when voice was turned off while it was open", async () => {
        mocks.api.checkBotVoiceName.mockRejectedValue(refused(409, { error: "voice_off", reason: "off" }));
        const { refresh } = await mount();
        await type("af_heart");
        useButton().click();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("drops an answer about a name that was changed while the server was answering", async () => {
        let answer: () => void = () => undefined;
        mocks.api.checkBotVoiceName.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    answer = resolve;
                })
        );
        const { onUse } = await mount();
        await type("af_heart");
        useButton().click();
        await settle();
        await type("af_sky");
        answer();
        await settle();
        expect(onUse).not.toHaveBeenCalled();
        expect(useButton().textContent?.trim()).toBe("Use af_sky");
    });

    it("waits for the hello that is being made before Use, and the hello waits for Use: the server makes one at a time", async () => {
        let said: (value: { text: string; url: string }) => void = () => undefined;
        mocks.api.sayBotHello.mockImplementation(
            () =>
                new Promise((resolve) => {
                    said = resolve;
                })
        );
        const hello = () => target.querySelector<HTMLButtonElement>("[data-testid=bot-voice-hello]")!;
        const { onUse } = await mount();
        await type("af_heart");
        hello().click();
        await settle();
        expect(useButton().disabled).toBe(true);
        said({ text: "Hello!", url: "blob:y" });
        class Audio {
            onended = null;
            onerror = null;
            play() {
                return Promise.resolve();
            }
            pause() {}
        }
        vi.stubGlobal("Audio", Audio);
        await settle();
        stopSample();
        await settle();
        expect(useButton().disabled).toBe(false);
        // While Use asks, the hello cannot be asked for
        mocks.api.checkBotVoiceName.mockImplementation(
            () =>
                new Promise(() => {
                    // never answers
                })
        );
        useButton().click();
        await settle();
        expect(hello().disabled).toBe(true);
        expect(onUse).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("waits while it is saving", async () => {
        await mount({ busy: true });
        await type("af_heart");
        expect(useButton().disabled).toBe(true);
    });

    describe("when changing the voice of a bot that speaks", () => {
        it("starts on the name it speaks with, which is not worth using again, and has Back and Use", async () => {
            const { onBack } = await mount({ mode: "change", currentName: "af_heart" });
            expect(text()).toContain("Voice for Hala on your speech server");
            expect(field().value).toBe("af_heart");
            expect(useButton("change").disabled).toBe(true);
            target.querySelector<HTMLButtonElement>("[data-testid=bot-voice-picker-back]")!.click();
            expect(onBack).toHaveBeenCalledTimes(1);
        });

        it("keeps another name once the server has said it", async () => {
            const { onUse } = await mount({ mode: "change", currentName: "af_heart" });
            await type("bm_george");
            expect(useButton("change").textContent?.trim()).toBe("Use bm_george");
            useButton("change").click();
            await settle();
            expect(mocks.api.checkBotVoiceName).toHaveBeenCalledWith("b1", "en-US", {
                voiceId: "bm_george",
                source: { providerId: "my-server", model: "kokoro" },
            });
            expect(onUse).toHaveBeenCalledWith("bm_george");
        });
    });

    it("is written in Arabic too", async () => {
        loadLocale("ar-SA");
        setLocale("ar-SA");
        try {
            await mount();
            expect(text()).toContain("اسم الصوت");
            expect(field().placeholder).toBe("اسم الصوت، مثل af_heart");
            expect(text()).toContain("لا يعرض أصواته");
            expect(useButton().textContent?.trim()).toBe("استخدم هذا الصوت");
        } finally {
            setLocale("en-US");
        }
    });
});
