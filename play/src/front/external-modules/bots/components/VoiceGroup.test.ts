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

const limitsAnswer = () => ({
    revision: 1,
    limits: { turnSeconds: 30, replyCharacters: 600, replySeconds: 60, listenMinutesPerDay: 60 } as Record<
        string,
        number
    >,
    window: { hours: 5, signedIn: { replies: 30, voiceReplies: 25 }, guest: { replies: 10, voiceReplies: 3 } },
});

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
        voiceLimits: limitsAnswer(),
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

    it("is off by default, and the row opens on voices to hear with Universe AI's own voice first", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        expect(text()).toContain("Voice Off · Give Tinyfish a voice");
        expect(text()).toContain(
            "Pick a voice and people next to Tinyfish can talk with it out loud. Text chat stays as it is."
        );
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "universe-ai");
        const rows = byTestId("bot-voice-option");
        expect(rows).toHaveLength(2);
        // Universe AI's own voice (River, set by a super admin) is first, tagged and picked
        expect(rows[0].textContent).toContain("River");
        expect(rows[0].textContent).toContain("Recommended");
        expect(rows[0].getAttribute("aria-checked")).toBe("true");
        expect(text()).toContain("Use River’s voice");
        expect(text()).toContain(
            "Free for you. Each person gets up to 25 voice replies every 5 hours, then Tinyfish answers them in text."
        );
        // No company, model or who-pays question, and no switch, while off
        expect(text()).not.toContain("Who pays");
        expect(text()).not.toContain("Eleven");
        expect(text()).not.toContain("eleven_v4_turbo");
        expect(byTestId("bot-voice-switch")).toHaveLength(0);
        expect(byTestId("bot-voice-payer-change")).toHaveLength(0);
        expect(byTestId("bot-voice-card")).toHaveLength(0);
    });

    it("turns on with one tap on Use, with the picked voice and Universe AI's current models", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
            recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
            speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-river", voiceName: "River" },
            expression: "natural",
            language: { mode: "follow" },
        });
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
        expect(text()).toContain("Tinyfish talks in bubbles now, with River’s voice.");
        expect(text()).toContain("Free for you. Each person gets up to 25 voice replies every 5 hours.");
        expect(text()).toContain("River · Natural · Universe AI");
        // Models, companies and who pays stay out of sight until a key is involved
        expect(text()).not.toContain("Eleven");
        expect(text()).not.toContain("Soniox");
        expect(byTestId("bot-voice-switch")).toHaveLength(1);
    });

    it("saves the voice that was picked and heard, not the first one", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-option", 1);
        expect(text()).toContain("Use Fahad’s voice");
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({
            voiceId: "v-fahad",
            voiceName: "Fahad",
        });
    });

    it("shows only as many voices as Orbit says, then All voices, which opens the whole list", async () => {
        const many: VoiceChoice[] = ["River", "Fahad", "Layla", "Omar"].map((name) => ({
            voiceId: `v-${name.toLowerCase()}`,
            name,
            description: "Warm",
            languages: ["en"],
            previewUrl: null,
            providerId: "uai-speak",
            model: "eleven_v4_turbo",
        }));
        mocks.api.getBotVoices.mockResolvedValue(many);
        mocks.api.getBotVoice.mockResolvedValue(
            answer({ voiceLimits: { ...limitsAnswer(), limits: { ...limitsAnswer().limits, voicesShownFirst: 2 } } })
        );
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        expect(byTestId("bot-voice-option")).toHaveLength(2);
        expect(text()).toContain("Search all 4 voices by name or language");
        await click("bot-voice-all-voices");
        expect(text()).toContain("Voices for Tinyfish on Universe AI");
        expect(byTestId("bot-voice-option")).toHaveLength(4);
        // Using a voice from the whole list turns voice on with it
        await click("bot-voice-option", 3);
        await click("bot-voice-use");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({ voiceId: "v-omar", voiceName: "Omar" });
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
        expect(byTestId("bot-voice-picker-title")).toHaveLength(0);
    });

    it("shows every voice when the list is no longer than what Orbit says to show", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        expect(byTestId("bot-voice-all-voices")).toHaveLength(0);
    });

    it("says it can't load the voices, and tries again", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.getBotVoices.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(voices);
        await mount();
        expect(text()).toContain("Couldn’t load the voices.");
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        await click("bot-voice-door-retry");
        expect(byTestId("bot-voice-option")).toHaveLength(2);
    });

    it("treats a source that lists no voice as a failure to load, with Try again, not a dead button", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.getBotVoices.mockResolvedValueOnce([]).mockResolvedValue(voices);
        await mount();
        expect(text()).toContain("Couldn’t load the voices.");
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        await click("bot-voice-door-retry");
        expect(byTestId("bot-voice-option")).toHaveLength(2);
    });

    it("turns on again with the voice it had, without making a new version", async () => {
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(), enabled: false });
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        expect(byTestId("bot-voice-option")[0].textContent).toContain("Used before");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
    });

    it("makes a new version when it is turned on again with another voice", async () => {
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(), enabled: false });
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-option", 1);
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({ voiceId: "v-fahad" });
    });

    it("keeps the style and language it had when it is turned on again with another voice", async () => {
        const styled = { ...uaiProfile, expression: "expressive", language: { mode: "fixed", code: "ar" } };
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(styled), enabled: false });
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-option", 1);
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            expression: "expressive",
            language: { mode: "fixed", code: "ar" },
        });
    });

    it("turns off from the switch, and the row opens on voices again", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.setBotVoiceEnabled.mockResolvedValue({ ...turnedOn(), enabled: false });
        await mount();
        await click("bot-voice-switch");
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", false);
        expect(text()).toContain("Voice Off · Give Tinyfish a voice");
        expect(byTestId("bot-voice-go")).toHaveLength(1);
    });

    it("picks the lent key for you, with its voices, and turns on without asking who pays", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
        mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [key()] })
        );
        await mount();
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-el");
        expect(text()).toContain("Paid by your ElevenLabs key");
        expect(text()).toContain("You pay; people talking with Tinyfish pay nothing.");
        expect(text()).toContain("Voices on your ElevenLabs key");
        expect(text()).not.toContain("Who pays for");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "uai-listen" },
            speech: { providerId: "key-el", voiceId: "v-river" },
        });
        expect(text()).toContain("Tinyfish talks in bubbles now, with River’s voice on your ElevenLabs key.");
        expect(text()).toContain("Your ElevenLabs key ••••a1b2 speaks. Universe AI listens.");
    });

    it("lets the maker change who pays before turning on, and Universe AI's voices come in", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
        mocks.api.getBotVoices.mockImplementation((_bot: string, source: string) =>
            Promise.resolve(
                voices.map((voice) => ({ ...voice, providerId: source === "key-el" ? "key-el" : "uai-speak" }))
            )
        );
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-payer-change");
        expect(byTestId("bot-voice-ask-universe-ai")).toHaveLength(1);
        expect(byTestId("bot-voice-ask-key")).toHaveLength(1);
        await click("bot-voice-ask-universe-ai");
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "universe-ai");
        expect(text()).toContain("Paid by Universe AI");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({ providerId: "uai-speak" });
        expect(mocks.api.saveBotVoice).toHaveBeenCalledTimes(1);
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
        // No company or model on Universe AI's card
        expect(byTestId("bot-voice-card")[0].textContent).not.toContain("Eleven");
        expect((byTestId("bot-voice-card-play")[0] as HTMLButtonElement).disabled).toBe(false);
        await click("bot-voice-style-expressive");
        expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", { ...uaiProfile, expression: "expressive" });
        expect(text()).toContain("River · Expressive · Universe AI");
    });

    it("shows Try again in the picker too when the source lists no voice", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.getBotVoices.mockReset();
        mocks.api.getBotVoices.mockResolvedValue([]);
        await mount();
        await click("bot-voice-change");
        expect(text()).toContain("Couldn’t load the voices.");
        expect(byTestId("bot-voice-use")[0] as HTMLButtonElement | undefined).toBeUndefined();
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
        expect(text()).toContain("Not available here yet");
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
        expect(text()).toContain("Pick a voice and people next to Tinyfish can talk with it out loud.");
    });

    it("shows the line Orbit refused a change with, and keeps the voice as it was", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("The providers in the voice profile don't work right now"));
        await mount();
        await click("bot-voice-style-restrained");
        expect(text()).toContain("Couldn’t save that. The providers in the voice profile don't work right now");
        expect(text()).toContain("River · Natural · Universe AI");
    });

    it("says why turning voice on failed, and stays off", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("nope"));
        await mount();
        await click("bot-voice-go");
        expect(text()).toContain("Couldn’t save that. nope");
        expect(text()).toContain("Voice Off · Give Tinyfish a voice");
        expect(byTestId("bot-voice-switch")).toHaveLength(0);
        expect(mocks.api.setBotVoiceEnabled).not.toHaveBeenCalled();
    });

    it("keeps the switch on when turning voice off fails", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.setBotVoiceEnabled.mockRejectedValue(new Error("nope"));
        await mount();
        await click("bot-voice-switch");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(true);
        expect(text()).toContain("Couldn’t save that. nope");
    });

    describe("More voice settings", () => {
        const twoModels = [
            { id: "eleven_v4_turbo", label: "Eleven v4 Turbo", kind: "speech" },
            { id: "eleven_flash_v2_5", label: "Eleven Flash v2.5", kind: "speech" },
        ];
        const onKey = (over: Record<string, unknown> = {}) =>
            turnedOn(
                { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } },
                {
                    lentKeys: [key({ models: twoModels })],
                    ...over,
                }
            );

        it("says nothing about companies or models on Universe AI, and points to AI keys for paying yourself", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn());
            await mount();
            await click("bot-voice-more");
            expect(text()).toContain("Language, who pays, versions");
            expect(text()).toContain("Universe AI picks how Tinyfish listens and speaks, and keeps it current.");
            expect(byTestId("bot-voice-speech-model")).toHaveLength(0);
            expect(byTestId("bot-voice-recognition-model")).toHaveLength(0);
            expect(byTestId("bot-voice-speech-model-change")).toHaveLength(0);
            expect(text()).not.toContain("Speaking model");
            expect(text()).not.toContain("eleven_v4_turbo");
            expect(text()).not.toContain("stt-rt-v6");
            expect(text()).toContain("A spoken reply is up to 60 s. It listens for its name up to 60 min a day.");
            const aiKeys = [...target.querySelectorAll("button")].find(
                (button) => button.textContent?.trim() === "AI keys"
            );
            aiKeys?.click();
            expect(mocks.openOrbitPage).toHaveBeenCalledWith("/admin/you/ai-keys");
        });

        it("keeps the model of a key one row, preselected and tagged, and Change opens the whole list", async () => {
            mocks.api.getBotVoice.mockResolvedValue(onKey());
            mocks.api.saveBotVoice.mockResolvedValue(onKey());
            await mount();
            await click("bot-voice-more");
            expect(text()).toContain("Language, who pays, model, versions");
            const row = byTestId("bot-voice-speech-model-change")[0].textContent ?? "";
            expect(row).toContain("Speaking model · Eleven v4 Turbo");
            expect(row).toContain("Recommended");
            expect(byTestId("bot-voice-speech-model")).toHaveLength(0);
            await click("bot-voice-speech-model-change");
            const select = byTestId("bot-voice-speech-model")[0] as HTMLSelectElement;
            expect([...select.options].map((option) => option.value)).toEqual(["eleven_v4_turbo", "eleven_flash_v2_5"]);
            expect([...select.options][0].textContent).toBe("Eleven v4 Turbo · eleven_v4_turbo");
            select.value = "eleven_flash_v2_5";
            select.dispatchEvent(new Event("change"));
            await settle();
            expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({
                providerId: "key-el",
                model: "eleven_flash_v2_5",
            });
        });

        it("tags no model Recommended once another one is picked", async () => {
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn(
                    {
                        ...uaiProfile,
                        speech: { ...uaiProfile.speech, providerId: "key-el", model: "eleven_flash_v2_5" },
                    },
                    { lentKeys: [key({ models: twoModels })] }
                )
            );
            await mount();
            await click("bot-voice-more");
            const row = byTestId("bot-voice-speech-model-change")[0].textContent ?? "";
            expect(row).toContain("Speaking model · Eleven Flash v2.5");
            expect(row).not.toContain("Recommended");
        });

        it("shows a key's model as one row with no Change when the key lists only that model", async () => {
            mocks.api.getBotVoice.mockResolvedValue(onKey({ lentKeys: [key()] }));
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-speech-model-change")[0].textContent).toContain(
                "Speaking model · Eleven v4 Turbo"
            );
            expect(byTestId("bot-voice-speech-model-change")[0].textContent).not.toContain("Change");
        });

        it("keeps the choice of where each job runs one tap away when a key is lent, and saves it", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(uaiProfile, { lentKeys: [key()] }));
            mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
            mocks.api.saveBotVoice.mockResolvedValue(onKey());
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-speech-key")).toHaveLength(0);
            await click("bot-voice-sources-change");
            expect(text()).toContain("Speaks on");
            expect(text()).toContain("Listens on");
            expect(byTestId("bot-voice-speech-universe-ai")[0].getAttribute("aria-checked")).toBe("true");
            await click("bot-voice-speech-key");
            expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
                recognition: { providerId: "uai-listen" },
                speech: { providerId: "key-el", model: "eleven_v4_turbo", voiceId: "v-river" },
            });
        });

        it("lists the language in plain words, and Each person's language is the default", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn());
            mocks.api.saveBotVoice.mockResolvedValue(
                turnedOn({ ...uaiProfile, language: { mode: "fixed", code: "en" } })
            );
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-language-change")[0].textContent).toContain("Each person’s language");
            expect(byTestId("bot-voice-language-change")[0].textContent).toContain(
                "Tinyfish hears and answers in the language each person speaks: Arabic, English or both."
            );
            expect(byTestId("bot-voice-language-follow")).toHaveLength(0);
            await click("bot-voice-language-change");
            expect(byTestId("bot-voice-language-follow")[0].textContent).toContain("Recommended");
            expect(byTestId("bot-voice-language-follow")[0].getAttribute("aria-checked")).toBe("true");
            expect(byTestId("bot-voice-language-fixed")[0].textContent).toContain("Always one language");
            expect(byTestId("bot-voice-language-fixed")[0].textContent).toContain(
                "Pick this if most people here speak one language and Tinyfish mishears them."
            );
            await click("bot-voice-language-fixed");
            expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
                ...uaiProfile,
                language: { mode: "fixed", code: "en" },
            });
            expect(byTestId("bot-voice-language-select")).toHaveLength(1);
            expect(byTestId("bot-voice-language-change")[0].textContent).toContain("Always English");
        });

        it("goes back to each person's language", async () => {
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn({ ...uaiProfile, language: { mode: "fixed", code: "ar" } })
            );
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn());
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-language-change")[0].textContent).toContain("Always Arabic");
            await click("bot-voice-language-change");
            await click("bot-voice-language-follow");
            expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", { ...uaiProfile, language: { mode: "follow" } });
        });

        it("says what a key's limits are and what the key spent this month", async () => {
            mocks.api.getBotVoice.mockResolvedValue(onKey({ lentKeys: [key()] }));
            await mount();
            await click("bot-voice-more");
            expect(text()).toContain("This month: 142 voice replies on this key.");
            expect(text()).toContain("These are your key’s limits.");
            expect(text()).toContain("45 s");
        });

        it("saves a model change on the listening key too", async () => {
            const ears = key({
                id: "key-ears",
                adapter: "soniox",
                name: "My Soniox",
                recognition: true,
                speech: false,
                models: [
                    { id: "stt-rt-v6", label: "Soniox real-time v6", kind: "recognition" },
                    { id: "stt-rt-v5", kind: "recognition" },
                ],
            });
            const profile = { ...uaiProfile, recognition: { providerId: "key-ears", model: "stt-rt-v6" } };
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(profile, { lentKeys: [ears] }));
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn(profile, { lentKeys: [ears] }));
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-recognition-model-change")[0].textContent).toContain(
                "Listening model · Soniox real-time v6"
            );
            await click("bot-voice-recognition-model-change");
            const select = byTestId("bot-voice-recognition-model")[0] as HTMLSelectElement;
            select.value = "stt-rt-v5";
            select.dispatchEvent(new Event("change"));
            await settle();
            expect(mocks.api.saveBotVoice.mock.calls[0][1].recognition).toEqual({
                providerId: "key-ears",
                model: "stt-rt-v5",
            });
        });
    });

    it("starts a new voice on Universe AI's current model, not the older one the bot was on", async () => {
        const old = { ...uaiProfile, speech: { ...uaiProfile.speech, model: "eleven_flash_v2_5" } };
        mocks.api.getBotVoice.mockResolvedValue(turnedOn(old));
        mocks.api.saveBotVoice.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-change");
        await click("bot-voice-option", 1);
        await click("bot-voice-use");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({
            voiceId: "v-fahad",
            model: "eleven_v4_turbo",
        });
    });

    it("keeps a key's own model when another voice is picked on the key", async () => {
        const profile = {
            ...uaiProfile,
            speech: { ...uaiProfile.speech, providerId: "key-el", model: "eleven_flash_v2_5" },
        };
        const twoModelKey = key({
            models: [
                { id: "eleven_v4_turbo", kind: "speech" },
                { id: "eleven_flash_v2_5", kind: "speech" },
            ],
        });
        mocks.api.getBotVoice.mockResolvedValue(turnedOn(profile, { lentKeys: [twoModelKey] }));
        mocks.api.getBotVoices.mockResolvedValue(
            voices.map((voice) => ({ ...voice, providerId: "key-el", model: "eleven_v4_turbo" }))
        );
        mocks.api.saveBotVoice.mockResolvedValue(turnedOn(profile, { lentKeys: [twoModelKey] }));
        await mount();
        await click("bot-voice-change");
        await click("bot-voice-option", 1);
        await click("bot-voice-use");
        expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toMatchObject({
            providerId: "key-el",
            voiceId: "v-fahad",
            model: "eleven_flash_v2_5",
        });
    });
});
