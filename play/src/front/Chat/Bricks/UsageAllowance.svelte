<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../external-modules/bots/components/page/PageNote.svelte";
    import PageRow from "../../external-modules/bots/components/page/PageRow.svelte";
    import { shortDay } from "./Brick";
    import type { Entitlement } from "./Usage";

    /**
     * The person's own monthly allowance for voice or for connected Apps, in plain words: a bar, how much is left, the day it starts again,
     * and "Ask for more" once it is used up when Orbit says they can. Never a platform budget, a provider's limit or a number: only what is theirs.
     */
    export let kind: "voice" | "apps";
    export let allowance: Entitlement;
    export let asking = false;
    export let onAsk: () => void;

    $: text = $LL.chat.brick.usage;
    $: id = kind === "voice" ? "Voice" : "AppUse";
    $: title =
        allowance.words === "out"
            ? text.computerOut()
            : allowance.words === "low"
            ? text.computerLow()
            : allowance.words === "half"
            ? text.computerHalf()
            : text.computerPlenty();
    $: hint = text.startsAgain({ day: shortDay(allowance.startsAgainAt, $locale) });
    $: note = kind === "voice" ? text.voiceNote() : text.appUseNote();
</script>

<div class="meter" class:low={allowance.left < 0.2} aria-hidden="true">
    <span data-testid="usage{id}Bar" style="width:{Math.round(allowance.left * 100)}%" />
</div>
<PageRow {title} {hint} />
{#if allowance.asked}
    <PageRow title={text.asked()} hint={text.askedLine()} />
{:else if allowance.canAskForMore}
    <div class="ask">
        <PageButton tall go disabled={asking} testId="usageAskForMore{id}" on:click={onAsk}>
            {text.askForMore()}
        </PageButton>
    </div>
    <PageNote>{text.askNote()}</PageNote>
{:else}
    <PageNote>{note}</PageNote>
{/if}

<style>
    .meter {
        flex: none;
        height: 8px;
        margin: 0 8px 2px;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.12);
        overflow: hidden;
    }
    .meter span {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .meter.low span {
        background: #e9c74c;
    }
    .ask {
        flex: none;
        display: flex;
        padding: 4px 8px;
    }
    .ask :global(.bp-btn) {
        flex: 1;
    }
</style>
