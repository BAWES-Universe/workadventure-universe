<script lang="ts">
    import { createEventDispatcher, tick } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestLogEntry } from "../QuestCopy";
    import type { QuestPath } from "../QuestModel";
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
    /** The quest on the map: its row is open, with its sentence and buttons. */
    export let tracked: QuestPath | null;
    export let trackedBody = "";
    /** The walk control's label ("Walk to the Courtyard", "Walk there"), or undefined when there is nowhere to walk. */
    export let walkLabel: string | undefined = undefined;
    export let walking = false;
    /** Build can open the editor from here. */
    export let editorLabel: string | undefined = undefined;
    /** Guests with sign-in available: a row under Available to keep progress across devices. */
    export let showSignInRow = false;

    const dispatch = createEventDispatcher<{
        close: void;
        /** An available quest is taken: it goes on the map. */
        accept: QuestPath;
        /** An accepted quest goes on the map. */
        track: QuestPath;
        walk: void;
        stopWalking: void;
        openEditor: void;
        signIn: void;
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

    let closeWrapper: HTMLElement | undefined;
    let panel: HTMLElement | undefined;

    export function focusClose(): void {
        closeWrapper?.querySelector("button")?.focus();
    }

    export function containsFocus(): boolean {
        const active = document.activeElement;
        return !!active && !!panel?.contains(active);
    }

    /**
     * Taking a quest moves its row to another section, which redraws it: pressed from the keyboard, focus follows
     * the row instead of falling to the page.
     */
    async function moveEntry(event: MouseEvent, path: QuestPath, run: () => void) {
        run();
        if (event.detail !== 0) return;
        await tick();
        if (containsFocus()) return;
        const row = panel?.querySelector<HTMLElement>(`[data-testid="quest-row-${path}"]`);
        if (row) row.focus();
        else focusClose();
    }
</script>

<!-- The quest panel: slides up from the pill, which stays under it as its handle. One list, three sections. A row is
     one tap: an available quest starts, an accepted one goes on the map. The one on the map shows its sentence and
     buttons inline. Done rows keep their badge, ticked. -->
<div
    {id}
    class="quest-surface quest-panel pointer-events-auto flex w-full flex-col"
    role="dialog"
    aria-modal="false"
    aria-labelledby="{id}-title"
    data-testid="quest-panel"
    bind:this={panel}
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
    use:questControls
>
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
            <p class="quest-secondary m-0 px-1 py-2" data-testid="quest-panel-all-done">{$LL.quest.log.allDone()}</p>
        {/if}
        {#each sections as section (section.key)}
            <h3 class="quest-log-section px-1">{sectionLabel(section.key)}</h3>
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
                {#each section.entries as entry (entry.path)}
                    {@const onMap = entry.status === "tracked"}
                    <li class="quest-entry" class:quest-entry-open={onMap} data-testid="quest-entry-{entry.path}">
                        {#if entry.status === "done"}
                            <div class="quest-row quest-row-done" data-testid="quest-row-{entry.path}">
                                <QuestStamp path={entry.path} size={36} tilted={false} />
                                <span class="min-w-0 flex-1">
                                    <span class="block font-bold">{entry.title}</span>
                                    <span class="quest-secondary block">{entry.line}</span>
                                </span>
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
                                <span class="sr-only">{$LL.quest.log.done()}</span>
                            </div>
                        {:else}
                            <button
                                type="button"
                                class="quest-row"
                                aria-current={onMap ? "true" : undefined}
                                data-testid="quest-row-{entry.path}"
                                on:click={(event) => {
                                    if (entry.status === "available") {
                                        void moveEntry(event, entry.path, () => dispatch("accept", entry.path));
                                    } else if (entry.status === "accepted") {
                                        void moveEntry(event, entry.path, () => dispatch("track", entry.path));
                                    }
                                }}
                            >
                                <QuestHostPortrait host={giverAsHost(entry.giver, world)} size="sm" />
                                <span class="min-w-0 flex-1">
                                    <span class="block font-bold">{entry.title}</span>
                                    <span class="quest-secondary block">{entry.note ?? entry.line}</span>
                                    <span class="quest-meta block">
                                        {entry.origin} · {$LL.quest.minutes({ minutes: entry.minutes })}
                                    </span>
                                </span>
                                {#if onMap}
                                    <span class="quest-tag" data-testid="quest-on-map">{$LL.quest.log.onMap()}</span>
                                {:else if entry.status === "available"}
                                    <span class="quest-tag quest-tag-quiet">{$LL.quest.log.tapToStart()}</span>
                                {:else}
                                    <span class="quest-stamp-mini" aria-hidden="true">
                                        <QuestStamp path={entry.path} size={20} glyphOnly tilted={false} />
                                    </span>
                                {/if}
                            </button>
                            {#if onMap}
                                <div class="quest-entry-details">
                                    <p class="m-0" data-testid="quest-tracked-body">{trackedBody}</p>
                                    {#if entry.requirement}
                                        <p class="quest-secondary m-0 mt-1">{entry.requirement}</p>
                                    {/if}
                                    <p class="quest-secondary m-0 mt-1">{entry.reward}</p>
                                    {#if (walkLabel && tracked === entry.path) || editorLabel}
                                        <div class="mt-2 flex flex-wrap gap-2">
                                            {#if walkLabel && tracked === entry.path}
                                                <button
                                                    type="button"
                                                    class="quest-btn quest-btn-small u-cta"
                                                    data-testid={walking ? "quest-panel-stop" : "quest-panel-walk"}
                                                    on:click={() => dispatch(walking ? "stopWalking" : "walk")}
                                                >
                                                    {walking ? $LL.quest.card.stopWalking() : walkLabel}
                                                </button>
                                            {/if}
                                            {#if editorLabel}
                                                <button
                                                    type="button"
                                                    class="quest-btn quest-btn-small u-cta"
                                                    data-testid="quest-panel-editor"
                                                    on:click={() => dispatch("openEditor")}
                                                >
                                                    {editorLabel}
                                                </button>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/if}
                    </li>
                {/each}
                {#if section.key === "available" && showSignInRow}
                    <li class="quest-entry">
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
</div>
