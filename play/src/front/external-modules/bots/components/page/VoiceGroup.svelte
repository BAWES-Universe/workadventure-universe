<script lang="ts">
    // Voice: whether the bot talks in bubbles, with which voice, how it speaks and who pays (#1668). Off by default, and then
    // the group is the way in: a few voices to hear, one tap on Use turns voice on (no company, model or who-pays question on
    // Universe AI; a lent key is picked for you, with Change). More voice settings fold in language, who pays for listening and
    // speaking, the model of a key, and versions. Every change saves at once as a new version, like the rest of the page.
    // Every number, voice and key comes from Orbit.
    import { onDestroy, tick } from "svelte";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import { modalVisibilityStore } from "../../../../Stores/ModalStore";
    import { canOpenOrbit, openOrbitPage } from "../../../admin-api/index";
    import type { BotData } from "../../types";
    import { botApiService } from "../../services/BotApiService";
    import {
        VOICE_EXPRESSIONS,
        choiceOfSource,
        choicesFor,
        coversBoth,
        optionOf,
        companyName,
        describeVoice,
        doorVoices,
        fullProfile,
        isNoVoiceList,
        isOwnServer,
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
        startingPayer,
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
    import VoiceRows from "./VoiceRows.svelte";
    import VoicePayerPicker from "./VoicePayerPicker.svelte";
    import VoiceHello from "./VoiceHello.svelte";
    import VoiceTyped from "./VoiceTyped.svelte";
    import {
        IconAlertTriangle,
        IconCheck,
        IconChevronDown,
        IconChevronRight,
        IconExternalLink,
        IconHistory,
        IconInfoCircle,
        IconKey,
        IconLock,
        IconPauseFilled,
        IconPlayerPlayFilled,
        IconSearch,
        IconServer,
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
    /** The Voice row while voice is off: who pays (null: the one it starts on), the voice picked, and whether the choice of who pays is open */
    let doorPayerId: string | null = null;
    let doorPickedId: string | undefined;
    let payerOpen = false;
    /** More voice settings: which of the choices are open (each is one row with Change until it is tapped) */
    let languageOpen = false;
    let sourcesOpen = false;
    let modelOpen: Record<VoicePart, boolean> = { speech: false, recognition: false };
    type Note = { kind: "first-on"; voice: string; key: string | null } | { kind: "rolled-back"; number: number };
    let note: Note | null = null;

    /** The voices each source lists, by "universe-ai" or a key's id */
    let lists: Record<string, VoiceChoice[]> = {};
    let listFailed: Record<string, boolean> = {};
    /** The sources that list no voices because they never do (a speech server of the person's own): the page asks for a name (#1874) */
    let listTyped: Record<string, boolean> = {};
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
            listTyped = {};
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
        doorPayerId = null;
        doorPickedId = undefined;
        payerOpen = false;
        languageOpen = false;
        sourcesOpen = false;
        modelOpen = { speech: false, recognition: false };
        note = null;
        saveError = null;
        sampleError = false;
        myKeys = null;
        lists = {};
        listFailed = {};
        listTyped = {};
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

    /** A speech server of the person's own is named as one, not as a company's key (#1874): "your speech server", "Sara’s speech server" */
    function ownName(middle: boolean): string {
        if (!viewerIsMaker) return v.ownServerTheirs({ owner: maker });
        return middle ? v.ownServerMine() : v.ownServerMineStart();
    }
    function keyPhrase(key: VoiceKey, middle = false): string {
        if (isOwnServer(key)) return ownName(middle);
        const company = companyName(key.adapter);
        // Inside a sentence or an uppercase caption the digits only add noise: the company and whose key it is say enough.
        if (middle) return viewerIsMaker ? v.keyMineMidShort({ company }) : v.keyTheirsShort({ owner: maker, company });
        const args = { company, last4: key.last4 };
        return viewerIsMaker ? v.keyMine(args) : v.keyTheirs({ owner: maker, ...args });
    }
    function keyShort(key: VoiceKey): string {
        if (isOwnServer(key)) return ownName(false);
        const company = companyName(key.adapter);
        return viewerIsMaker ? v.keyMineShort({ company }) : v.keyTheirsShort({ owner: maker, company });
    }
    $: whoKey = viewerIsMaker ? v.yourKey() : v.theirKey({ maker });

    /** The name of a way to pay with keys: both keys when one listens and another speaks, else the one key. */
    /** A place a job runs on, as a sentence starts with it: "Universe AI", "Your Soniox key", "Sara’s Soniox key" */
    function placeShort(choice: PayerChoice): string {
        return choice.kind === "universe-ai" ? v.askUniverseAi() : keyShort(choice.key);
    }

    /** What pays for both jobs (#1911): one place for both, or the two places of a split */
    function payerTitle(option: PayerOption): string {
        if (coversBoth(option) && option.speech.kind === "key" && isOwnServer(option.speech.key)) {
            return v.payerOwnTitle({ server: ownName(true) });
        }
        if (coversBoth(option)) {
            return option.speech.kind === "key"
                ? v.paidByKey({ key: keyPhrase(option.speech.key, true) })
                : v.paidByUniverseAi();
        }
        return v.payerSplitTitle({ listens: placeShort(option.recognition), speaks: placeShort(option.speech) });
    }

    /** The line under it: what one place does and who pays, or that two companies are paid for */
    function payerLine(option: PayerOption, data: BotVoice): string {
        const keyLine = viewerIsMaker
            ? v.askKeyLine({ bot: botName })
            : v.askKeyLineTheirs({ owner: maker, bot: botName });
        if (coversBoth(option) && option.speech.kind === "key" && isOwnServer(option.speech.key)) {
            return v.payerOwnLine({ bot: botName });
        }
        if (coversBoth(option)) {
            if (option.speech.kind === "universe-ai") {
                return v.payerBothUniverseAiLine({ replies: data.window.voiceReplies, hours: data.window.hours });
            }
            return viewerIsMaker
                ? v.payerBothKeyLine({ bot: botName })
                : v.payerBothKeyLineTheirs({ owner: maker, bot: botName });
        }
        if (option.recognition.kind === "key" && option.speech.kind === "key") {
            return viewerIsMaker
                ? v.payerTwoKeysLine({ bot: botName })
                : v.payerTwoKeysLineTheirs({ owner: maker, bot: botName });
        }
        return keyLine;
    }

    function payerBrief(data: BotVoice, current: VoiceProfile): string {
        switch (payerKind(data, current)) {
            case "universe-ai":
                return v.payerUniverseAi();
            case "keys": {
                // One key that listens and speaks is one key, named by its company
                const speaks = sourceOf(data, current, "speech");
                const listens = sourceOf(data, current, "recognition");
                if (speaks.kind === "key" && listens.kind === "key" && speaks.key.id === listens.key.id) {
                    return keyPhrase(speaks.key, true);
                }
                return viewerIsMaker ? v.payerYourKeys() : v.payerTheirKeys({ maker });
            }
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
        whose: string,
        who: string
    ): string {
        if (!data || !now) return hasFailed ? v.loadFailed() : v.loading();
        switch (now.kind) {
            case "not-allowed":
                return v.notAllowedBrief();
            case "no-service":
                return v.noServiceBrief();
            case "off":
                return v.offDoor({ bot: who });
            case "on":
                if (now.pause?.kind === "key-down") {
                    return now.pause.reason === "credit" ? v.pausedCredit({ key: whose }) : v.pausedKey({ key: whose });
                }
                if (now.pause?.kind === "key-gone") return v.pausedGone({ key: whose });
                if (now.pause?.kind === "universe-ai-off") return v.pausedUniverseAi();
                return v.briefOn({ voice: speaking, style: v.style[style](), payer: payerBrief(data, now.profile) });
        }
    }
    $: brief = briefOf(voice, view, failed, voiceName, expression, whoKey, botName);

    // The voice card's second line
    $: speaksOwn = speaksSource?.kind === "key" && isOwnServer(speaksSource.key);
    // A speech server that lists no voices has no sample either: the voice is a name that was typed
    $: speaksTyped = speaksOwn && speakChoice !== null && listTyped[sourceKey(speakChoice)] === true;
    $: cardAbout = speaksTyped ? v.cardAboutTyped({ server: ownName(true) }) : describeVoice(currentVoice, $locale);

    $: payerKindNow = voice && profile ? payerKind(voice, profile) : "universe-ai";
    $: speakingKey = speaksSource?.kind === "key" ? speaksSource.key : null;
    $: limits = voice && profile ? limitsOf(voice, profile) : null;
    $: listensChoice = listensSource ? choiceOfSource(listensSource) : null;
    $: onOption = voice && listensChoice && speakChoice ? optionOf(voice, listensChoice, speakChoice) ?? null : null;

    // ---------------------------------------------------------------------------------------------------------------
    // The Voice row while voice is off: a few voices to hear, and one button

    $: previousProfile = voice ? liveRevision(voice)?.profile ?? null : null;
    $: doorOptions = voice && view?.kind === "off" ? payerOptions(voice) : [];
    $: doorOption =
        voice && view?.kind === "off"
            ? doorOptions.find((option) => option.id === doorPayerId) ?? startingPayer(voice, previousProfile)
            : null;
    $: doorList = doorOption ? lists[sourceKey(doorOption.speech)] : undefined;
    $: doorFailed = doorOption ? listFailed[sourceKey(doorOption.speech)] === true : false;
    $: doorTyped = doorOption ? listTyped[sourceKey(doorOption.speech)] === true : false;
    $: doorOwn = doorOption?.speech.kind === "key" && isOwnServer(doorOption.speech.key);
    /** Before voice is on, the typed name is heard from the speech server the door is on */
    $: doorSource = voice && doorOption ? providerOf(voice, "speech", doorOption.speech) ?? undefined : undefined;
    $: door =
        voice && doorOption && doorList
            ? doorVoices(voice, doorOption.speech, doorList, previousProfile?.speech?.voiceId)
            : null;
    // The first voice is picked until another is; a new list (another payer) starts again
    $: if (door && !door.voices.some((candidate) => candidate.voiceId === doorPickedId)) doorPickedId = door.startId;
    $: doorPicked = doorList?.find((candidate) => candidate.voiceId === doorPickedId);
    $: doorTags =
        door?.startId === undefined
            ? {}
            : previousProfile?.speech?.voiceId === door.startId
            ? { [door.startId]: v.usedBefore() }
            : {};

    // ---------------------------------------------------------------------------------------------------------------
    // Voice lists and samples

    function voicesFor(choice: PayerChoice): Promise<VoiceChoice[]> {
        const id = sourceKey(choice);
        const known = lists[id];
        if (known) return Promise.resolve(known);
        const botId = bot.id;
        // One request per bot and source: the panel may move to another bot while one is on its way
        const slot = `${botId}/${id}`;
        listLoading[slot] ??= botApiService
            .getBotVoices(botId, id)
            .then((list) => {
                // A source that lists no voice is a failure to load, not a list: the page offers Try again instead of a dead button
                const stored = list.length > 0;
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (bot.id === botId && stored) lists = { ...lists, [id]: list };
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (bot.id === botId && !stored) listFailed = { ...listFailed, [id]: true };
                return list;
            })
            .catch((e) => {
                // eslint-disable-next-line svelte/infinite-reactive-loop
                if (bot.id === botId) listFailed = { ...listFailed, [id]: true };
                // A speech server that lists no voices never will: no Try again, the voice's name is asked for instead
                if (bot.id === botId && isNoVoiceList(e)) listTyped = { ...listTyped, [id]: true };
                throw e;
            })
            .finally(() => {
                delete listLoading[slot];
            });
        return listLoading[slot];
    }

    // The voice on the card shows what its company says about it once the list is in; the card works without it
    $: if (open && speakChoice && !lists[sourceKey(speakChoice)] && !listFailed[sourceKey(speakChoice)]) {
        // eslint-disable-next-line svelte/infinite-reactive-loop
        voicesFor(speakChoice).catch(() => undefined);
    }

    $: if (open && doorOption && !lists[sourceKey(doorOption.speech)] && !listFailed[sourceKey(doorOption.speech)]) {
        // eslint-disable-next-line svelte/infinite-reactive-loop
        voicesFor(doorOption.speech).catch(() => undefined);
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

    /** Whether the bot already speaks with this voice from this place (a version it was turned off with, still working). */
    function sameAsBefore(data: BotVoice, option: PayerOption, choice: VoiceChoice): boolean {
        const before = liveRevision(data)?.profile;
        if (!before || !fullProfile(before) || pauseOf(data, before)) return false;
        const speech = providerOf(data, "speech", option.speech);
        const recognition = providerOf(data, "recognition", option.recognition);
        return (
            before.speech?.voiceId === choice.voiceId &&
            before.speech?.providerId === (choice.providerId || speech?.providerId) &&
            before.recognition?.providerId === recognition?.providerId
        );
    }

    /**
     * Turns voice on with a voice from a place to pay from: save the profile, then turn it on. Turned off with the very same
     * voice and place, it only turns on again (no new version).
     */
    async function turnOnWith(option: PayerOption, choice: VoiceChoice) {
        if (!voice) return;
        const data = voice;
        const botId = bot.id;
        const saved = await run(async () => {
            const spoken = { voiceId: choice.voiceId, voiceName: choice.name };
            const before = liveRevision(data)?.profile;
            if (!sameAsBefore(data, option, choice)) {
                const recognition = providerOf(data, "recognition", option.recognition);
                const speech = providerOf(data, "speech", option.speech);
                if (!recognition || !speech) throw new Error(v.voicesFailed());
                const fresh: FullVoiceProfile = {
                    recognition,
                    speech: {
                        providerId: choice.providerId || speech.providerId,
                        model: choice.model || speech.model,
                        ...spoken,
                    },
                    // The style and language the bot had stay when only the voice or the place to pay changes
                    expression: before?.expression ?? "natural",
                    language: before?.language ?? { mode: "follow" },
                };
                await botApiService.saveBotVoice(botId, fresh);
            }
            const on = await botApiService.setBotVoiceEnabled(botId, true);
            pendingNote = {
                kind: "first-on",
                voice: choice.name,
                key: option.speech.kind === "key" ? keyPhrase(option.speech.key, true) : null,
            };
            return on;
        });
        if (saved) {
            note = pendingNote;
            payerOpen = false;
            doorPayerId = null;
            doorPickedId = undefined;
            stopSample();
            screen = "page";
        }
        pendingNote = null;
    }
    let pendingNote: Note | null = null;

    /** The switch is a native checkbox that has already flipped when this runs: when nothing changed (a failed save), put it
     *  back to what the page says. It is only on the page while voice is on, so this turns voice off. */
    async function onSwitch(next: boolean) {
        if (!next && voice && !saving) await run(() => botApiService.setBotVoiceEnabled(bot.id, false));
        await tick();
        const input = document.getElementById("bot-voice-switch");
        if (input instanceof HTMLInputElement) input.checked = view?.kind === "on";
    }

    /** Who pays (#1911): where both jobs run. A new place for speaking brings a voice that company has; one save for both. */
    async function choosePlaces(option: PayerOption) {
        const current = base();
        if (!voice || !profile || !current || saving) return;
        const data = voice;
        // The panel can move to another bot while the voice list loads; the save stays on the bot picked on.
        const botId = bot.id;
        const listensNow = choiceOfSource(sourceOf(data, profile, "recognition"));
        const speaksNow = choiceOfSource(sourceOf(data, profile, "speech"));
        const newListening = !listensNow || !sameChoice(listensNow, option.recognition);
        const newSpeaking = !speaksNow || !sameChoice(speaksNow, option.speech);
        if (!newListening && !newSpeaking) return;
        await run(async () => {
            const next: FullVoiceProfile = { ...current };
            if (newListening) {
                const picked = providerOf(data, "recognition", option.recognition);
                if (!picked) throw new Error(v.voicesFailed());
                next.recognition = picked;
            }
            if (newSpeaking) {
                const speech = providerOf(data, "speech", option.speech);
                const list = await voicesFor(option.speech);
                const picked = startingVoice(data, option.speech, list, current.speech.voiceId);
                if (!speech || !picked) throw new Error(v.voicesFailed());
                const entry = list.find((candidate) => candidate.voiceId === picked.voiceId);
                next.speech = {
                    providerId: entry?.providerId || speech.providerId,
                    model: entry?.model || speech.model,
                    voiceId: picked.voiceId,
                    ...(picked.voiceName ? { voiceName: picked.voiceName } : {}),
                };
            }
            return botApiService.saveBotVoice(botId, next);
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
                // Universe AI's part always starts on its current model; a key keeps the model its maker picked
                model:
                    sameProvider && pickerChoice.kind === "key" ? current.speech.model : choice.model || speech.model,
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
        const botId = bot.id;
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
            return botApiService.saveBotVoice(botId, next);
        });
    }

    async function checkNow(key: VoiceKey) {
        if (checking) return;
        checking = true;
        saveError = null;
        const botId = bot.id;
        try {
            const checked = await botApiService.checkVoiceKey(key.id);
            // A check that did not go through must say so, not look like nothing happened.
            if (!checked && bot.id === botId) saveError = v.keyDownOther({ key: keyShort(key) });
            await load(bot.id, true);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            checking = false;
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // The picker

    $: pickerChoice = speakChoice ?? doorOption?.speech ?? (voice ? firstSpeechChoice(voice) : null);
    $: pickerList = pickerChoice ? lists[sourceKey(pickerChoice)] ?? null : null;
    $: pickerFailed = pickerChoice ? listFailed[sourceKey(pickerChoice)] === true : false;
    $: pickerTyped = pickerChoice ? listTyped[sourceKey(pickerChoice)] === true : false;
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
        // A server that lists no voices does not start listing them: the name is asked for at once
        if (listTyped[sourceKey(choice)]) return;
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
    function retryDoor() {
        if (!doorOption) return;
        const choice = doorOption.speech;
        delete listFailed[sourceKey(choice)];
        listFailed = listFailed;
        voicesFor(choice).catch(() => undefined);
    }
    /** A voice name typed for the speech server, as the voice the page saves (it has no list to pick it from) */
    const typedChoice = (name: string): VoiceChoice => ({
        voiceId: name,
        name,
        description: "",
        languages: [],
        previewUrl: null,
        providerId: "",
        model: "",
    });
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

    /** A lent key could do the speaking or the listening: the choice of where each runs is one tap away */
    $: hasKeyChoice = voice
        ? choicesFor(voice, "speech").some((choice) => choice.kind === "key") ||
          choicesFor(voice, "recognition").some((choice) => choice.kind === "key")
        : false;
    $: hasModelRow = voice ? [speaksSource, listensSource].some((source) => source?.kind === "key") : false;
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
            {:else if screen === "picker" && view.kind === "on" && pickerTyped}
                <VoiceTyped
                    botId={bot.id}
                    {botName}
                    mode="change"
                    server={ownName(true)}
                    serverStart={ownName(false)}
                    currentName={voiceName}
                    busy={saving}
                    onBack={closePicker}
                    onUse={(name) => useVoice(typedChoice(name))}
                    on:refresh={() => void load(bot.id, true)}
                />
                {#if saveError}<p class="vg-error" role="alert">{saveError}</p>{/if}
            {:else if screen === "picker" && (view.kind === "on" || view.kind === "off")}
                <VoicePicker
                    {botName}
                    heading={pickerHeading}
                    voices={pickerList}
                    failed={pickerFailed}
                    currentId={view.kind === "on" ? profile?.speech?.voiceId : undefined}
                    startId={view.kind === "off" ? doorPickedId : undefined}
                    offerKeys={noSpeakingKey}
                    canOpenKeys={canOpenOrbit()}
                    busy={saving}
                    onBack={closePicker}
                    onUse={(choice) =>
                        view.kind === "off" && doorOption ? void turnOnWith(doorOption, choice) : void useVoice(choice)}
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
                            <span class="bp-cn"
                                >{viewerIsMaker && canOpenOrbit()
                                    ? v.noServiceLineMaker({ bot: botName })
                                    : v.noServiceLine({ bot: botName })}</span
                            >
                        {/if}
                    </div>
                </div>
                {#if view.kind === "no-service" && viewerIsMaker && canOpenOrbit()}
                    <div class="bp-line">
                        <span />
                        <PageButton tall testId="bot-voice-add-keys" on:click={openAiKeys}>
                            {v.addVoiceKeys()}
                            <IconExternalLink font-size="14" />
                        </PageButton>
                    </div>
                {/if}
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
                {#if view.kind === "on"}
                    <label class="vg-set" for="bot-voice-switch">
                        <span class="bp-mtx"
                            ><span class="vg-t">{v.switchTitle()}</span><span class="bp-cn">{v.switchHint()}</span
                            ></span
                        >
                        <PageSwitch
                            id="bot-voice-switch"
                            testId="bot-voice-switch"
                            checked
                            disabled={saving}
                            label={v.switchLabel()}
                            onChange={onSwitch}
                        />
                    </label>
                {:else if doorOption}
                    <p class="bp-m" data-testid="bot-voice-off-line">{v.doorLead({ bot: botName })}</p>
                    <!-- Universe AI alone needs no row: the note under the voices says it is free -->
                    {#if voice && (doorOptions.length > 1 || doorOption.kind === "key")}
                        <button
                            type="button"
                            class="vg-tap"
                            class:vg-still={doorOptions.length < 2}
                            disabled={doorOptions.length < 2}
                            aria-expanded={doorOptions.length < 2 ? undefined : payerOpen}
                            data-testid="bot-voice-payer-change"
                            on:click={() => (payerOpen = !payerOpen)}
                        >
                            <span class="vg-ico">
                                {#if doorOwn}<IconServer
                                        font-size="20"
                                    />{:else if doorOption.speech.kind === "key" || doorOption.recognition.kind === "key"}<IconKey
                                        font-size="20"
                                    />{:else}<IconSparkles font-size="20" />{/if}
                            </span>
                            <span class="bp-mtx">
                                <span class="vg-t">{payerTitle(doorOption)}</span>
                                <span class="bp-cn">{payerLine(doorOption, voice)}</span>
                            </span>
                            {#if doorOptions.length > 1}<span class="vg-chg">{v.change()}</span>{/if}
                        </button>
                        {#if payerOpen && doorOptions.length > 1}
                            <VoicePayerPicker
                                {voice}
                                listens={doorOption.recognition}
                                speaks={doorOption.speech}
                                {botName}
                                {viewerIsMaker}
                                {maker}
                                place="door"
                                keyName={(key) => keyPhrase(key)}
                                onPick={(option) => {
                                    doorPayerId = option.id;
                                    if (coversBoth(option)) payerOpen = false;
                                }}
                            />
                        {/if}
                    {/if}
                    {#if !doorTyped}
                        <div class="bp-cap" data-testid="bot-voice-door-caption">
                            {doorOption.speech.kind === "key"
                                ? v.doorVoicesOn({ key: keyPhrase(doorOption.speech.key, true) })
                                : v.doorVoices()}
                        </div>
                    {/if}
                    {#if door && doorList}
                        <VoiceRows
                            voices={door.voices}
                            pickedId={doorPickedId}
                            tags={doorTags}
                            onPick={(choice) => (doorPickedId = choice.voiceId)}
                            onPlay={(choice) => void playChoice(`row:${choice.voiceId}`, choice)}
                        />
                        {#if doorList.length > door.voices.length}
                            <button
                                type="button"
                                class="vg-tap"
                                data-testid="bot-voice-all-voices"
                                on:click={openPicker}
                            >
                                <span class="vg-ico"><IconSearch font-size="20" /></span>
                                <span class="bp-mtx">
                                    <span class="vg-t">{v.allVoices()}</span>
                                    <span class="bp-cn">{v.allVoicesLine({ count: doorList.length })}</span>
                                </span>
                                <IconChevronRight font-size="18" />
                            </button>
                        {/if}
                        {#if sampleError}<p class="bp-m" role="alert">{v.sampleFailed()}</p>{/if}
                        {#if saveError}<p class="vg-error" role="alert" data-testid="bot-voice-error">
                                {saveError}
                            </p>{/if}
                        <button
                            type="button"
                            class="vg-go"
                            data-testid="bot-voice-go"
                            disabled={saving || !doorPicked}
                            on:click={() => doorPicked && void turnOnWith(doorOption, doorPicked)}
                        >
                            {v.useVoice({ voice: doorPicked?.name ?? "" }).trim()}
                        </button>
                        {#if doorOption.speech.kind === "universe-ai" && voice}
                            <p class="bp-note" data-testid="bot-voice-door-note">
                                <IconSparkles font-size="14" /><span
                                    >{v.doorNoteUniverseAi({
                                        bot: botName,
                                        replies: voice.window.voiceReplies,
                                        hours: voice.window.hours,
                                    })}</span
                                >
                            </p>
                        {/if}
                    {:else if doorTyped}
                        {#key doorOption.id}
                            <VoiceTyped
                                botId={bot.id}
                                {botName}
                                mode="door"
                                server={ownName(true)}
                                serverStart={ownName(false)}
                                source={doorSource}
                                busy={saving}
                                onUse={(name) => turnOnWith(doorOption, typedChoice(name))}
                                on:refresh={() => void load(bot.id, true)}
                            />
                        {/key}
                        {#if saveError}<p class="vg-error" role="alert" data-testid="bot-voice-error">
                                {saveError}
                            </p>{/if}
                    {:else if doorFailed}
                        <div class="bp-line">
                            <p class="bp-m">{v.voicesFailed()}</p>
                            <PageButton tall testId="bot-voice-door-retry" on:click={retryDoor}>{v.retry()}</PageButton>
                        </div>
                    {:else}
                        <p class="bp-m">{v.voicesLoading()}</p>
                    {/if}
                {/if}

                {#if saveError && view.kind === "on"}<p class="vg-error" role="alert" data-testid="bot-voice-error">
                        {saveError}
                    </p>{/if}

                {#if view.kind === "on" && profile && voice}
                    {#if note?.kind === "first-on"}
                        <div class="vg-done" role="status" data-testid="bot-voice-first-on">
                            <IconCheck font-size="16" />{note.key
                                ? v.firstOnKey({ bot: botName, voice: note.voice, key: note.key })
                                : v.firstOnUniverseAi({ bot: botName, voice: note.voice })}
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
                        </div>
                        {#if !speaksTyped}
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
                        {/if}
                        <PageButton tall testId="bot-voice-change" disabled={!pickerChoice} on:click={openPicker}
                            >{v.change()}</PageButton
                        >
                    </div>
                    {#if sampleError}<p class="bp-m" role="alert">{v.sampleFailed()}</p>{/if}

                    {#if !pause}
                        {#key bot.id}
                            <VoiceHello
                                botId={bot.id}
                                paidByKey={speakingKey ? keyPhrase(speakingKey, true) : null}
                                free={speaksOwn}
                                locale={$locale}
                                on:refresh={() => void load(bot.id, true)}
                            />
                        {/key}
                    {/if}

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

                    {#if !moreOpen}
                        <p class="bp-note" data-testid="bot-voice-payer">
                            {#if payerKindNow === "universe-ai"}<IconSparkles
                                    font-size="14"
                                />{:else if speaksOwn}<IconServer font-size="14" />{:else}<IconKey
                                    font-size="14"
                                />{/if}
                            <span>
                                {#if payerKindNow === "universe-ai"}
                                    {v.onNoteUniverseAi({
                                        replies: voice.window.voiceReplies,
                                        hours: voice.window.hours,
                                    })}
                                {:else if onOption}
                                    {payerTitle(onOption)}
                                {:else}
                                    {whoKey}
                                {/if}
                            </span>
                        </p>
                    {/if}
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
                        <span class="bp-cn">{hasModelRow ? v.moreLineModel() : v.moreLine()}</span>
                        <IconChevronDown font-size="18" />
                    </button>

                    {#if moreOpen}
                        <div class="vg-adv" data-testid="bot-voice-more-open">
                            <div class="bp-cap">{v.language()}</div>
                            <button
                                type="button"
                                class="vg-tap"
                                aria-expanded={languageOpen}
                                data-testid="bot-voice-language-change"
                                on:click={() => (languageOpen = !languageOpen)}
                            >
                                <span class="bp-mtx">
                                    <span class="vg-t"
                                        >{language.mode === "fixed"
                                            ? v.languageAlways({ language: languageName(language.code, $locale) })
                                            : v.languageFollow()}</span
                                    >
                                    <span class="bp-cn"
                                        >{language.mode === "fixed"
                                            ? v.languageAlwaysHint({
                                                  bot: botName,
                                                  language: languageName(language.code, $locale),
                                              })
                                            : v.languageFollowHint({ bot: botName })}</span
                                    >
                                </span>
                                <span class="vg-chg">{v.change()}</span>
                            </button>
                            {#if languageOpen}
                                <div class="bp-cards" role="radiogroup" aria-label={v.language()}>
                                    <button
                                        type="button"
                                        role="radio"
                                        class="bp-card"
                                        class:picked={language.mode === "follow"}
                                        aria-checked={language.mode === "follow"}
                                        disabled={saving}
                                        data-testid="bot-voice-language-follow"
                                        on:click={() => chooseLanguageMode("follow")}
                                    >
                                        <span class="bp-ctx">
                                            <span class="bp-ct">{v.languageFollow()}</span>
                                            <span class="bp-cn">{v.languageFollowHint({ bot: botName })}</span>
                                        </span>
                                        <span
                                            class="bp-radio"
                                            class:on={language.mode === "follow"}
                                            aria-hidden="true"
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        role="radio"
                                        class="bp-card"
                                        class:picked={language.mode === "fixed"}
                                        aria-checked={language.mode === "fixed"}
                                        disabled={saving}
                                        data-testid="bot-voice-language-fixed"
                                        on:click={() => chooseLanguageMode("fixed")}
                                    >
                                        <span class="bp-ctx">
                                            <span class="bp-ct">{v.languageOne()}</span>
                                            <span class="bp-cn">{v.languageOneHint({ bot: botName })}</span>
                                        </span>
                                        <span
                                            class="bp-radio"
                                            class:on={language.mode === "fixed"}
                                            aria-hidden="true"
                                        />
                                    </button>
                                </div>
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
                            {/if}

                            <div class="bp-cap">{v.whoPays()}</div>
                            <div class="vg-tap vg-still" data-testid="bot-voice-payer">
                                <span class="vg-ico">
                                    {#if payerKindNow === "universe-ai"}<IconSparkles
                                            font-size="20"
                                        />{:else if speaksOwn}<IconServer font-size="20" />{:else}<IconKey
                                            font-size="20"
                                        />{/if}
                                </span>
                                <span class="bp-mtx">
                                    {#if payerKindNow === "universe-ai"}
                                        <span class="vg-t">{v.askUniverseAi()}</span>
                                    {:else if onOption}
                                        <span class="vg-t">{payerTitle(onOption)}</span>
                                    {:else}
                                        <span class="vg-t">{whoKey}</span>
                                    {/if}
                                    {#if payerKindNow === "universe-ai" || payerKindNow === "key-listens"}
                                        <span class="bp-cn"
                                            >{v.onNoteUniverseAi({
                                                replies: voice.window.voiceReplies,
                                                hours: voice.window.hours,
                                            })}</span
                                        >
                                    {:else if speakingKey}
                                        <span class="bp-cn"
                                            >{v.payerKeyNote({
                                                bot: botName,
                                                replies: speakingKey.month.voiceReplies,
                                            })}</span
                                        >
                                    {/if}
                                </span>
                                {#if hasKeyChoice}
                                    <button
                                        type="button"
                                        class="vg-chg"
                                        aria-expanded={sourcesOpen}
                                        data-testid="bot-voice-sources-change"
                                        on:click={() => (sourcesOpen = !sourcesOpen)}>{v.change()}</button
                                    >
                                {/if}
                            </div>
                            {#if hasKeyChoice && sourcesOpen}
                                <VoicePayerPicker
                                    {voice}
                                    listens={listensChoice}
                                    speaks={speakChoice}
                                    {botName}
                                    {viewerIsMaker}
                                    {maker}
                                    {saving}
                                    place="on"
                                    keyName={(key) => keyPhrase(key)}
                                    onPick={(option) => void choosePlaces(option)}
                                />
                            {/if}
                            {#if !hasKeyChoice && payerKindNow === "universe-ai"}
                                <p class="bp-note" data-testid="bot-voice-universe-ai-picks">
                                    <IconInfoCircle font-size="14" /><span>{v.universeAiPicks({ bot: botName })}</span>
                                </p>
                                {#if canOpenOrbit()}
                                    <div class="bp-line">
                                        <span />
                                        <PageButton tall on:click={openAiKeys}
                                            >{v.aiKeys()} <IconExternalLink font-size="14" /></PageButton
                                        >
                                    </div>
                                {/if}
                            {/if}

                            {#each [{ part: "speech", title: v.speakingModel(), source: speaksSource }, { part: "recognition", title: v.listeningModel(), source: listensSource }] as row (row.part)}
                                {@const part = row.part === "speech" ? "speech" : "recognition"}
                                {#if row.source && row.source.kind === "key"}
                                    {@const models = modelsOf(voice, part, row.source)}
                                    {@const chosen = profile[part]?.model}
                                    {@const shown = models.find((model) => model.id === chosen)}
                                    <button
                                        type="button"
                                        class="vg-tap"
                                        class:vg-still={models.length < 2}
                                        disabled={models.length < 2}
                                        aria-expanded={modelOpen[part]}
                                        data-testid="bot-voice-{part}-model-change"
                                        on:click={() => (modelOpen[part] = !modelOpen[part])}
                                    >
                                        <span class="bp-mtx">
                                            <span class="vg-t"
                                                >{v.modelRow({
                                                    title: row.title,
                                                    model: modelName(
                                                        shown ?? (chosen ? { id: chosen } : undefined),
                                                        ""
                                                    ),
                                                })}</span
                                            >
                                        </span>
                                        {#if models.length > 1}<span class="vg-chg">{v.change()}</span>{/if}
                                    </button>
                                    {#if modelOpen[part] && models.length > 1}
                                        <PageField title={row.title}>
                                            <label class="bp-select">
                                                <select
                                                    aria-label={row.title}
                                                    disabled={saving}
                                                    value={chosen}
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
                                {/if}
                            {/each}
                            {#if limits}
                                <p class="bp-m">
                                    {v.limitsLine({
                                        seconds: limits.replySeconds,
                                        minutes: limits.listenMinutesPerDay,
                                    })}{speakingKey
                                        ? viewerIsMaker
                                            ? v.limitsYourKey()
                                            : v.limitsTheirKey({ maker })
                                        : ""}
                                </p>
                            {/if}

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
    .vg-tap {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 6px 4px 6px 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .vg-tap:disabled,
    .vg-still {
        cursor: default;
    }
    @media (hover: hover) {
        .vg-tap:not(:disabled):not(.vg-still):hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .vg-tap:focus-visible,
    .vg-chg:focus-visible,
    .vg-go:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vg-tap > :global(svg) {
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .vg-tap > :global(svg) {
        transform: scaleX(-1);
    }
    .vg-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .vg-chg {
        flex: none;
        display: inline-flex;
        align-items: center;
        height: 44px;
        margin: 0;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .vg-go {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 48px;
        margin: 2px 0 0;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .vg-go:disabled {
        opacity: 0.5;
        cursor: default;
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
