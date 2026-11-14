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
        sayBotHello: vi.fn(),
        checkBotVoiceName: vi.fn(),
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
        talk: false,
    },
    {
        voiceId: "v-fahad",
        name: "Fahad",
        description: "Warm, confident",
        languages: ["ar"],
        previewUrl: null,
        providerId: "uai-speak",
        model: "eleven_v4_turbo",
        talk: false,
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
    /** Voice is off and the voices are hidden: the switch opens them to pick one */
    const startChoosing = () => click("bot-voice-switch");

    async function mount(open = true, brick = false) {
        const component = new VoiceGroup({ target, props: { bot, open, onToggle: vi.fn(), brick } });
        destroy = () => component.$destroy();
        await settle();
    }

    it("is off by default: a switch that is off says so, and no voice is picked or listed", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        expect(text()).toContain("Voice Off · Give Tinyfish a voice");
        expect(text()).toContain("Voice is off for Tinyfish.");
        const toggle = byTestId("bot-voice-switch")[0] as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        expect(toggle.disabled).toBe(false);
        // Nothing to pick from while off, nothing selected, and nothing is fetched yet
        expect(byTestId("bot-voice-option")).toHaveLength(0);
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        // Only the switch: no rows to turn it on or pick a voice from
        expect(byTestId("bot-voice-last")).toHaveLength(0);
        expect(byTestId("bot-voice-pick-another")).toHaveLength(0);
        expect(text()).not.toContain("Use River’s voice");
        expect(mocks.api.getBotVoices).not.toHaveBeenCalled();
        expect(byTestId("bot-voice-card")).toHaveLength(0);
    });

    it("opens on voices to hear with Universe AI's own voice first when the switch is turned on for the first time", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        await startChoosing();
        expect(text()).toContain(
            "Pick a voice and people next to Tinyfish can talk with it out loud. Text chat stays as it is."
        );
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "universe-ai", "speech");
        const rows = byTestId("bot-voice-option");
        expect(rows).toHaveLength(2);
        // Universe AI's own voice (River, set by a super admin) is first, with no tag on it, and nothing is picked yet
        expect(rows[0].textContent).toContain("River");
        expect(rows[0].textContent).not.toContain("Recommended");
        expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "false"]);
        expect(text()).toContain("Pick a voice");
        expect((byTestId("bot-voice-go")[0] as HTMLButtonElement).disabled).toBe(true);
        await click("bot-voice-option");
        expect(byTestId("bot-voice-option")[0].getAttribute("aria-checked")).toBe("true");
        expect(text()).toContain("Use River’s voice");
        expect(text()).toContain(
            "Free for you. Each person gets up to 25 voice replies every 5 hours, then Tinyfish answers them in text."
        );
        // The switch shows on while a voice is picked, but nothing is saved until Use is tapped
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(true);
        expect(mocks.api.setBotVoiceEnabled).not.toHaveBeenCalled();
        // No company, model or who-pays question
        expect(text()).not.toContain("Who pays");
        expect(text()).not.toContain("Eleven");
        expect(text()).not.toContain("eleven_v4_turbo");
        expect(byTestId("bot-voice-payer-change")).toHaveLength(0);
        expect(byTestId("bot-voice-card")).toHaveLength(0);
    });

    it("closes the voices again when the switch is flipped back off, with nothing saved", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        await mount();
        await startChoosing();
        expect(byTestId("bot-voice-option")).toHaveLength(2);
        expect(byTestId("bot-voice-door-cancel")).toHaveLength(0);
        await click("bot-voice-switch");
        expect(text()).toContain("Voice is off for Tinyfish.");
        expect(byTestId("bot-voice-option")).toHaveLength(0);
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        expect(mocks.api.setBotVoiceEnabled).not.toHaveBeenCalled();
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(false);
    });

    it("turns on with one tap on Use, with the picked voice and Universe AI's current models", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await startChoosing();
        await click("bot-voice-option");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
            recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
            speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-river", voiceName: "River" },
            expression: "natural",
            language: { mode: "follow" },
        });
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
        // No note repeating what the header and the voice card already say
        expect(text()).not.toContain("talks in bubbles now");
        expect(byTestId("bot-voice-first-on")).toHaveLength(0);
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
        await startChoosing();
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
            talk: false,
        }));
        mocks.api.getBotVoices.mockResolvedValue(many);
        mocks.api.getBotVoice.mockResolvedValue(
            answer({ voiceLimits: { ...limitsAnswer(), limits: { ...limitsAnswer().limits, voicesShownFirst: 2 } } })
        );
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await startChoosing();
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
        await startChoosing();
        expect(text()).toContain("Couldn’t load the voices.");
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        await click("bot-voice-door-retry");
        expect(byTestId("bot-voice-option")).toHaveLength(2);
    });

    it("treats a source that lists no voice as a failure to load, with Try again, not a dead button", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.getBotVoices.mockResolvedValueOnce([]).mockResolvedValue(voices);
        await mount();
        await startChoosing();
        expect(text()).toContain("Couldn’t load the voices.");
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        await click("bot-voice-door-retry");
        expect(byTestId("bot-voice-option")).toHaveLength(2);
    });

    it("keeps the voice it was turned off with, says so in the header, and shows only the switch", async () => {
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(), enabled: false });
        await mount();
        expect(text()).toContain("Voice Off · River is remembered");
        expect(text()).toContain("Voice is off for Tinyfish.");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(false);
        expect(byTestId("bot-voice-option")).toHaveLength(0);
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        expect(byTestId("bot-voice-last")).toHaveLength(0);
        expect(byTestId("bot-voice-turn-on")).toHaveLength(0);
        expect(byTestId("bot-voice-pick-another")).toHaveLength(0);
        expect(text()).not.toContain("Used before");
        expect(mocks.api.getBotVoices).not.toHaveBeenCalled();
    });

    it("turns on again with the voice it had in one tap, without making a new version", async () => {
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(), enabled: false });
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await click("bot-voice-switch");
        expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(true);
        expect(byTestId("bot-voice-option")).toHaveLength(0);
        expect(byTestId("bot-voice-card")).toHaveLength(1);
        expect(text()).not.toContain("talks in bubbles now");
    });

    it("stays off, with the voice list still hidden, when turning on again fails", async () => {
        mocks.api.getBotVoice.mockResolvedValue({ ...turnedOn(), enabled: false });
        mocks.api.setBotVoiceEnabled.mockRejectedValue(new Error("nope"));
        await mount();
        await click("bot-voice-switch");
        expect(text()).toContain("Couldn’t save that. nope");
        expect(text()).toContain("Voice Off · River is remembered");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(false);
        expect(byTestId("bot-voice-option")).toHaveLength(0);
    });

    it("turns off from the switch, and shows it off with the voice it had kept", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.setBotVoiceEnabled.mockResolvedValue({ ...turnedOn(), enabled: false });
        await mount();
        await click("bot-voice-switch");
        expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", false);
        // Off is plain: the switch is off, the voice it had is remembered, and the voice list is gone
        expect(text()).toContain("Voice Off · River is remembered");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).checked).toBe(false);
        expect(byTestId("bot-voice-option")).toHaveLength(0);
        expect(byTestId("bot-voice-go")).toHaveLength(0);
        expect(text()).not.toContain("Talks in bubbles now");
    });

    it("picks the lent key for you, with its voices, and turns on without asking who pays", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
        mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [key()] })
        );
        await mount();
        await startChoosing();
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-el", "speech");
        expect(text()).toContain("Universe AI listens. Your ElevenLabs key speaks.");
        expect(text()).toContain("You pay; people talking with Tinyfish pay nothing.");
        expect(text()).toContain("Voices on your ElevenLabs key");
        expect(text()).not.toContain("Who pays for");
        await click("bot-voice-option");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "uai-listen" },
            speech: { providerId: "key-el", voiceId: "v-river" },
        });
        expect(text()).toContain("Universe AI listens. Your ElevenLabs key speaks.");
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
        await startChoosing();
        await click("bot-voice-payer-change");
        // The key only speaks, so Universe AI is the one place for both jobs; the split is open, as the voice starts split
        expect(byTestId("bot-voice-both-universe-ai")).toHaveLength(1);
        expect(byTestId("bot-voice-both-key-el")).toHaveLength(0);
        expect(byTestId("bot-voice-split")[0].getAttribute("aria-expanded")).toBe("true");
        expect(byTestId("bot-voice-speech-key-el")[0].getAttribute("aria-checked")).toBe("true");
        expect(byTestId("bot-voice-recognition-universe-ai")[0].getAttribute("aria-checked")).toBe("true");
        expect(byTestId("bot-voice-recognition-key-el")).toHaveLength(0);
        expect(text()).toContain("Why split?");
        await click("bot-voice-both-universe-ai");
        expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "universe-ai", "speech");
        expect(text()).toContain("Paid by Universe AI");
        await click("bot-voice-option");
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
        expect(text()).toContain("Universe AI listens. Khalid’s ElevenLabs key speaks.");
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
        // Which companies a key can come from is the server's choice, so the line names none
        expect(text()).toContain("Add a voice key from any company this server offers in AI keys, and lend it here.");
        expect(text()).not.toMatch(/ElevenLabs, Deepgram|Deepgram or Cartesia/);
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

    describe("Hear this voice say hello (#1852)", () => {
        const hello = () => byTestId("bot-voice-hello")[0] as HTMLButtonElement | undefined;

        it("is a row under the voice card while voice is on, and says it costs one of the person's voice replies on Universe AI", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn());
            await mount();
            expect(hello()?.textContent).toContain("Hear this voice say hello");
            expect(hello()?.textContent).toContain("Uses 1 of your voice replies; hearing it again soon is free.");
            // Under the voice card, above How it speaks
            const card = byTestId("bot-voice-card")[0];
            const row = hello()!;
            expect(card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(text().indexOf("Hear this voice say hello")).toBeLessThan(text().indexOf("How it speaks"));
        });

        it("names the lent key that pays instead", async () => {
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn(
                    { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } },
                    { lentKeys: [key()] }
                )
            );
            await mount();
            expect(hello()?.textContent).toContain("Uses a few characters of your ElevenLabs key;");
            expect(hello()?.textContent).not.toContain("voice replies");
        });

        it("is not on the page while voice is off, or while the key is down", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer());
            await mount();
            expect(hello()).toBeUndefined();
            destroy();
            document.body.innerHTML = "";
            target = document.createElement("div");
            document.body.append(target);
            const down = key({ health: { status: "down", downSince: "2026-11-03T06:12:00Z", downReason: "credit" } });
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn(
                    { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } },
                    { lentKeys: [down] }
                )
            );
            await mount();
            expect(text()).toContain("Paused · your key is out of credit");
            expect(hello()).toBeUndefined();
        });

        it("says hello for this bot in the language of the game, and the page looks again when the voice company refused the key", async () => {
            const refused = Object.assign(new Error("provider"), {
                status: 502,
                body: { error: "provider", providerStatus: 401, rejected: true },
            });
            mocks.api.sayBotHello.mockRejectedValue(refused);
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn(
                    { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } },
                    { lentKeys: [key()] }
                )
            );
            await mount();
            const loads = mocks.api.getBotVoice.mock.calls.length;
            await click("bot-voice-hello");
            expect(mocks.api.sayBotHello).toHaveBeenCalledWith("b1", "en-US");
            // Asked again, quietly: the page does not flash its loading state
            expect(mocks.api.getBotVoice.mock.calls.length).toBe(loads + 1);
            expect(text()).not.toContain("Loading");
        });
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

    it("still lets the maker move a job off a key that is no longer lent, onto another lent key", async () => {
        mocks.api.getBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-old" } }, { lentKeys: [key()] })
        );
        mocks.api.getMyVoiceKeys.mockResolvedValue([{ id: "key-old", adapter: "elevenlabs" }]);
        mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
        mocks.api.saveBotVoice.mockResolvedValue(
            turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } }, { lentKeys: [key()] })
        );
        await mount();
        await click("bot-voice-more");
        await click("bot-voice-sources-change");
        // Nothing speaks now, so no card is picked for speaking, and the split is open to pick one
        expect(byTestId("bot-voice-split")[0].getAttribute("aria-expanded")).toBe("true");
        expect(byTestId("bot-voice-recognition-universe-ai")[0].getAttribute("aria-checked")).toBe("true");
        expect(byTestId("bot-voice-speech-key-el")[0].getAttribute("aria-checked")).toBe("false");
        expect(byTestId("bot-voice-both-universe-ai")[0].getAttribute("aria-checked")).toBe("false");
        await click("bot-voice-speech-key-el");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "uai-listen" },
            speech: { providerId: "key-el" },
        });
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
        expect(text()).toContain("No voice is set up here yet");
        expect((byTestId("bot-voice-switch")[0] as HTMLInputElement).disabled).toBe(true);
    });

    it("shows the bot's maker a way forward when no voice is set up: Add voice keys opens AI keys", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(options({ viewerIsMaker: true }));
        mocks.api.getBotVoice.mockResolvedValue(answer({ universeAi: { recognition: null, speech: null } }));
        await mount();
        expect(text()).toContain("No voice is set up here yet");
        expect(text()).toContain(
            "Add a voice key in AI keys and lend it to this universe: one key from a company that listens and speaks is enough, or use two companies."
        );
        expect(byTestId("bot-voice-add-keys")).toHaveLength(1);
        await click("bot-voice-add-keys");
        expect(mocks.openOrbitPage).toHaveBeenCalledWith("/admin/you/ai-keys");
    });

    describe("on a Brick's page, whose keys are its owner's own and lent to no universe", () => {
        it("says to add a voice key, never to lend one to a universe", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ universeAi: { recognition: null, speech: null } }));
            await mount(true, true);
            expect(text()).toContain("No voice is set up here yet");
            expect(text()).toContain(
                "Universe AI has no voice here yet. Add a voice key in AI keys: one key from a company that listens and speaks is enough, or use two companies."
            );
            expect(text()).not.toContain("lend");
            expect(text()).not.toContain("this universe");
        });

        it("says a key that is gone is not there, and offers a Universe AI voice", async () => {
            mocks.api.getBotVoice.mockResolvedValue(
                turnedOn({ ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-old" } })
            );
            mocks.api.getMyVoiceKeys.mockResolvedValue([{ id: "key-old", adapter: "elevenlabs" }]);
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn());
            await mount(true, true);
            expect(text()).toContain("Paused · your key is not available");
            expect(text()).toContain("Your ElevenLabs key isn’t there any more");
            expect(text()).toContain("Add the key again in AI keys, or pick a Universe AI voice.");
            expect(text()).not.toContain("lent");
            await click("bot-voice-use-universe-ai");
            expect(mocks.api.saveBotVoice.mock.calls[0][1].speech.providerId).toBe("uai-speak");
        });

        it("names who pays on a key as 'You pay', without 'lent to this universe'", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key()] }));
            await mount(true, true);
            await startChoosing();
            await click("bot-voice-payer-change");
            expect(text()).toContain("You pay");
            expect(text()).not.toContain("lent to this universe");
        });
    });

    it("turns voice on from a listening key and a speaking key when Universe AI has no voice, naming both keys", async () => {
        const none = { universeAi: { recognition: null, speech: null } };
        const ear = (id: string, adapter: string, last4: string) =>
            key({
                id,
                adapter,
                last4,
                recognition: true,
                speech: false,
                models: [{ id: "stt", label: "STT", kind: "recognition" }],
            });
        mocks.api.getBotVoice.mockResolvedValue(
            answer({ ...none, lentKeys: [ear("ear-1", "soniox", "1111"), ear("ear-2", "deepgram", "2222"), key()] })
        );
        mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
        await mount();
        await startChoosing();
        expect(text()).not.toContain("No voice is set up here yet");
        expect(byTestId("bot-voice-add-keys")).toHaveLength(0);
        // No key does both jobs: the two that pair up start picked, listening keys A to Z
        expect(text()).toContain("Your Deepgram key listens. Your ElevenLabs key speaks.");
        await click("bot-voice-payer-change");
        expect(byTestId("bot-voice-both")).toHaveLength(0);
        const ears = [...byTestId("bot-voice-split-recognition")[0].querySelectorAll("[role=radio]")].map((card) =>
            card.getAttribute("data-testid")
        );
        expect(ears).toEqual(["bot-voice-recognition-ear-2", "bot-voice-recognition-ear-1"]);
        await click("bot-voice-recognition-ear-1");
        expect(text()).toContain("Your Soniox key listens. Your ElevenLabs key speaks.");
        mocks.api.saveBotVoice.mockResolvedValue(answer(none));
        mocks.api.setBotVoiceEnabled.mockResolvedValue(answer(none));
        await click("bot-voice-option");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "ear-1" },
            speech: { providerId: "key-el" },
        });
    });

    it("starts on one key whose company listens and speaks, and splits it in a tap", async () => {
        const both = key({
            id: "key-dg",
            adapter: "deepgram",
            recognition: true,
            speech: true,
            models: [
                { id: "nova-3", label: "Nova 3", kind: "recognition" },
                { id: "aura-2", label: "Aura 2", kind: "speech" },
            ],
        });
        mocks.api.getBotVoice.mockResolvedValue(answer({ lentKeys: [key(), both] }));
        mocks.api.getBotVoices.mockImplementation((_bot: string, source: string) =>
            Promise.resolve(voices.map((voice) => ({ ...voice, providerId: source })))
        );
        mocks.api.saveBotVoice.mockResolvedValue(answer());
        mocks.api.setBotVoiceEnabled.mockResolvedValue(turnedOn());
        await mount();
        await startChoosing();
        expect(text()).toContain("Paid by your Deepgram key");
        await click("bot-voice-payer-change");
        expect(byTestId("bot-voice-both-key-dg")[0].getAttribute("aria-checked")).toBe("true");
        expect(byTestId("bot-voice-both-universe-ai")[0].getAttribute("aria-checked")).toBe("false");
        // Splitting is one row away, closed while one key does both
        expect(byTestId("bot-voice-split")[0].getAttribute("aria-expanded")).toBe("false");
        expect(byTestId("bot-voice-speech-key-el")).toHaveLength(0);
        await click("bot-voice-split");
        await click("bot-voice-speech-key-el");
        expect(text()).toContain("Your Deepgram key listens. Your ElevenLabs key speaks.");
        // The card for one key doing both is no longer picked once the jobs are split
        expect(byTestId("bot-voice-both-key-dg")[0].getAttribute("aria-checked")).toBe("false");
        expect(byTestId("bot-voice-speech-key-el")[0].getAttribute("aria-checked")).toBe("true");
        await click("bot-voice-option");
        await click("bot-voice-go");
        expect(mocks.api.saveBotVoice.mock.calls[0][1]).toMatchObject({
            recognition: { providerId: "key-dg", model: "nova-3" },
            speech: { providerId: "key-el" },
        });
    });

    it("tells a co-manager, who can't lend keys for the bot, only that voice isn't set up, with no button", async () => {
        mocks.api.getBotAiOptions.mockResolvedValue(
            options({ viewerIsMaker: false, maker: { id: "u9", name: "Khalid" } })
        );
        mocks.api.getBotVoice.mockResolvedValue(answer({ universeAi: { recognition: null, speech: null } }));
        await mount();
        expect(text()).toContain("No voice is set up here yet");
        expect(text()).not.toContain("Add voice keys");
        expect(byTestId("bot-voice-add-keys")).toHaveLength(0);
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
        expect(text()).toContain("Voice is off for Tinyfish.");
    });

    it("shows the line Orbit refused a change with, and keeps the voice as it was", async () => {
        mocks.api.getBotVoice.mockResolvedValue(turnedOn());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("The providers in the voice profile don't work right now"));
        await mount();
        await click("bot-voice-style-restrained");
        expect(text()).toContain("Couldn’t save that. The providers in the voice profile don't work right now");
        expect(text()).toContain("River · Natural · Universe AI");
    });

    it("says why turning voice on failed, and stays off with the voices still open to try again", async () => {
        mocks.api.getBotVoice.mockResolvedValue(answer());
        mocks.api.saveBotVoice.mockRejectedValue(new Error("nope"));
        await mount();
        await startChoosing();
        await click("bot-voice-option");
        await click("bot-voice-go");
        expect(text()).toContain("Couldn’t save that. nope");
        expect(text()).toContain("Voice Off · Give Tinyfish a voice");
        expect(byTestId("bot-voice-option")).toHaveLength(2);
        expect((byTestId("bot-voice-go")[0] as HTMLButtonElement).disabled).toBe(false);
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

        it("keeps the model of a key one row, preselected with no tag, and Change opens the whole list", async () => {
            mocks.api.getBotVoice.mockResolvedValue(onKey());
            mocks.api.saveBotVoice.mockResolvedValue(onKey());
            await mount();
            await click("bot-voice-more");
            expect(text()).toContain("Language, who pays, model, versions");
            const row = byTestId("bot-voice-speech-model-change")[0].textContent ?? "";
            expect(row).toContain("Speaking model · Eleven v4 Turbo");
            expect(row).not.toContain("Recommended");
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

        it("talks live on a talking model: one Talking model row, and changing it changes listening too (#1910)", async () => {
            const openAi = key({
                id: "key-oa",
                adapter: "openai",
                name: "My OpenAI",
                recognition: true,
                speech: true,
                models: [
                    { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1", kind: "talk" },
                    { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 mini", kind: "talk" },
                ],
            });
            const live = {
                ...uaiProfile,
                recognition: { providerId: "key-oa", model: "gpt-realtime-2.1" },
                speech: { providerId: "key-oa", model: "gpt-realtime-2.1", voiceId: "marin", voiceName: "Marin" },
            };
            mocks.api.getBotVoices.mockResolvedValue([
                {
                    voiceId: "marin",
                    name: "Marin",
                    description: "",
                    languages: [],
                    previewUrl: null,
                    providerId: "key-oa",
                    model: "gpt-realtime-2.1",
                    talk: true,
                },
            ]);
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(live, { lentKeys: [openAi] }));
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn(live, { lentKeys: [openAi] }));
            await mount();
            expect(byTestId("bot-voice-card")[0].textContent).toContain("Talks live");
            expect(text()).toContain(
                "Your OpenAI key ••••a1b2 listens and speaks live. Tinyfish’s Mind writes every answer, out loud and in text."
            );
            await click("bot-voice-more");
            const row = byTestId("bot-voice-speech-model-change")[0].textContent ?? "";
            expect(row).toContain("Talking model · GPT Realtime 2.1");
            expect(text()).not.toContain("Listening model");
            expect(byTestId("bot-voice-recognition-model-change")).toHaveLength(0);
            await click("bot-voice-speech-model-change");
            const select = byTestId("bot-voice-speech-model")[0] as HTMLSelectElement;
            expect([...select.options].map((option) => option.value)).toEqual([
                "gpt-realtime-2.1",
                "gpt-realtime-2.1-mini",
            ]);
            select.value = "gpt-realtime-2.1-mini";
            select.dispatchEvent(new Event("change"));
            await settle();
            const saved = mocks.api.saveBotVoice.mock.calls[0][1];
            expect(saved.speech).toMatchObject({ providerId: "key-oa", model: "gpt-realtime-2.1-mini" });
            expect(saved.recognition).toEqual({ providerId: "key-oa", model: "gpt-realtime-2.1-mini" });
        });

        describe("a key that speaks on its own and talks live, whose voices differ (Amazon Polly and Nova Sonic)", () => {
            const SONIC = "amazon.nova-2-sonic-v1:0";
            const aws = key({
                id: "key-aws",
                adapter: "aws",
                name: "My AWS",
                recognition: true,
                speech: true,
                models: [
                    { id: "amazon-transcribe", label: "Amazon Transcribe", kind: "recognition" },
                    { id: "generative", label: "Generative", kind: "speech" },
                    { id: SONIC, label: "Nova 2 Sonic", kind: "talk" },
                ],
            });
            const voiceOf = (voiceId: string, name: string, model: string, talk: boolean): VoiceChoice => ({
                voiceId,
                name,
                description: "",
                languages: ["en"],
                previewUrl: null,
                providerId: "key-aws",
                model,
                talk,
            });
            const polly = [
                voiceOf("Matthew", "Matthew", "generative", false),
                voiceOf("Ruth", "Ruth", "generative", false),
            ];
            const sonic = [voiceOf("tiffany", "Tiffany", SONIC, true), voiceOf("matthew", "Matthew", SONIC, true)];
            beforeEach(() => {
                mocks.api.getBotVoices.mockImplementation((_bot: string, _source: string, part: string) =>
                    Promise.resolve(part === "talk" ? sonic : polly)
                );
            });

            it("lists Nova Sonic's own voices while the bot talks live on it", async () => {
                const live = {
                    ...uaiProfile,
                    recognition: { providerId: "key-aws", model: SONIC },
                    speech: { providerId: "key-aws", model: SONIC, voiceId: "tiffany", voiceName: "Tiffany" },
                };
                mocks.api.getBotVoice.mockResolvedValue(turnedOn(live, { lentKeys: [aws] }));
                await mount();
                expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-aws", "talk");
                expect(mocks.api.getBotVoices).not.toHaveBeenCalledWith("b1", "key-aws", "speech");
            });

            const pickSpeechModel = async (model: string) => {
                await click("bot-voice-more");
                await click("bot-voice-speech-model-change");
                const select = byTestId("bot-voice-speech-model")[0] as HTMLSelectElement;
                expect([...select.options].map((option) => option.value)).toEqual(["generative", SONIC]);
                select.value = model;
                select.dispatchEvent(new Event("change"));
                await settle();
            };

            it("goes live from the Speaking model row on a Nova Sonic voice, and listening goes live too", async () => {
                const speaking = {
                    ...uaiProfile,
                    speech: { providerId: "key-aws", model: "generative", voiceId: "Ruth", voiceName: "Ruth" },
                };
                mocks.api.getBotVoice.mockResolvedValue(turnedOn(speaking, { lentKeys: [aws] }));
                mocks.api.saveBotVoice.mockResolvedValue(turnedOn(speaking, { lentKeys: [aws] }));
                await mount();
                expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-aws", "speech");
                await pickSpeechModel(SONIC);
                expect(mocks.api.getBotVoices).toHaveBeenCalledWith("b1", "key-aws", "talk");
                const saved = mocks.api.saveBotVoice.mock.calls[0][1];
                // Polly's Ruth is not a Nova Sonic voice: the first one Nova Sonic lists is taken
                expect(saved.speech).toEqual({
                    providerId: "key-aws",
                    model: SONIC,
                    voiceId: "tiffany",
                    voiceName: "Tiffany",
                });
                expect(saved.recognition).toEqual({ providerId: "key-aws", model: SONIC });
            });

            it("stops talking live from the same row on a Polly voice, and listens with Transcribe again", async () => {
                const live = {
                    ...uaiProfile,
                    recognition: { providerId: "key-aws", model: SONIC },
                    speech: { providerId: "key-aws", model: SONIC, voiceId: "matthew", voiceName: "Matthew" },
                };
                mocks.api.getBotVoice.mockResolvedValue(turnedOn(live, { lentKeys: [aws] }));
                mocks.api.saveBotVoice.mockResolvedValue(turnedOn(live, { lentKeys: [aws] }));
                await mount();
                await pickSpeechModel("generative");
                const saved = mocks.api.saveBotVoice.mock.calls[0][1];
                expect(saved.speech).toEqual({
                    providerId: "key-aws",
                    model: "generative",
                    voiceId: "Matthew",
                    voiceName: "Matthew",
                });
                expect(saved.recognition).toEqual({ providerId: "key-aws", model: "amazon-transcribe" });
            });
        });

        it("keeps the choice of where each job runs one tap away when a key is lent, and saves it", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(uaiProfile, { lentKeys: [key()] }));
            mocks.api.getBotVoices.mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-el" })));
            mocks.api.saveBotVoice.mockResolvedValue(onKey());
            await mount();
            await click("bot-voice-more");
            expect(byTestId("bot-voice-speech-key")).toHaveLength(0);
            await click("bot-voice-sources-change");
            expect(text()).toContain("One company for both");
            expect(byTestId("bot-voice-both-universe-ai")[0].getAttribute("aria-checked")).toBe("true");
            await click("bot-voice-split");
            expect(text()).toContain("Listens with");
            expect(text()).toContain("Speaks with");
            expect(text()).toContain("Why split?");
            expect(byTestId("bot-voice-speech-universe-ai")[0].getAttribute("aria-checked")).toBe("true");
            await click("bot-voice-speech-key-el");
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
            expect(byTestId("bot-voice-language-follow")[0].textContent).not.toContain("Recommended");
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

    describe("a speech server of the person's own that lists no voices (#1874)", () => {
        const none = { universeAi: { recognition: null, speech: null } };
        const own = key({
            id: "key-own",
            adapter: "openai-compatible",
            name: "My server",
            recognition: true,
            speech: true,
            last4: "",
            models: [
                { id: "whisper-1", label: "Whisper", kind: "recognition" },
                { id: "kokoro", label: "Kokoro", kind: "speech" },
            ],
        });
        const ownProfile = (voiceId = "af_heart") => ({
            recognition: { providerId: "key-own", model: "whisper-1" },
            speech: { providerId: "key-own", model: "kokoro", voiceId, voiceName: voiceId },
            expression: "natural",
            language: { mode: "follow" },
        });
        // What Orbit answers (and the game keeps) when the server lists no voices
        const noList = () =>
            Object.assign(new Error("It doesn’t list its voices."), { status: 409, code: "no_voice_list" });
        const typedField = () => byTestId("bot-voice-typed")[0] as HTMLInputElement;
        const type = async (value: string) => {
            typedField().value = value;
            typedField().dispatchEvent(new Event("input", { bubbles: true }));
            await settle();
        };

        beforeEach(() => {
            mocks.api.getBotVoices.mockRejectedValue(noList());
            mocks.api.checkBotVoiceName.mockResolvedValue(undefined);
        });

        it("at the door asks for the voice's name in place of the list, with no Try again, and names the server as one", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            await mount();
            await startChoosing();
            expect(typedField()).toBeDefined();
            expect(text()).toContain("Voice on your speech server");
            expect(text()).toContain("Your speech server doesn’t list its voices.");
            expect(text()).not.toContain("Couldn’t load the voices");
            expect(byTestId("bot-voice-door-retry")).toHaveLength(0);
            // One caption, not two
            expect(byTestId("bot-voice-door-caption")).toHaveLength(1);
            // The server, not a company's key: nobody is paid
            expect(text()).toContain("Runs on your speech server");
            expect(text()).toContain(
                "It listens and speaks. No voice company is paid, and people talking with Tinyfish pay nothing."
            );
            expect(text()).not.toContain("Openai-compatible");
            expect(text()).not.toContain("You pay");
            expect(text()).toContain("A short line said by your speech server. Free: no voice company is paid.");
            expect((byTestId("bot-voice-go")[0] as HTMLButtonElement).disabled).toBe(true);
        });

        it("turns voice on with the name once the server has said hello with it, from the server and model it would speak on", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            mocks.api.saveBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            mocks.api.setBotVoiceEnabled.mockResolvedValue(
                turnedOn(ownProfile("bm_george"), { ...none, lentKeys: [own] })
            );
            await mount();
            await startChoosing();
            await type("bm_george");
            await click("bot-voice-go");
            expect(mocks.api.checkBotVoiceName).toHaveBeenCalledWith("b1", "en-US", {
                voiceId: "bm_george",
                source: { providerId: "key-own", model: "kokoro" },
            });
            expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
                recognition: { providerId: "key-own", model: "whisper-1" },
                speech: { providerId: "key-own", model: "kokoro", voiceId: "bm_george", voiceName: "bm_george" },
                expression: "natural",
                language: { mode: "follow" },
            });
            expect(mocks.api.setBotVoiceEnabled).toHaveBeenCalledWith("b1", true);
            expect(byTestId("bot-voice-card")[0].textContent).toContain("bm_george");
        });

        it("saves nothing when the server did not take the name, and says so once", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            mocks.api.checkBotVoiceName.mockRejectedValue(
                Object.assign(new Error("provider"), {
                    status: 502,
                    body: { error: "provider", providerStatus: 404, rejected: false },
                })
            );
            await mount();
            await startChoosing();
            await type("nope");
            await click("bot-voice-go");
            expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
            expect(mocks.api.setBotVoiceEnabled).not.toHaveBeenCalled();
            expect(byTestId("bot-voice-typed-error")).toHaveLength(1);
            expect(byTestId("bot-voice-typed-error")[0].textContent).toContain("didn’t take “nope” as a voice name");
        });

        it("keeps Try again for a server that did not answer, as that says nothing about its voices", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            mocks.api.getBotVoices.mockRejectedValue(Object.assign(new Error("down"), { status: 502 }));
            await mount();
            await startChoosing();
            expect(byTestId("bot-voice-typed")).toHaveLength(0);
            expect(byTestId("bot-voice-door-retry")).toHaveLength(1);
        });

        it("after a Try again that finds the voices, shows them as for any other key", async () => {
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            mocks.api.getBotVoices
                .mockRejectedValueOnce(Object.assign(new Error("down"), { status: 502 }))
                .mockResolvedValue(voices.map((voice) => ({ ...voice, providerId: "key-own", model: "kokoro" })));
            await mount();
            await startChoosing();
            await click("bot-voice-door-retry");
            expect(byTestId("bot-voice-option")).toHaveLength(2);
            expect(byTestId("bot-voice-typed")).toHaveLength(0);
        });

        it("on a bot that speaks shows the name as typed, with no sample to play, and says the hello is free", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(ownProfile(), { ...none, lentKeys: [own] }));
            await mount();
            expect(text()).toContain("af_heart");
            expect(text()).toContain("Name typed for your speech server");
            expect(byTestId("bot-voice-card-play")).toHaveLength(0);
            expect(text()).toContain("A short line said by your speech server. Free: no voice company is paid.");
            expect(text()).toContain("Runs on your speech server");
            expect(text()).not.toContain("You pay");
        });

        it("Change asks for another name, hears it from the bot's own server, and keeps it only when the server said it", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(ownProfile(), { ...none, lentKeys: [own] }));
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn(ownProfile("bm_george"), { ...none, lentKeys: [own] }));
            await mount();
            await click("bot-voice-change");
            expect(text()).toContain("Voice for Tinyfish on your speech server");
            expect(typedField().value).toBe("af_heart");
            // The name it speaks with is not worth using again
            expect((byTestId("bot-voice-use")[0] as HTMLButtonElement).disabled).toBe(true);
            await type("bm_george");
            await click("bot-voice-use");
            // The bot already speaks on this server: no source is named
            expect(mocks.api.checkBotVoiceName).toHaveBeenCalledWith("b1", "en-US", {
                voiceId: "bm_george",
                source: undefined,
            });
            expect(mocks.api.saveBotVoice.mock.calls[0][1].speech).toEqual({
                providerId: "key-own",
                model: "kokoro",
                voiceId: "bm_george",
                voiceName: "bm_george",
            });
            // Back on the page with the new name
            expect(byTestId("bot-voice-typed")).toHaveLength(0);
        });

        it("moving a bot that speaks onto it from Who pays asks for the name first, with nothing saved and no error", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(uaiProfile, { lentKeys: [own] }));
            mocks.api.getBotVoices.mockImplementation((_bot: string, source: string) =>
                source === "key-own" ? Promise.reject(noList()) : Promise.resolve(voices)
            );
            mocks.api.saveBotVoice.mockResolvedValue(turnedOn(ownProfile("bm_george"), { lentKeys: [own] }));
            await mount();
            await click("bot-voice-more");
            await click("bot-voice-sources-change");
            await click("bot-voice-both-key-own");
            expect(mocks.api.saveBotVoice).not.toHaveBeenCalled();
            expect(byTestId("bot-voice-error")).toHaveLength(0);
            expect(text()).toContain("Voice for Tinyfish on your speech server");
            await type("bm_george");
            await click("bot-voice-use");
            // The bot still speaks on Universe AI: the server and model to hear it from are named
            expect(mocks.api.checkBotVoiceName).toHaveBeenCalledWith("b1", "en-US", {
                voiceId: "bm_george",
                source: { providerId: "key-own", model: "kokoro" },
            });
            expect(mocks.api.saveBotVoice).toHaveBeenCalledWith("b1", {
                recognition: { providerId: "key-own", model: "whisper-1" },
                speech: { providerId: "key-own", model: "kokoro", voiceId: "bm_george", voiceName: "bm_george" },
                expression: "natural",
                language: { mode: "follow" },
            });
            expect(byTestId("bot-voice-typed")).toHaveLength(0);
        });

        it("names the server as Sara's to a co-manager", async () => {
            mocks.api.getBotAiOptions.mockResolvedValue(
                options({ viewerIsMaker: false, maker: { id: "u2", name: "Sara" } })
            );
            mocks.api.getBotVoice.mockResolvedValue(answer({ ...none, lentKeys: [own] }));
            await mount();
            await startChoosing();
            expect(text()).toContain("Voice on Sara’s speech server");
            expect(text()).toContain("Runs on Sara’s speech server");
        });

        it("leaves a company's key as it was: a play button, its own wording", async () => {
            mocks.api.getBotVoice.mockResolvedValue(turnedOn(uaiProfile));
            mocks.api.getBotVoices.mockResolvedValue(voices);
            await mount();
            expect(byTestId("bot-voice-card-play")).toHaveLength(1);
            expect(text()).not.toContain("speech server");
        });
    });
});
