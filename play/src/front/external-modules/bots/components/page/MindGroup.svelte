<script lang="ts">
    // Mind: which AI the bot thinks with. A provider whose model has vision (can look at pictures) says so.
    import { onDestroy } from "svelte";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import { modalVisibilityStore } from "../../../../Stores/ModalStore";
    import type { BotAiOptions, BotData } from "../../types";
    import { botApiService } from "../../services/BotApiService";
    import { resolveVisionSupport } from "../../visionModels";
    import { canOpenOrbit, openOrbitPage } from "../../../admin-api/index";
    import { canPick, cardIcon, mindBriefName, runsOnCards, unlentKeyNames, type RunsOnCard } from "../../mindModel";
    import { allowedModelsOf, botModelOf, keyChoice, keyOfRef, modelRow, shortName } from "../../modelPickerModel";
    import PageGroup from "./PageGroup.svelte";
    import PageButton from "./PageButton.svelte";
    import ModelList from "./ModelList.svelte";
    import {
        IconChevronDown,
        IconCpu,
        IconExternalLink,
        IconEye,
        IconKey,
        IconPlug,
        IconSparkles,
        IconTool,
    } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;

    type Provider = Awaited<ReturnType<typeof botApiService.getAvailableAIProviders>>[number];

    let providers: Provider[] = [];
    let loading = true;
    let failed = false;
    /**
     * What Orbit offers this bot under "Runs on" (Universe AI and the viewer's own keys lent here). Null when Orbit can't
     * say (an older Orbit, offline): the page then keeps the provider list it always had.
     */
    let options: BotAiOptions | null = null;
    /** The viewer's own keys, lent or not (#1375): the ones not lent here are named, with how to lend them. */
    let myKeys: Array<{ id: string; name: string }> | null = null;
    /**
     * AI keys was opened from this page: a key lent there should show here at once, so what Orbit offers is loaded again
     * when Orbit closes or the page gets focus back, until the panel moves to another bot.
     */
    let lendPending = false;

    /** The model list is open: for the key the bot is on (Change), or for a key it is about to go on (nothing picked yet). */
    let choosing: { keyId: string; pending: boolean } | null = null;

    let loadedFor: string | undefined | null = null;
    let loadCount = 0;

    /** `quiet`: loaded again in the background (after a lend), so the page keeps what it shows until the answer is in. */
    async function load(botId: string | undefined, quiet = false) {
        // Only the newest load may answer: a slow reply for the bot the panel was on before must not show on this one
        const mine = ++loadCount;
        if (!quiet) {
            loading = true;
            failed = false;
        }
        if (!botApiService.isInitialized()) {
            if (quiet) return;
            loading = false;
            failed = true;
            return;
        }
        try {
            // The viewer's own keys only add a hint, so the page never waits for them: they show when they arrive
            void botApiService
                .getMyAiKeys()
                .then((loadedKeys) => {
                    if (mine === loadCount && (loadedKeys || !quiet)) myKeys = loadedKeys;
                })
                .catch((e) => console.error("[MindGroup] Failed to load the viewer's AI keys:", e));
            // The provider names (to show what a pinned bot is on) and what Orbit offers, together
            const [loadedProviders, loadedOptions] = await Promise.all([
                botApiService.getAvailableAIProviders(true),
                botApiService.getBotAiOptions(botId ? { botId } : {}),
            ]);
            if (mine !== loadCount) return;
            // A background load that couldn't be answered (the provider list comes back empty then) keeps what the page
            // already shows
            if (loadedProviders.length > 0 || !quiet) providers = loadedProviders;
            if (loadedOptions || !quiet) options = loadedOptions;
        } catch (e) {
            if (mine !== loadCount) return;
            console.error("[MindGroup] Failed to load AI providers:", e);
            if (!quiet) failed = true;
        } finally {
            if (mine === loadCount) loading = false;
        }
    }

    function openAiKeys() {
        lendPending = true;
        openOrbitPage("/admin/you/ai-keys");
    }

    function reloadAfterLend() {
        if (lendPending && !loading) void load(bot.id, true);
    }

    // Orbit closing is one way back from a lend (the other is the page getting focus back, below)
    let orbitOpen = false;
    const unsubscribeOrbit = modalVisibilityStore.subscribe((visible) => {
        if (orbitOpen && !visible) reloadAfterLend();
        orbitOpen = visible;
    });
    onDestroy(unsubscribeOrbit);

    function showFor(botId: string | undefined) {
        if (loadedFor === botId) return;
        loadedFor = botId;
        options = null;
        myKeys = null;
        choosing = null;
        lendPending = false;
        void load(botId);
    }

    // On first show, and again whenever the panel moves to another bot (it stays mounted when the bot changes)
    $: showFor(bot.id);

    // A provider can see pictures when its model can (by its setting or its model's name), or when it has a
    // separate model for pictures.
    function seesPictures(provider: Provider): boolean {
        return (
            resolveVisionSupport(provider.model || "", provider.supportsVision) ||
            (!!provider.visionModel && provider.supportsVision !== false)
        );
    }

    $: page = $LL.mapEditor.edit.bots.page;
    $: ref = bot.aiProviderRef ?? "";
    $: current = providers.find((p) => p.providerId.toLowerCase() === ref.toLowerCase());
    $: names = new Map(providers.map((p) => [p.providerId.toLowerCase(), p.name]));
    $: cards = options ? runsOnCards(options, ref || null, names) : [];
    $: runsOnBrief = options ? mindBriefName(options, ref || null, names) : null;
    $: unlent = options ? unlentKeyNames(options, myKeys) : [];
    $: unlentList = listNames(unlent, $locale);
    // The model the bot is on, when it is on one of the person's own keys
    $: rowKey = options ? keyOfRef(options, ref || options.current) : undefined;
    $: row = options ? modelRow(options, ref || options.current, botModelOf(options, bot)) : null;
    $: rowModel = row?.kind === "choose" ? row.model : row?.kind === "single" ? row.model : null;
    $: rowModelId = rowModel ? rowModel.id : row?.kind === "unlisted" ? row.model : null;
    $: choosingKey = options && choosing ? keyOfRef(options, choosing.keyId) : undefined;
    $: chooseModels = choosingKey ? allowedModelsOf(choosingKey) : null;
    $: brief = options
        ? runsOnBrief?.kind === "universe-ai"
            ? page.mind.universeAi()
            : runsOnBrief?.kind === "key"
            ? [runsOnBrief.name, rowModelId ? shortName(rowModelId) : ""].filter(Boolean).join(" · ")
            : runsOnBrief?.kind === "gone"
            ? page.mind.keyGoneTitle()
            : runsOnBrief?.kind === "provider" && current
            ? [
                  current.enabled
                      ? current.name
                      : `${current.name} ${$LL.actionbar.botEditorModule.providerDisabled()}`,
                  current.model,
                  seesPictures(current) ? page.mind.seesPictures() : "",
              ]
                  .filter(Boolean)
                  .join(" · ")
            : runsOnBrief?.kind === "provider"
            ? runsOnBrief.name ?? runsOnBrief.ref
            : page.mind.none()
        : !ref
        ? page.mind.none()
        : current
        ? [
              current.enabled ? current.name : `${current.name} ${$LL.actionbar.botEditorModule.providerDisabled()}`,
              current.model,
              seesPictures(current) ? page.mind.seesPictures() : "",
          ]
              .filter(Boolean)
              .join(" · ")
        : ref;

    function listNames(list: string[], lang: string): string {
        if (list.length < 2 || !Intl.ListFormat) return list.join(", ");
        return new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(list);
    }

    function chooseCard(card: RunsOnCard) {
        if (!options || !canPick(options, card)) return;
        // Another key or Universe AI starts the bot off on its own model: the only one, the provider's suggested one, or
        // none yet. A key that needs a pick opens its list first, and the bot moves only when a model is saved.
        const key = card.kind === "mine" ? keyOfRef(options, card.id) : undefined;
        const choice = key ? keyChoice(key) : { model: null, needsPick: false };
        if (choice.needsPick) {
            choosing = { keyId: card.id, pending: true };
            return;
        }
        onChange({ ...bot, aiProviderRef: card.id, aiModel: choice.model });
    }

    function saveModel(model: string) {
        if (!choosing) return;
        onChange({ ...bot, aiProviderRef: choosing.keyId, aiModel: model });
        choosing = null;
    }

    function noteOf(card: RunsOnCard): string {
        switch (card.kind) {
            case "universe-ai":
                return card.available ? page.mind.universeAiNote() : page.mind.universeAiMissing();
            case "mine":
                return card.group === "own-computer"
                    ? page.mind.keyComputer({ universe: card.universe })
                    : page.mind.keyHosted({ universe: card.universe });
            case "theirs":
                return card.owner
                    ? page.mind.othersKey({ owner: card.owner, bot: bot.name ?? "" })
                    : card.title && options?.currentKey?.mine
                    ? page.mind.keyUnlent()
                    : page.mind.othersKeyUnknown({ bot: bot.name ?? "" });
            case "pinned":
                return page.mind.pinned();
            case "gone":
                return page.mind.keyGone();
        }
    }

    function downNoteOf(card: RunsOnCard): string | null {
        if ((card.kind !== "mine" && card.kind !== "theirs") || card.status !== "down") return null;
        return card.ifDown === "stop" ? page.mind.downStops() : page.mind.downUseUniverseAi();
    }

    function pinProvider(event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const value = select.value;
        // Back to the prompt, so the same provider can be pinned again after the bot moves off it
        select.value = "";
        if (value) onChange({ ...bot, aiProviderRef: value, aiModel: null });
    }

    function pick(event: Event) {
        const value = (event.currentTarget as HTMLSelectElement).value;
        onChange({ ...bot, aiProviderRef: value || undefined, aiModel: null });
    }
</script>

<svelte:window on:focus={reloadAfterLend} />

<PageGroup id="mind" icon={IconSparkles} title={page.mind.title()} {brief} {open} {onToggle}>
    {#if loading}
        <p class="bp-m">{$LL.actionbar.botEditorModule.loadingProviders()}</p>
    {:else if options && choosing && choosingKey && chooseModels}
        <ModelList
            botName={bot.name ?? ""}
            keyName={choosingKey.name}
            models={chooseModels}
            selected={choosing.pending ? null : rowModelId}
            onSave={saveModel}
            onBack={() => (choosing = null)}
        />
    {:else if options}
        <div class="bp-cap" id="bot-runs-on-label">{page.mind.runsOn()}</div>
        <div class="bp-cards" role="radiogroup" aria-labelledby="bot-runs-on-label" data-testid="bot-runs-on">
            {#each cards as card (card.kind + card.id)}
                {@const icon = cardIcon(card)}
                <button
                    type="button"
                    role="radio"
                    class="bp-card"
                    class:picked={card.picked}
                    aria-checked={card.picked}
                    disabled={!card.picked && !canPick(options, card)}
                    data-testid="bot-runs-on-{card.kind}"
                    on:click={() => chooseCard(card)}
                >
                    <span class="bp-cico">
                        {#if icon?.kind === "logo"}
                            <span
                                class="bp-logo"
                                data-testid="bot-runs-on-logo"
                                style="-webkit-mask-image: url({icon.url}); mask-image: url({icon.url});"
                            />
                        {:else if icon?.kind === "plug"}<IconPlug font-size="22" />
                        {:else if icon?.kind === "chip"}<IconCpu font-size="22" />
                        {:else if card.kind === "universe-ai"}<IconSparkles font-size="22" />
                        {:else}<IconKey font-size="22" />{/if}
                    </span>
                    <span class="bp-ctx">
                        <span class="bp-ct"
                            >{card.kind === "universe-ai"
                                ? page.mind.universeAi()
                                : card.kind === "gone"
                                ? page.mind.keyGoneTitle()
                                : card.title}</span
                        >
                        <span class="bp-cn">
                            {noteOf(card)}
                            {#if downNoteOf(card)}
                                <span class="bp-down">{page.mind.downNow()}</span>{downNoteOf(card)}
                            {/if}
                        </span>
                    </span>
                    <span class="bp-radio" class:on={card.picked} aria-hidden="true" />
                </button>
            {/each}
        </div>
        {#if row}
            <div class="bp-model" data-testid="bot-model-row">
                <div class="bp-mtx">
                    <span class="bp-cap">{page.mind.model.title()}</span>
                    <span class="bp-mid">{rowModelId ?? page.mind.model.notPicked()}</span>
                    {#if row.kind === "single"}
                        <span class="bp-cn">
                            {page.mind.model.only({ key: rowKey?.name ?? "", universe: rowKey?.universeName ?? "" })}
                        </span>
                    {:else if row.kind === "unlisted"}
                        <span class="bp-cn">{page.mind.model.unlisted()}</span>
                    {:else if rowModel && (rowModel.tools === true || rowModel.vision === true)}
                        <span class="bp-facts">
                            {#if rowModel.tools === true}
                                <span class="bp-fact"><IconTool font-size="14" />{page.mind.model.tools()}</span>
                            {/if}
                            {#if rowModel.vision === true}
                                <span class="bp-fact"><IconEye font-size="14" />{page.mind.seesPictures()}</span>
                            {/if}
                        </span>
                    {/if}
                </div>
                {#if row.kind === "choose"}
                    <PageButton
                        testId="bot-model-change"
                        tall
                        on:click={() => (choosing = { keyId: ref || options?.current || "", pending: false })}
                    >
                        {page.mind.model.change()}
                    </PageButton>
                {/if}
            </div>
        {/if}
        {#if options.viewerIsMaker && unlent.length > 0}
            <div class="bp-unlent" data-testid="bot-runs-on-unlent">
                <IconKey font-size="18" />
                <div class="bp-mtx">
                    <span class="bp-ut">
                        {unlent.length === 1
                            ? page.mind.unlentOne({ key: unlentList })
                            : page.mind.unlentMany({ keys: unlentList })}
                    </span>
                    {#if canOpenOrbit()}
                        <span class="bp-cn">
                            {unlent.length === 1 ? page.mind.unlentStepOne() : page.mind.unlentStepMany()}
                        </span>
                    {/if}
                </div>
            </div>
        {/if}
        {#if options.viewerIsMaker && canOpenOrbit()}
            <div class="bp-line">
                <PageButton testId="bot-runs-on-ai-keys" tall on:click={openAiKeys}>
                    {page.mind.aiKeys()}
                    <IconExternalLink font-size="14" />
                </PageButton>
            </div>
        {/if}
        {#if options.providers && options.providers.length > 0}
            <label class="bp-select">
                <span class="sr-only">{page.mind.pinTo()}</span>
                <select value="" on:change={pinProvider} data-testid="bot-mind-provider">
                    <option value="">{page.mind.pinTo()}</option>
                    {#each options.providers as provider (provider.id)}
                        <option value={provider.id}>
                            {provider.name}{provider.enabled
                                ? ""
                                : ` ${$LL.actionbar.botEditorModule.providerDisabled()}`}
                        </option>
                    {/each}
                </select>
                <IconChevronDown font-size="16" />
            </label>
        {/if}
        {#if !options.viewerIsMaker || unlent.length === 0}
            <p class="bp-m">
                {options.viewerIsMaker ? page.mind.makerHint() : page.mind.managerHint({ bot: bot.name ?? "" })}
            </p>
        {/if}
    {:else if failed}
        <div class="bp-line">
            <p class="bp-m">{$LL.actionbar.botEditorModule.errorLoadFailed()}</p>
            <PageButton on:click={() => void load(bot.id)}>{$LL.actionbar.botEditorModule.retry()}</PageButton>
        </div>
    {:else if providers.length === 0}
        <p class="bp-m">{$LL.actionbar.botEditorModule.noProvidersConfigured()}</p>
    {:else}
        <label class="bp-select">
            <span class="sr-only">{page.mind.title()}</span>
            <select value={current?.providerId ?? ref} on:change={pick} data-testid="bot-mind-provider">
                {#if !current}
                    <option value={ref}>{ref || page.mind.none()}</option>
                {/if}
                {#each providers as provider (provider.providerId)}
                    <option value={provider.providerId}>
                        {provider.name}{seesPictures(provider) ? ` · ${page.mind.seesPictures()}` : ""}{provider.enabled
                            ? ""
                            : ` ${$LL.actionbar.botEditorModule.providerDisabled()}`}
                    </option>
                {/each}
            </select>
            <IconChevronDown font-size="16" />
        </label>
        <p class="bp-m">{page.mind.hint()}</p>
    {/if}
</PageGroup>

<style>
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
        text-align: left;
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
    .bp-card:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-cico {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* One slot for every card, so the names start in the same place whatever the icon */
        width: 28px;
        color: #fff;
    }
    /* The logo is a one-colour picture drawn as a mask, so it takes the card's ink */
    .bp-logo {
        width: 24px;
        height: 24px;
        background: currentColor;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-position: center;
        mask-position: center;
        -webkit-mask-size: contain;
        mask-size: contain;
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
    .bp-down {
        color: #f5c451;
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
        gap: 12px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    /* A key of the maker's that isn't lent here: said above the AI keys button, which is the way to lend it */
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
    .bp-facts {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }
    .bp-fact {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12.5px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
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
        height: 40px;
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
