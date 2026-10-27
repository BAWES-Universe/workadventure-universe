<script lang="ts">
    // What the maker sees (#1159, mock approved 26 Oct 2026): on top of the bot's page, how many people asked for more
    // replies while the bot runs on Universe AI, and one button to the maker's own key. Counts only, never who asked.
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotUsage } from "../../usageModel";
    import { IconBell, IconEye, IconKey } from "@wa-icons";

    export let name: string;
    export let usage: BotUsage;
    export let onUseKey: () => void;

    $: text = $LL.mapEditor.edit.bots.page.usage;
    $: range =
        usage.range === "today" ? text.rangeToday() : usage.range === "30d" ? text.rangeMonth() : text.rangeWeek();
</script>

<div
    class="mk"
    role="group"
    aria-label={text.askedTitle({ count: usage.limits.askedMaker, range })}
    data-testid="bot-maker-asked"
>
    <div class="mk-row">
        <IconBell font-size="20" />
        <span class="mk-tx">
            <b>{text.askedTitle({ count: usage.limits.askedMaker, range })}</b>
            <span
                >{text.askedLine({
                    name,
                    signedIn: usage.limits.universeAi.signedIn,
                    hours: usage.limits.universeAi.windowHours,
                })}</span
            >
        </span>
    </div>
    <button type="button" class="mk-go" data-testid="bot-maker-asked-key" on:click={onUseKey}>
        <IconKey font-size="18" />{text.useMyKey()}
    </button>
    <span class="mk-who"><IconEye font-size="13" />{text.countsOnly()}</span>
</div>

<style>
    /* The limit card's look, so the maker knows it is the same thing people saw */
    .mk {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 16px;
        color: #fff;
        background: linear-gradient(160deg, rgba(31, 28, 47, 0.96), rgba(20, 18, 30, 0.97));
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.22), 0 0 24px -12px rgba(134, 41, 252, 0.55);
        overflow-wrap: anywhere;
    }
    .mk-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }
    .mk-row > :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .mk-tx {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .mk-tx b {
        font-size: 14px;
        line-height: 19px;
    }
    .mk-tx span {
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.75);
    }
    .mk-go {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
        cursor: pointer;
    }
    .mk-go:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .mk-who {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
    }
</style>
