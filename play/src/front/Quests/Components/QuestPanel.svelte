<script lang="ts">
    import { createEventDispatcher, tick } from "svelte";
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestLogEntry } from "../QuestCopy";
    import type { QuestPath } from "../QuestModel";
    import { motionMs } from "../QuestMotion";
    import type { QuestWorld } from "../QuestWorld";
    import { giverAsHost } from "../QuestWorld";
    import QuestHostPortrait from "./QuestHostPortrait.svelte";
    import QuestStamp from "./QuestStamp.svelte";
    import { escapeKey, questControls, questKeyboardFocus } from "./questActions";

    export let id: string;
    export let entries: QuestLogEntry[];
    export let world: QuestWorld;
    /** Done so far, out of the chapter's quests: the header's progress. */
    export let doneCount: number;
    export let total: number;
    /** The quest on the map: its details offer the walk (or the editor, for Build). */
    export let tracked: QuestPath | null;
    /** The walk control's label ("Walk to the Courtyard", "Walk there"), or undefined when there is nowhere to walk. */
    export let walkLabel: string | undefined = undefined;
    export let walking = false;
    /** Build can open the editor from its details. */
    export let editorLabel: string | undefined = undefined;
    /** "See it in Orbit", when Orbit is there for this player: opens the quest's page (its badge) in Orbit. */
    export let orbitLinkLabel: string | undefined = undefined;
    /** Where the quest on the map is, in words, for people who can't see the marks. */
    export let whereText: string | undefined = undefined;
    /** Guests with sign-in available: a row under Available to keep progress across devices. */
    export let showSignInRow = false;

    const dispatch = createEventDispatcher<{
        close: void;
        /** Accept, in an available quest's details. */
        accept: QuestPath;
        /** Show on map, in an accepted quest's details. */
        track: QuestPath;
        abandon: QuestPath;
        walk: void;
        stopWalking: void;
        openEditor: void;
        signIn: void;
        /** "See it in Orbit", under the reward. */
        viewInOrbit: QuestPath;
    }>();

    const SECTIONS: Array<{ key: "inProgress" | "available" | "done"; statuses: QuestLogEntry["status"][] }> = [
        { key: "inProgress", statuses: ["tracked", "accepted"] },
        { key: "available", statuses: ["available"] },
        { key: "done", statuses: ["done"] },
    ];

    $: sections = SECTIONS.map((section) => ({
        ...section,
        entries: entries.filter((entry) => section.statuses.includes(entry.status)),
    })).filter((section) => section.entries.length > 0 || (section.key === "available" && showSignInRow));
    $: allDone = total > 0 && doneCount === total;

    function sectionLabel(key: (typeof SECTIONS)[number]["key"]): string {
        switch (key) {
            case "inProgress":
                return $LL.quest.log.inProgress();
            case "available":
                return $LL.quest.log.available();
            case "done":
                return $LL.quest.log.done();
        }
    }

    // ---- List or details --------------------------------------------------------------------------------------
    let selected: QuestPath | null = null;
    let confirmingAbandon = false;
    // The quest left the list (abandoned elsewhere, the room changed): back to the list.
    $: entry = selected ? entries.find((candidate) => candidate.path === selected) : undefined;

    let panel: HTMLElement | undefined;
    let closeWrapper: HTMLElement | undefined;

    export function focusClose(): void {
        closeWrapper?.querySelector("button")?.focus();
    }

    export function containsFocus(): boolean {
        const active = document.activeElement;
        return !!active && !!panel?.contains(active);
    }

    /** From the keyboard (a click has detail 0), focus follows the view; a tap leaves none behind. */
    /**
     * Accept keeps the details open on the quest, now on the map: focus moves to what to do next (Walk there, the
     * editor, or Abandon), since the Accept button itself is gone.
     */
    async function onAccept(path: QuestPath) {
        dispatch("accept", path);
        await tick();
        (
            panel?.querySelector<HTMLElement>("[data-testid='quest-detail-actions'] button") ??
            panel?.querySelector<HTMLElement>("[data-testid='quest-detail-back']")
        )?.focus();
    }

    async function show(path: QuestPath | null, event?: MouseEvent) {
        const from = selected;
        selected = path;
        confirmingAbandon = false;
        if (event && event.detail !== 0) return;
        await tick();
        if (path) panel?.querySelector<HTMLElement>("[data-testid='quest-detail-back']")?.focus();
        else if (from) panel?.querySelector<HTMLElement>(`[data-testid="quest-row-${from}"]`)?.focus();
    }

    function onAbandon(path: QuestPath, event: MouseEvent) {
        dispatch("abandon", path);
        void show(null, event);
    }
</script>

<!-- The quest log: slides up from the pill, which stays under it as its handle. A row opens that quest's details:
     Accept or Decline an available quest, show an accepted one on the map or abandon it. Back returns to the list. -->
<div
    {id}
    class="quest-surface quest-panel pointer-events-auto flex w-full flex-col"
    role="dialog"
    aria-modal="false"
    aria-labelledby="{id}-title"
    data-testid="quest-panel"
    bind:this={panel}
    use:escapeKey={() => (selected ? void show(null) : dispatch("close"))}
    use:questKeyboardFocus
    use:questControls
>
    {#key entry ? entry.path : "list"}
        <div class="flex min-h-0 flex-1 flex-col" in:fly={{ x: entry ? 16 : -16, duration: motionMs(160) }}>
            {#if entry}
                {@const onMap = entry.status === "tracked"}
                <!-- Details -->
                <div class="flex items-center gap-2 px-2 pt-2 pb-1">
                    <button
                        type="button"
                        class="quest-icon-btn"
                        aria-label={$LL.quest.detail.back()}
                        data-testid="quest-detail-back"
                        on:click={(event) => show(null, event)}
                    >
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 20 20"
                            fill="none"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <path
                                d="M12.5 4.5 7 10l5.5 5.5"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </button>
                    <h2 id="{id}-title" class="m-0 min-w-0 flex-1 truncate text-base font-bold leading-tight">
                        {entry.title}
                    </h2>
                    <div class="shrink-0" bind:this={closeWrapper}>
                        <ButtonClose
                            size="lg"
                            ariaLabel={$LL.quest.close()}
                            dataTestId="quest-panel-close"
                            on:click={() => dispatch("close")}
                        />
                    </div>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="quest-detail-{entry.path}">
                    <div class="flex items-center gap-2">
                        <QuestHostPortrait host={giverAsHost(entry.giver, world)} size="sm" />
                        <div class="min-w-0 flex-1">
                            <p class="quest-eyebrow m-0 truncate">{entry.origin}</p>
                            <p class="quest-meta m-0">{$LL.quest.minutes({ minutes: entry.minutes })}</p>
                        </div>
                        {#if entry.status === "done"}
                            <span class="quest-tag quest-tag-done">{$LL.quest.detail.completed()}</span>
                        {/if}
                    </div>
                    <p class="m-0 mt-3 text-sm leading-snug" data-testid="quest-detail-description">
                        {entry.description}
                    </p>

                    <h3 class="quest-detail-label">{$LL.quest.detail.objective()}</h3>
                    <!-- A line of the quest tracker, as in an RPG: a bullet, then 0/1 while it's on, a tick once done. Nothing
                         here is a control, so nothing looks like one. -->
                    <div class="quest-objective" class:quest-objective-done={entry.status === "done"}>
                        <span class="quest-objective-dot" aria-hidden="true" />
                        <span class="min-w-0 flex-1 font-semibold">{entry.objective}</span>
                        {#if entry.status === "done"}
                            <span class="quest-check" aria-hidden="true">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" focusable="false">
                                    <path
                                        d="m3.5 8.5 3 3 6-7"
                                        stroke="currentColor"
                                        stroke-width="2.25"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    />
                                </svg>
                            </span>
                        {:else if entry.status !== "available"}
                            <span class="quest-objective-count" data-testid="quest-objective-count">0/1</span>
                        {/if}
                    </div>
                    <p class="quest-secondary m-0 mt-1" data-testid="quest-detail-body">{entry.note ?? entry.body}</p>
                    {#if entry.requirement}
                        <p class="quest-secondary m-0 mt-1">{entry.requirement}</p>
                    {/if}
                    {#if onMap}
                        <p class="quest-on-map-note" data-testid="quest-on-map">
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="none"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <path
                                    d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8c0 3.5 4.5 7.7 4.5 7.7Z"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                />
                                <circle cx="8" cy="6.8" r="1.6" fill="currentColor" />
                            </svg>
                            <span>{$LL.quest.detail.onMapNote()}</span>
                        </p>
                        {#if whereText}
                            <p class="sr-only">{whereText}</p>
                        {/if}
                    {/if}

                    <h3 class="quest-detail-label">{$LL.quest.detail.reward()}</h3>
                    <div class="flex items-center gap-2">
                        <QuestStamp path={entry.path} size={40} tilted={false} />
                        <span class="min-w-0 flex-1">
                            <span class="block text-sm font-semibold text-[#e9c74c]">{entry.reward}</span>
                            {#if orbitLinkLabel}
                                <button
                                    type="button"
                                    class="quest-link"
                                    data-testid="quest-detail-orbit"
                                    on:click={() => entry && dispatch("viewInOrbit", entry.path)}
                                >
                                    {orbitLinkLabel}
                                </button>
                            {/if}
                        </span>
                    </div>
                </div>

                {#if entry.status !== "done"}
                    <div class="quest-detail-actions" data-testid="quest-detail-actions">
                        {#if confirmingAbandon}
                            <p class="quest-secondary m-0 w-full">{$LL.quest.detail.abandonConfirm()}</p>
                            <button
                                type="button"
                                class="quest-btn quest-btn-small quest-danger"
                                data-testid="quest-detail-abandon-confirm"
                                on:click={(event) => entry && onAbandon(entry.path, event)}
                            >
                                {$LL.quest.detail.abandon()}
                            </button>
                            <button
                                type="button"
                                class="quest-btn quest-btn-small quest-ghost"
                                data-testid="quest-detail-keep"
                                on:click={() => (confirmingAbandon = false)}
                            >
                                {$LL.quest.detail.keep()}
                            </button>
                        {:else if entry.status === "available"}
                            <button
                                type="button"
                                class="quest-btn u-cta flex-1"
                                data-testid="quest-detail-accept"
                                on:click={() => entry && onAccept(entry.path)}
                            >
                                {$LL.quest.detail.accept()}
                            </button>
                            <button
                                type="button"
                                class="quest-btn quest-ghost flex-1"
                                data-testid="quest-detail-decline"
                                on:click={(event) => show(null, event)}
                            >
                                {$LL.quest.detail.decline()}
                            </button>
                        {:else}
                            {#if onMap && walkLabel && tracked === entry.path}
                                <button
                                    type="button"
                                    class="quest-btn u-cta flex-1"
                                    data-testid={walking ? "quest-detail-stop" : "quest-detail-walk"}
                                    on:click={() => dispatch(walking ? "stopWalking" : "walk")}
                                >
                                    {walking ? $LL.quest.card.stopWalking() : walkLabel}
                                </button>
                            {:else if onMap && editorLabel}
                                <button
                                    type="button"
                                    class="quest-btn u-cta flex-1"
                                    data-testid="quest-detail-editor"
                                    on:click={() => dispatch("openEditor")}
                                >
                                    {editorLabel}
                                </button>
                            {:else if !onMap}
                                <button
                                    type="button"
                                    class="quest-btn u-cta flex-1"
                                    data-testid="quest-detail-track"
                                    on:click={() => entry && dispatch("track", entry.path)}
                                >
                                    {$LL.quest.detail.showOnMap()}
                                </button>
                            {/if}
                            <button
                                type="button"
                                class="quest-btn quest-ghost flex-1"
                                data-testid="quest-detail-abandon"
                                on:click={() => (confirmingAbandon = true)}
                            >
                                {$LL.quest.detail.abandon()}
                            </button>
                        {/if}
                    </div>
                {/if}
            {:else}
                <!-- List -->
                <div class="flex items-center gap-3 px-3 pt-3 pb-2">
                    <div class="order-last shrink-0" bind:this={closeWrapper}>
                        <ButtonClose
                            size="lg"
                            ariaLabel={$LL.quest.close()}
                            dataTestId="quest-panel-close"
                            on:click={() => dispatch("close")}
                        />
                    </div>
                    <div class="min-w-0 flex-1">
                        <h2 id="{id}-title" class="m-0 text-lg font-bold leading-tight">{$LL.quest.quests()}</h2>
                        {#if total > 0}
                            <p class="quest-secondary m-0" data-testid="quest-panel-progress">
                                {$LL.quest.log.progress({ done: doneCount, total })}
                            </p>
                        {/if}
                    </div>
                </div>
                <!-- The chapter's progress: one segment per quest, lit as it is done. -->
                {#if total > 0}
                    <div class="quest-progress mx-3 mb-1" aria-hidden="true">
                        {#each { length: total } as _, index (index)}
                            <span class="quest-progress-seg" class:lit={index < doneCount} />
                        {/each}
                    </div>
                {/if}

                <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {#if allDone}
                        <p class="quest-secondary m-0 px-1 py-2" data-testid="quest-panel-all-done">
                            {$LL.quest.log.allDone()}
                        </p>
                    {/if}
                    {#each sections as section (section.key)}
                        <h3 class="quest-log-section px-1">{sectionLabel(section.key)}</h3>
                        <ul class="m-0 flex list-none flex-col gap-1 p-0">
                            {#each section.entries as row (row.path)}
                                <li data-testid="quest-entry-{row.path}">
                                    <button
                                        type="button"
                                        class="quest-row"
                                        class:quest-row-done={row.status === "done"}
                                        aria-label="{row.title}: {$LL.quest.detail.title()}"
                                        data-testid="quest-row-{row.path}"
                                        on:click={(event) => show(row.path, event)}
                                    >
                                        {#if row.status === "done"}
                                            <QuestStamp path={row.path} size={36} tilted={false} />
                                        {:else}
                                            <QuestHostPortrait host={giverAsHost(row.giver, world)} size="sm" />
                                        {/if}
                                        <span class="min-w-0 flex-1">
                                            <span class="block font-bold">{row.title}</span>
                                            <span class="quest-secondary block truncate">{row.note ?? row.line}</span>
                                            {#if row.status !== "done"}
                                                <span class="quest-meta block truncate">
                                                    {row.origin} · {$LL.quest.minutes({ minutes: row.minutes })}
                                                </span>
                                            {/if}
                                        </span>
                                        {#if row.status === "tracked"}
                                            <span class="quest-tag">{$LL.quest.log.onMap()}</span>
                                        {:else if row.status !== "done"}
                                            <!-- The badge this quest earns, as in the game's reward line. -->
                                            <span
                                                class="quest-stamp-mini"
                                                data-testid="quest-row-reward-{row.path}"
                                                aria-hidden="true"
                                            >
                                                <QuestStamp path={row.path} size={28} tilted={false} />
                                            </span>
                                        {:else}
                                            <span class="quest-check" aria-hidden="true">
                                                <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 16 16"
                                                    fill="none"
                                                    focusable="false"
                                                >
                                                    <path
                                                        d="m3.5 8.5 3 3 6-7"
                                                        stroke="currentColor"
                                                        stroke-width="2.25"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    />
                                                </svg>
                                            </span>
                                        {/if}
                                        <svg
                                            class="quest-row-chevron"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                            aria-hidden="true"
                                            focusable="false"
                                        >
                                            <path
                                                d="m6 3.5 4.5 4.5L6 12.5"
                                                stroke="currentColor"
                                                stroke-width="1.75"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                        </svg>
                                    </button>
                                </li>
                            {/each}
                            {#if section.key === "available" && showSignInRow}
                                <li>
                                    <button
                                        type="button"
                                        class="quest-row"
                                        data-testid="quest-row-sign-in"
                                        on:click={() => dispatch("signIn")}
                                    >
                                        <span class="min-w-0 flex-1">
                                            <span class="block font-bold">{$LL.quest.log.signInRow()}</span>
                                            <span class="quest-secondary block">{$LL.quest.log.needsAccount()}</span>
                                        </span>
                                    </button>
                                </li>
                            {/if}
                        </ul>
                    {:else}
                        <p class="quest-secondary m-0 px-1 py-2">{$LL.quest.log.nothingHere()}</p>
                    {/each}
                </div>
            {/if}
        </div>
    {/key}
</div>
