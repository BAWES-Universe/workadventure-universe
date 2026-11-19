<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../external-modules/bots/components/page/PageNote.svelte";
    import PageRow from "../../external-modules/bots/components/page/PageRow.svelte";
    import { availableText, moneyLeft, moneyUsedUp, renewsWhen, type CreditCategory, type Money } from "./Usage";

    /**
     * One money credit on the Usage page, for Instant Apps or computers: a bar, what is available out of what it was, and
     * when it renews or that it never does. When it is used up, "Ask for more" is offered if Orbit says so. Every figure is
     * Orbit's; this only says it. A balance that could not be read says so, with no bar and no made-up amount.
     */
    // A cent, in millionths of a dollar: what is held back below it is not "$0"
    const CENT_MICROS = 10_000;
    export let category: CreditCategory;
    export let money: Money;
    /** The explanation under it while there is nothing to ask for */
    export let note: string;
    export let asking = false;
    /** Another request is out: both buttons wait, as only one request is made at a time */
    export let busy = false;
    export let onAsk: () => void;

    $: text = $LL.chat.brick.usage;
    $: id = category === "apps" ? "Apps" : "Computer";
    $: usedUp = moneyUsedUp(money);
    $: oneOff = money.kind === "oneoff";
    $: available = availableText(money.availableMicros, $locale);
    $: total = availableText(money.totalMicros, $locale);
    $: title =
        usedUp && oneOff
            ? text.startingCreditUsedUp({ total })
            : oneOff
            ? text.startingCredit({ available, total })
            : text.creditOfTotal({ available, total });
    $: renew = renewsWhen(money.renewsAt, $locale);
    $: hint = [
        oneOff
            ? usedUp
                ? text.oneTimeCreditUsedUp()
                : text.oneTimeCredit()
            : renew
            ? text.renews(renew)
            : text.renewsNoTime(),
        money.inProgressMicros <= 0
            ? ""
            : money.inProgressMicros < CENT_MICROS
            ? text.inProgressTiny()
            : text.inProgress({ amount: availableText(money.inProgressMicros, $locale) }),
    ]
        .filter(Boolean)
        .join(" · ");
    $: left = moneyLeft(money);
</script>

{#if money.unavailable}
    <PageRow title={text.unavailable()} hint={text.unavailableHint()} />
{:else}
    <div class="meter" class:low={left < 0.2} aria-hidden="true">
        <span data-testid="usage{id}Bar" style="width:{Math.round(left * 100)}%" />
    </div>
    <PageRow {title} {hint} />
    {#if money.asked}
        <PageRow title={text.asked()} hint={text.askedLine()} />
    {:else if money.canAskForMore}
        <div class="ask">
            <PageButton tall go disabled={asking || busy} testId="usageAskForMore{id}" on:click={onAsk}>
                {text.askForMore()}
            </PageButton>
        </div>
        <PageNote>{category === "apps" ? text.askNoteApps() : text.askNoteComputers()}</PageNote>
    {:else}
        <PageNote>{note}</PageNote>
    {/if}
{/if}

<style>
    /* One thin bar in the brand gradient, the same fill as a switch that is on. */
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
