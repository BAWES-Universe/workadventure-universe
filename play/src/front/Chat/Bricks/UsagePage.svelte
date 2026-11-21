<script lang="ts">
    import { onMount, tick } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageNote from "../../external-modules/bots/components/page/PageNote.svelte";
    import PageRow from "../../external-modules/bots/components/page/PageRow.svelte";
    import { whenLabel } from "../../external-modules/bots/usageModel";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import BrickPicture from "./BrickPicture.svelte";
    import { shortDay } from "./Brick";
    import {
        availableText,
        fullAgainWhen,
        PRICE_NOT_KNOWN,
        REFUND_PENDING_NOTE,
        exactDollars,
        spentLabel,
        storageSize,
        type ActivityItem,
        type BotSpend,
        type ChatUsage,
        type CreditCategory,
        type ExtraCredit,
        type Replies,
        type ReceiptLine,
    } from "./Usage";
    import UsageMoney from "./UsageMoney.svelte";
    import { askMyUsageForMore, loadMyUsage, myUsageFailed, myUsageSettled, myUsageStore } from "./UsageStore";
    import { IconChevronDown } from "@wa-icons";

    /**
     * The Usage page (game #1999, then the credits and grants work), opened from the Usage row of the Bricks page or from
     * "What it used" under a Brick's answer. Real numbers, all Orbit's: Universe AI as replies with the time they reset,
     * Instant Apps and computers as dollars, extra credit, what each Brick spent, and one line for each task that opens to
     * its receipt. Chat and voice keep their own limits; this page only says them. Opening it starts no window and takes
     * nothing. "Ask for more" asks the Universe team and creates no debt; chat carries on either way. A balance that cannot
     * be read says so, never a made-up bar. An older Orbit that sends only the bar and its words is shown by those words.
     */
    export let onBack: () => void;
    /** A task whose receipt opens first (the link under a Brick's answer) */
    export let receiptId: string | undefined = undefined;
    /** Which request opened it: the same receipt asked for again is a new request, and opens it again */
    export let receiptRequest = 0;
    /** What each of the person's Bricks looks like, by id, for By bot */
    export let looks: Record<string, string | null> = {};

    $: text = $LL.chat.brick.usage;
    $: usage = $myUsageStore;
    $: chat = usage?.chat;
    $: replies = chat?.replies ?? null;
    $: apps = usage?.apps ?? null;
    $: computer = usage?.computer ?? null;
    let asking: CreditCategory | undefined;
    let openId: string | undefined = receiptId;
    let handledRequest: number | undefined;
    let body: HTMLDivElement | undefined;
    // Each task's button, by its id: what a link to a receipt puts the keyboard on
    let activityButtons: Record<string, HTMLButtonElement | undefined> = {};

    // The legacy bar: words only, for an Orbit that does not send replies yet
    $: chatTitle = chat
        ? chat.words === "out"
            ? text.out()
            : chat.words === "low"
            ? text.low()
            : chat.words === "half"
            ? text.half()
            : text.plenty()
        : "";
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

    // The real counts
    $: extraDay = chat?.extra?.until ? shortDay(chat.extra.until, $locale) : "";
    $: noLimit = chat?.extra?.noLimit === true;
    $: repliesTitle = !replies
        ? ""
        : noLimit
        ? extraDay
            ? text.noPersonalLimit({ day: extraDay })
            : text.noPersonalLimitNoDay()
        : !replies.running
        ? text.repliesIdle({ count: replies.total })
        : replies.available === 0
        ? text.repliesNone()
        : replies.total === 1
        ? text.repliesOfOne({ available: replies.available })
        : text.repliesOf({ available: replies.available, total: replies.total });
    // Everything it says comes in as a parameter, so a change of language says it again
    $: repliesHint = !replies || noLimit ? undefined : repliesHintOf(replies, chat, text, extraDay, $locale);
    $: repliesLeft = !replies ? 0 : noLimit ? 1 : replies.total > 0 ? replies.available / replies.total : 0;

    function repliesHintOf(
        replies: Replies,
        chat: ChatUsage | undefined,
        text: typeof $LL.chat.brick.usage,
        extraDay: string,
        locale: string | undefined
    ): string | undefined {
        if (!chat) return undefined;
        const parts: string[] = [];
        if (!replies.running) {
            parts.push(
                replies.windowHours ? text.windowStartsHours({ hours: replies.windowHours }) : text.windowStarts()
            );
        } else if (chat.fullAgainAt) {
            parts.push(text.repliesResets({ when: fullAgainWhen(chat.fullAgainAt, locale) }));
        }
        if (replies.inProgress > 0) parts.push(text.repliesInProgress({ count: replies.inProgress }));
        const extra = chat.extra;
        if (extra?.multiplier && extraDay) {
            parts.push(
                extra.multiplier === 2
                    ? text.extraTwice({ day: extraDay })
                    : text.extraTimes({ times: extra.multiplier, day: extraDay })
            );
        }
        return parts.length > 0 ? parts.join(" · ") : undefined;
    }

    // These take what they say it with (the words and the language) as arguments, so a row says itself again when either changes
    type Words = typeof $LL.chat.brick.usage;
    const coversText = (covers: CreditCategory[], text: Words) =>
        covers.length > 1 ? text.coversBoth() : covers[0] === "apps" ? text.coversApps() : text.coversComputers();
    const creditHint = (credit: ExtraCredit, text: Words, locale: string | undefined) => {
        const name = credit.fromName ?? text.extraCreditUniverse();
        const covers = coversText(credit.covers, text);
        return credit.until
            ? text.extraCreditFrom({ name, covers, day: shortDay(credit.until, locale) })
            : text.extraCreditFromNoDay({ name, covers });
    };
    const botUses = (bot: BotSpend, text: Words) =>
        bot.uses.length > 1
            ? text.botUsesBoth()
            : bot.uses[0] === "computer"
            ? text.botUsesComputer()
            : text.botUsesApps();

    function paidBy(item: ActivityItem, text: Words): string {
        if (item.payer === "you") return text.paidByYou();
        if (item.payer === "universe") return text.paidByUniverse();
        return text.paidByName({ name: item.payerName ?? text.extraCreditUniverse() });
    }

    function activityWhen(at: string, text: Words, locale: string | undefined): string {
        const when = whenLabel(at, locale ?? "en");
        if (when.kind === "today") return text.activityToday({ time: when.text });
        return when.kind === "yesterday" ? text.activityYesterday() : when.text;
    }

    /** A task that cost something nobody can say yet: Orbit sends its total as nothing and a line that says the price is not known */
    const priceUnknown = (item: ActivityItem): boolean =>
        item.spentMicros === null &&
        item.lines.some((line) => line.amountMicros === null && line.note === PRICE_NOT_KNOWN);

    /**
     * What a task that did not simply finish is called: Orbit's own headline when it sends one, else ours. A done task has none.
     * An outcome this page does not know reads as done, but keeps its own headline when Orbit sends one (a genuine done task, which
     * Orbit also gives the word "Done", shows none).
     */
    function headline(item: ActivityItem, text: Words): string {
        if (item.state === "refunded" && item.outcome !== "unconfirmed") return "";
        // Orbit's own words for how a task ended are shown as Orbit says them; ours are only for an Orbit that sent none
        if (item.outcome === "partial") return item.outcomeText ?? text.activityPartly();
        if (item.outcome === "failed") return item.outcomeText ?? text.activityDidntFinish();
        if (item.outcome === "unconfirmed") return item.outcomeText ?? text.activityCouldntConfirm();
        if (item.outcome === "stopped") return item.outcomeText ?? text.activityStopped();
        if (item.outcome === "deciding") return item.outcomeText ?? text.activityDeciding();
        if (item.outcome === "refund_pending") {
            if (item.outcomeText) return item.outcomeText;
            const owed = item.refundPendingMicros !== undefined ? exactDollars(item.refundPendingMicros) : null;
            return owed ? text.activityRefundPending({ amount: owed }) : text.activityRefundPendingNoAmount();
        }
        return item.unknownOutcome && item.outcomeText ? item.outcomeText : "";
    }

    /** A task that did not finish and took nothing: nobody paid, so no "Paid by" line (the note says what happened) */
    const nothingPaid = (item: ActivityItem): boolean =>
        (item.outcome === "failed" ||
            item.outcome === "unconfirmed" ||
            item.outcome === "stopped" ||
            item.outcome === "deciding" ||
            item.outcome === "refund_pending") &&
        item.spentMicros === null &&
        !priceUnknown(item);

    function activityHint(item: ActivityItem, text: Words, locale: string | undefined): string {
        const when = activityWhen(item.at, text, locale);
        // A refunded task nobody could confirm says so beside the refund: its delivery is still not known
        if (item.state === "refunded") {
            return item.outcome === "unconfirmed"
                ? [when, headline(item, text), text.refunded()].filter(Boolean).join(" · ")
                : `${when} · ${text.activityRefunded()}`;
        }
        const partly = headline(item, text);
        if (item.payer !== "you") {
            return [when, partly, nothingPaid(item) ? "" : paidBy(item, text)].filter(Boolean).join(" · ");
        }
        const what =
            item.category === "apps"
                ? text.activityApps()
                : item.category === "computer"
                ? text.activityComputer()
                : "";
        const spent =
            item.spentMicros !== null
                ? spentLabel(item.spentMicros, locale, text.lessThanTenthOfCent())
                : priceUnknown(item)
                ? text.amountUnavailable()
                : "";
        return [when, partly, spent, what].filter(Boolean).join(" · ");
    }

    function lineValue(line: ReceiptLine, text: Words, locale: string | undefined) {
        const { amountMicros, note } = line;
        if (amountMicros !== null) return spentLabel(amountMicros, locale, text.lessThanTenthOfCentInLine());
        if (note === PRICE_NOT_KNOWN) return text.amountUnavailable();
        // A computer given back: Orbit's word for it ("Given back") and what it got back, said the way Orbit says amounts
        const back = note !== null && line.returnedMicros !== null ? exactDollars(line.returnedMicros) : null;
        if (note !== null && back) return `${note} ${back}`;
        return note ?? text.activityNothingTaken();
    }

    /** Every outcome but done and refunded shows its actions: a task that did not finish says what each step did */
    const showsActions = (item: ActivityItem): boolean => item.outcome !== "done" && item.outcome !== "refunded";

    /**
     * A task that did not finish shows each action and how it ended; the lines of what it used follow only when no step that worked
     * carries its own amount (then Orbit's lines are all there is). Once a step says what it took, the steps are the lines.
     */
    const perAction = (item: ActivityItem): boolean =>
        showsActions(item) &&
        item.actions.some((action) => action.outcome === "worked" && action.amountMicros !== null);

    /**
     * The lines of a receipt that are shown. When each step says what it took, the steps are the lines, except the computer's own line
     * when it was given back or a refund of it is pending: nothing else says what happened to the computer's cost on that receipt.
     */
    const shownLines = (item: ActivityItem): ReceiptLine[] =>
        perAction(item)
            ? item.lines.filter(
                  (line) =>
                      line.returnedMicros !== null ||
                      (item.refundPendingMicros !== undefined && line.note === REFUND_PENDING_NOTE)
              )
            : item.lines;

    async function onAsk(category: CreditCategory) {
        if (asking) return;
        asking = category;
        const sent = await askMyUsageForMore(category);
        // eslint-disable-next-line require-atomic-updates
        asking = undefined;
        if (!sent) warningMessageStore.addWarningMessage(text.askFailed());
    }

    function load() {
        loadMyUsage().catch((error) => console.error(error));
    }

    // The task a link asked for opens, scrolls into view and takes the keyboard once the page has it, each time it is asked for
    // (the same receipt asked for again, after it was closed, is a new request)
    $: if (
        receiptId &&
        usage &&
        handledRequest !== receiptRequest &&
        usage.activity.some((item) => item.id === receiptId)
    ) {
        const wanted = receiptId;
        handledRequest = receiptRequest;
        openId = wanted;
        tick()
            .then(() => {
                const button = activityButtons[wanted];
                button?.scrollIntoView?.({ block: "center" });
                button?.focus({ preventScroll: true });
            })
            .catch((error) => console.error(error));
    }

    // Read again each time the page opens
    onMount(load);
</script>

<div class="up flex h-full min-h-0 flex-col" data-testid="usagePage">
    <PanelHeader title={text.title()} {onBack} backLabel={text.backToBricks()} canHide={false} />
    <div class="body" bind:this={body}>
        {#if !usage}
            {#if !$myUsageSettled}
                <PageNote>{text.loading()}</PageNote>
            {:else}
                <div data-testid="usageLoadFailed">
                    <PageRow title={text.unavailable()} hint={text.unavailableHint()} />
                </div>
                <div class="ask">
                    <PageButton tall testId="usageTryAgain" on:click={load}>{text.tryAgain()}</PageButton>
                </div>
            {/if}
        {:else if chat}
            <div class="sec">{text.universeAi()}</div>
            {#if chat.unavailable}
                <PageRow title={text.unavailable()} hint={text.unavailableHint()} />
            {:else if replies}
                <div class="meter" class:low={repliesLeft < 0.2} aria-hidden="true">
                    <span data-testid="usageChatBar" style="width:{Math.round(repliesLeft * 100)}%" />
                </div>
                <PageRow title={repliesTitle} hint={repliesHint} />
                <PageNote>{text.aiNoteReplies()}</PageNote>
            {:else}
                <div class="meter" class:low={chat.words === "low" || chat.words === "out"} aria-hidden="true">
                    <span data-testid="usageChatBar" style="width:{Math.round(chat.left * 100)}%" />
                </div>
                <PageRow title={chatTitle} hint={chatHint} />
                {#if usage.extraUntil}
                    <PageRow title={text.extra({ day: shortDay(usage.extraUntil, $locale) })} hint={text.extraFrom()} />
                {/if}
                <PageNote>{text.aiNote()}</PageNote>
            {/if}
            {#if $myUsageFailed}
                <p class="up-bad" data-testid="usageStale">{text.loadFailed()}</p>
            {/if}

            {#if apps}
                <div class="sec" data-testid="usageSecApps">{text.instantApps()}</div>
                <UsageMoney
                    category="apps"
                    money={apps}
                    note={text.instantNote()}
                    asking={asking === "apps"}
                    busy={asking !== undefined}
                    onAsk={() => onAsk("apps")}
                />
            {/if}

            {#if computer}
                <div class="sec">{apps || computer.money ? text.computers() : text.computer()}</div>
                {#if computer.money}
                    <UsageMoney
                        category="computer"
                        money={computer.money}
                        note={text.computerNote()}
                        asking={asking === "computer"}
                        busy={asking !== undefined}
                        onAsk={() => onAsk("computer")}
                    />
                {:else}
                    <div
                        class="meter"
                        class:low={computer.words === "low" || computer.words === "out"}
                        aria-hidden="true"
                    >
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
                            <PageButton
                                tall
                                go
                                disabled={asking !== undefined}
                                testId="usageAskForMore"
                                on:click={() => onAsk("computer")}
                            >
                                {text.askForMore()}
                            </PageButton>
                        </div>
                        <PageNote>{text.askNote()}</PageNote>
                    {:else}
                        <PageNote>{text.computerNote()}</PageNote>
                    {/if}
                {/if}
            {/if}

            {#if usage.credit.length > 0}
                <div class="sec" data-testid="usageSecCredit">{text.extraCredit()}</div>
                {#each usage.credit as credit, index (index)}
                    <PageRow
                        title={text.creditOfTotal({
                            available: availableText(credit.availableMicros, $locale),
                            total: availableText(credit.totalMicros, $locale),
                        })}
                        hint={creditHint(credit, text, $locale)}
                        on
                    />
                    <PageNote>{credit.covers.length > 1 ? text.extraCreditBoth() : text.extraCreditOne()}</PageNote>
                {/each}
            {/if}

            {#if usage.bots.length > 0}
                <div class="sec" data-testid="usageSecBots">{text.byBot()}</div>
                {#each usage.bots as bot (bot.id)}
                    <div class="br" data-testid="usageBotRow">
                        <span class="face"><BrickPicture look={looks[bot.id]} /></span>
                        <div class="tx">
                            <div class="t">{bot.name}</div>
                            <div class="m">
                                {bot.spentMicros > 0
                                    ? text.botSpent({
                                          amount: spentLabel(bot.spentMicros, $locale, text.lessThanTenthOfCent()),
                                          uses: botUses(bot, text),
                                      })
                                    : text.botNone()}
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}

            {#if usage.activity.length > 0}
                <div class="sec" data-testid="usageSecActivity">{text.activity()}</div>
                {#each usage.activity as item (item.id)}
                    <button
                        type="button"
                        class="act"
                        class:open={openId === item.id}
                        aria-expanded={openId === item.id}
                        data-activity={item.id}
                        bind:this={activityButtons[item.id]}
                        data-testid="usageActivity"
                        on:click={() => (openId = openId === item.id ? undefined : item.id)}
                    >
                        <div class="tx">
                            <div class="t">{item.title}</div>
                            <div class="m">{activityHint(item, text, $locale)}</div>
                        </div>
                        <span class="chev"><IconChevronDown font-size="18" /></span>
                    </button>
                    {#if openId === item.id}
                        <div class="receipt" data-testid="usageReceipt">
                            {#if showsActions(item)}
                                {#each item.actions as action, index (index)}
                                    <div class="rl" data-testid="usageReceiptAction">
                                        <span>{action.text}</span>
                                        {#if action.outcome === "failed"}
                                            <b class="q">{action.takenText ?? text.activityNothingTaken()}</b>
                                        {:else if action.outcome === "unknown"}
                                            <!-- Not confirmed: only Orbit's words for what was taken, never a claim of ours -->
                                            {#if action.takenText}<b class="q">{action.takenText}</b>{/if}
                                        {:else if action.amountMicros !== null}
                                            <b
                                                >{spentLabel(
                                                    action.amountMicros,
                                                    $locale,
                                                    text.lessThanTenthOfCentInLine()
                                                )}</b
                                            >
                                        {:else if perAction(item) && item.lines.some((line) => line.note === PRICE_NOT_KNOWN)}
                                            <!-- This step worked and its price is not known yet, as Orbit says in its lines -->
                                            <b class="q">{text.amountUnavailable()}</b>
                                        {/if}
                                    </div>
                                {/each}
                            {/if}
                            {#each shownLines(item) as line, index (index)}
                                <div class="rl">
                                    <span>{line.label}</span><b
                                        class:q={line.amountMicros === null && line.note === PRICE_NOT_KNOWN}
                                        >{lineValue(line, text, $locale)}</b
                                    >
                                </div>
                            {/each}
                            {#if item.state === "refunded" && item.outcome !== "unconfirmed"}
                                <p class="why" data-testid="usageReceiptWhy">{text.receiptRefundedWhy()}</p>
                            {:else if item.outcomeNote}
                                <p class="why" data-testid="usageReceiptWhy">{item.outcomeNote}</p>
                            {/if}
                            <div class="rfoot">
                                {#if headline(item, text)}
                                    <span class="paid" data-testid="usageReceiptPartly">{headline(item, text)}</span>
                                {/if}
                                {#if item.state === "refunded"}
                                    <span class="paid">{text.refunded()}</span>
                                {:else if !nothingPaid(item)}
                                    <span class="paid">{paidBy(item, text)}</span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}
                <PageNote>{text.activityNote()}</PageNote>
            {/if}

            {#if usage.storageBytes !== null}
                <div class="sec">{text.storage()}</div>
                <PageRow
                    title={storageSize(usage.storageBytes)}
                    hint={usage.storagePaidByUniverse ? text.storagePaidByUniverse() : text.noLimit()}
                />
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
    .br,
    .act {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 12px;
        min-height: 48px;
        box-sizing: border-box;
    }
    .act {
        width: 100%;
        margin: 0;
        border: 0;
        background: none;
        color: inherit;
        text-align: left;
        font: inherit;
        cursor: pointer;
    }
    .act.open {
        background: rgba(255, 255, 255, 0.08);
    }
    .chev {
        display: flex;
        flex: none;
        color: rgba(255, 255, 255, 0.6);
    }
    .act.open .chev {
        transform: rotate(180deg);
    }
    .face {
        flex: none;
        display: flex;
        width: 32px;
        height: 32px;
    }
    .tx {
        flex: 1;
        min-width: 0;
    }
    .t {
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .m {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.6);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .receipt {
        margin: 0 8px 4px;
        padding: 6px 12px 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
    }
    .rl {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.75);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .rl b {
        font-weight: 600;
        color: #fff;
        text-align: right;
    }
    .rl b.q {
        font-weight: 500;
        color: rgba(244, 242, 250, 0.75);
    }
    .rfoot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding-top: 8px;
        min-height: 36px;
    }
    .paid {
        font-size: 12px;
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: rgba(244, 242, 250, 0.8);
    }
    .why {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.85);
    }
</style>
