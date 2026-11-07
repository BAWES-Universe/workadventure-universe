// The bot page's Voice group (#1668): what Orbit says about a bot's voice (GET /api/bots/:id/voice), and the plain rules
// the group draws from it. Nothing here calls Orbit or shows a word: every number, voice and key comes from Orbit's
// answer, and the group puts the words on it.

export type VoiceExpression = "restrained" | "natural" | "expressive";
export type VoicePart = "recognition" | "speech";

export const VOICE_EXPRESSIONS: readonly VoiceExpression[] = ["restrained", "natural", "expressive"];

export type VoiceLanguage = { mode: "follow" } | { mode: "fixed"; code: string };

export interface VoiceProfile {
    recognition?: { providerId?: string; model?: string };
    speech?: { providerId?: string; model?: string; voiceId?: string; voiceName?: string };
    expression?: VoiceExpression;
    language?: VoiceLanguage;
}

/** A profile that names everything: what a published version holds. */
export interface FullVoiceProfile {
    recognition: { providerId: string; model: string };
    speech: { providerId: string; model: string; voiceId: string; voiceName?: string };
    expression: VoiceExpression;
    language: VoiceLanguage;
}

export interface VoiceModel {
    id: string;
    label?: string;
    kind: VoicePart;
}

export interface KeyLimit {
    value: number;
    recommended: number;
    changed: boolean;
}

/** A voice key the bot's maker lent to its universe (never the key itself). */
export interface VoiceKey {
    id: string;
    adapter: string;
    name: string;
    recognition: boolean;
    speech: boolean;
    last4: string;
    models: VoiceModel[];
    health: { status: "working" | "down"; downSince: string | null; downReason: string | null };
    month: { voiceReplies: number; botVoiceReplies: number };
    limits: Partial<Record<"turnSeconds" | "replyCharacters" | "replySeconds" | "listenMinutesPerDay", KeyLimit>>;
}

/** What Universe AI starts from for one job (null: the server has no usable default provider for it). */
export interface UniverseAiPart {
    providerId: string;
    adapter: string;
    name: string;
    model: string;
    models: Array<{ id: string; label: string | null }>;
}

export interface UniverseAiSpeech extends UniverseAiPart {
    defaultVoice: { voiceId: string; voiceName: string | null } | null;
}

export interface VoiceRevision {
    number: number;
    profile: VoiceProfile;
    publishedById: string | null;
    publishedAt: string | null;
}

export interface VoiceLimits {
    turnSeconds: number;
    replyCharacters: number;
    replySeconds: number;
    listenMinutesPerDay: number;
}

export interface BotVoice {
    enabled: boolean;
    universeAllows: boolean;
    parts: { recognition: "universe-ai" | "owner"; speech: "universe-ai" | "owner" };
    /**
     * The server's own providers the live version names (Orbit #840). A bot can stay on one that is no longer Universe AI's
     * default after the operator switches company; Universe AI still pays for it. Empty from an older Orbit.
     */
    serverProviderIds: string[];
    revision: number | null;
    revisions: VoiceRevision[];
    lentKeys: VoiceKey[];
    universeAi: { recognition: UniverseAiPart | null; speech: UniverseAiSpeech | null };
    limits: VoiceLimits;
    window: { hours: number; voiceReplies: number };
    /** How many voices the Voice row shows before "All voices": Orbit's setting, 5 when it doesn't say */
    voicesShownFirst: number;
}

/** What the Voice row shows before "All voices" when Orbit doesn't say (a setting there, recommended 5). */
export const DEFAULT_VOICES_SHOWN_FIRST = 5;

/** One voice a company lists (GET /api/bots/:id/voice/voices). */
export interface VoiceChoice {
    voiceId: string;
    name: string;
    description: string;
    languages: string[];
    previewUrl: string | null;
    providerId: string;
    model: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

function readModels(value: unknown): VoiceModel[] {
    if (!Array.isArray(value)) return [];
    const models: VoiceModel[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const id = text(item.id);
        if (!id || (item.kind !== "recognition" && item.kind !== "speech")) continue;
        models.push({ id, label: text(item.label), kind: item.kind });
    }
    return models;
}

function readKeyLimits(value: unknown): VoiceKey["limits"] {
    const limits: VoiceKey["limits"] = {};
    if (!isRecord(value)) return limits;
    for (const name of ["turnSeconds", "replyCharacters", "replySeconds", "listenMinutesPerDay"] as const) {
        const one = value[name];
        if (!isRecord(one)) continue;
        const current = count(one.value);
        if (current === undefined) continue;
        limits[name] = {
            value: current,
            recommended: count(one.recommended) ?? current,
            changed: one.changed === true,
        };
    }
    return limits;
}

function readKey(value: unknown): VoiceKey | null {
    if (!isRecord(value)) return null;
    const id = text(value.id);
    const adapter = text(value.adapter);
    if (!id || !adapter) return null;
    const health = isRecord(value.health) ? value.health : {};
    const month = isRecord(value.month) ? value.month : {};
    return {
        id,
        adapter,
        name: text(value.name) ?? adapter,
        recognition: value.recognition === true,
        speech: value.speech === true,
        last4: text(value.last4) ?? "",
        models: readModels(value.models),
        health: {
            status: health.status === "down" ? "down" : "working",
            downSince: text(health.downSince) ?? null,
            downReason: text(health.downReason) ?? null,
        },
        month: { voiceReplies: count(month.voiceReplies) ?? 0, botVoiceReplies: count(month.botVoiceReplies) ?? 0 },
        limits: readKeyLimits(value.limits),
    };
}

function readUniverseAiPart(value: unknown): UniverseAiPart | null {
    if (!isRecord(value)) return null;
    const providerId = text(value.providerId);
    const model = text(value.model);
    if (!providerId || !model) return null;
    const models = Array.isArray(value.models)
        ? value.models.flatMap((item) => {
              const id = isRecord(item) ? text(item.id) : undefined;
              return id ? [{ id, label: text((item as Record<string, unknown>).label) ?? null }] : [];
          })
        : [];
    return {
        providerId,
        adapter: text(value.adapter) ?? "",
        name: text(value.name) ?? "Universe AI",
        model,
        models: models.length > 0 ? models : [{ id: model, label: null }],
    };
}

function readProfile(value: unknown): VoiceProfile {
    if (!isRecord(value)) return {};
    const profile: VoiceProfile = {};
    if (isRecord(value.recognition)) {
        profile.recognition = { providerId: text(value.recognition.providerId), model: text(value.recognition.model) };
    }
    if (isRecord(value.speech)) {
        profile.speech = {
            providerId: text(value.speech.providerId),
            model: text(value.speech.model),
            voiceId: text(value.speech.voiceId),
            voiceName: text(value.speech.voiceName),
        };
    }
    if (VOICE_EXPRESSIONS.includes(value.expression as VoiceExpression)) {
        profile.expression = value.expression as VoiceExpression;
    }
    if (isRecord(value.language)) {
        const code = text(value.language.code);
        profile.language = value.language.mode === "fixed" && code ? { mode: "fixed", code } : { mode: "follow" };
    }
    return profile;
}

/**
 * Orbit's answer, checked. Null when it isn't one (an older Orbit without the fields this page reads), so the page
 * says it can't load the voice rather than showing numbers it made up.
 */
export function readBotVoice(data: unknown): BotVoice | null {
    if (!isRecord(data) || typeof data.enabled !== "boolean" || typeof data.universeAllows !== "boolean") return null;
    if (!Array.isArray(data.revisions) || !Array.isArray(data.lentKeys)) return null;
    if (!isRecord(data.universeAi) || !isRecord(data.voiceLimits)) return null;
    const parts = isRecord(data.parts) ? data.parts : {};
    const server = isRecord(data.voiceLimits.limits) ? data.voiceLimits.limits : {};
    const window = isRecord(data.voiceLimits.window) ? data.voiceLimits.window : {};
    const signedIn = isRecord(window.signedIn) ? window.signedIn : {};
    const turnSeconds = count(server.turnSeconds);
    const replyCharacters = count(server.replyCharacters);
    const replySeconds = count(server.replySeconds);
    const listenMinutesPerDay = count(server.listenMinutesPerDay);
    const shownFirst = count(server.voicesShownFirst);
    const hours = count(window.hours);
    const voiceReplies = count(signedIn.voiceReplies);
    if (
        turnSeconds === undefined ||
        replyCharacters === undefined ||
        replySeconds === undefined ||
        listenMinutesPerDay === undefined ||
        hours === undefined ||
        voiceReplies === undefined
    ) {
        return null;
    }
    const speech = readUniverseAiPart(data.universeAi.speech);
    const defaultVoice =
        isRecord(data.universeAi.speech) && isRecord(data.universeAi.speech.defaultVoice)
            ? data.universeAi.speech.defaultVoice
            : null;
    const defaultVoiceId = defaultVoice ? text(defaultVoice.voiceId) : undefined;
    return {
        enabled: data.enabled,
        universeAllows: data.universeAllows,
        parts: {
            recognition: parts.recognition === "owner" ? "owner" : "universe-ai",
            speech: parts.speech === "owner" ? "owner" : "universe-ai",
        },
        serverProviderIds: Array.isArray(data.serverProviderIds)
            ? data.serverProviderIds.filter((id): id is string => typeof id === "string" && id !== "")
            : [],
        revision: count(data.revision) ?? null,
        revisions: data.revisions.flatMap((item) => {
            if (!isRecord(item)) return [];
            const number = count(item.number);
            return number === undefined
                ? []
                : [
                      {
                          number,
                          profile: readProfile(item.profile),
                          publishedById: text(item.publishedById) ?? null,
                          publishedAt: text(item.publishedAt) ?? null,
                      },
                  ];
        }),
        lentKeys: data.lentKeys.flatMap((item) => {
            const key = readKey(item);
            return key ? [key] : [];
        }),
        universeAi: {
            recognition: readUniverseAiPart(data.universeAi.recognition),
            speech: speech && {
                ...speech,
                defaultVoice: defaultVoiceId
                    ? { voiceId: defaultVoiceId, voiceName: defaultVoice ? text(defaultVoice.voiceName) ?? null : null }
                    : null,
            },
        },
        limits: { turnSeconds, replyCharacters, replySeconds, listenMinutesPerDay },
        window: { hours, voiceReplies },
        voicesShownFirst:
            shownFirst !== undefined && shownFirst >= 1 ? Math.floor(shownFirst) : DEFAULT_VOICES_SHOWN_FIRST,
    };
}

/** The voices a company lists, checked. */
export function readVoiceChoices(data: unknown): VoiceChoice[] | null {
    if (!Array.isArray(data)) return null;
    return data.flatMap((item) => {
        if (!isRecord(item)) return [];
        const voiceId = text(item.voiceId);
        const name = text(item.name);
        if (!voiceId || !name) return [];
        return [
            {
                voiceId,
                name,
                description: typeof item.description === "string" ? item.description : "",
                languages: Array.isArray(item.languages)
                    ? item.languages.filter((code): code is string => typeof code === "string")
                    : [],
                previewUrl: text(item.previewUrl) ?? null,
                providerId: text(item.providerId) ?? "",
                model: text(item.model) ?? "",
            },
        ];
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Where each part of the voice runs now

/** Where one part of the live voice runs: Universe AI, one of the maker's lent keys, or a key that is not lent here. */
export type PartSource =
    | { kind: "universe-ai" }
    | { kind: "key"; key: VoiceKey }
    | { kind: "gone"; providerId: string | undefined };

/** The version the bot speaks with (null: none yet). */
export function liveRevision(voice: BotVoice): VoiceRevision | null {
    if (voice.revision === null) return null;
    return voice.revisions.find((revision) => revision.number === voice.revision) ?? null;
}

/**
 * Where a part of a profile runs. A provider that is one of the lent keys is that key; Universe AI's own provider is
 * Universe AI, and so is any server provider Orbit names (a bot keeps the company it started on when the operator switches
 * Universe AI to another one); anything else is a key that is no longer lent here (the page only ever writes Universe AI's
 * providers and the lent keys).
 */
export function sourceOf(voice: BotVoice, profile: VoiceProfile, part: VoicePart): PartSource {
    const providerId = profile[part]?.providerId;
    const key = providerId ? voice.lentKeys.find((candidate) => candidate.id === providerId) : undefined;
    if (key) return { kind: "key", key };
    if (!providerId) return { kind: "universe-ai" };
    const uai = voice.universeAi[part];
    // Universe AI is off for this job (no usable provider on the server), or the provider is its own
    if (!uai || uai.providerId === providerId) return { kind: "universe-ai" };
    if (voice.serverProviderIds.includes(providerId)) return { kind: "universe-ai" };
    return { kind: "gone", providerId };
}

/** Why the voice of a bot that is on does not speak now, or null when it does. The payer is never changed for it. */
export type VoicePause =
    | { kind: "key-down"; part: VoicePart; key: VoiceKey; reason: string | null; since: string | null }
    | { kind: "key-gone"; part: VoicePart; providerId: string | undefined }
    | { kind: "universe-ai-off"; part: VoicePart };

export function pauseOf(voice: BotVoice, profile: VoiceProfile): VoicePause | null {
    for (const part of ["speech", "recognition"] as const) {
        const source = sourceOf(voice, profile, part);
        if (source.kind === "key" && source.key.health.status === "down") {
            return {
                kind: "key-down",
                part,
                key: source.key,
                reason: source.key.health.downReason,
                since: source.key.health.downSince,
            };
        }
        if (source.kind === "gone") return { kind: "key-gone", part, providerId: source.providerId };
    }
    for (const part of ["speech", "recognition"] as const) {
        if (sourceOf(voice, profile, part).kind === "universe-ai" && !voice.universeAi[part]) {
            return { kind: "universe-ai-off", part };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Who can pay

/** A place a part can run: Universe AI or one lent key. */
export type PayerChoice = { kind: "universe-ai" } | { kind: "key"; key: VoiceKey };

export const sameChoice = (a: PayerChoice, b: PayerChoice): boolean =>
    a.kind === b.kind && (a.kind === "universe-ai" || (b.kind === "key" && a.key.id === b.key.id));

/** What a part can run on: Universe AI when the server has a default for it, and each lent key that does the job. */
export function choicesFor(voice: BotVoice, part: VoicePart): PayerChoice[] {
    const choices: PayerChoice[] = [];
    if (voice.universeAi[part]) choices.push({ kind: "universe-ai" });
    for (const key of voice.lentKeys) {
        if (key[part] && key.models.some((model) => model.kind === part)) choices.push({ kind: "key", key });
    }
    return choices;
}

/** No voice company is set up for a job (nothing to run it on): voice can't be turned on. */
export function noService(voice: BotVoice): boolean {
    return choicesFor(voice, "speech").length === 0 || choicesFor(voice, "recognition").length === 0;
}

/** Who pays, for the question when voice is turned on: each way both jobs can be covered. */
export interface PayerOption {
    id: string;
    kind: "universe-ai" | "key";
    key?: VoiceKey;
    recognition: PayerChoice;
    speech: PayerChoice;
}

/**
 * The ways to turn voice on: Universe AI for both jobs, and each lent key for the jobs it does (Universe AI does the
 * other one). A way that would leave a job with nothing to run on is left out. When no such way exists, one key that listens plus
 * another that speaks is offered, so lending the two keys the Voice row asks for always turns voice on.
 */
export function payerOptions(voice: BotVoice): PayerOption[] {
    const uai: PayerChoice = { kind: "universe-ai" };
    const options: PayerOption[] = [];
    if (voice.universeAi.recognition && voice.universeAi.speech) {
        options.push({ id: "universe-ai", kind: "universe-ai", recognition: uai, speech: uai });
    }
    for (const key of voice.lentKeys) {
        const listens = key.recognition && key.models.some((model) => model.kind === "recognition");
        const speaks = key.speech && key.models.some((model) => model.kind === "speech");
        if (!listens && !speaks) continue;
        const own: PayerChoice = { kind: "key", key };
        const recognition = listens ? own : voice.universeAi.recognition ? uai : null;
        const speech = speaks ? own : voice.universeAi.speech ? uai : null;
        if (recognition && speech) options.push({ id: key.id, kind: "key", key, recognition, speech });
    }
    if (options.length > 0) return options;
    // Nothing above covers both jobs (no Universe AI voice and no one key that does both): one key that listens and another that
    // speaks, together. The speaking key is the one the voices are read from.
    const listeners = choicesFor(voice, "recognition").filter((choice) => choice.kind === "key");
    const speakers = choicesFor(voice, "speech").filter((choice) => choice.kind === "key");
    for (const speech of speakers) {
        for (const recognition of listeners) {
            if (speech.kind !== "key" || recognition.kind !== "key" || speech.key.id === recognition.key.id) continue;
            options.push({
                id: `${recognition.key.id}+${speech.key.id}`,
                kind: "key",
                key: speech.key,
                recognition,
                speech,
            });
        }
    }
    return options;
}

/**
 * The provider and model a part runs on for a choice. Universe AI's part always starts on the model Universe AI uses now (Orbit
 * serves a bot on Universe AI with its current models, so a model kept from an older version would only be a stale name); a lent
 * key starts on the first model it lists for the job, or the one kept when it lists it.
 */
export function providerOf(
    voice: BotVoice,
    part: VoicePart,
    choice: PayerChoice,
    keepModel?: string
): { providerId: string; model: string } | null {
    if (choice.kind === "universe-ai") {
        const uai = voice.universeAi[part];
        if (!uai) return null;
        return { providerId: uai.providerId, model: uai.model };
    }
    const models = choice.key.models.filter((candidate) => candidate.kind === part);
    if (models.length === 0) return null;
    const model = models.find((candidate) => candidate.id === keepModel) ?? models[0];
    return { providerId: choice.key.id, model: model.id };
}

/** The models a source offers for a job, as the selects list them. */
export function modelsOf(voice: BotVoice, part: VoicePart, source: PartSource): Array<{ id: string; label?: string }> {
    if (source.kind === "key") {
        return source.key.models
            .filter((model) => model.kind === part)
            .map((model) => ({ id: model.id, label: model.label }));
    }
    const uai = voice.universeAi[part];
    return uai ? uai.models.map((model) => ({ id: model.id, label: model.label ?? undefined })) : [];
}

/** The label a model is shown with: its name and id ("Eleven v4 Turbo · eleven_v4_turbo"), or the id alone. */
export function modelLabel(model: { id: string; label?: string | null }): string {
    return model.label && model.label !== model.id ? `${model.label} · ${model.id}` : model.id;
}

/** The model's short name, for the voice card ("Eleven v4 Turbo"). */
export function modelName(model: { id: string; label?: string | null } | undefined, fallback: string): string {
    return model?.label || model?.id || fallback;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the page is in

export type VoiceView =
    | { kind: "not-allowed" }
    | { kind: "no-service" }
    | { kind: "off" }
    | { kind: "on"; profile: VoiceProfile; pause: VoicePause | null };

export function viewOf(voice: BotVoice): VoiceView {
    if (!voice.universeAllows) return { kind: "not-allowed" };
    const revision = liveRevision(voice);
    // Nothing to run a job on, or no way to cover both jobs (two keys that each do one job and no Universe AI to do the other)
    if (!voice.enabled || !revision) {
        return noService(voice) || payerOptions(voice).length === 0 ? { kind: "no-service" } : { kind: "off" };
    }
    return { kind: "on", profile: revision.profile, pause: pauseOf(voice, revision.profile) };
}

/** How the two jobs are paid for, for the payer box and the brief. */
export type PayerKind = "universe-ai" | "keys" | "key-speaks" | "key-listens";

export function payerKind(voice: BotVoice, profile: VoiceProfile): PayerKind {
    // A key that is no longer lent still reads as a key: the bot is on it, and paused
    const speaks = sourceOf(voice, profile, "speech").kind !== "universe-ai";
    const listens = sourceOf(voice, profile, "recognition").kind !== "universe-ai";
    if (speaks && listens) return "keys";
    if (speaks) return "key-speaks";
    if (listens) return "key-listens";
    return "universe-ai";
}

/** The limits that apply: a key's own for the job it does, else the server's (as the bot server reads them). */
export function limitsOf(
    voice: BotVoice,
    profile: VoiceProfile
): { replySeconds: number; listenMinutesPerDay: number } {
    const speaking = sourceOf(voice, profile, "speech");
    const listening = sourceOf(voice, profile, "recognition");
    return {
        replySeconds: (speaking.kind === "key" && speaking.key.limits.replySeconds?.value) || voice.limits.replySeconds,
        listenMinutesPerDay:
            (listening.kind === "key" && listening.key.limits.listenMinutesPerDay?.value) ||
            voice.limits.listenMinutesPerDay,
    };
}

/** A key a person sees named by its company: "ElevenLabs". Orbit lists the companies it supports by adapter. */
export function companyName(adapter: string): string {
    const known: Record<string, string> = {
        assemblyai: "AssemblyAI",
        async: "Async",
        bland: "Bland",
        camb: "CAMB.AI",
        fal: "fal",
        gladia: "Gladia",
        google: "Google",
        gradium: "Gradium",
        groq: "Groq",
        hume: "Hume",
        meta: "Meta",
        minimax: "MiniMax",
        mistral: "Mistral",
        neuphonic: "Neuphonic",
        nvidia: "NVIDIA",
        openai: "OpenAI",
        resemble: "Resemble AI",
        rime: "Rime",
        sarvam: "Sarvam AI",
        smallest: "Smallest AI",
        speechify: "Speechify",
        speechmatics: "Speechmatics",
        together: "Together AI",
        xai: "xAI",
        zoom: "Zoom",
        elevenlabs: "ElevenLabs",
        cartesia: "Cartesia",
        fish: "Fish Audio",
        deepgram: "Deepgram",
        soniox: "Soniox",
    };
    return known[adapter] ?? adapter.charAt(0).toUpperCase() + adapter.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Profiles

/** The profile the bot has now as a finished one to change (null when it can't be: a part missing). */
export function fullProfile(profile: VoiceProfile): FullVoiceProfile | null {
    const { recognition, speech } = profile;
    if (!recognition?.providerId || !recognition.model || !speech?.providerId || !speech.model || !speech.voiceId) {
        return null;
    }
    return {
        recognition: { providerId: recognition.providerId, model: recognition.model },
        speech: {
            providerId: speech.providerId,
            model: speech.model,
            voiceId: speech.voiceId,
            ...(speech.voiceName ? { voiceName: speech.voiceName } : {}),
        },
        expression: profile.expression ?? "natural",
        language: profile.language ?? { mode: "follow" },
    };
}

/** The voice to start with on a source: the one the voice list gives first, unless one is kept that it also lists. */
export function startingVoice(
    voice: BotVoice,
    choice: PayerChoice,
    list: VoiceChoice[],
    keep?: string
): { voiceId: string; voiceName?: string } | null {
    const kept = keep ? list.find((candidate) => candidate.voiceId === keep) : undefined;
    if (kept) return { voiceId: kept.voiceId, voiceName: kept.name };
    if (choice.kind === "universe-ai") {
        const set = voice.universeAi.speech?.defaultVoice;
        if (set) {
            const named = list.find((candidate) => candidate.voiceId === set.voiceId);
            return { voiceId: set.voiceId, voiceName: named?.name ?? set.voiceName ?? undefined };
        }
    }
    const first = list[0];
    return first ? { voiceId: first.voiceId, voiceName: first.name } : null;
}

/**
 * The voices the Voice row shows before "All voices": the one to start with first (the voice kept, else Universe AI's default
 * voice, else the first the company lists), then the others in the company's order, `size` in all.
 */
export function doorVoices(
    voice: BotVoice,
    choice: PayerChoice,
    list: VoiceChoice[],
    keep?: string
): { voices: VoiceChoice[]; startId: string | undefined } {
    const start = startingVoice(voice, choice, list, keep);
    // A default voice the company doesn't list (any more) can't be heard or picked: the first one listed starts instead
    const first = (start ? list.find((candidate) => candidate.voiceId === start.voiceId) : undefined) ?? list[0];
    const rest = list.filter((candidate) => candidate !== first);
    const voices = (first ? [first, ...rest] : rest).slice(0, Math.max(1, voice.voicesShownFirst));
    return { voices, startId: first?.voiceId };
}

/** The place to pay from that the Voice row starts on: the one the last version used when it is still there, else a lent key, else Universe AI. */
export function startingPayer(voice: BotVoice, previous: VoiceProfile | null): PayerOption | null {
    const options = payerOptions(voice);
    const before = previous?.speech?.providerId;
    // A key that is down would turn voice on already paused: it is never the one to start on while another way works
    const working = (option: PayerOption) =>
        ![option.recognition, option.speech].some(
            (choice) => choice.kind === "key" && choice.key.health.status === "down"
        );
    const same = before
        ? options.find((option) => working(option) && providerOf(voice, "speech", option.speech)?.providerId === before)
        : undefined;
    return (
        same ??
        options.find((option) => option.kind === "key" && working(option)) ??
        options.find(working) ??
        options[0] ??
        null
    );
}

/** The source a voice list is read from: "universe-ai" or a key's id. */
export const sourceKey = (choice: PayerChoice): string =>
    choice.kind === "universe-ai" ? "universe-ai" : choice.key.id;

export function choiceOfSource(source: PartSource): PayerChoice | null {
    if (source.kind === "key") return { kind: "key", key: source.key };
    if (source.kind === "universe-ai") return { kind: "universe-ai" };
    return null;
}

/** The distinct language codes the voices list, in the order they first appear. */
export function voiceLanguages(list: VoiceChoice[]): string[] {
    const seen: string[] = [];
    for (const choice of list) {
        for (const code of choice.languages) {
            if (!seen.includes(code)) seen.push(code);
        }
    }
    return seen;
}

/** The voices that match what was typed and the language picked ("" is any). */
export function filterVoices(list: VoiceChoice[], query: string, language: string): VoiceChoice[] {
    const needle = query.trim().toLocaleLowerCase();
    return list.filter(
        (choice) =>
            (language === "" || choice.languages.includes(language)) &&
            (needle === "" || `${choice.name} ${choice.description}`.toLocaleLowerCase().includes(needle))
    );
}

/** A preview kept in Orbit is an Orbit path; a company's own sample is a full https address. */
export function previewKind(previewUrl: string | null): "none" | "orbit" | "public" {
    if (!previewUrl) return "none";
    if (/^\/api\/bots\/[^/]+\/voice\/voices\/[^/]+\/preview(\?|$)/.test(previewUrl)) return "orbit";
    return /^https:\/\//i.test(previewUrl) ? "public" : "none";
}

/** A language's name in the page's language ("Arabic"), or its code when the browser doesn't know it. */
export function languageName(code: string, lang: string): string {
    try {
        return new Intl.DisplayNames([lang], { type: "language" }).of(code) ?? code;
    } catch {
        return code;
    }
}

/** What a voice is, for its row and the card: the company's words about it and its first language. */
export function describeVoice(choice: VoiceChoice | undefined, lang: string): string {
    if (!choice) return "";
    const names = choice.languages.slice(0, 1).map((code) => languageName(code, lang));
    return [choice.description, ...names].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------------------------------------------------
// "Hear <bot> say hello" (#1852): the bot writes a hello with its own brain and says it once in the voice it speaks with.

/** The hello the bot server answers with: the words, and the audio as base64 (a WAV file). */
export interface BotHello {
    text: string;
    mime: string;
    audio: string;
}

/** The hello as the bot server sends it, or null when the answer is not one. */
export function readHello(data: unknown): BotHello | null {
    if (!isRecord(data)) return null;
    const words = text(data.text);
    const audio = text(data.audio);
    if (!words || !audio) return null;
    return { text: words, mime: text(data.mime) ?? "audio/wav", audio };
}

/**
 * Why a hello was not heard, for the page to say:
 * - used-up: the person's voice replies are used up until `resetsAt` (Universe AI pays for this voice);
 * - off: the bot does not speak any more (turned off, or not allowed here), so the page is out of date;
 * - provider: the voice company refused or failed (`rejected`: it refused the key itself; `credit`: the key is out of credit);
 * - failed: anything else, nothing was said (the bot wrote nothing, the voice server is busy or away).
 */
export type HelloFailure =
    | { kind: "used-up"; resetsAt: Date }
    | { kind: "off" }
    | { kind: "provider"; rejected: boolean; credit: boolean }
    | { kind: "failed" };

/** What went wrong with a hello, from the bot server's error (its status, and the parsed answer it carried as `body`). */
export function helloFailureOf(error: unknown): HelloFailure {
    const failure = error as { status?: unknown; body?: unknown } | null;
    const status = typeof failure?.status === "number" ? failure.status : undefined;
    const body = isRecord(failure?.body) ? failure.body : {};
    if (status === 429 && body.error === "used_up" && typeof body.resetsAt === "string") {
        const resetsAt = new Date(body.resetsAt);
        if (!Number.isNaN(resetsAt.getTime())) return { kind: "used-up", resetsAt };
    }
    if (status === 409 && body.error === "voice_off") return { kind: "off" };
    if (status === 502 && body.error === "provider") {
        const providerStatus = count(body.providerStatus);
        return {
            kind: "provider",
            rejected: body.rejected === true || providerStatus === 401 || providerStatus === 403,
            credit: providerStatus === 402,
        };
    }
    return { kind: "failed" };
}
