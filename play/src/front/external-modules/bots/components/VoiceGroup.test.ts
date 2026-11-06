import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
    api: {
        isInitialized: vi.fn(() => true),
        getBotVoice: vi.fn(),
        getBotAiOptions: vi.fn(),
        getBotVoices: vi.fn(),
        getBotVoicePreview: vi.fn(),
        saveBotVoice: vi.fn(),
        setBotVoiceEnabled: vi.fn(),
        rollbackBotVoice: vi.fn(),
        checkVoiceKey: vi.fn(),
        getMyVoiceKeys: vi.fn(),
    },
    canOpenOrbit: vi.fn(() => true),
    openOrbitPage: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks.api }));
vi.mock("../../admin-api/index", () => ({ canOpenOrbit: mocks.canOpenOrbit, openOrbitPage: mocks.openOrbitPage }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { modalVisibilityStore } from "../../../Stores/ModalStore";
import { readBotVoice, type BotVoice, type VoiceChoice } from "../voiceModel";
import type { BotData } from "../types";
import VoiceGroup from "./page/VoiceGroup.svelte";

const uai = {
    recognition: {
        providerId: "uai-listen",
        adapter: "soniox",
        name: "Soniox",
        model: "stt-rt-v6",
        models: [{ id: "stt-rt-v6", label: "Soniox real-time" }],
    },
    speech: {
        providerId: "uai-speak",
        adapter: "elevenlabs",
        name: "ElevenLabs",
        model: "eleven_v4_turbo",
        models: [{ id: "eleven_v4_turbo", label: "Eleven v4 Turbo" }],
        defaultVoice: { voiceId: "v-river", voiceName: "River" },
    },
};

const key = (over: Record<string, unknown> = {}) => ({
    id: "key-el",
    adapter: "elevenlabs",
    name: "My ElevenLabs",
    recognition: false,
    speech: true,
    last4: "a1b2",
    models: [{ id: "eleven_v4_turbo", label: "Eleven v4 Turbo", kind: "speech" }],
    health: { status: "working", downSince: null, downReason: null },
    month: { voiceReplies: 142, botVoiceReplies: 12 },
    limits: { replySeconds: { value: 45, recommended: 60, changed: true } },
    ...over,
});

const uaiProfile = {
    recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
    speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-river", voiceName: "River" },
    expression: "natural",
    language: { mode: "follow" },
};

const answer = (over: Record<string, unknown> = {}): BotVoice => {
    const voice = readBotVoice({
        enabled: false,
        universeAllows: true,
        paidBy: "universe-ai",
        parts: { recognition: "universe-ai", speech: "universe-ai" },
        revision: null,
        draft: { profile: {}, updatedAt: null },
        revisions: [],
        lentKeys: [],
        universeAi: uai,
        voiceLimits: {
            revision: 1,
            limits: { turnSeconds: 30, replyCharacters: 600, replySeconds: 60, listenMinutesPerDay: 60 },
            window: { hours: 5, signedIn: { replies: 30, voiceReplies: 25 }, guest: { replies: 10, voiceReplies: 3 } },
        },
        ...over,
    });
    if (!voice) throw new Error("readable");
    return voice;
};

const turnedOn = (profile: Record<string, unknown> = uaiProfile, over: Record<string, unknown> = {}) =>
    answer({
        enabled: true,
        revision: 2,
        revisions: [
            { number: 2, profile, publishedById: "u1", publishedAt: "2026-11-03T07:00:00Z" },
            { number: 1, profile: uaiProfile, publishedById: "u1", publishedAt: "2026-11-01T18:00:00Z" },
        ],
        ...over,
    });

const voices: VoiceChoice[] = [
    {
        voiceId: "v-river",
        name: "River",
        description: "Relaxed, neutral",
        languages: ["en"],
        previewUrl: "https://samples.example.com/river.mp3",
        providerId: "uai-speak",
        model: "eleven_v4_turbo",
    },
    {
        voiceId: "v-fahad",
        name: "Fahad",
        description: "Warm, confident",
        languages: ["ar"],
        previewUrl: null,
        providerId: "uai-speak",
        model: "eleven_v4_turbo",
    },
];

const options = (over: Record<string, unknown> = {}) => ({
    current: "universe-ai",
    universeAi: { available: true },
    maker: { id: "u1", name: "Khalid" },
    viewerIsMaker: true,
    keys: [],
    currentKey: null,
    providers: null,
    ...over,
});

const bot = { id: "b1", name: "Tinyfish" } as BotData;

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
}

describe("the bot page's Voice group (#1668)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.api.isInitialized.mockReturnValue(true);
        mocks.canOpenOrbit.mockReturnValue(true);
        mocks.api.getBotAiOptions.mockResolvedValue(options());
        mocks.api.getBotVoices.mockResolvedValue(voices);
        mocks.api.getMyVoiceKeys.mockResolvedValue([]);
        modalVisibilityStore.set(false);
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byTestId = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];
    const click = async (id: string, index = 0) => {
        byTestId(id)[index].click();
        await settle();
    };

    async function mount(open = true) {
        const component = new VoiceGroup({ target, props: { bot, open, onToggle: vi.fn() } });
        destroy = () => component.$destroy();
        await settle();
    }

    it("is off by default and says what turning it on does", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        expect(text()).toContain("Voice Off");
        expect(text()).toContain("Off: Tinyfish answers in text only, as today. Turn it on to pick a voice.");
        expect(byTestId("bot-voice-card")).toHaveLength(0);
    });

    it("turns on at once with Universe AI's default voice when no voice key is lent", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-switch");
        expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
            recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
            speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-river", voiceName: "River" },
            expression: "natural",
            language: { mode: "follow" },
        });
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
        expect(text()).toContain("Voice is on with River, Universe AI’s voice. Pick another below.");
        // The numbers are Orbit's: 25 voice replies every 5 hours, a 60 s reply, 60 min a day
        expect(text()).toContain("Universe AI pays for listening and speaking.");
        expect(text()).toContain("up to 25 every 5 hours");
        expect(text()).toContain("A spoken reply is up to 60 s. It listens for its name up to 60 min a day.");
        expect(text()).toContain("River · Natural · Universe AI");
    });

    it("asks who pays before saving anything when the maker lent a voice key", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
        await mount();
        await click("bot-voice-switch");
        expect(byTestId("bot-voice-ask")).toHaveLength(1);
        expect(text()).toContain("Who pays for Tinyfish’s voice?");
        expect(text()).toContain("Your ElevenLabs key ••••a1b2");
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        // Cancel saves nothing and puts the switch back
        const cancel = [...target.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Cancel");
        cancel?.click();
        await settle();
        expect(byTestId("bot-voice-ask")).toHaveLength(0);
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        expect(mocks.api.setBotVoiceEnabled).not.toHaveBeenCalled();
    });

    it("turns on with the lent key, Universe AI doing the job the key can't", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
        mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [key()] })
        );
        await mount();
        await click("bot-voice-switch");
        await click("bot-voice-ask-key");
        await click("bot-voice-ask-go");
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-el");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "uai-listen" },
            speech: { providerId: "key-el", voiceId: "v-river" },
        });
        expect(text()).toContain("Your ElevenLabs key ••••a1b2 speaks. Universe AI listens.");
        expect(text()).toContain("This month: 142 voice replies on this key.");
        expect(text()).toContain("These are your key’s limits.");
        expect(text()).toContain("45 s");
    });

    it("names the maker's keys, not 'your' keys, for a co-manager", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(
            options({ viewerIsMaker: false, maker: { id: "u9", name: "Khalid" } })
        );
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [key()] })
        );
        await mount();
        expect(text()).toContain("Khalid’s ElevenLabs key ••••a1b2 speaks. Universe AI listens.");
        expect(text()).toContain(
            "Only Khalid’s keys or Universe AI can pay for Tinyfish’s voice, because Khalid made it."
        );
        expect(text()).not.toContain("Your ElevenLabs");
        expect(text()).toContain("Universe AI and Khalid’s key");
    });

    it("shows what the voice is, with its sample, and saves a new style as a new version", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.saveBotVoice.mockResolvedValue(turnedOn({ ...uaiProfile, expression: "expressive" }));
        await mount();
        expect(byTestId("bot-voice-card")[0].textContent).toContain("River");
        expect(byTestId("bot-voice-card")[0].textContent).toContain("Relaxed, neutral · English");
        expect(byTestId("bot-voice-card")[0].textContent).toContain("ElevenLabs · Eleven v4 Turbo");
        expect((byTestId("bot-voice-card-play")[0] as HTMLButtonElement).disabled).toBe(false);
        await click("bot-voice-style-expressive");
        expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", { ...uaiProfile, expression: "expressive" });
        expect(text()).toContain("River · Expressive · Universe AI");
    });

    it("picks another voice in the picker and saves it only on Use", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.saveBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, voiceId: "v-fahad", voiceName: "Fahad" } })
        );
        await mount();
        await click("bot-voice-change");
        expect(text()).toContain("Voices for Tinyfish on Universe AI");
        expect(text()).toContain("More voices with your own voice key");
        expect((byTestId("bot-voice-use")[0] as HTMLButtonElement).disabled).toBe(true);
        await click("bot-voice-option", 1);
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        expect(text()).toContain("Use Fahad");
        await click("bot-voice-use");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({
            voiceId: "v-fahad",
            voiceName: "Fahad",
        });
        expect(text()).toContain("Fahad · Natural");
        expect(byTestId("bot-voice-picker-title")).toHaveLength(0);
    });

    it("lists the versions and rolls back to an earlier one", async () => {
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, voiceId: "v-fahad", voiceName: "Fahad" } })
        );
        mocks.api.rollbackBotVoice.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-more");
        const versions = byTestId("bot-voice-versions")[0].textContent ?? "";
        expect(versions).toContain("Version 2 · Fahad · Natural · Universe AI");
        expect(versions).toContain("Speaking now");
        expect(versions).toContain("Version 1 · River");
        await click("bot-voice-roll-back");
        expect(mocks.api.rollbackBotVoice).toHaveBeenCalledWith("b1", 1);
        expect(text()).toContain("Back to version 1. New conversations use it");
    });

    it("pauses on a key out of credit, keeps the payer, and lets the maker check now", async () => {
        const down = key({ health: { status: "down", downSince: "2026-11-03T06:12:00Z", downReason: "credit" } });
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [down] })
        );
        mocks.api.checkVoiceKey.mockResolvedValue(true);
        await mount();
        expect(text()).toContain("Paused · your key is out of credit");
        expect(text()).toContain("Your ElevenLabs key ran out of credit at");
        expect(text()).toContain("It isn’t moved to Universe AI’s voice by itself.");
        await click("bot-voice-check");
        expect(mocks.api.checkVoiceKey).toHaveBeenCalledWith("key-el");
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
    });

    it("pauses on a key that is no longer lent and offers a Universe AI voice", async () => {
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-old" } })
        );
        mocks.api.getMyVoiceKeys.mockResolvedValue([{ id: "key-old", adapter: "elevenlabs" }]);
        mocks.api.saveBotVoice.mockResolvedValue(turnedOn());
        await mount();
        expect(text()).toContain("Paused · your key isn’t lent here");
        expect(text()).toContain("Your ElevenLabs key isn’t lent to this universe any more");
        await click("bot-voice-use-universe-ai");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech.providerId).toBe("uai-speak");
    });

    it("says Universe AI's voice is off, with no buttons", async () => {
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn(uaiProfile, { universeAi: { recognition: uai.recognition, speech: null } })
        );
        await mount();
        expect(text()).toContain("Paused · Universe AI’s voice is off");
        expect(text()).toContain("Universe AI’s voice is off on this server for now");
        expect(byTestId("bot-voice-paused")).toHaveLength(1);
    });

    it("locks the switch where the universe doesn't allow voice bots, and opens Universe settings", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ universeAllows: false }));
        await mount();
        expect(text()).toContain("Off in this universe");
        expect(text()).toContain("Voice bots are off in this universe");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).disabled).toBe(true);
        await click("bot-voice-universe-settings");
        expect(mocks.openOrbitPage).toHaveBeenCalledWith("/admin/universes");
    });

    it("locks the switch when no voice company is set up on the server", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ universeAi: { recognition: null, speech: null } }));
        await mount();
        expect(text()).toContain("Not on this server yet");
        expect(text()).toContain("Voice isn’t available on this server yet");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).disabled).toBe(true);
    });

    it("shows nothing to someone who can't manage the bot's voice", async () => {
        mocks.api.getBotVoice.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
        await mount();
        expect(byTestId("bot-page-group-voice")).toHaveLength(0);
        expect(text()).toBe("");
    });

    it("says it couldn't load, and tries again", async () => {
        mocks.api.getBotVoice.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(answer());
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await mount();
        expect(text()).toContain("Couldn’t load the voice settings.");
        const retry = [...target.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Try again"
        );
        retry?.click();
        await settle();
        expect(text()).toContain("Off: Tinyfish answers in text only");
    });

    it("shows the line Orbit refused a change with, and keeps the voice as it was", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("The providers in the voice profile don't work right now"));
        await mount();
        await click("bot-voice-style-restrained");
        expect(text()).toContain("Couldn’t save that. The providers in the voice profile don't work right now");
        expect(text()).toContain("River · Natural · Universe AI");
    });

    it("puts the switch back when turning voice on fails", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("nope"));
        await mount();
        await click("bot-voice-switch");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(false);
    });
});
