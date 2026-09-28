<script lang="ts">
    import { createEventDispatcher, tick } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestLogEntry } from "../QuestCopy";
    import type { QuestDockWidth } from "../QuestDevSettings";
    import type { QuestPath } from "../QuestModel";
    import QuestStamp from "./QuestStamp.svelte";
    import { escapeKey, questControls, questKeyboardFocus } from "./questActions";

    export let entries: QuestLogEntry[];
    export let hidden: boolean;
    /** Guests with sign-in available: a row under Available to keep progress across devices. */
    export let showSignInRow = false;
    export let dockWidth: QuestDockWidth = "narrow";
    /** The dev-only card width switch (the flag is on). */
    export let showWidthSwitch = false;

    const dispatch = createEventDispatcher<{
        close: void;
        accept: QuestPath;
        track: QuestPath;
        setAside: void;
        remove: QuestPath;
        setHidden: boolean;
        signIn: void;
        setWidth: QuestDockWidth;
    }>();

    const SECTIONS: QuestLogEntry["status"][] = ["tracked", "accepted", "available", "done"];

    $: anyTracked = entries.some((entry) => entry.status === "tracked");
    $: sections = SECTIONS.map((status) => ({
        status,
        entries: entries.filter((entry) => entry.status === status),
    })).filter((section) => section.entries.length > 0 || (section.status === "available" && showSignInRow));

    let expanded: QuestPath | null = null;
    // The tracked entry is open; the others open on tap.
    $: openPath = expanded ?? entries.find((entry) => entry.status === "tracked")?.path ?? null;

    function sectionLabel(status: QuestLogEntry["status"]): string {
        switch (status) {
            case "tracked":
                return $LL.quest.log.tracked();
            case "accepted":
                return $LL.quest.log.accepted();
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
     * Track, Set aside and Remove move the entry to another section, which redraws its row: pressed from the keyboard,
     * focus follows the entry instead of falling to the page.
     */
    async function moveEntry(event: MouseEvent, path: QuestPath, run: () => void) {
        run();
        if (event.detail !== 0) return;
        await tick();
        if (containsFocus()) return;
        const row = panel?.querySelector<HTMLElement>(`[data-testid="quest-log-${path}"] .quest-row`);
        if (row) row.focus();
        else focusClose();
    }

    // Phones only: the strip of map between the cameras and the panel. On wider screens the panel is a side panel and
    // the map around it stays live (close, Escape and Back close it).
    let panelHeight = 0;
    let stripTop = 0;
    $: measureStrip(panelHeight);
    function measureStrip(_height: number) {
        const section = panel?.offsetParent;
        const cameras = document.querySelector("[data-camera-block]")?.getBoundingClientRect();
        if (!section || !cameras || cameras.height <= 0) {
            stripTop = 0;
            return;
        }
        stripTop = Math.max(0, cameras.bottom - section.getBoundingClientRect().top);
    }

    /** One tap on the uncovered map closes the log, and goes no further (it never walks the player). */
    function closeOnTap(node: HTMLElement) {
        const onClick = (event: MouseEvent) => {
            event.preventDefault();
            dispatch("close");
        };
        node.addEventListener("click", onClick);
        return { destroy: () => node.removeEventListener("click", onClick) };
    }
</script>

<div
    class="quest-log-backdrop md:hidden"
    style="top: {stripTop}px; bottom: {panelHeight}px;"
    data-testid="quest-log-backdrop"
    aria-hidden="true"
    use:closeOnTap
/>
<div
    class="quest-surface quest-log pointer-events-auto flex flex-col"
    role="dialog"
    aria-modal="false"
    aria-labelledby="quest-log-title"
    data-testid="quest-log"
    bind:this={panel}
    bind:clientHeight={panelHeight}
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
    use:questControls
>
    <div class="quest-log-header flex items-center gap-3 p-3">
        <div class="order-last shrink-0" bind:this={closeWrapper}>
            <ButtonClose
                size="lg"
                ariaLabel={$LL.quest.close()}
                dataTestId="quest-log-close"
                on:click={() => dispatch("close")}
            />
        </div>
        <h2 id="quest-log-title" class="m-0 min-w-0 flex-1 text-lg font-bold">{$LL.quest.quests()}</h2>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {#each sections as section (section.status)}
            <h3 class="quest-log-section">{sectionLabel(section.status)}</h3>
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
                {#each section.entries as entry (entry.path)}
                    <li class="quest-log-entry" data-testid="quest-log-{entry.path}">
                        <button
                            type="button"
                            class="quest-row"
                            aria-expanded={openPath === entry.path}
                            on:click={() => (expanded = openPath === entry.path ? null : entry.path)}
                        >
                            <QuestStamp path={entry.path} size={36} tilted={entry.status === "done"} />
                            <span class="min-w-0 flex-1 text-start">
                                <span class="block font-bold">{entry.title}</span>
                                <span class="quest-secondary block">{entry.note ?? entry.description}</span>
                            </span>
                        </button>
                        {#if openPath === entry.path}
                            <div class="quest-log-details">
                                {#if entry.lastTime}
                                    <p class="m-0">{entry.lastTime}</p>
                                {/if}
                                <p class="quest-secondary m-0">
                                    {entry.origin} · {$LL.quest.minutes({ minutes: entry.minutes })}
                                </p>
                                <p class="quest-secondary m-0">{entry.reward}</p>
                                {#if entry.requirement}
                                    <p class="quest-secondary m-0">{entry.requirement}</p>
                                {/if}
                                <div class="quest-text-row">
                                    {#if entry.status === "available"}
                                        <button
                                            type="button"
                                            class="quest-text-btn"
                                            data-testid="quest-log-accept-{entry.path}"
                                            on:click={(event) =>
                                                moveEntry(event, entry.path, () => dispatch("accept", entry.path))}
                                        >
                                            {anyTracked ? $LL.quest.log.trackInstead() : $LL.quest.log.track()}
                                        </button>
                                    {:else if entry.status === "accepted"}
                                        <button
                                            type="button"
                                            class="quest-text-btn"
                                            data-testid="quest-log-track-{entry.path}"
                                            on:click={(event) =>
                                                moveEntry(event, entry.path, () => dispatch("track", entry.path))}
                                        >
                                            {anyTracked ? $LL.quest.log.trackInstead() : $LL.quest.log.track()}
                                        </button>
                                        <span class="quest-dot" aria-hidden="true">·</span>
                                        <button
                                            type="button"
                                            class="quest-text-btn"
                                            data-testid="quest-log-remove-{entry.path}"
                                            on:click={(event) =>
                                                moveEntry(event, entry.path, () => dispatch("remove", entry.path))}
                                        >
                                            {$LL.quest.log.remove()}
                                        </button>
                                    {:else if entry.status === "tracked"}
                                        <button
                                            type="button"
                                            class="quest-text-btn"
                                            data-testid="quest-log-set-aside"
                                            on:click={(event) =>
                                                moveEntry(event, entry.path, () => dispatch("setAside"))}
                                        >
                                            {$LL.quest.card.setAside()}
                                        </button>
                                        <span class="quest-dot" aria-hidden="true">·</span>
                                        <button
                                            type="button"
                                            class="quest-text-btn"
                                            data-testid="quest-log-remove-{entry.path}"
                                            on:click={(event) =>
                                                moveEntry(event, entry.path, () => dispatch("remove", entry.path))}
                                        >
                                            {$LL.quest.log.remove()}
                                        </button>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </li>
                {/each}
                {#if section.status === "available" && showSignInRow}
                    <li class="quest-log-entry">
                        <button
                            type="button"
                            class="quest-row"
                            data-testid="quest-log-sign-in"
                            on:click={() => dispatch("signIn")}
                        >
                            <span class="min-w-0 flex-1 text-start">
                                <span class="block font-bold">{$LL.quest.log.signInRow()}</span>
                                <span class="quest-secondary block">{$LL.quest.log.needsAccount()}</span>
                            </span>
                        </button>
                    </li>
                {/if}
            </ul>
        {:else}
            <p class="quest-secondary m-0 py-2">{$LL.quest.log.nothingHere()}</p>
        {/each}
    </div>

    <div class="quest-log-footer quest-text-row px-3 py-1">
        <button
            type="button"
            class="quest-text-btn"
            data-testid="quest-log-hide"
            on:click={() => dispatch("setHidden", !hidden)}
        >
            {hidden ? $LL.quest.log.show() : $LL.quest.log.hide()}
        </button>
        {#if showWidthSwitch}
            <span class="quest-secondary ms-auto whitespace-nowrap">{$LL.quest.log.cardWidth()}</span>
            <button
                type="button"
                class="quest-text-btn"
                aria-pressed={dockWidth === "narrow"}
                data-testid="quest-width-narrow"
                on:click={() => dispatch("setWidth", "narrow")}
            >
                {$LL.quest.log.narrow()}
            </button>
            <span class="quest-dot" aria-hidden="true">·</span>
            <button
                type="button"
                class="quest-text-btn"
                aria-pressed={dockWidth === "full"}
                data-testid="quest-width-full"
                on:click={() => dispatch("setWidth", "full")}
            >
                {$LL.quest.log.full()}
            </button>
        {/if}
    </div>
</div>
