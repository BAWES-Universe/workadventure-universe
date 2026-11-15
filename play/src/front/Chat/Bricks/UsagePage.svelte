<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../external-modules/bots/components/page/PageNote.svelte";
    import PageRow from "../../external-modules/bots/components/page/PageRow.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { shortDay } from "./Brick";
    import { fullAgainWhen, storageSize } from "./Usage";
    import { askMyUsageForMore, loadMyUsage, myUsageFailed, myUsageSettled, myUsageStore } from "./UsageStore";

    /**
     * The Usage page (game #1999), opened from the Usage row of the Bricks page. One bar for what Universe gives the person,
     * in no unit: it covers text and voice, and only their Bricks on Universe AI. Never a count of replies and never a
     * price. Someone whose Brick uses a computer also sees its time this month, and what their Bricks keep. When computer
     * time is used up, "Ask for more" asks the Universe team and creates no debt; chat carries on either way.
     */
    export let onBack: () => void;

    $: text = $LL.chat.brick.usage;
    $: usage = $myUsageStore;
    $: chat = usage?.chat;
    $: computer = usage?.computer ?? null;
    let asking = false;

    $: chatTitle = chat ? (chat.words === "out" ? text.out() : chat.words === "low" ? text.low() : text.plenty()) : "";
    $: chatHint = chat?.fullAgainAt ? text.fullAgain({ when: fullAgainWhen(chat.fullAgainAt, $locale) }) : undefined;
    $: computerTitle = computer
        ? computer.words === "out"
            ? text.computerOut()
            : computer.words === "low"
            ? text.computerLow()
            : computer.words === "half"
            ? text.computerHalf()
            : text.computerPlenty()
        : "";

    async function onAsk() {
        if (asking) return;
        asking = true;
        const sent = await askMyUsageForMore();
        // eslint-disable-next-line require-atomic-updates
        asking = false;
        if (!sent) warningMessageStore.addWarningMessage(text.askFailed());
    }

    function load() {
        loadMyUsage().catch((error) => console.error(error));
    }

    // Read again each time the page opens
    onMount(load);
</script>

<div class="up flex h-full min-h-0 flex-col" data-testid="usagePage">
    <PanelHeader title={text.title()} {onBack} backLabel={text.backToBricks()} canHide={false} />
    <div class="body">
        {#if !usage}
            {#if !$myUsageSettled}
                <PageNote>{text.loading()}</PageNote>
            {:else}
                <p class="up-bad" data-testid="usageLoadFailed">{text.loadFailed()}</p>
                <div class="ask">
                    <PageButton tall testId="usageTryAgain" on:click={load}>{text.tryAgain()}</PageButton>
                </div>
            {/if}
        {:else if chat}
            <div class="sec">{text.universeAi()}</div>
            <div class="meter" class:low={chat.words === "low" || chat.words === "out"} aria-hidden="true">
                <span data-testid="usageChatBar" style="width:{Math.round(chat.left * 100)}%" />
            </div>
            <PageRow title={chatTitle} hint={chatHint} />
            {#if usage.extraUntil}
                <PageRow title={text.extra({ day: shortDay(usage.extraUntil, $locale) })} hint={text.extraFrom()} />
            {/if}
            <PageNote>{text.aiNote()}</PageNote>
            {#if $myUsageFailed}
                <p class="up-bad" data-testid="usageStale">{text.loadFailed()}</p>
            {/if}

            {#if computer}
                <div class="sec">{text.computer()}</div>
                <div class="meter" class:low={computer.words === "low" || computer.words === "out"} aria-hidden="true">
                    <span data-testid="usageComputerBar" style="width:{Math.round(computer.left * 100)}%" />
                </div>
                <PageRow
                    title={computerTitle}
                    hint={text.startsAgain({ day: shortDay(computer.startsAgainAt, $locale) })}
                />
                {#if computer.asked}
                    <PageRow title={text.asked()} hint={text.askedLine()} />
                {:else if computer.canAskForMore}
                    <div class="ask">
                        <PageButton tall go disabled={asking} testId="usageAskForMore" on:click={onAsk}>
                            {text.askForMore()}
                        </PageButton>
                    </div>
                    <PageNote>{text.askNote()}</PageNote>
                {:else}
                    <PageNote>{text.computerNote()}</PageNote>
                {/if}
            {/if}

            {#if usage.storageBytes !== null}
                <div class="sec">{text.storage()}</div>
                <PageRow title={storageSize(usage.storageBytes)} hint={text.noLimit()} />
                <PageNote>{text.storageNote()}</PageNote>
            {/if}
        {/if}
    </div>
</div>

<style>
    .up {
        box-sizing: border-box;
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 0;
        overflow-y: auto;
    }
    /* The bot list's own section label. */
    .sec {
        display: flex;
        align-items: center;
        min-height: 36px;
        margin-top: 6px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
    .sec:first-child {
        margin-top: 0;
    }
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
    .up-bad {
        margin: 0;
        padding: 0 8px;
        font-size: 13px;
        line-height: 1.4;
        color: #ff8a7a;
    }
    .body :global(.bp-note) {
        padding: 0 8px;
    }
</style>
