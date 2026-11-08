import { describe, expect, it } from "vitest";
import {
    choicesFor,
    companyName,
    coversBoth,
    fullProfile,
    helloFailureOf,
    isNoVoiceList,
    isOwnServer,
    voiceNameFailureOf,
    limitsOf,
    modelLabel,
    noService,
    optionOf,
    pauseOf,
    payerKind,
    payerOptions,
    previewKind,
    providerOf,
    readBotVoice,
    readVoiceChoices,
    settleTalk,
    talkingModelsOf,
    talksLive,
    modelDoes,
    readHello,
    sourceOf,
    styleReaches,
    splitChoices,
    splitPlaces,
    speaksLive as speaksOnTalkingModel,
    voicesForOption,
    startingVoice,
    viewOf,
    filterVoices,
    doorVoices,
    startingPayer,
    voiceLanguages,
    type BotVoice,
    type FullVoiceProfile,
    type VoiceChoice,
    type VoiceProfile,
} from "./voiceModel";

const orbitAnswer = (over: Record<string, unknown> = {}) => ({
    enabled: false,
    universeAllows: true,
    paidBy: "universe-ai",
    parts: { recognition: "universe-ai", speech: "universe-ai" },
    revision: null,
    draft: { profile: {}, updatedAt: null },
    revisions: [],
    lentKeys: [],
    universeAi: {
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
            defaultVoice: { voiceId: "v-default", voiceName: "River" },
        },
    },
    voiceLimits: {
        revision: 1,
        limits: { turnSeconds: 30, replyCharacters: 600, replySeconds: 60, listenMinutesPerDay: 60 },
        window: { hours: 5, signedIn: { replies: 30, voiceReplies: 25 }, guest: { replies: 10, voiceReplies: 3 } },
    },
    ...over,
});

const keyAnswer = (over: Record<string, unknown> = {}) => ({
    id: "key-el",
    adapter: "elevenlabs",
    name: "My ElevenLabs",
    recognition: false,
    speech: true,
    last4: "a1b2",
    models: [{ id: "eleven_v4_turbo", label: "Eleven v4 Turbo", kind: "speech" }],
    health: { status: "working", downSince: null, downReason: null },
    month: { voiceReplies: 142, botVoiceReplies: 12 },
    limits: {
        replySeconds: { value: 45, recommended: 60, changed: true },
        listenMinutesPerDay: { value: 60, recommended: 60, changed: false },
    },
    ...over,
});

const read = (over: Record<string, unknown> = {}): BotVoice => {
    const voice = readBotVoice(orbitAnswer(over));
    if (!voice) throw new Error("the answer should be readable");
    return voice;
};

const uaiProfile: VoiceProfile = {
    recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
    speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-default", voiceName: "River" },
};
const on = (profile: VoiceProfile, extra: Record<string, unknown> = {}) =>
    read({
        enabled: true,
        revision: 1,
        revisions: [{ number: 1, profile, publishedById: "u1", publishedAt: "2026-11-03T07:00:00Z" }],
        ...extra,
    });

describe("readBotVoice (#1668)", () => {
    it("reads Orbit's answer, with the numbers the page shows", () => {
        const voice = read({ lentKeys: [keyAnswer()] });
        expect(voice.window).toEqual({ hours: 5, voiceReplies: 25 });
        expect(voice.limits.replySeconds).toBe(60);
        expect(voice.lentKeys[0].month.voiceReplies).toBe(142);
        expect(voice.universeAi.speech?.defaultVoice).toEqual({ voiceId: "v-default", voiceName: "River" });
    });

    it("is null for an Orbit that doesn't send what the page reads", () => {
        expect(readBotVoice(null)).toBeNull();
        expect(readBotVoice({ enabled: true, universeAllows: true, revisions: [], lentKeys: [] })).toBeNull();
        const noLimits = orbitAnswer();
        (noLimits.voiceLimits as { window: unknown }).window = {};
        expect(readBotVoice(noLimits)).toBeNull();
    });

    it("leaves out a key it can't read and a default Universe AI job with no model", () => {
        const voice = read({ lentKeys: [{ nonsense: true }], universeAi: { recognition: null, speech: null } });
        expect(voice.lentKeys).toEqual([]);
        expect(voice.universeAi).toEqual({ recognition: null, speech: null });
    });
});

describe("where each part of the voice runs", () => {
    it("tells Universe AI's own provider from a lent key and from a key that went away", () => {
        const voice = on(uaiProfile, { lentKeys: [keyAnswer()] });
        expect(sourceOf(voice, uaiProfile, "speech").kind).toBe("universe-ai");
        const keyed: VoiceProfile = { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } };
        expect(sourceOf(voice, keyed, "speech")).toMatchObject({ kind: "key", key: { id: "key-el" } });
        const gone: VoiceProfile = { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-old" } };
        expect(sourceOf(voice, gone, "speech")).toEqual({ kind: "gone", providerId: "key-old" });
    });

    it("keeps a bot on the server company it started on as Universe AI after the operator switches company (Orbit #840)", () => {
        const stayed: VoiceProfile = {
            ...uaiProfile,
            speech: { providerId: "uai-old-speak", model: "eleven_flash_v2_5", voiceId: "v-aria", voiceName: "Aria" },
        };
        const voice = on(stayed, { serverProviderIds: ["uai-listen", "uai-old-speak"] });
        expect(voice.serverProviderIds).toEqual(["uai-listen", "uai-old-speak"]);
        expect(sourceOf(voice, stayed, "speech")).toEqual({ kind: "universe-ai" });
        expect(pauseOf(voice, stayed)).toBeNull();
        // An older Orbit doesn't say, so the page reads it as before
        expect(read().serverProviderIds).toEqual([]);
        expect(pauseOf(on(stayed), stayed)).toMatchObject({ kind: "key-gone", part: "speech" });
    });

    it("says how the two jobs are paid for", () => {
        const voice = on(uaiProfile, { lentKeys: [keyAnswer()] });
        expect(payerKind(voice, uaiProfile)).toBe("universe-ai");
        expect(payerKind(voice, { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } })).toBe(
            "key-speaks"
        );
        expect(payerKind(voice, { ...uaiProfile, recognition: { providerId: "key-el", model: "m" } })).toBe(
            "key-listens"
        );
    });

    it("uses a key's own limits for the job it does, and the server's for the other", () => {
        const voice = on(uaiProfile, { lentKeys: [keyAnswer()] });
        const keyed: VoiceProfile = { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } };
        expect(limitsOf(voice, uaiProfile)).toEqual({ replySeconds: 60, listenMinutesPerDay: 60 });
        expect(limitsOf(voice, keyed)).toEqual({ replySeconds: 45, listenMinutesPerDay: 60 });
    });
});

describe("when the voice stops", () => {
    const keyed: VoiceProfile = { ...uaiProfile, speech: { ...uaiProfile.speech, providerId: "key-el" } };

    it("a key that is out of credit pauses the bot, and says when", () => {
        const down = keyAnswer({ health: { status: "down", downSince: "2026-11-03T06:12:00Z", downReason: "credit" } });
        const voice = on(keyed, { lentKeys: [down] });
        expect(pauseOf(voice, keyed)).toMatchObject({
            kind: "key-down",
            reason: "credit",
            since: "2026-11-03T06:12:00Z",
        });
        // The payer is never moved: the profile still names the key
        expect(payerKind(voice, keyed)).toBe("key-speaks");
    });

    it("a key that is no longer lent here pauses it", () => {
        expect(pauseOf(on(keyed, { lentKeys: [] }), keyed)).toMatchObject({ kind: "key-gone", part: "speech" });
    });

    it("Universe AI's voice being off on the server pauses a bot on Universe AI", () => {
        const voice = on(uaiProfile, {
            universeAi: { recognition: orbitAnswer().universeAi.recognition, speech: null },
        });
        expect(pauseOf(voice, uaiProfile)).toEqual({ kind: "universe-ai-off", part: "speech" });
    });

    it("a bot that works has no pause", () => {
        expect(pauseOf(on(uaiProfile), uaiProfile)).toBeNull();
    });
});

describe("what the group is in", () => {
    it("is locked when the universe doesn't allow voice bots, even with voice on", () => {
        expect(viewOf(on(uaiProfile, { universeAllows: false })).kind).toBe("not-allowed");
    });

    it("is locked when the server has no voice company for a job", () => {
        const voice = read({ universeAi: { recognition: null, speech: null } });
        expect(noService(voice)).toBe(true);
        expect(viewOf(voice).kind).toBe("no-service");
    });

    it("is off until voice is turned on and a version exists", () => {
        expect(viewOf(read()).kind).toBe("off");
        expect(viewOf(read({ enabled: true })).kind).toBe("off");
        expect(viewOf(on(uaiProfile)).kind).toBe("on");
    });
});

describe("who can pay", () => {
    it("offers Universe AI, and each lent key with Universe AI doing the job the key can't", () => {
        const voice = read({ lentKeys: [keyAnswer()] });
        const options = payerOptions(voice);
        expect(options.map((option) => option.id)).toEqual(["universe-ai", "universe-ai+key-el"]);
        expect(options[1]).toMatchObject({ recognition: { kind: "universe-ai" }, speech: { kind: "key" } });
    });

    it("offers a key that listens and speaks for both jobs first, then every way to split them, A to Z", () => {
        const both = keyAnswer({
            id: "key-dg",
            adapter: "deepgram",
            name: "My Deepgram",
            recognition: true,
            speech: true,
            models: [
                { id: "nova-3", kind: "recognition" },
                { id: "aura-2", kind: "speech" },
            ],
        });
        const voice = read({ lentKeys: [keyAnswer(), both] });
        const options = payerOptions(voice);
        expect(options.filter(coversBoth).map((option) => option.id)).toEqual(["universe-ai", "key-dg"]);
        expect(options.map((option) => option.id)).toEqual([
            "universe-ai",
            "key-dg",
            "universe-ai+key-dg",
            "universe-ai+key-el",
            "key-dg+universe-ai",
            "key-dg+key-el",
        ]);
        expect(splitChoices(voice, "speech").map((choice) => (choice.kind === "key" ? choice.key.id : "uai"))).toEqual([
            "uai",
            "key-dg",
            "key-el",
        ]);
        expect(splitChoices(voice, "recognition").map((choice) => choice.kind)).toEqual(["universe-ai", "key"]);
        const dg = splitChoices(voice, "recognition")[1];
        const el = splitChoices(voice, "speech")[2];
        expect(optionOf(voice, dg, el)?.id).toBe("key-dg+key-el");
        expect(optionOf(voice, el, dg)).toBeUndefined();
        // One key for the whole voice is where it starts
        expect(startingPayer(voice, null)?.id).toBe("key-dg");
    });

    it("leaves out a key that can't be covered, and a key with no model", () => {
        const noUai = read({
            lentKeys: [keyAnswer(), keyAnswer({ id: "k2", speech: false, recognition: true, models: [] })],
            universeAi: { recognition: null, speech: orbitAnswer().universeAi.speech },
        });
        expect(payerOptions(noUai)).toEqual([]);
        expect(choicesFor(noUai, "speech").map((choice) => choice.kind)).toEqual(["universe-ai", "key"]);
    });

    it("takes the first model a source lists for the job, or the one kept", () => {
        const voice = read({
            lentKeys: [
                keyAnswer({
                    models: [
                        { id: "m1", kind: "speech" },
                        { id: "m2", kind: "speech" },
                    ],
                }),
            ],
        });
        const [, key] = choicesFor(voice, "speech");
        expect(providerOf(voice, "speech", key)).toEqual({ providerId: "key-el", model: "m1" });
        expect(providerOf(voice, "speech", key, "m2")).toEqual({ providerId: "key-el", model: "m2" });
        expect(providerOf(voice, "recognition", key)).toBeNull();
    });

    it("always starts Universe AI's part on the model Universe AI uses now, whatever model was kept", () => {
        const voice = read({
            universeAi: {
                recognition: orbitAnswer().universeAi.recognition,
                speech: {
                    ...orbitAnswer().universeAi.speech,
                    models: [{ id: "eleven_v4_turbo" }, { id: "eleven_flash_v2_5" }],
                },
            },
        });
        const [uai] = choicesFor(voice, "speech");
        expect(providerOf(voice, "speech", uai, "eleven_flash_v2_5")).toEqual({
            providerId: "uai-speak",
            model: "eleven_v4_turbo",
        });
    });
});

describe("the Voice row's door", () => {
    const voices = ["a", "b", "c", "d", "e", "f", "g"].map(
        (id): VoiceChoice => ({
            voiceId: id,
            name: id.toUpperCase(),
            description: "",
            languages: [],
            previewUrl: null,
            providerId: "p",
            model: "m",
            talk: false,
        })
    );

    it("shows five voices unless Orbit says another number", () => {
        expect(read().voicesShownFirst).toBe(5);
        expect(
            read({
                voiceLimits: {
                    ...orbitAnswer().voiceLimits,
                    limits: { ...orbitAnswer().voiceLimits.limits, voicesShownFirst: 3 },
                },
            }).voicesShownFirst
        ).toBe(3);
        expect(
            read({
                voiceLimits: {
                    ...orbitAnswer().voiceLimits,
                    limits: { ...orbitAnswer().voiceLimits.limits, voicesShownFirst: 0 },
                },
            }).voicesShownFirst
        ).toBe(5);
    });

    it("puts the voice to start with first, then the company's order, cut at the number to show", () => {
        const voice = read();
        const [uai] = choicesFor(voice, "speech");
        // Universe AI's default voice is not in this list: the first listed starts
        expect(doorVoices(voice, uai, voices).voices.map((item) => item.voiceId)).toEqual(["a", "b", "c", "d", "e"]);
        expect(doorVoices(voice, uai, voices).startId).toBe("a");
        // A voice kept moves to the front, and nothing is listed twice
        const kept = doorVoices(voice, uai, voices, "f");
        expect(kept.voices.map((item) => item.voiceId)).toEqual(["f", "a", "b", "c", "d"]);
        expect(kept.startId).toBe("f");
        // Universe AI's own default voice leads when the list has it
        const withDefault = [...voices, { ...voices[0], voiceId: "v-default", name: "River" }];
        expect(doorVoices(voice, uai, withDefault).startId).toBe("v-default");
        expect(doorVoices(voice, uai, withDefault).voices[0].name).toBe("River");
        expect(doorVoices(voice, uai, []).voices).toEqual([]);
    });

    it("starts on a lent key when there is one, and on the place the last version used when it is still there", () => {
        const voice = read({ lentKeys: [keyAnswer()] });
        expect(startingPayer(voice, null)?.id).toBe("universe-ai+key-el");
        const before = { speech: { providerId: "uai-speak", model: "m", voiceId: "x" } };
        expect(startingPayer(voice, before)?.id).toBe("universe-ai");
        const onKey = { speech: { providerId: "key-el", model: "m", voiceId: "x" } };
        expect(startingPayer(voice, onKey)?.id).toBe("universe-ai+key-el");
        expect(startingPayer(read(), null)?.id).toBe("universe-ai");
        expect(startingPayer(read({ universeAi: { recognition: null, speech: null } }), null)).toBeNull();
    });

    it("never starts on a key that is down while another way works (it would turn on already paused)", () => {
        const down = keyAnswer({ health: { status: "down", downSince: "2026-11-03T06:12:00Z", downReason: "credit" } });
        const voice = read({ lentKeys: [down] });
        expect(startingPayer(voice, null)?.id).toBe("universe-ai");
        const onKey = { speech: { providerId: "key-el", model: "m", voiceId: "x" } };
        expect(startingPayer(voice, onKey)?.id).toBe("universe-ai");
        const another = keyAnswer({ id: "key-2" });
        expect(startingPayer(read({ lentKeys: [down, another] }), onKey)?.id).toBe("universe-ai+key-2");
        // Nothing else to start on: the key is still offered, and the page says it is down
        expect(
            startingPayer(read({ lentKeys: [down], universeAi: { recognition: null, speech: null } }), null)
        ).toBeNull();
    });

    it("offers one key that listens and another that speaks when no Universe AI voice covers either job", () => {
        const listens = keyAnswer({
            id: "ear",
            recognition: true,
            speech: false,
            models: [{ id: "nova", kind: "recognition" }],
        });
        const speaks = keyAnswer({ id: "mouth" });
        const none = { recognition: null, speech: null };
        const voice = read({ lentKeys: [listens, speaks], universeAi: none });
        expect(noService(voice)).toBe(false);
        expect(viewOf(voice).kind).toBe("off");
        expect(payerOptions(voice)).toMatchObject([
            {
                id: "ear+mouth",
                kind: "key",
                recognition: { kind: "key", key: { id: "ear" } },
                speech: { kind: "key", key: { id: "mouth" } },
            },
        ]);
        expect(startingPayer(voice, null)?.id).toBe("ear+mouth");
    });

    it("reads as no service when only a listening key is lent and nothing speaks", () => {
        const listens = keyAnswer({
            id: "ear",
            recognition: true,
            speech: false,
            models: [{ id: "nova", kind: "recognition" }],
        });
        const none = { recognition: null, speech: null };
        expect(viewOf(read({ lentKeys: [listens], universeAi: none })).kind).toBe("no-service");
    });
});

describe("voices", () => {
    const list: VoiceChoice[] = [
        {
            voiceId: "a",
            name: "River",
            description: "Relaxed, neutral",
            languages: ["en"],
            previewUrl: null,
            providerId: "p",
            model: "m",
            talk: false,
        },
        {
            voiceId: "b",
            name: "Fahad",
            description: "Warm",
            languages: ["ar"],
            previewUrl: null,
            providerId: "p",
            model: "m",
            talk: false,
        },
    ];

    it("starts on the voice Universe AI's super admin set, else the first the company lists", () => {
        const voice = read();
        expect(startingVoice(voice, { kind: "universe-ai" }, list)).toEqual({
            voiceId: "v-default",
            voiceName: "River",
        });
        const unset = read({
            universeAi: {
                ...orbitAnswer().universeAi,
                speech: { ...orbitAnswer().universeAi.speech, defaultVoice: null },
            },
        });
        expect(startingVoice(unset, { kind: "universe-ai" }, list)).toEqual({ voiceId: "a", voiceName: "River" });
        expect(startingVoice(unset, { kind: "universe-ai" }, [])).toBeNull();
    });

    it("keeps the voice when the new source lists it", () => {
        expect(startingVoice(read(), { kind: "universe-ai" }, list, "b")).toEqual({ voiceId: "b", voiceName: "Fahad" });
    });

    it("filters by what was typed and the language, and lists the languages", () => {
        expect(voiceLanguages(list)).toEqual(["en", "ar"]);
        expect(filterVoices(list, "far", "").map((choice) => choice.voiceId)).toEqual([]);
        expect(filterVoices(list, "fah", "").map((choice) => choice.voiceId)).toEqual(["b"]);
        expect(filterVoices(list, "", "en").map((choice) => choice.voiceId)).toEqual(["a"]);
    });

    it("knows a sample the company serves from one only Orbit can fetch", () => {
        expect(previewKind(null)).toBe("none");
        expect(previewKind("https://cdn.example.com/a.mp3")).toBe("public");
        expect(previewKind("http://cdn.example.com/a.mp3")).toBe("none");
        expect(previewKind("/api/bots/b1/voice/voices/v1/preview?source=key-1")).toBe("orbit");
        expect(previewKind("/api/other")).toBe("none");
    });

    it("names a model with its id when it has a label", () => {
        expect(modelLabel({ id: "eleven_v4_turbo", label: "Eleven v4 Turbo" })).toBe(
            "Eleven v4 Turbo · eleven_v4_turbo"
        );
        expect(modelLabel({ id: "stt" })).toBe("stt");
    });

    it("a profile missing a part isn't finished", () => {
        expect(fullProfile({})).toBeNull();
        expect(fullProfile(uaiProfile)).toMatchObject({ expression: "natural", language: { mode: "follow" } });
    });
});

describe("talking models (#1910)", () => {
    const openAi = (over: Record<string, unknown> = {}) =>
        keyAnswer({
            id: "key-oa",
            adapter: "openai",
            name: "My OpenAI",
            recognition: true,
            speech: true,
            models: [
                { id: "gpt-realtime-2.1", label: "GPT Realtime 2.1", kind: "talk" },
                { id: "gpt-realtime-2.1-mini", label: "GPT Realtime 2.1 mini", kind: "talk" },
            ],
            ...over,
        });
    const live = {
        recognition: { providerId: "key-oa", model: "gpt-realtime-2.1" },
        speech: { providerId: "key-oa", model: "gpt-realtime-2.1", voiceId: "marin", voiceName: "Marin" },
    };
    const uai = {
        recognition: { providerId: "uai-listen", model: "stt-rt-v6" },
        speech: { providerId: "uai-speak", model: "eleven_v4_turbo", voiceId: "v-default", voiceName: "River" },
    };
    type Parts = Pick<FullVoiceProfile, "recognition" | "speech">;
    const full = (profile: Parts): FullVoiceProfile => ({
        recognition: profile.recognition,
        speech: profile.speech,
        expression: "natural",
        language: { mode: "follow" },
    });

    it("reads a talking model as one that both listens and speaks", () => {
        const voice = read({ lentKeys: [openAi()] });
        expect(voice.lentKeys[0].models.map((model) => model.kind)).toEqual(["talk", "talk"]);
        expect(modelDoes({ kind: "talk" }, "recognition")).toBe(true);
        expect(modelDoes({ kind: "talk" }, "speech")).toBe(true);
        expect(modelDoes({ kind: "speech" }, "recognition")).toBe(false);
        expect(choicesFor(voice, "speech")).toContainEqual({ kind: "key", key: voice.lentKeys[0] });
    });

    it("offers a key that only talks live under speaking, not on its own for listening, and still counts it as a service", () => {
        const voice = read({ lentKeys: [openAi()] });
        expect(choicesFor(voice, "recognition")).not.toContainEqual({ kind: "key", key: voice.lentKeys[0] });
        expect(choicesFor(voice, "speech")).toContainEqual({ kind: "key", key: voice.lentKeys[0] });
        const keyOnly = read({ universeAi: { recognition: null, speech: null }, lentKeys: [openAi()] });
        expect(noService(keyOnly)).toBe(false);
    });

    it("offers a key that only talks live as one place for both jobs, never as half of a split", () => {
        const voice = read({ lentKeys: [openAi()] });
        const ids = payerOptions(voice).map((option) => option.id);
        expect(ids).toContain("key-oa");
        expect(ids.some((id) => id.includes("+") && id.includes("key-oa"))).toBe(false);
        const own = payerOptions(voice).find((option) => option.id === "key-oa");
        expect(own?.recognition).toEqual({ kind: "key", key: voice.lentKeys[0] });
        expect(own?.speech).toEqual({ kind: "key", key: voice.lentKeys[0] });
        const keyOnly = read({ universeAi: { recognition: null, speech: null }, lentKeys: [openAi()] });
        expect(payerOptions(keyOnly).map((option) => option.id)).toEqual(["key-oa"]);
    });

    it("leaves a key that only talks live out of the split lists, so every place there can be half of a split", () => {
        const withOwn = openAi({
            id: "key-ob",
            name: "Also OpenAI",
            models: [...openAi().models, { id: "gpt-listen", kind: "recognition" }, { id: "gpt-tts", kind: "speech" }],
        });
        const voice = read({ lentKeys: [openAi(), withOwn] });
        const id = (choice: { kind: string; key?: { id: string } }) => choice.key?.id ?? choice.kind;
        for (const part of ["recognition", "speech"] as const) {
            const places = splitPlaces(voice, part).map(id);
            expect(places).not.toContain("key-oa");
            expect(places).toContain("key-ob");
        }
        // Each place offered for speaking pairs with Universe AI listening, so picking one always does something
        const uaiListens = { kind: "universe-ai" as const };
        for (const place of splitPlaces(voice, "speech")) {
            expect(optionOf(voice, uaiListens, place)).toBeDefined();
        }
        // The key that only talks live is still offered as one place for both jobs
        expect(
            payerOptions(voice)
                .filter(coversBoth)
                .map((option) => option.id)
        ).toContain("key-oa");
    });

    it("speaks a split on the key's own speaking voices, never a talking model's, so the split holds", () => {
        const withOwn = openAi({
            models: [...openAi().models, { id: "gpt-listen", kind: "recognition" }, { id: "gpt-tts", kind: "speech" }],
        });
        const voice = on(live, { lentKeys: [withOwn] });
        expect(speaksOnTalkingModel(voice, live)).toBe(true);
        const key = { kind: "key" as const, key: voice.lentKeys[0] };
        const split = optionOf(voice, { kind: "universe-ai" }, key);
        const one = optionOf(voice, key, key);
        if (!split || !one) throw new Error("both options should be offered");
        const list = readVoiceChoices([
            { voiceId: "marin", name: "Marin", providerId: "key-oa", model: "gpt-realtime-2.1", talk: true },
            { voiceId: "alloy", name: "Alloy", providerId: "key-oa", model: "gpt-tts", talk: false },
        ]);
        if (!list) throw new Error("the list should be readable");
        expect(voicesForOption(split, list).map((choice) => choice.voiceId)).toEqual(["alloy"]);
        expect(voicesForOption(one, list).map((choice) => choice.voiceId)).toEqual(["marin", "alloy"]);
        // Turning voice on with the split starts on the key's own voice, even when the last version talked live
        const door = doorVoices(voice, split.speech, voicesForOption(split, list), "marin");
        expect(door.voices.map((choice) => choice.voiceId)).toEqual(["alloy"]);
        expect(door.startId).toBe("alloy");
        // Listening on Universe AI and speaking on the key's own model is left as it is
        const next = full({
            ...live,
            recognition: uai.recognition,
            speech: { ...live.speech, model: "gpt-tts", voiceId: "alloy" },
        });
        expect(speaksOnTalkingModel(voice, next)).toBe(false);
        expect(settleTalk(voice, next).recognition).toEqual(uai.recognition);
    });

    it("starts a key with only talking models on its first one, for either part", () => {
        const voice = read({ lentKeys: [openAi()] });
        const key = { kind: "key" as const, key: voice.lentKeys[0] };
        expect(providerOf(voice, "speech", key)).toEqual({ providerId: "key-oa", model: "gpt-realtime-2.1" });
        expect(providerOf(voice, "recognition", key, "gpt-realtime-2.1-mini")).toEqual({
            providerId: "key-oa",
            model: "gpt-realtime-2.1-mini",
        });
    });

    it("names the talking-model companies as they write their own names", () => {
        expect(companyName("openai")).toBe("OpenAI");
        expect(companyName("xai")).toBe("xAI");
        expect(companyName("azure")).toBe("Azure OpenAI");
        expect(companyName("google")).toBe("Google");
        expect(companyName("aws")).toBe("AWS");
        expect(companyName("inworld")).toBe("Inworld");
        expect(companyName("ultravox")).toBe("Ultravox");
        expect(companyName("zoom")).toBe("Zoom");
    });

    it("reads which voices talk live", () => {
        const choices = readVoiceChoices([
            { voiceId: "marin", name: "Marin", providerId: "key-oa", model: "gpt-realtime-2.1", talk: true },
            { voiceId: "v1", name: "River" },
        ]);
        expect(choices?.map((choice) => choice.talk)).toEqual([true, false]);
    });

    it("talks live only when one talking model is named for both parts", () => {
        const voice = on(live, { lentKeys: [openAi()] });
        expect(talksLive(voice, live)).toBe(true);
        expect(talkingModelsOf(voice, live).map((model) => model.id)).toEqual([
            "gpt-realtime-2.1",
            "gpt-realtime-2.1-mini",
        ]);
        const split: VoiceProfile = { ...live, recognition: { providerId: "uai-listen", model: "stt-rt-v6" } };
        expect(talksLive(voice, split)).toBe(false);
        expect(talkingModelsOf(voice, split)).toEqual([]);
        expect(talksLive(voice, uaiProfile)).toBe(false);
    });

    it("names a talking model for listening too, whatever changed", () => {
        const voice = on(live, { lentKeys: [openAi()] });
        const speaksLive = full({ ...uai, speech: live.speech });
        expect(settleTalk(voice, speaksLive).recognition).toEqual(live.recognition);
        const mini = full({ ...live, speech: { ...live.speech, model: "gpt-realtime-2.1-mini" } });
        expect(settleTalk(voice, mini).recognition).toEqual({ providerId: "key-oa", model: "gpt-realtime-2.1-mini" });
        const settled = full(live);
        expect(settleTalk(voice, settled)).toBe(settled);
    });

    it("moves listening off a talking model when speaking moved off it", () => {
        const voice = on(live, { lentKeys: [openAi()] });
        const spoken = full({ ...live, speech: uai.speech });
        expect(settleTalk(voice, spoken).recognition).toEqual({ providerId: "uai-listen", model: "stt-rt-v6" });
        // A key that also listens on its own model keeps listening there
        const both = on(live, {
            lentKeys: [openAi({ models: [...openAi().models, { id: "gpt-listen", kind: "recognition" }] })],
        });
        expect(settleTalk(both, spoken).recognition).toEqual({ providerId: "key-oa", model: "gpt-listen" });
        // A server with no Universe AI listening: another lent key that listens takes it
        const noUaiListening = on(live, {
            universeAi: { recognition: null, speech: orbitAnswer().universeAi.speech },
            lentKeys: [
                openAi(),
                keyAnswer({
                    id: "key-dg",
                    adapter: "deepgram",
                    recognition: true,
                    speech: false,
                    models: [{ id: "nova-3", kind: "recognition" }],
                }),
            ],
        });
        expect(settleTalk(noUaiListening, spoken).recognition).toEqual({ providerId: "key-dg", model: "nova-3" });
        // Nothing to do for a voice that never talked live
        const plain = full(uai);
        expect(settleTalk(voice, plain)).toBe(plain);
    });
});

describe("hearing a bot say hello (#1852)", () => {
    it("reads the hello the bot server sends, and nothing without words and audio", () => {
        expect(readHello({ text: "Hi, I’m Hala.", mime: "audio/wav", audio: "UklGRg==", ms: 2300 })).toEqual({
            text: "Hi, I’m Hala.",
            mime: "audio/wav",
            audio: "UklGRg==",
        });
        // A WAV unless it says otherwise
        expect(readHello({ text: "Hi", audio: "UklGRg==" })?.mime).toBe("audio/wav");
        for (const bad of [
            null,
            "hello",
            [],
            {},
            { text: "Hi" },
            { audio: "UklGRg==" },
            { text: "", audio: "UklGRg==" },
            { text: 3, audio: 4 },
        ]) {
            expect(readHello(bad)).toBeNull();
        }
    });

    const refused = (status: number, body: unknown) => Object.assign(new Error("refused"), { status, body });

    it("says when the voice replies come back for a hello that is used up", () => {
        expect(helloFailureOf(refused(429, { error: "used_up", resetsAt: "2026-11-06T18:40:00.000Z" }))).toEqual({
            kind: "used-up",
            resetsAt: new Date("2026-11-06T18:40:00.000Z"),
        });
        // No time, or one that is not a time: nothing to wait for, so it is just a failure
        expect(helloFailureOf(refused(429, { error: "used_up" }))).toEqual({ kind: "failed" });
        expect(helloFailureOf(refused(429, { error: "used_up", resetsAt: "tomorrow" }))).toEqual({ kind: "failed" });
    });

    it("says the voice was turned off, the voice company's refusal and a key out of credit", () => {
        expect(helloFailureOf(refused(409, { error: "voice_off", reason: "off" }))).toEqual({ kind: "off" });
        expect(helloFailureOf(refused(502, { error: "provider", providerStatus: 401, rejected: true }))).toEqual({
            kind: "provider",
            rejected: true,
            credit: false,
        });
        expect(helloFailureOf(refused(502, { error: "provider", providerStatus: 403, rejected: false }))).toEqual({
            kind: "provider",
            rejected: true,
            credit: false,
        });
        expect(helloFailureOf(refused(502, { error: "provider", providerStatus: 402, rejected: false }))).toEqual({
            kind: "provider",
            rejected: false,
            credit: true,
        });
        expect(helloFailureOf(refused(502, { error: "provider", rejected: false }))).toEqual({
            kind: "provider",
            rejected: false,
            credit: false,
        });
    });

    it("calls anything else a failure, however it came", () => {
        expect(helloFailureOf(refused(502, { error: "no_words" }))).toEqual({ kind: "failed" });
        expect(helloFailureOf(refused(503, { error: "unavailable" }))).toEqual({ kind: "failed" });
        expect(helloFailureOf(refused(429, { error: "busy" }))).toEqual({ kind: "failed" });
        expect(helloFailureOf(new Error("network"))).toEqual({ kind: "failed" });
        expect(helloFailureOf(null)).toEqual({ kind: "failed" });
        expect(helloFailureOf("boom")).toEqual({ kind: "failed" });
    });
});

describe("a speech server that lists no voices (#1874)", () => {
    it("knows Orbit's refusal to list them by its status and its code, and no other failure for it", () => {
        expect(isNoVoiceList(Object.assign(new Error("x"), { status: 409, code: "no_voice_list" }))).toBe(true);
        // A server that is down or refused is a 502 with no code: Try again stays
        expect(isNoVoiceList(Object.assign(new Error("x"), { status: 502 }))).toBe(false);
        expect(isNoVoiceList(Object.assign(new Error("x"), { status: 409 }))).toBe(false);
        expect(isNoVoiceList(Object.assign(new Error("x"), { status: 502, code: "no_voice_list" }))).toBe(false);
        expect(isNoVoiceList(null)).toBe(false);
        expect(isNoVoiceList("no_voice_list")).toBe(false);
    });

    it("names a refused typed name when the server answered 400, 404 or 422, and a silent server for anything else", () => {
        const provider = (providerStatus?: number) => ({
            status: 502,
            body: { error: "provider", ...(providerStatus === undefined ? {} : { providerStatus }), rejected: false },
        });
        for (const status of [400, 404, 422]) expect(voiceNameFailureOf(provider(status))).toBe("rejected");
        for (const status of [401, 402, 429, 500, 503, undefined]) {
            expect(voiceNameFailureOf(provider(status))).toBe("unreachable");
        }
        // The bot server could not reach the voice worker, or the worker the speech server
        expect(voiceNameFailureOf({ status: 503, body: { error: "unavailable" } })).toBe("unreachable");
        expect(voiceNameFailureOf(new Error("network"))).toBe("unreachable");
        expect(voiceNameFailureOf(null)).toBe("unreachable");
    });

    it("tells a speech server of the person's own by its adapter", () => {
        expect(isOwnServer({ adapter: "openai-compatible" })).toBe(true);
        expect(isOwnServer({ adapter: "elevenlabs" })).toBe(false);
    });
});

describe("How it speaks is offered only where the company uses it", () => {
    it("is offered on Universe AI's speaking company when its connector passes the style on", () => {
        expect(styleReaches(on(uaiProfile), uaiProfile)).toBe(true);
        const fish = on(uaiProfile, {
            universeAi: {
                ...orbitAnswer().universeAi,
                speech: { ...orbitAnswer().universeAi.speech, adapter: "fish" },
            },
        });
        expect(styleReaches(fish, uaiProfile)).toBe(false);
    });

    it("follows the lent key's company, and whether its model speaks or talks live", () => {
        const keyed: VoiceProfile = { ...uaiProfile, speech: { providerId: "key-1", model: "m", voiceId: "v" } };
        const withKey = (adapter: string, kind: string) =>
            on(keyed, { lentKeys: [keyAnswer({ id: "key-1", adapter, models: [{ id: "m", kind }] })] });
        expect(styleReaches(withKey("elevenlabs", "speech"), keyed)).toBe(true);
        expect(styleReaches(withKey("deepgram", "speech"), keyed)).toBe(false);
        expect(styleReaches(withKey("soniox", "speech"), keyed)).toBe(false);
        expect(styleReaches(withKey("openai", "talk"), keyed)).toBe(true);
        expect(styleReaches(withKey("inworld", "talk"), keyed)).toBe(false);
        // A company's plain speaking job can ignore it even where its talking model uses it
        expect(styleReaches(withKey("google", "speech"), keyed)).toBe(false);
    });

    it("stays offered when the company can't be told", () => {
        const gone: VoiceProfile = { ...uaiProfile, speech: { providerId: "key-old", model: "m", voiceId: "v" } };
        expect(styleReaches(on(gone), gone)).toBe(true);
        const stayed: VoiceProfile = {
            ...uaiProfile,
            speech: { providerId: "uai-old-speak", model: "m", voiceId: "v" },
        };
        expect(styleReaches(on(stayed, { serverProviderIds: ["uai-old-speak"] }), stayed)).toBe(true);
    });
});
