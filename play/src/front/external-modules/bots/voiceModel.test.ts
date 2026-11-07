import { describe, expect, it } from "vitest";
import {
    choicesFor,
    fullProfile,
    helloFailureOf,
    limitsOf,
    modelLabel,
    noService,
    pauseOf,
    payerKind,
    payerOptions,
    previewKind,
    providerOf,
    readBotVoice,
    readHello,
    sourceOf,
    startingVoice,
    viewOf,
    filterVoices,
    doorVoices,
    startingPayer,
    voiceLanguages,
    type BotVoice,
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
        expect(options.map((option) => option.id)).toEqual(["universe-ai", "key-el"]);
        expect(options[1]).toMatchObject({ recognition: { kind: "universe-ai" }, speech: { kind: "key" } });
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
        expect(startingPayer(voice, null)?.id).toBe("key-el");
        const before = { speech: { providerId: "uai-speak", model: "m", voiceId: "x" } };
        expect(startingPayer(voice, before)?.id).toBe("universe-ai");
        const onKey = { speech: { providerId: "key-el", model: "m", voiceId: "x" } };
        expect(startingPayer(voice, onKey)?.id).toBe("key-el");
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
        expect(startingPayer(read({ lentKeys: [down, another] }), onKey)?.id).toBe("key-2");
        // Nothing else to start on: the key is still offered, and the page says it is down
        expect(
            startingPayer(read({ lentKeys: [down], universeAi: { recognition: null, speech: null } }), null)
        ).toBeNull();
    });

    it("reads as no service when no way covers both jobs, even though each job has something to run on", () => {
        const listens = keyAnswer({
            id: "ear",
            recognition: true,
            speech: false,
            models: [{ id: "nova", kind: "recognition" }],
        });
        const speaks = keyAnswer({ id: "mouth" });
        const none = { recognition: null, speech: null };
        expect(viewOf(read({ lentKeys: [listens, speaks], universeAi: none })).kind).toBe("no-service");
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
        },
        {
            voiceId: "b",
            name: "Fahad",
            description: "Warm",
            languages: ["ar"],
            previewUrl: null,
            providerId: "p",
            model: "m",
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
