<script lang="ts">
    // Voice: whether the bot talks in bubbles, with which voice, how it speaks and who pays (#1668). Off by default. More
    // voice settings fold in who pays for listening and speaking, models, language and versions. Every change saves at
    // once as a new version, like the rest of the page. Every number, voice and key comes from Orbit.
    import { onDestroy } from "svelte";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import { modalVisibilityStore } from "../../../../Stores/ModalStore";
    import { canOpenOrbit, openOrbitPage } from "../../../admin-api/index";
    import type { BotData } from "../../types";
    import { botApiService } from "../../services/BotApiService";
    import {
        VOICE_EXPRESSIONS,
        choiceOfSource,
        choicesFor,
        companyName,
        describeVoice,
        fullProfile,
        languageName,
        limitsOf,
        liveRevision,
        modelLabel,
        modelName,
        modelsOf,
        payerKind,
        payerOptions,
        pauseOf,
        providerOf,
        sameChoice,
        sourceKey,
        sourceOf,
        startingVoice,
        viewOf,
        voiceLanguages,
        previewKind,
        type BotVoice,
        type FullVoiceProfile,
        type PayerChoice,
        type PayerOption,
        type VoiceChoice,
        type VoiceExpression,
        type VoiceKey,
        type VoicePart,
        type VoiceProfile,
    } from "../../voiceModel";
    import { playingSample, stopSample, toggleSample } from "../../voicePlayer";
    import PageGroup from "./PageGroup.svelte";
    import PageButton from "./PageButton.svelte";
    import PageSegment from "./PageSegment.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import PageField from "./PageField.svelte";
    import VoicePicker from "./VoicePicker.svelte";
    import {
        IconAlertTriangle,
        IconCheck,
        IconChevronDown,
        IconExternalLink,
        IconHistory,
        IconInfoCircle,
        IconKey,
        IconLock,
        IconPauseFilled,
        IconPlayerPlayFilled,
        IconSparkles,
        IconVolume,
    } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;

    let voice: BotVoice | null = null;
    let loading = true;
    let failed = false;
    /** The viewer can't manage this bot's voice (Orbit says no): the group is not shown at all */
    let hidden = false;
    let loadedFor: string | undefined | null = null;
    let loadCount = 0;
    let makerName: string | null = null;
    let viewerIsMaker = false;
    /** The viewer's own keys with their company, read only to name a key that is no longer lent */
    let myKeys: Array<{ id: string; adapter: string }> | null = null;
    let lendPending = false;

    let screen: "page" | "picker" = "page";
    let moreOpen = false;
    let saving = false;
    let saveError: string | null = null;
    let sampleError = false;
    let checking = false;
    /** Turning voice on when a lent key could pay: the question is asked before anything is saved */
    let asking = false;
    let askId = "";
    type Note = { kind: "first-on"; voice: string; key: string | null } | { kind: "rolled-back"; number: number };
    let note: Note | null = null;

    /** The voices each source lists, by "universe-ai" or a key's id */
    let lists: Record<string, VoiceChoice[]> = {};
    let listFailed: Record<string, boolean> = {};
    const listLoading: Record<string, Promise<VoiceChoice[]>> = {};

    async function load(botId: string | undefined, quiet = false) {
        const mine = ++loadCount;
        if (!quiet) {
            loading = true;
            failed = false;
        }
        if (!botId || !botApiService.isInitialized()) {
            if (!quiet) {
                loading = false;
                failed = true;
            }
            return;
        }
        try {
            const [loaded, options] = await Promise.all([
                botApiService.getBotVoice(botId),
                botApiService.getBotAiOptions({ botId }),
            ]);
            if (mine !== loadCount) return;
            voice = loaded;
            hidden = false;
            failed = false;
            makerName = options?.maker?.name ?? bot.createdBy?.name ?? null;
            // When Orbit can't say who made the bot, the viewer is treated as a co-manager: never "your keys" by guess
            viewerIsMaker = options?.viewerIsMaker === true;
            lists = {};
            listFailed = {};
        } catch (e) {
            if (mine !== loadCount) return;
            if ((e as { status?: number }).status === 403 || (e as { status?: number }).status === 404) {
                hidden = true;
            } else if (!quiet) {
                console.error("[VoiceGroup] Failed to load the voice settings:", e);
                failed = true;
            }
        } finally {
            if (mine === loadCount) loading = false;
        }
    }

    function showFor(botId: string | undefined) {
        if (loadedFor === botId) return;
        loadedFor = botId;
        voice = null;
        hidden = false;
        screen = "page";
        moreOpen = false;
        asking = false;
        note = null;
        saveError = null;
        sampleError = false;
        myKeys = null;
        lists = {};
        listFailed = {};
        stopSample();
        void load(botId);
    }
    // On first show, and again whenever the panel moves to another bot (it stays mounted when the bot changes)
    $: showFor(bot.id);

    onDestroy(() => stopSample());

    // A key lent in Orbit shows here at once when Orbit closes or the page gets focus back
    let orbitOpen = false;
    const unsubscribeOrbit = modalVisibilityStore.subscribe((visible) => {
        if (orbitOpen && !visible) reloadAfterLend();
        orbitOpen = visible;
    });
    onDestroy(unsubscribeOrbit);
    function reloadAfterLend() {
        if (lendPending && !loading && !saving) void load(bot.id, true);
    }
    function openAiKeys() {
        lendPending = true;
        openOrbitPage("/admin/you/ai-keys");
    }
    function openUniverseSettings() {
        openOrbitPage("/admin/universes");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // What the group shows

    $: v = $LL.mapEditor.edit.bots.page.voice;
    $: botName = bot.name || "Bot";
    $: maker = makerName ?? v.makerFallback();
    $: view = voice ? viewOf(voice) : null;
    $: profile = view?.kind === "on" ? view.profile : null;
    $: pause = view?.kind === "on" ? view.pause : null;
    $: speaksSource = voice && profile ? sourceOf(voice, profile, "speech") : null;
    $: listensSource = voice && profile ? sourceOf(voice, profile, "recognition") : null;
    $: speakChoice = speaksSource ? choiceOfSource(speaksSource) : null;
    $: currentList = speakChoice ? lists[sourceKey(speakChoice)] : undefined;
    $: currentVoice = currentList?.find((candidate) => candidate.voiceId === profile?.speech?.voiceId);
    $: expression = profile?.expression ?? "natural";
    $: language = profile?.language ?? { mode: "follow" as const };
    $: voiceName = profile?.speech?.voiceName ?? currentVoice?.name ?? profile?.speech?.voiceId ?? "";
    $: busyClass = saving;

    function keyPhrase(key: VoiceKey, middle = false): string {
        const args = { company: companyName(key.adapter), last4: key.last4 };
        if (!viewerIsMaker) return v.keyTheirs({ owner: maker, ...args });
        return middle ? v.keyMineMid(args) : v.keyMine(args);
    }
    function keyShort(key: VoiceKey): string {
        const company = companyName(key.adapter);
        return viewerIsMaker ? v.keyMineShort({ company }) : v.keyTheirsShort({ owner: maker, company });
    }
    $: whoKey = viewerIsMaker ? v.yourKey() : v.theirKey({ maker });

    function payerBrief(data: BotVoice, current: VoiceProfile): string {
        switch (payerKind(data, current)) {
            case "universe-ai":
                return v.payerUniverseAi();
            case "keys":
                return viewerIsMaker ? v.payerYourKeys() : v.payerTheirKeys({ maker });
            default:
                return viewerIsMaker ? v.payerUniverseAiAndYourKey() : v.payerUniverseAiAndTheirKey({ maker });
        }
    }

    function briefOf(
        data: BotVoice | null,
        now: ReturnType<typeof viewOf> | null,
        hasFailed: boolean,
        speaking: string,
        style: VoiceExpression,
        whose: string
    ): string {
        if (!data || !now) return hasFailed ? v.loadFailed() : v.loading();
        switch (now.kind) {
            case "not-allowed":
                return v.notAllowedBrief();
            case "no-service":
                return v.noServiceBrief();
            case "off":
                return v.off();
            case "on":
                if (now.pause?.kind === "key-down") {
                    return now.pause.reason === "credit" ? v.pausedCredit({ key: whose }) : v.pausedKey({ key: whose });
                }
                if (now.pause?.kind === "key-gone") return v.pausedGone({ key: whose });
                if (now.pause?.kind === "universe-ai-off") return v.pausedUniverseAi();
                return v.briefOn({ voice: speaking, style: v.style[style](), payer: payerBrief(data, now.profile) });
        }
    }
    $: brief = briefOf(voice, view, failed, voiceName, expression, whoKey);

    // The voice card's second and third lines
    $: cardAbout = describeVoice(currentVoice, $locale);
    $: cardModel = (() => {
        if (!voice || !profile || !speaksSource) return "";
        const company =
            speaksSource.kind === "key"
                ? companyName(speaksSource.key.adapter)
                : voice.universeAi.speech
                ? companyName(voice.universeAi.speech.adapter)
                : "";
        const model = modelsOf(voice, "speech", speaksSource).find(
            (candidate) => candidate.id === profile?.speech?.model
        );
        return [company, modelName(model ?? (profile.speech?.model ? { id: profile.speech.model } : undefined), "")]
            .filter(Boolean)
            .join(" · ");
    })();

    $: payerKindNow = voice && profile ? payerKind(voice, profile) : "universe-ai";
    $: speakingKey = speaksSource?.kind === "key" ? speaksSource.key : null;
    $: listeningKey = listensSource?.kind === "key" ? listensSource.key : null;
    $: limits = voice && profile ? limitsOf(voice, profile) : null;

    // ---------------------------------------------------------------------------------------------------------------
    // Voice lists and samples

    function voicesFor(choice: PayerChoice): Promise<VoiceChoice[]> {
        const id = sourceKey(choice);
        const known = lists[id];
        if (known) return Promise.resolve(known);
        const botId = bot.id;
        listLoading[id] ??= botApiService
            .getBotVoices(botId, id)
            .then((list) => {
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (bot.id === botId) lists = { ...lists, [id]: list };
                return list;
            })
            .catch((e) => {
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (bot.id === botId) listFailed = { ...listFailed, [id]: true };
                throw e;
            })
            .finally(() => {
                delete listLoading[id];
            });
        return listLoading[id];
    }

    // The voice on the card shows what its company says about it once the list is in; the card works without it
    $: if (open && speakChoice && !lists[sourceKey(speakChoice)] && !listFailed[sourceKey(speakChoice)]) {
        // eslint-disable-next-line svelte/infinite-reactive-loop
        voicesFor(speakChoice).catch(() => undefined);
    }

    async function playChoice(id: string, choice: VoiceChoice | undefined) {
        if (!choice?.previewUrl) return;
        const kind = previewKind(choice.previewUrl);
        if (kind === "none") return;
        sampleError = false;
        const url = choice.previewUrl;
        await toggleSample(
            id,
            async () => {
                if (kind === "public") return { url };
                const blob = await botApiService.getBotVoicePreview(url);
                return { url: URL.createObjectURL(blob), revoke: true };
            },
            () => (sampleError = true)
        );
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Saving

    function reason(e: unknown): string {
        return e instanceof Error ? e.message : "";
    }

    /** One change at a time; it ends with how Orbit says the voice stands now, or the line it refused with. */
    async function run(change: () => Promise<BotVoice>): Promise<boolean> {
        if (saving) return false;
        const botId = bot.id;
        saving = true;
        saveError = null;
        note = null;
        try {
            const next = await change();
            if (bot.id === botId) voice = next;
            return true;
        } catch (e) {
            if (bot.id === botId) saveError = v.saveFailed({ reason: reason(e) }).trim();
            return false;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            saving = false;
        }
    }

    function commit(next: FullVoiceProfile): Promise<boolean> {
        return run(() => botApiService.saveBotVoice(bot.id, next));
    }

    const base = (): FullVoiceProfile | null => (profile ? fullProfile(profile) : null);

    /** Starts the voice for the first time (or again after a key went away): save the profile, then turn it on. */
    async function turnOnWith(option: PayerOption) {
        if (!voice) return;
        const data = voice;
        const botId = bot.id;
        const saved = await run(async () => {
            const recognition = providerOf(data, "recognition", option.recognition);
            const speech = providerOf(data, "speech", option.speech);
            if (!recognition || !speech) throw new Error(v.voicesFailed());
            const list = await voicesFor(option.speech);
            const picked = startingVoice(data, option.speech, list);
            if (!picked) throw new Error(v.voicesFailed());
            const entry = list.find((candidate) => candidate.voiceId === picked.voiceId);
            const fresh: FullVoiceProfile = {
                recognition,
                speech: {
                    providerId: entry?.providerId || speech.providerId,
                    model: entry?.model || speech.model,
                    voiceId: picked.voiceId,
                    ...(picked.voiceName ? { voiceName: picked.voiceName } : {}),
                },
                expression: "natural",
                language: { mode: "follow" },
            };
            await botApiService.saveBotVoice(botId, fresh);
            const on = await botApiService.setBotVoiceEnabled(botId, true);
            pendingNote = {
                kind: "first-on",
                voice: picked.voiceName ?? picked.voiceId,
                key: option.speech.kind === "key" ? keyPhrase(option.speech.key, true) : null,
            };
            return on;
        });
        if (saved) {
            asking = false;
            note = pendingNote;
        }
        pendingNote = null;
    }
    let pendingNote: Note | null = null;

    function switchVoice(next: boolean) {
        if (!voice || saving) return;
        if (!next) {
            asking = false;
            void run(() => botApiService.setBotVoiceEnabled(bot.id, false));
            return;
        }
        const revision = liveRevision(voice);
        // Turned on again with the voice it had, when that still works
        if (revision && fullProfile(revision.profile) && !pauseOf(voice, revision.profile)) {
            void run(() => botApiService.setBotVoiceEnabled(bot.id, true));
            return;
        }
        const options = payerOptions(voice);
        if (options.length === 0) return;
        if (options.some((option) => option.kind === "key")) {
            askId = options[0].id;
            asking = true;
            return;
        }
        void turnOnWith(options[0]);
    }

    /** Speaks on / Listens on: another place for one job. A new place for speaking brings a voice that company has. */
    async function chooseSource(part: VoicePart, choice: PayerChoice) {
        const current = base();
        if (!voice || !profile || !current || saving) return;
        const data = voice;
        const now = choiceOfSource(sourceOf(data, profile, part));
        if (now && sameChoice(now, choice)) return;
        await run(async () => {
            const next: FullVoiceProfile = { ...current };
            if (part === "recognition") {
                const picked = providerOf(data, "recognition", choice);
                if (!picked) throw new Error(v.voicesFailed());
                next.recognition = picked;
            } else {
                const speech = providerOf(data, "speech", choice);
                const list = await voicesFor(choice);
                const picked = startingVoice(data, choice, list, current.speech.voiceId);
                if (!speech || !picked) throw new Error(v.voicesFailed());
                const entry = list.find((candidate) => candidate.voiceId === picked.voiceId);
                next.speech = {
                    providerId: entry?.providerId || speech.providerId,
                    model: entry?.model || speech.model,
                    voiceId: picked.voiceId,
                    ...(picked.voiceName ? { voiceName: picked.voiceName } : {}),
                };
            }
            return botApiService.saveBotVoice(bot.id, next);
        });
    }

    function chooseModel(part: VoicePart, model: string) {
        const current = base();
        if (!current || saving || current[part].model === model) return;
        const next: FullVoiceProfile = {
            ...current,
            [part]: { ...current[part], model },
        };
        void commit(next);
    }

    function chooseExpression(next: VoiceExpression) {
        const current = base();
        if (!current || saving || current.expression === next) return;
        void commit({ ...current, expression: next });
    }

    function chooseLanguageMode(mode: "follow" | "fixed") {
        const current = base();
        if (!current || saving) return;
        if (mode === "follow") {
            if (current.language.mode === "follow") return;
            void commit({ ...current, language: { mode: "follow" } });
            return;
        }
        if (current.language.mode === "fixed") return;
        const code =
            currentVoice?.languages[0] ??
            (currentList ? voiceLanguages(currentList)[0] : undefined) ??
            $locale.split("-")[0];
        void commit({ ...current, language: { mode: "fixed", code } });
    }

    function chooseLanguage(code: string) {
        const current = base();
        if (!current || saving || (current.language.mode === "fixed" && current.language.code === code)) return;
        void commit({ ...current, language: { mode: "fixed", code } });
    }

    async function useVoice(choice: VoiceChoice) {
        const current = base();
        if (!voice || !current || !pickerChoice) return;
        const speech = providerOf(voice, "speech", pickerChoice, current.speech.model);
        if (!speech) return;
        const sameProvider = current.speech.providerId === (choice.providerId || speech.providerId);
        const saved = await commit({
            ...current,
            speech: {
                providerId: choice.providerId || speech.providerId,
                model: sameProvider ? current.speech.model : choice.model || speech.model,
                voiceId: choice.voiceId,
                voiceName: choice.name,
            },
        });
        if (saved) {
            stopSample();
            screen = "page";
        }
    }

    function rollBack(number: number) {
        if (saving) return;
        void run(async () => {
            const next = await botApiService.rollbackBotVoice(bot.id, number);
            pendingNote = { kind: "rolled-back", number };
            return next;
        }).then((ok) => {
            if (ok) note = pendingNote;
            pendingNote = null;
        });
    }

    /** "Use a Universe AI voice": the part whose key is gone moves to Universe AI, with a voice it has. */
    async function useUniverseAi() {
        const current = base();
        if (!voice || !profile || !current || saving) return;
        const data = voice;
        await run(async () => {
            const next: FullVoiceProfile = { ...current };
            const uai: PayerChoice = { kind: "universe-ai" };
            if (sourceOf(data, profile, "recognition").kind === "gone") {
                const picked = providerOf(data, "recognition", uai);
                if (!picked) throw new Error(v.voicesFailed());
                next.recognition = picked;
            }
            if (sourceOf(data, profile, "speech").kind === "gone") {
                const speech = providerOf(data, "speech", uai);
                const list = await voicesFor(uai);
                const picked = startingVoice(data, uai, list);
                if (!speech || !picked) throw new Error(v.voicesFailed());
                const entry = list.find((candidate) => candidate.voiceId === picked.voiceId);
                next.speech = {
                    providerId: entry?.providerId || speech.providerId,
                    model: entry?.model || speech.model,
                    voiceId: picked.voiceId,
                    ...(picked.voiceName ? { voiceName: picked.voiceName } : {}),
                };
            }
            return botApiService.saveBotVoice(bot.id, next);
        });
    }

    async function checkNow(key: VoiceKey) {
        if (checking) return;
        checking = true;
        try {
            await botApiService.checkVoiceKey(key.id);
            await load(bot.id, true);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            checking = false;
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // The picker

    $: pickerChoice = speakChoice ?? (voice ? firstSpeechChoice(voice) : null);
    $: pickerList = pickerChoice ? lists[sourceKey(pickerChoice)] ?? null : null;
    $: pickerFailed = pickerChoice ? listFailed[sourceKey(pickerChoice)] === true : false;
    $: pickerHeading = !pickerChoice
        ? ""
        : pickerChoice.kind === "universe-ai"
        ? v.pickerTitleUniverseAi({ bot: botName })
        : v.pickerTitleKey({ bot: botName, key: keyPhrase(pickerChoice.key, true) });
    $: noSpeakingKey = voice ? !choicesFor(voice, "speech").some((choice) => choice.kind === "key") : false;

    function firstSpeechChoice(data: BotVoice): PayerChoice | null {
        const all = choicesFor(data, "speech");
        return all.find((choice) => choice.kind === "universe-ai") ?? all[0] ?? null;
    }

    function openPicker() {
        if (!pickerChoice) return;
        screen = "picker";
        sampleError = false;
        stopSample();
        const choice = pickerChoice;
        delete listFailed[sourceKey(choice)];
        listFailed = listFailed;
        voicesFor(choice).catch(() => undefined);
    }
    function retryPicker() {
        if (!pickerChoice) return;
        const choice = pickerChoice;
        delete listFailed[sourceKey(choice)];
        listFailed = listFailed;
        voicesFor(choice).catch(() => undefined);
    }
    function closePicker() {
        stopSample();
        screen = "page";
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Pieces of text

    function timeOf(value: string | null): string {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleTimeString($locale, { hour: "numeric", minute: "2-digit" });
    }

    function whenOf(value: string | null): string {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const time = timeOf(value);
        if (date.toDateString() === new Date().toDateString()) return v.today({ time });
        return `${date.toLocaleDateString($locale, { day: "numeric", month: "short" })} ${time}`;
    }

    function whoPublished(id: string | null): string | null {
        if (!id) return null;
        if (bot.createdBy?.id === id) return bot.createdBy.name;
        if (bot.updatedBy?.id === id) return bot.updatedBy.name;
        return null;
    }

    function keyDownTitle(key: VoiceKey, reasonOf: string | null, since: string | null): string {
        const named = keyShort(key);
        switch (reasonOf) {
            case "credit":
                return since
                    ? v.keyDownCredit({ key: named, time: timeOf(since) })
                    : v.keyDownCreditNoTime({ key: named });
            case "rejected":
                return v.keyDownRejected({ key: named });
            case "model":
                return v.keyDownModel({ key: named });
            case "errors":
                return v.keyDownErrors({ key: named });
            default:
                return v.keyDownOther({ key: named });
        }
    }

    // A key that is no longer lent can't be named from what Orbit lists here: the viewer's own keys name its company
    $: if (pause?.kind === "key-gone" && viewerIsMaker && myKeys === null) {
        // eslint-disable-next-line svelte/infinite-reactive-loop
        void botApiService.getMyVoiceKeys().then((keys) => (myKeys = keys ?? []));
    }
    $: goneKeyTitle = (() => {
        if (pause?.kind !== "key-gone") return "";
        const adapter = myKeys?.find((key) => key.id === pause.providerId)?.adapter;
        const company = adapter ? companyName(adapter) : null;
        const named = company
            ? viewerIsMaker
                ? v.keyMineShort({ company })
                : v.keyTheirsShort({ owner: maker, company })
            : viewerIsMaker
            ? v.keyFallbackMine()
            : v.keyFallbackTheirs({ owner: maker });
        return v.keyGoneTitle({ key: named });
    })();

    $: askOptions = voice ? payerOptions(voice) : [];
    $: asked = askOptions.find((option) => option.id === askId) ?? askOptions[0];
    $: canUseUniverseAi = voice ? choicesFor(voice, "speech").some((choice) => choice.kind === "universe-ai") : false;
</script>

{#if !hidden}
    <PageGroup id="voice" icon={IconVolume} title={v.title()} {brief} {open} {onToggle}>
        <div class="vg" class:busy={busyClass} data-testid="bot-voice">
            {#if loading && !voice}
                <p class="bp-m">{v.loading()}</p>
            {:else if failed || !voice || !view}
                <div class="bp-line">
                    <p class="bp-m">{v.loadFailed()}</p>
                    <PageButton on:click={() => void load(bot.id)}>{v.retry()}</PageButton>
                </div>
            {:else if screen === "picker" && view.kind === "on"}
                <VoicePicker
                    {botName}
                    heading={pickerHeading}
                    voices={pickerList}
                    failed={pickerFailed}
                    currentId={profile?.speech?.voiceId}
                    offerKeys={noSpeakingKey}
                    canOpenKeys={canOpenOrbit()}
                    busy={saving}
                    onBack={closePicker}
                    onUse={(choice) => void useVoice(choice)}
                    onPlay={(choice) => void playChoice(`row:${choice.voiceId}`, choice)}
                    onRetry={retryPicker}
                    onAiKeys={openAiKeys}
                />
                {#if sampleError}<p class="bp-m" role="alert">{v.sampleFailed()}</p>{/if}
                {#if saveError}<p class="vg-error" role="alert">{saveError}</p>{/if}
            {:else if view.kind === "not-allowed" || view.kind === "no-service"}
                <div class="vg-set">
                    <span class="bp-mtx"
                        ><span class="vg-t">{v.switchTitle()}</span><span class="bp-cn">{v.switchHintLocked()}</span
                        ></span
                    >
                    <span class="vg-lock"><IconLock font-size="16" /></span>
                    <PageSwitch
                        checked={false}
                        disabled
                        label={v.switchLabel()}
                        testId="bot-voice-switch"
                        onChange={() => {}}
                    />
                </div>
                <div class="bp-unlent" data-testid="bot-voice-locked">
                    <IconInfoCircle font-size="18" />
                    <div class="bp-mtx">
                        {#if view.kind === "not-allowed"}
                            <span class="bp-ut">{v.notAllowedTitle()}</span>
                            <span class="bp-cn">{v.notAllowedLine({ bot: botName })}</span>
                        {:else}
                            <span class="bp-ut">{v.noServiceTitle()}</span>
                            <span class="bp-cn">{v.noServiceLine({ bot: botName })}</span>
                        {/if}
                    </div>
                </div>
                {#if view.kind === "not-allowed" && canOpenOrbit()}
                    <div class="bp-line">
                        <span />
                        <PageButton tall testId="bot-voice-universe-settings" on:click={openUniverseSettings}>
                            {v.universeSettings()}
                            <IconExternalLink font-size="14" />
                        </PageButton>
                    </div>
                {/if}
            {:else}
                <label class="vg-set" for="bot-voice-switch">
                    <span class="bp-mtx"
                        ><span class="vg-t">{v.switchTitle()}</span><span class="bp-cn">{v.switchHint()}</span></span
                    >
                    <PageSwitch
                        id="bot-voice-switch"
                        testId="bot-voice-switch"
                        checked={view.kind === "on" || asking}
                        disabled={saving}
                        label={v.switchLabel()}
                        onChange={switchVoice}
                    />
                </label>

                {#if asking && asked}
                    <div class="bp-ask" role="alert" data-testid="bot-voice-ask">
                        <p class="bp-ask-t">{v.askTitle({ bot: botName })}</p>
                        <p>{v.askLine()}</p>
                        <div class="bp-cards" role="radiogroup" aria-label={v.askTitle({ bot: botName })}>
                            {#each askOptions as option (option.id)}
                                <button
                                    type="button"
                                    class="bp-card"
                                    class:picked={asked.id === option.id}
                                    role="radio"
                                    aria-checked={asked.id === option.id}
                                    data-testid="bot-voice-ask-{option.kind}"
                                    on:click={() => (askId = option.id)}
                                >
                                    <span class="bp-cico">
                                        {#if option.kind === "universe-ai"}<IconSparkles
                                                font-size="22"
                                            />{:else}<IconKey font-size="22" />{/if}
                                    </span>
                                    <span class="bp-ctx">
                                        <span class="bp-ct"
                                            >{option.kind === "universe-ai" || !option.key
                                                ? v.askUniverseAi()
                                                : keyPhrase(option.key)}</span
                                        >
                                        <span class="bp-cn">
                                            {#if option.kind === "universe-ai" && voice}
                                                {v.askUniverseAiLine({
                                                    replies: voice.window.voiceReplies,
                                                    hours: voice.window.hours,
                                                })}
                                            {:else if viewerIsMaker}
                                                {v.askKeyLine({ bot: botName })}
                                            {:else}
                                                {v.askKeyLineTheirs({ owner: maker, bot: botName })}
                                            {/if}
                                        </span>
                                    </span>
                                    <span class="bp-radio" class:on={asked.id === option.id} aria-hidden="true" />
                                </button>
                            {/each}
                        </div>
                        <div class="bp-ask-actions">
                            <PageButton tall on:click={() => (asking = false)}>{v.cancel()}</PageButton>
                            <PageButton
                                tall
                                go
                                testId="bot-voice-ask-go"
                                disabled={saving}
                                on:click={() => void turnOnWith(asked)}
                            >
                                {v.turnOn()}
                            </PageButton>
                        </div>
                    </div>
                {/if}

                {#if view.kind === "off" && !asking}
                    <p class="bp-m" data-testid="bot-voice-off-line">{v.offLine({ bot: botName })}</p>
                {/if}

                {#if saveError}<p class="vg-error" role="alert" data-testid="bot-voice-error">{saveError}</p>{/if}

                {#if view.kind === "on" && profile && voice}
                    {#if note?.kind === "first-on"}
                        <div class="vg-done" role="status" data-testid="bot-voice-first-on">
                            <IconCheck font-size="16" />{note.key
                                ? v.firstOnKey({ voice: note.voice, key: note.key })
                                : v.firstOnUniverseAi({ voice: note.voice })}
                        </div>
                    {/if}
                    {#if pause}
                        <div class="vg-warn" role="alert" data-testid="bot-voice-paused">
                            <IconAlertTriangle font-size="18" />
                            <div class="bp-mtx">
                                {#if pause.kind === "key-down"}
                                    <span class="bp-ut">{keyDownTitle(pause.key, pause.reason, pause.since)}</span>
                                    <span class="bp-cn">{v.keyDownLine({ bot: botName })}</span>
                                {:else if pause.kind === "key-gone"}
                                    <span class="bp-ut">{goneKeyTitle}</span>
                                    <span class="bp-cn"
                                        >{viewerIsMaker
                                            ? v.keyGoneLine({ bot: botName })
                                            : v.keyGoneLineTheirs({ bot: botName, maker })}</span
                                    >
                                {:else}
                                    <span class="bp-ut">{v.universeAiOffTitle()}</span>
                                    <span class="bp-cn">{v.universeAiOffLine({ bot: botName })}</span>
                                {/if}
                            </div>
                        </div>
                        {#if pause.kind === "key-down" && viewerIsMaker}
                            <div class="vg-actions">
                                <PageButton
                                    tall
                                    testId="bot-voice-check"
                                    disabled={checking}
                                    on:click={() => pause?.kind === "key-down" && void checkNow(pause.key)}
                                >
                                    {v.checkNow()}
                                </PageButton>
                                {#if canOpenOrbit()}
                                    <PageButton tall on:click={openAiKeys}
                                        >{v.aiKeys()} <IconExternalLink font-size="14" /></PageButton
                                    >
                                {/if}
                            </div>
                        {:else if pause.kind === "key-gone"}
                            <div class="vg-actions">
                                {#if viewerIsMaker && canOpenOrbit()}
                                    <PageButton tall on:click={openAiKeys}
                                        >{v.aiKeys()} <IconExternalLink font-size="14" /></PageButton
                                    >
                                {/if}
                                {#if canUseUniverseAi}
                                    <PageButton
                                        tall
                                        testId="bot-voice-use-universe-ai"
                                        disabled={saving}
                                        on:click={() => void useUniverseAi()}
                                    >
                                        {v.useUniverseAi()}
                                    </PageButton>
                                {/if}
                            </div>
                        {/if}
                    {/if}

                    <div
                        class="bp-model"
                        class:dim={pause?.kind === "key-down" || pause?.kind === "key-gone"}
                        data-testid="bot-voice-card"
                    >
                        <div class="bp-mtx">
                            <span class="bp-cap">{v.cardCaption()}</span>
                            <span class="bp-mid">{voiceName}</span>
                            {#if cardAbout}<span class="bp-cn">{cardAbout}</span>{/if}
                            {#if cardModel}<span class="bp-cn">{cardModel}</span>{/if}
                        </div>
                        <button
                            type="button"
                            class="vg-play"
                            class:on={$playingSample === "card"}
                            disabled={!currentVoice?.previewUrl}
                            aria-label={currentVoice?.previewUrl
                                ? v.hear({ voice: voiceName })
                                : v.noSample({ voice: voiceName })}
                            data-testid="bot-voice-card-play"
                            on:click={() => void playChoice("card", currentVoice)}
                        >
                            {#if $playingSample === "card"}<IconPauseFilled
                                    font-size="16"
                                />{:else}<IconPlayerPlayFilled font-size="16" />{/if}
                        </button>
                        <PageButton tall testId="bot-voice-change" disabled={!pickerChoice} on:click={openPicker}
                            >{v.change()}</PageButton
                        >
                    </div>
                    {#if sampleError}<p class="bp-m" role="alert">{v.sampleFailed()}</p>{/if}

                    <PageField title={v.howItSpeaks()} hint={v.styleHint[expression]()}>
                        <PageSegment
                            label={v.howItSpeaks()}
                            options={VOICE_EXPRESSIONS.map((value) => ({
                                value,
                                label: v.style[value](),
                                testId: `bot-voice-style-${value}`,
                            }))}
                            value={expression}
                            onPick={chooseExpression}
                        />
                    </PageField>

                    <div class="bp-unlent" data-testid="bot-voice-payer">
                        {#if payerKindNow === "universe-ai"}<IconSparkles font-size="18" />{:else}<IconKey
                                font-size="18"
                            />{/if}
                        <div class="bp-mtx">
                            {#if payerKindNow === "universe-ai"}
                                <span class="bp-ut">{v.payerUniverseAiTitle()}</span>
                            {:else if payerKindNow === "keys" && speakingKey && listeningKey}
                                <span class="bp-ut"
                                    >{v.payerKeysTitle({
                                        speaks: keyPhrase(speakingKey),
                                        listens: keyPhrase(listeningKey),
                                    })}</span
                                >
                            {:else if payerKindNow === "key-speaks" && speakingKey}
                                <span class="bp-ut">{v.payerKeySpeaksTitle({ speaks: keyPhrase(speakingKey) })}</span>
                            {:else if payerKindNow === "key-listens" && listeningKey}
                                <span class="bp-ut">{v.payerKeyListensTitle({ listens: keyPhrase(listeningKey) })}</span
                                >
                            {:else}
                                <span class="bp-ut">{whoKey}</span>
                            {/if}
                            {#if payerKindNow === "universe-ai" || payerKindNow === "key-listens"}
                                <span class="bp-cn"
                                    >{v.payerUniverseAiNote({
                                        replies: voice.window.voiceReplies,
                                        hours: voice.window.hours,
                                    })}</span
                                >
                            {:else if speakingKey}
                                <span class="bp-cn"
                                    >{v.payerKeyNote({ bot: botName, replies: speakingKey.month.voiceReplies })}</span
                                >
                            {/if}
                            {#if limits}
                                <span class="bp-cn"
                                    >{v.limitsLine({
                                        seconds: limits.replySeconds,
                                        minutes: limits.listenMinutesPerDay,
                                    })}{speakingKey
                                        ? viewerIsMaker
                                            ? v.limitsYourKey()
                                            : v.limitsTheirKey({ maker })
                                        : ""}</span
                                >
                            {/if}
                        </div>
                    </div>
                    {#if !viewerIsMaker}
                        <p class="bp-note" data-testid="bot-voice-comanager">
                            <IconInfoCircle font-size="14" /><span>{v.coManager({ maker, bot: botName })}</span>
                        </p>
                    {/if}
                    {#if note?.kind === "rolled-back"}
                        <div class="vg-done" role="status" data-testid="bot-voice-rolled-back">
                            <IconCheck font-size="16" />{v.rolledBack({ number: note.number })}
                        </div>
                    {/if}

                    <button
                        type="button"
                        class="vg-more"
                        aria-expanded={moreOpen}
                        data-testid="bot-voice-more"
                        on:click={() => (moreOpen = !moreOpen)}
                    >
                        <span>{v.more()}</span>
                        <span class="bp-cn">{v.moreLine()}</span>
                        <IconChevronDown font-size="18" />
                    </button>

                    {#if moreOpen}
                        <div class="vg-adv" data-testid="bot-voice-more-open">
                            {#each [{ part: "speech", caption: v.speaksOn(), modelTitle: v.speakingModel(), source: speaksSource }, { part: "recognition", caption: v.listensOn(), modelTitle: v.listeningModel(), source: listensSource }] as row (row.part)}
                                {@const part = row.part === "speech" ? "speech" : "recognition"}
                                {@const current = row.source ? choiceOfSource(row.source) : null}
                                <div class="bp-cap" id="voice-{part}-on">{row.caption}</div>
                                <div class="bp-cards" role="radiogroup" aria-labelledby="voice-{part}-on">
                                    {#each choicesFor(voice, part) as choice (sourceKey(choice))}
                                        {@const picked = current !== null && sameChoice(current, choice)}
                                        <button
                                            type="button"
                                            role="radio"
                                            class="bp-card"
                                            class:picked
                                            aria-checked={picked}
                                            disabled={saving}
                                            data-testid="bot-voice-{part}-{choice.kind}"
                                            on:click={() => void chooseSource(part, choice)}
                                        >
                                            <span class="bp-cico">
                                                {#if choice.kind === "universe-ai"}<IconSparkles
                                                        font-size="22"
                                                    />{:else}<IconKey font-size="22" />{/if}
                                            </span>
                                            <span class="bp-ctx">
                                                <span class="bp-ct"
                                                    >{choice.kind === "universe-ai"
                                                        ? v.askUniverseAi()
                                                        : keyPhrase(choice.key)}</span
                                                >
                                                <span class="bp-cn">
                                                    {#if choice.kind === "universe-ai"}
                                                        {part === "speech"
                                                            ? v.universeAiPeople()
                                                            : v.universeAiListens()}
                                                    {:else if viewerIsMaker}
                                                        {v.keyYouPay()}
                                                    {:else}
                                                        {v.keyOwnerPays({ owner: maker })}
                                                    {/if}
                                                </span>
                                            </span>
                                            <span class="bp-radio" class:on={picked} aria-hidden="true" />
                                        </button>
                                    {/each}
                                </div>
                                {#if row.source && row.source.kind !== "gone"}
                                    {@const models = modelsOf(voice, part, row.source)}
                                    <PageField title={row.modelTitle}>
                                        <label class="bp-select">
                                            <select
                                                aria-label={row.modelTitle}
                                                disabled={saving}
                                                value={profile[part]?.model}
                                                data-testid="bot-voice-{part}-model"
                                                on:change={(e) => chooseModel(part, e.currentTarget.value)}
                                            >
                                                {#each models as model (model.id)}
                                                    <option value={model.id}>{modelLabel(model)}</option>
                                                {/each}
                                            </select>
                                            <IconChevronDown font-size="16" />
                                        </label>
                                    </PageField>
                                {/if}
                            {/each}

                            <PageField
                                title={v.language()}
                                hint={language.mode === "follow" ? v.languageFollowHint() : v.languageOneHint()}
                            >
                                <PageSegment
                                    label={v.language()}
                                    options={[
                                        {
                                            value: "follow",
                                            label: v.languageFollow(),
                                            testId: "bot-voice-language-follow",
                                        },
                                        { value: "fixed", label: v.languageOne(), testId: "bot-voice-language-fixed" },
                                    ]}
                                    value={language.mode}
                                    onPick={chooseLanguageMode}
                                />
                                {#if language.mode === "fixed"}
                                    {@const fixedCode = language.code}
                                    {@const codes = [
                                        ...new Set([fixedCode, ...(currentList ? voiceLanguages(currentList) : [])]),
                                    ]}
                                    <label class="bp-select">
                                        <select
                                            aria-label={v.language()}
                                            disabled={saving}
                                            value={fixedCode}
                                            data-testid="bot-voice-language-select"
                                            on:change={(e) => chooseLanguage(e.currentTarget.value)}
                                        >
                                            {#each codes as code (code)}
                                                <option value={code}>{languageName(code, $locale)}</option>
                                            {/each}
                                        </select>
                                        <IconChevronDown font-size="16" />
                                    </label>
                                {/if}
                            </PageField>

                            <div class="bp-cap vg-hcap"><IconHistory font-size="14" />{v.versions()}</div>
                            <div class="vg-vers" data-testid="bot-voice-versions">
                                {#each voice.revisions as revision (revision.number)}
                                    {@const speaking = revision.number === voice.revision}
                                    {@const who = whoPublished(revision.publishedById)}
                                    <div class="vg-ver" class:now={speaking}>
                                        <div class="bp-mtx">
                                            <span class="vg-t"
                                                >{v.version({
                                                    number: revision.number,
                                                    voice:
                                                        revision.profile.speech?.voiceName ??
                                                        revision.profile.speech?.voiceId ??
                                                        "",
                                                    style: v.style[revision.profile.expression ?? "natural"](),
                                                    payer: payerBrief(voice, revision.profile),
                                                })}</span
                                            >
                                            <span class="bp-cn"
                                                >{who
                                                    ? v.versionWhen({ when: whenOf(revision.publishedAt), who })
                                                    : v.versionWhenOnly({ when: whenOf(revision.publishedAt) })}</span
                                            >
                                        </div>
                                        {#if speaking}
                                            <span class="vg-pill">{v.speakingNow()}</span>
                                        {:else}
                                            <PageButton
                                                tall
                                                testId="bot-voice-roll-back"
                                                disabled={saving}
                                                on:click={() => rollBack(revision.number)}
                                            >
                                                {v.rollBack()}
                                            </PageButton>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <p class="bp-m">{v.versionsLine()}</p>
                        </div>
                    {/if}
                {/if}
            {/if}
        </div>
    </PageGroup>
{/if}

<style>
    .vg {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .vg.busy {
        opacity: 0.7;
    }
    .vg-set {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        cursor: pointer;
    }
    div.vg-set {
        cursor: default;
    }
    .vg-lock {
        color: rgba(244, 242, 250, 0.64);
        display: inline-flex;
    }
    .vg-t {
        font-size: 14px;
        font-weight: 600;
    }
    .vg-play {
        flex: none;
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    .vg-play.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .vg-play:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .vg-play:focus-visible,
    .vg-more:focus-visible,
    .bp-card:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vg-pill {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(243, 241, 250, 0.16);
        color: rgba(243, 241, 250, 0.85);
        white-space: nowrap;
    }
    .vg-done {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(74, 222, 128, 0.08);
        font-size: 13px;
        line-height: 1.4;
        color: #d6f5e0;
    }
    .vg-done :global(svg) {
        flex: none;
        margin-top: 2px;
        color: #4ade80;
    }
    .vg-error {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #ff8a7a;
    }
    .vg-warn {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(245, 196, 81, 0.1);
        box-shadow: inset 0 0 0 1px rgba(245, 196, 81, 0.35);
        color: #f5c451;
    }
    .vg-warn .bp-ut {
        color: #fff;
    }
    .vg-warn :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .vg-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
        margin-top: -4px;
    }
    .dim {
        opacity: 0.55;
    }
    .vg-more {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 8px;
        min-height: 52px;
        margin: 0;
        padding: 8px 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .vg-more .bp-cn {
        grid-column: 1;
        font-weight: 400;
    }
    .vg-more :global(svg) {
        grid-column: 2;
        grid-row: 1 / span 2;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .vg-more :global(svg) {
        transform: scaleX(-1);
    }
    .vg-adv {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 4px 0 0;
    }
    .vg-hcap {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
    }
    .vg-vers {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .vg-ver {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 8px 8px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        min-height: 56px;
    }
    .vg-ver.now {
        background: rgba(255, 255, 255, 0.08);
    }
    /* The same as in the Mind group, so the cards and rows look alike */
    .bp-ask {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(167, 139, 250, 0.1);
    }
    .bp-ask p {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.72);
    }
    .bp-ask .bp-ask-t {
        font-size: 15px;
        font-weight: 600;
        color: #f4f2fa;
    }
    .bp-ask-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
    }
    .bp-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .bp-card {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .bp-card.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .bp-card:disabled:not(.picked) {
        opacity: 0.55;
        cursor: default;
    }
    .bp-cico {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        color: #fff;
    }
    .bp-ctx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .bp-ct {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .bp-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-radio {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .bp-radio.on {
        background: radial-gradient(circle, #fff 0 4px, #6d4aff 5px);
        box-shadow: none;
    }
    .bp-model {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .bp-unlent {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .bp-unlent > :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .bp-ut {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.35;
        overflow-wrap: anywhere;
    }
    .bp-mtx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .bp-mid {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-note :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .bp-line {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
    }
    .bp-select {
        position: relative;
        display: block;
    }
    .bp-select select {
        width: 100%;
        height: 44px;
        margin: 0;
        padding: 0 36px 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        color: #fff;
        appearance: none;
        cursor: pointer;
        outline: none;
    }
    .bp-select select:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-select select option {
        background: #14121e;
        color: #fff;
    }
    .bp-select :global(svg) {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(244, 242, 250, 0.64);
        pointer-events: none;
    }
</style>
