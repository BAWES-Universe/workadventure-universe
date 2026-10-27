<script lang="ts">
    // Usage (Orbit #491, mock v4 approved 20 Oct 2026): first on the bot page, for the people who manage the bot. The
    // range's numbers, replies a day split into direct messages and nearby chat, and three rows that each open a screen:
    // who uses it, what it ran on, and its limits. Names, never words. A bot nobody has chatted with yet is one line.
    import { get } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import { botUsageStore, loadBotUsage } from "../../stores/BotUsageStore";
    import {
        CHART,
        barPath,
        chartBars,
        chartSwitchBar,
        compactNumber,
        dayLabel,
        dollars,
        whenLabel,
        type BotUsage,
        type ChartBar,
        type UsageRange,
        type UsageScreen,
    } from "../../usageModel";
    import PageGroup from "./PageGroup.svelte";
    import PageSegment from "./PageSegment.svelte";
    import { IconAlertTriangle, IconChartBar, IconChevronDown, IconGauge, IconKey, IconUsers } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onOpenScreen: (screen: UsageScreen) => void;

    $: page = $LL.mapEditor.edit.bots.page;
    $: text = page.usage;
    $: name = bot.name || "Bot";

    // Back from one of its screens, the group keeps the range that was picked
    let loadedFor: string | undefined;
    $: if (bot.id !== loadedFor) {
        loadedFor = bot.id;
        const shown = get(botUsageStore);
        void loadBotUsage(bot.id, shown?.botId === bot.id ? shown.range : "7d");
    }
    $: state = $botUsageStore && $botUsageStore.botId === bot.id ? $botUsageStore : undefined;
    $: usage = state?.data;
    $: range = state?.range ?? "7d";
    // The words and day names follow the numbers on screen, so a range still loading never names numbers from another
    $: shownRange = usage?.range ?? range;
    // Opening the group after a failed read asks Orbit again
    let wasOpen = false;
    $: {
        if (open && !wasOpen && state?.status === "failed") void loadBotUsage(bot.id, range);
        wasOpen = open;
    }

    function pick(next: UsageRange) {
        if (next !== range) void loadBotUsage(bot.id, next);
    }

    $: brief =
        !state || (!usage && state.status === "loading")
            ? text.briefLoading()
            : !usage
            ? text.briefFailed()
            : !usage.hasUsage
            ? text.briefNone({ name })
            : shownRange === "today"
            ? text.briefToday({ replies: usage.totals.replies, people: usage.totals.people })
            : shownRange === "30d"
            ? text.briefMonth({ replies: usage.totals.replies, people: usage.totals.people })
            : text.briefWeek({ replies: usage.totals.replies, people: usage.totals.people });

    $: chart = usage ? chartBars(usage.perDay) : undefined;
    // The busiest day's total sits over its bar
    $: busiest = chart?.bars.reduce<ChartBar | undefined>(
        (top, bar) => (bar.total > 0 && (!top || bar.total >= top.total) ? bar : top),
        undefined
    );
    // A dashed line after the day the bot moved from one key to the next
    $: switchBar = usage && chart ? chartSwitchBar(usage, chart.bars) : undefined;
    // On 30 days every fifth day is named, so the names never run into each other
    $: labelEvery = usage && usage.perDay.length > 10 ? 5 : 1;

    function keyDownWhen(at: string): string {
        const when = whenLabel(at, $locale);
        if (when.kind === "today") return text.downToday({ time: when.text });
        if (when.kind === "yesterday") return text.downYesterday();
        return text.downOn({ day: when.text });
    }

    function whoBrief(data: BotUsage): string {
        // First names, as people say them, so three fit on the line
        const names = data.people.slice(0, 3).map((person) => person.name?.trim().split(/\s+/)[0] || text.noName());
        const others = data.people.length + data.guests.count - names.length;
        if (names.length === 0)
            return data.guests.count ? text.whoGuests({ count: data.guests.count }) : text.whoNone();
        return others > 0
            ? text.whoMore({ names: names.join(", "), count: others })
            : text.whoSome({ names: names.join(", ") });
    }

    function ranOnBrief(data: BotUsage): string {
        if (data.ranOn.length === 0) return text.ranOnNone();
        const names = data.ranOn.map((line) =>
            line.kind === "own-key" ? line.name || text.yourKey() : text.universeAi()
        );
        const lines = names.length === 2 ? text.ranOnThen({ first: names[0], second: names[1] }) : names.join(", ");
        const priced = data.ranOn.filter((line) => line.costMicros !== null);
        if (priced.length === 0) return lines;
        const micros = priced.reduce((sum, line) => sum + (line.costMicros ?? 0), 0);
        return text.ranOnCost({ lines, amount: dollars(micros, $locale) });
    }

    function limitsBrief(data: BotUsage): string {
        if (data.limits.ranOut.universeAi > 0) return text.limitsRanOut({ count: data.limits.ranOut.universeAi });
        if (data.limits.ranOut.botLimit > 0) return text.limitsReached({ count: data.limits.ranOut.botLimit, name });
        return text.limitsNone();
    }

    function dayTitle(day: BotUsage["perDay"][number]): string {
        return text.dayReplies({
            day: dayLabel(day.day, shownRange, $locale),
            dm: day.dm,
            nearby: day.nearby,
            notSplit: day.notSplit,
        });
    }
</script>

{#if state?.status === "hidden"}
    <!-- Only the people who manage the bot see its usage -->
{:else if usage && !usage.hasUsage}
    <PageGroup id="usage" icon={IconChartBar} title={text.title()} {brief} quiet {onToggle} />
{:else}
    <PageGroup id="usage" icon={IconChartBar} title={text.title()} {brief} {open} {onToggle}>
        <PageSegment
            label={text.range()}
            value={range}
            options={[
                { value: "today", label: text.today(), testId: "bot-usage-today" },
                { value: "7d", label: text.week(), testId: "bot-usage-7d" },
                { value: "30d", label: text.month(), testId: "bot-usage-30d" },
            ]}
            onPick={pick}
        />
        {#if !usage}
            {#if state?.status === "failed"}
                <p class="us-fail" role="alert">
                    {text.loadFailed()}
                    <button type="button" class="us-retry" on:click={() => loadBotUsage(bot.id, range)}
                        >{text.retry()}</button
                    >
                </p>
            {/if}
        {:else}
            {#if usage.keyProblem}
                <div class="us-alert" role="status">
                    <IconAlertTriangle font-size="16" />
                    <span
                        ><b
                            >{text.keyDown({
                                key: usage.keyProblem.name,
                                when: keyDownWhen(usage.keyProblem.downSince),
                            })}</b
                        >
                        {usage.keyProblem.meanwhile === "stopped"
                            ? text.keyDownRests({ name })
                            : text.keyDownMoved({ name })}</span
                    >
                </div>
            {/if}
            <div class="us-figs" class:dim={state?.status === "loading"}>
                <div class="us-fig">
                    <strong>{compactNumber(usage.totals.replies, $locale)}</strong><span
                        >{text.replies(usage.totals.replies)}</span
                    >
                </div>
                <div class="us-fig">
                    <strong>{compactNumber(usage.totals.people, $locale)}</strong><span
                        >{text.people(usage.totals.people)}</span
                    >
                </div>
                <div class="us-fig">
                    <strong>{compactNumber(usage.totals.tokens, $locale)}</strong><span>{text.tokens()}</span>
                </div>
            </div>
            <div class="us-legend">
                <span><i class="us-sw dm" />{text.dm()} {usage.channels.dm}</span>
                <span><i class="us-sw nearby" />{text.nearby()} {usage.channels.nearby}</span>
                {#if usage.channels.notSplit > 0}
                    <span><i class="us-sw split" />{text.notSplit()} {usage.channels.notSplit}</span>
                {/if}
            </div>
            {#if chart}
                <svg
                    class="us-chart"
                    viewBox="0 0 {CHART.width} {CHART.height}"
                    role="img"
                    aria-label={text.chart()}
                    data-testid="bot-usage-chart"
                >
                    <defs>
                        <pattern
                            id="bot-usage-hatch"
                            width="6"
                            height="6"
                            patternUnits="userSpaceOnUse"
                            patternTransform="rotate(45)"
                        >
                            <rect width="6" height="6" fill="rgba(245,243,255,.06)" />
                            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(245,243,255,.28)" stroke-width="2" />
                        </pattern>
                    </defs>
                    {#each [0, chart.max / 2, chart.max] as tick (tick)}
                        {@const y = CHART.bottom - (tick / chart.max) * (CHART.bottom - CHART.top)}
                        <line x1={CHART.left} x2={CHART.right} y1={y} y2={y} class="us-grid" />
                        <text x={CHART.left - 6} y={y + 4} text-anchor="end" class="us-ax">{tick}</text>
                    {/each}
                    {#each chart.bars as bar, i (bar.day)}
                        <g>
                            <title>{dayTitle(usage.perDay[i])}</title>
                            {#each bar.parts as part (part.kind)}
                                <path
                                    d={barPath(bar.x, part.y, bar.width, part.height, part.top)}
                                    class="us-bar {part.kind}"
                                />
                            {/each}
                        </g>
                        {#if bar === busiest}
                            <text
                                x={bar.x + bar.width / 2}
                                y={(bar.parts.at(-1)?.y ?? CHART.bottom) - 5}
                                text-anchor="middle"
                                class="us-val">{compactNumber(bar.total, $locale)}</text
                            >
                        {/if}
                        {#if i % labelEvery === 0 || i === chart.bars.length - 1}
                            <text x={bar.x + bar.width / 2} y={CHART.height - 8} text-anchor="middle" class="us-ax"
                                >{dayLabel(bar.day, shownRange, $locale)}</text
                            >
                        {/if}
                    {/each}
                    {#if switchBar}
                        <line
                            x1={switchBar.x + switchBar.width + 4}
                            x2={switchBar.x + switchBar.width + 4}
                            y1={CHART.top}
                            y2={CHART.bottom}
                            class="us-switch"
                        />
                    {/if}
                </svg>
            {/if}
            <div class="us-drills">
                <button
                    type="button"
                    class="us-drill"
                    data-testid="bot-usage-people"
                    on:click={() => onOpenScreen("people")}
                >
                    <span class="us-dico"><IconUsers font-size="20" /></span>
                    <span class="us-dtx"><b>{text.whoTitle({ name })}</b><span>{whoBrief(usage)}</span></span>
                    <span class="us-chev"><IconChevronDown font-size="18" /></span>
                </button>
                <button
                    type="button"
                    class="us-drill"
                    data-testid="bot-usage-ran-on"
                    on:click={() => onOpenScreen("ranOn")}
                >
                    <span class="us-dico"><IconKey font-size="20" /></span>
                    <span class="us-dtx"><b>{text.ranOnTitle()}</b><span>{ranOnBrief(usage)}</span></span>
                    <span class="us-chev"><IconChevronDown font-size="18" /></span>
                </button>
                <button
                    type="button"
                    class="us-drill"
                    data-testid="bot-usage-limits"
                    on:click={() => onOpenScreen("limits")}
                >
                    <span class="us-dico"><IconGauge font-size="20" /></span>
                    <span class="us-dtx"><b>{text.limitsTitle()}</b><span>{limitsBrief(usage)}</span></span>
                    <span class="us-chev"><IconChevronDown font-size="18" /></span>
                </button>
            </div>
        {/if}
    </PageGroup>
{/if}

<style>
    .us-alert {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 12px;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.66);
        background: rgba(251, 191, 36, 0.08);
        box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35);
    }
    .us-alert :global(svg) {
        flex: none;
        margin-top: 1px;
        color: #fbbf24;
    }
    .us-alert b {
        color: #fff;
        font-weight: 600;
    }
    .us-figs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
        transition: opacity 0.15s;
    }
    .us-figs.dim {
        opacity: 0.6;
    }
    .us-fig {
        display: flex;
        flex-direction: column;
    }
    .us-fig strong {
        font-size: 24px;
        font-weight: 700;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
    }
    .us-fig span {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.66);
    }
    .us-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.66);
        font-variant-numeric: tabular-nums;
    }
    .us-legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .us-sw {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 3px;
    }
    .us-sw.dm {
        background: #8b5cf6;
    }
    .us-sw.nearby {
        background: #0d9488;
    }
    .us-sw.split {
        background: repeating-linear-gradient(45deg, rgba(245, 243, 255, 0.3) 0 2px, rgba(245, 243, 255, 0.06) 2px 4px);
        box-shadow: inset 0 0 0 1px rgba(245, 243, 255, 0.22);
    }
    .us-chart {
        display: block;
        width: 100%;
        height: auto;
    }
    .us-grid {
        stroke: rgba(245, 243, 255, 0.1);
        stroke-width: 1;
    }
    .us-ax {
        font-size: 10px;
        font-weight: 500;
        fill: rgba(245, 243, 255, 0.6);
    }
    .us-val {
        font-size: 11px;
        font-weight: 700;
        fill: #f5f3ff;
    }
    .us-switch {
        stroke: rgba(245, 243, 255, 0.45);
        stroke-width: 1;
        stroke-dasharray: 3 3;
    }
    .us-bar.dm {
        fill: #8b5cf6;
    }
    .us-bar.nearby {
        fill: #0d9488;
    }
    .us-bar.notSplit {
        fill: url(#bot-usage-hatch);
        stroke: rgba(245, 243, 255, 0.22);
        stroke-width: 1;
    }
    .us-drills {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .us-drill {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 2px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    @media (hover: hover) {
        .us-drill:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .us-drill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .us-dico {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        color: rgba(255, 255, 255, 0.85);
    }
    .us-dtx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .us-dtx b {
        font-size: 14px;
        font-weight: 500;
    }
    .us-dtx span {
        overflow: hidden;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .us-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .us-chev {
        transform: rotate(90deg);
    }
    .us-fail {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .us-retry {
        min-height: 44px;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
</style>
