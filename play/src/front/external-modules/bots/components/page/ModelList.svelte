<script lang="ts">
    // The key's models as a radio list, inside the Mind group: only the models the lend here allows, folded by maker when
    // the list has makers (OpenRouter), flat when it has none (Claude). A tap only tries a model; Save keeps it, Back leaves
    // the bot as it was. Save waits for a pick.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { KeyModelOption } from "../../types";
    import {
        factVaries,
        filterModels,
        groupModels,
        isFiltering,
        listNote,
        makerFacts,
        makerHolding,
        rowFacts,
        sharedFacts,
        shortName,
        visibleMakers,
        type Fact,
        type ModelFilter,
    } from "../../modelPickerModel";
    import ModelChoice from "./ModelChoice.svelte";
    import {
        IconCheck,
        IconChevronDown,
        IconChevronLeft,
        IconChevronRight,
        IconEye,
        IconSearch,
        IconTool,
    } from "@wa-icons";

    export let botName: string;
    export let keyName: string;
    export let models: KeyModelOption[];
    /** The model the bot is on now (null: none yet) */
    export let selected: string | null;
    export let onSave: (model: string) => void;
    export let onBack: () => void;

    $: model = $LL.mapEditor.edit.bots.page.mind.model;
    $: runsOn = $LL.mapEditor.edit.bots.page.mind.runsOn();

    // What is tried on, until Save
    let draft: string | null = selected;
    let query = "";
    let tools = false;
    let vision = false;
    let showAll = false;
    // Makers the person opened; the one holding the pick starts open
    let opened = new Set<string>(makerHolding(selected) ? [makerHolding(selected) as string] : []);

    $: filter = { query, tools, vision } as ModelFilter;
    $: filtering = isFiltering(filter);
    $: shown = filterModels(models, filter);
    $: grouped = groupModels(shown);
    $: allMakers = groupModels(models).makers;
    $: keep = new Set([...opened, ...(makerHolding(draft) ? [makerHolding(draft) as string] : [])]);
    $: makers = visibleMakers(grouped.makers, { showAll, filtering, keep });
    $: hiddenMakers = grouped.makers.length - makers.length;
    // A filter is offered when it would sort the list: some models have the fact and some don't
    $: hasTools = factVaries(models, "tools");
    $: hasVision = factVaries(models, "vision");
    $: hasMakers = allMakers.length > 0;
    $: note = listNote(models, shown, filtering);
    // What every model has is said once above the list; a maker's row says what only its own models share
    $: listSaid = filtering ? [] : sharedFacts(models);
    $: foundText =
        note?.kind === "found"
            ? [model.makerCount({ count: note.models }), note.makers ? model.fromMakers({ count: note.makers }) : ""]
                  .filter(Boolean)
                  .join(" ")
            : "";
    const factText = (fact: Fact) =>
        fact === "tools" ? model.tools() : $LL.mapEditor.edit.bots.page.mind.seesPictures();

    function toggleMaker(id: string) {
        const next = new Set(opened);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        opened = next;
    }

    const isOpen = (id: string, open: ReadonlySet<string>, searching: boolean) => searching || open.has(id);

    function pick(id: string) {
        draft = id;
    }

    function save() {
        if (draft) onSave(draft);
    }
</script>

<div class="ml" data-testid="bot-model-list">
    <button type="button" class="ml-back" data-testid="bot-model-back" on:click={onBack}>
        <IconChevronLeft font-size="18" />
        {runsOn}
    </button>
    <div class="ml-cap">{model.listFor({ bot: botName, key: keyName })}</div>

    <label class="ml-search">
        <IconSearch font-size="18" />
        <input
            type="search"
            bind:value={query}
            placeholder={hasMakers
                ? model.searchMakers({ count: models.length })
                : model.search({ count: models.length })}
            aria-label={hasMakers
                ? model.searchMakers({ count: models.length })
                : model.search({ count: models.length })}
            data-testid="bot-model-search"
        />
    </label>
    {#if hasTools || hasVision}
        <div class="ml-filters">
            {#if hasTools}
                <button
                    type="button"
                    class="ml-chip"
                    aria-pressed={tools}
                    data-testid="bot-model-filter-tools"
                    on:click={() => (tools = !tools)}
                >
                    {#if tools}<IconCheck font-size="16" />{:else}<IconTool font-size="16" />{/if}
                    {model.tools()}
                </button>
            {/if}
            {#if hasVision}
                <button
                    type="button"
                    class="ml-chip"
                    aria-pressed={vision}
                    data-testid="bot-model-filter-vision"
                    on:click={() => (vision = !vision)}
                >
                    {#if vision}<IconCheck font-size="16" />{:else}<IconEye font-size="16" />{/if}
                    {$LL.mapEditor.edit.bots.page.mind.seesPictures()}
                </button>
            {/if}
        </div>
    {/if}
    {#if note}
        <p class="ml-note" data-testid="bot-model-note">
            {#if note.kind === "all"}
                {model.allHave({ count: note.count })}
                {#each note.facts as fact (fact)}
                    <span class="ml-fact">
                        {#if fact === "tools"}<IconTool font-size="14" />{:else}<IconEye font-size="14" />{/if}
                        {factText(fact)}
                    </span>
                {/each}
            {:else}
                {foundText}
            {/if}
        </p>
    {/if}

    <div class="ml-list" role="radiogroup" aria-label={model.listFor({ bot: botName, key: keyName })}>
        {#each grouped.flat as entry (entry.id)}
            {@const shownFacts = rowFacts(entry, grouped.flat, listSaid)}
            <ModelChoice
                {entry}
                name={entry.id}
                facts={shownFacts.facts}
                noTools={shownFacts.noTools}
                picked={draft === entry.id}
                onPick={pick}
            />
        {/each}

        {#each makers as maker (maker.id)}
            {@const open = isOpen(maker.id, opened, filtering)}
            {@const said = makerFacts(maker.models, listSaid)}
            <div class="ml-maker" class:open data-testid="bot-model-maker-{maker.id}">
                <button
                    type="button"
                    class="ml-mhead"
                    aria-expanded={open}
                    on:click={() => toggleMaker(maker.id)}
                    disabled={filtering}
                >
                    <span class="ml-rt">
                        <span class="ml-mname">{maker.name}</span>
                        <span class="ml-mcount">
                            {model.makerCount({ count: maker.models.length })}{makerHolding(draft) === maker.id
                                ? ` · ${model.picked()}`
                                : ""}
                        </span>
                        {#if open && said.length > 0}
                            <span class="ml-mcount ml-allhave">
                                {model.allHaveMaker()}
                                {#each said as fact (fact)}
                                    <span class="ml-fact">
                                        {#if fact === "tools"}<IconTool font-size="14" />{:else}<IconEye
                                                font-size="14"
                                            />{/if}
                                        {factText(fact)}
                                    </span>
                                {/each}
                            </span>
                        {/if}
                    </span>
                    {#if !filtering}
                        {#if open}<IconChevronDown font-size="18" />{:else}<IconChevronRight font-size="18" />{/if}
                    {/if}
                </button>
                {#if open}
                    <div class="ml-mbody">
                        {#each maker.models as entry (entry.id)}
                            {@const shownFacts = rowFacts(entry, maker.models, [...listSaid, ...said])}
                            <ModelChoice
                                {entry}
                                name={shortName(entry.id)}
                                facts={shownFacts.facts}
                                noTools={shownFacts.noTools}
                                picked={draft === entry.id}
                                onPick={pick}
                            />
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}

        {#if shown.length === 0}
            <p class="ml-empty">{model.noMatch()}</p>
        {/if}
    </div>

    {#if hiddenMakers > 0}
        <button type="button" class="ml-more" data-testid="bot-model-show-all" on:click={() => (showAll = true)}>
            {model.showAllMakers({ count: allMakers.length })}
        </button>
    {/if}

    <button type="button" class="ml-save" disabled={!draft} data-testid="bot-model-save" on:click={save}>
        {model.save()}
    </button>
</div>

<style>
    .ml {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #fff;
    }
    .ml-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        align-self: flex-start;
        min-height: 44px;
        margin: 0;
        padding: 0 8px 0 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 15px;
        font-weight: 650;
        color: #fff;
        cursor: pointer;
    }
    .ml-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .ml-search {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 12px;
        border-radius: 12px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: rgba(244, 242, 250, 0.64);
    }
    .ml-search:focus-within {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .ml-search input {
        flex: 1;
        min-width: 0;
        height: 42px;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        outline: none;
    }
    .ml-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .ml-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .ml-chip[aria-pressed="true"] {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .ml-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .ml-mhead {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 8px 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    .ml-mhead:disabled {
        cursor: default;
    }
    .ml-mhead:focus-visible,
    .ml-chip:focus-visible,
    .ml-back:focus-visible,
    .ml-more:focus-visible,
    .ml-save:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .ml-maker {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .ml-maker.open {
        padding: 0 0 8px;
        border-radius: 14px;
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
    }
    .ml-maker.open .ml-mhead {
        background: transparent;
        box-shadow: none;
    }
    .ml-mbody {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 8px 0 24px;
    }
    .ml-rt {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .ml-mname {
        font-size: 15px;
        font-weight: 650;
        overflow-wrap: anywhere;
    }
    .ml-mcount {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .ml-note {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        margin: 0;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .ml-allhave {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px 10px;
    }
    .ml-fact {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 600;
    }
    .ml-empty {
        margin: 0;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .ml-more {
        align-self: flex-start;
        min-height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .ml-save {
        min-height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .ml-save:disabled {
        background: rgba(255, 255, 255, 0.08);
        box-shadow: none;
        color: rgba(244, 242, 250, 0.45);
        cursor: default;
    }
</style>
