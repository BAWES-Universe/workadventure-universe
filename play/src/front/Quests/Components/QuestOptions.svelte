<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestOptionRow } from "../QuestCopy";
    import type { QuestPath } from "../QuestModel";
    import type { QuestHost } from "../QuestWorld";
    import QuestHostPortrait from "./QuestHostPortrait.svelte";
    import QuestStamp from "./QuestStamp.svelte";
    import { escapeKey, questKeyboardFocus } from "./questActions";

    export let host: QuestHost;
    export let title: string;
    export let rows: QuestOptionRow[];

    const dispatch = createEventDispatcher<{ close: void; accept: QuestPath }>();

    let closeButton: HTMLElement | undefined;

    export function focusClose(): void {
        closeButton?.querySelector("button")?.focus();
    }
</script>

<div
    class="quest-surface w-full p-3 pointer-events-auto overflow-y-auto quest-max-h"
    role="dialog"
    aria-modal="false"
    aria-labelledby="quest-options-title"
    data-testid="quest-options"
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
>
    <div class="flex items-start gap-3">
        <!-- First in focus order, drawn at the end. -->
        <div class="order-last shrink-0" bind:this={closeButton}>
            <ButtonClose
                size="lg"
                ariaLabel={$LL.quest.close()}
                dataTestId="quest-options-close"
                on:click={() => dispatch("close")}
            />
        </div>
        <QuestHostPortrait {host} />
        <h2 id="quest-options-title" class="m-0 min-w-0 flex-1 self-center text-base font-bold leading-snug">
            {title}
        </h2>
    </div>
    <ul class="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {#each rows as row (row.path)}
            <li>
                <button
                    type="button"
                    class="quest-row"
                    data-testid="quest-option-{row.path}"
                    on:click={() => dispatch("accept", row.path)}
                >
                    <QuestStamp path={row.path} size={40} tilted={false} />
                    <span class="min-w-0 flex-1 text-start">
                        <span class="block font-bold">{row.title}</span>
                        <span class="quest-secondary block">{row.description}</span>
                    </span>
                    <span class="quest-secondary shrink-0 whitespace-nowrap"
                        >{$LL.quest.minutes({ minutes: row.minutes })}</span
                    >
                </button>
            </li>
        {/each}
    </ul>
</div>
