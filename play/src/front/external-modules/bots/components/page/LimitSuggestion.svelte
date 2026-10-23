<script lang="ts">
    // Asked once, when the owner gives an open bot a tool: anyone who can walk up to it could make it use that tool,
    // so is that what the owner wants? Choose who opens Permissions; Keep it open closes the card for good.
    import LL from "../../../../../i18n/i18n-svelte";

    export let name: string;
    export let onChoose: () => void;
    export let onKeep: () => void;

    $: access = $LL.mapEditor.edit.bots.page.access;
</script>

<div class="bp-ask" role="group" aria-label={access.recommendTitle({ name })} data-testid="bot-limit-suggestion">
    <p class="bp-ask-t">{access.recommendTitle({ name })}</p>
    <p class="bp-ask-m">{access.recommendTool({ name })}</p>
    <div class="bp-ask-row">
        <button type="button" class="bp-go" data-testid="bot-limit-choose" on:click={onChoose}>
            {access.recommendChoose()}
        </button>
        <button type="button" class="bp-keep" data-testid="bot-limit-keep" on:click={onKeep}>
            {access.recommendKeep()}
        </button>
    </div>
</div>

<style>
    .bp-ask {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
        color: #fff;
    }
    .bp-ask-t {
        margin: 0;
        font-size: 14px;
        font-weight: 650;
        overflow-wrap: anywhere;
    }
    .bp-ask-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.78);
        overflow-wrap: anywhere;
    }
    .bp-ask-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 6px;
    }
    .bp-go,
    .bp-keep {
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    /* The choice that goes on */
    .bp-go {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
    }
    @media (hover: hover) {
        .bp-keep:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .bp-go:focus-visible,
    .bp-keep:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
