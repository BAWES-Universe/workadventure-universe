<script lang="ts">
    // The screens Usage's rows open (Orbit #491, mock v4): who uses the bot, what it ran on, and its limits. They fill
    // the panel in place of the bot page; BotEditor puts the title and the back circle up.
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { BotData } from "../types";
    import { botUsageStore, loadBotUsage } from "../stores/BotUsageStore";
    import {
        compactNumber,
        dollars,
        whenLabel,
        whereKind,
        type BotUsage,
        type UsagePerson,
        type UsageRange,
        type UsageRanOn,
        type UsageScreen,
    } from "../usageModel";
    import PageSegment from "./page/PageSegment.svelte";
    import PageChips from "./page/PageChips.svelte";
    import PageNote from "./page/PageNote.svelte";
    import { IconAlertTriangle, IconSearch, IconUsers } from "@wa-icons";

    export let bot: BotData;
    export let screen: UsageScreen;

    $: text = $LL.mapEditor.edit.bots.page.usage;
    $: name = bot.name || "Bot";
    $: state = $botUsageStore && $botUsageStore.botId === bot.id ? $botUsageStore : undefined;
    $: usage = state?.data;
    $: range = state?.range ?? "7d";

    function pick(next: UsageRange) {
        if (next !== range) void loadBotUsage(bot.id, next);
    }

    let search = "";
    type Order = "replies" | "recent";
    let sort: Order = "replies";
    let sorts: Array<{ value: Order; label: string }>;
    $: sorts = [
        { value: "replies", label: text.mostReplies() },
        { value: "recent", label: text.mostRecent() },
    ];
    $: people = usage ? listed(usage.people, search, sort) : [];

    function listed(all: UsagePerson[], query: string, order: Order): UsagePerson[] {
        const q = query.trim().toLocaleLowerCase();
        const found = q ? all.filter((person) => (person.name ?? "").toLocaleLowerCase().includes(q)) : all;
        return order === "recent" ? [...found].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) : found;
    }

    function when(at: string): string {
        const label = whenLabel(at, $locale);
        if (label.kind === "today") return text.whenToday({ time: label.text });
        if (label.kind === "yesterday") return text.whenYesterday();
        return label.text;
    }

    function personLine(person: UsagePerson): string {
        const kind = whereKind(person);
        const where =
            kind === "both"
                ? text.whereBoth()
                : kind === "dm"
                ? text.whereDm()
                : kind === "nearby"
                ? text.whereNearby()
                : "";
        return where
            ? text.row({ replies: person.replies, where, when: when(person.lastAt) })
            : text.rowNoWhere({ replies: person.replies, when: when(person.lastAt) });
    }

    function guestsLine(data: BotUsage): string {
        const kind = whereKind(data.guests);
        if (kind === "dm" || kind === "nearby") {
            const where = kind === "dm" ? text.whereDm() : text.whereNearby();
            return text.guestsLineWhere({ replies: data.guests.replies, where });
        }
        return text.guestsLine({ replies: data.guests.replies });
    }

    /** A soft colour of its own for each person's circle, the same every time */
    function hue(id: string): number {
        let h = 0;
        for (const char of id) h = (h * 31 + char.charCodeAt(0)) % 360;
        return h;
    }

    function initial(person: UsagePerson): string {
        return (person.name ?? "?").trim().charAt(0).toLocaleUpperCase() || "?";
    }

    function ranOnTitle(line: UsageRanOn): string {
        return line.kind === "own-key" ? line.name || text.yourKey() : text.universeAi();
    }

    function ranOnLine(line: UsageRanOn, data: BotUsage): string {
        const last = data.ranOn[data.ranOn.length - 1] === line;
        const from = when(line.firstAt);
        const span = last ? text.since({ from }) : text.fromTo({ from, to: when(line.lastAt) });
        return text.keyLine({ span, replies: line.replies, tokens: compactNumber(line.tokens, $locale) });
    }

    function keyDownWhen(at: string): string {
        const label = whenLabel(at, $locale);
        if (label.kind === "today") return text.downToday({ time: label.text });
        if (label.kind === "yesterday") return text.downYesterday();
        return text.downOn({ day: label.text });
    }
</script>

<div class="us-screen" data-testid="bot-usage-screen-{screen}">
    <!-- Nobody has ever chatted with the bot: every range is zero, so there is nothing to switch -->
    {#if !usage || usage.hasUsage}
        <PageSegment
            label={text.range()}
            value={range}
            options={[
                { value: "today", label: text.today() },
                { value: "7d", label: text.week() },
                { value: "30d", label: text.month() },
            ]}
            onPick={pick}
        />
    {/if}
    {#if !usage}
        {#if state?.status === "failed"}
            <p class="us-fail" role="alert">
                {text.loadFailed()}
                <button type="button" class="us-retry" on:click={() => loadBotUsage(bot.id, range)}
                    >{text.retry()}</button
                >
            </p>
        {/if}
    {:else if screen === "people" && !usage.hasUsage}
        <p class="us-none" data-testid="bot-usage-people-fresh">{text.peopleFresh({ name })}</p>
        <PageNote>{text.namesOnly()}</PageNote>
    {:else if screen === "people"}
        <label class="us-search">
            <IconSearch font-size="16" />
            <input type="search" placeholder={text.search()} aria-label={text.search()} bind:value={search} />
        </label>
        <div class="us-sort">
            <span aria-hidden="true">{text.sortBy()}</span>
            <PageChips label={text.sortBy()} value={sort} options={sorts} onPick={(next) => (sort = next)} />
        </div>
        <ul class="us-people">
            {#each people as person (person.id)}
                <li class="us-pr">
                    <span class="us-av" style="--h:{hue(person.id)}" aria-hidden="true">{initial(person)}</span>
                    <span class="us-prtx"><b>{person.name || text.noName()}</b><span>{personLine(person)}</span></span>
                </li>
            {/each}
            {#if people.length === 0 && search.trim()}
                <li class="us-none">{text.noMatch()}</li>
            {/if}
            {#if usage.guests.count > 0 && !search.trim()}
                <li class="us-pr">
                    <span class="us-av guest" aria-hidden="true"><IconUsers font-size="16" /></span>
                    <span class="us-prtx"
                        ><b>{text.guests({ count: usage.guests.count })}</b><span>{guestsLine(usage)}</span></span
                    >
                </li>
            {/if}
        </ul>
        <PageNote>{text.namesOnly()}</PageNote>
    {:else if screen === "ranOn"}
        {#if usage.keyProblem}
            <div class="us-alert" role="status">
                <IconAlertTriangle font-size="16" />
                <span
                    ><b>{text.keyDown({ key: usage.keyProblem.name, when: keyDownWhen(usage.keyProblem.downSince) })}</b
                    >
                    {usage.keyProblem.meanwhile === "stopped"
                        ? text.keyDownRests({ name })
                        : text.keyDownMoved({ name })}</span
                >
            </div>
        {/if}
        <div class="us-rows">
            <!-- Keyed by place: two lines can share a kind and name (two deleted keys, or Universe AI before and after a key) -->
            {#each usage.ranOn as line, index (index)}
                <div class="us-row">
                    <span class="us-rowtx"><b>{ranOnTitle(line)}</b><span>{ranOnLine(line, usage)}</span></span>
                    {#if line.kind === "universe-ai"}
                        <strong class="free">{text.free()}</strong>
                    {:else if line.costMicros === null}
                        <strong class="free">{text.notKnown()}</strong>
                    {:else}
                        <strong>{text.about({ amount: dollars(line.costMicros, $locale) })}</strong>
                    {/if}
                </div>
            {:else}
                <p class="us-none">{usage.hasUsage ? text.ranOnNone() : text.ranOnFreshLine({ name })}</p>
            {/each}
        </div>
        <PageNote>{text.costNote()}</PageNote>
    {:else}
        <div class="us-rows">
            <div class="us-row block">
                <span class="us-rowtx">
                    <b>{text.universeAiLimit()}</b>
                    <span
                        >{text.universeAiLimitLine({
                            signedIn: usage.limits.universeAi.signedIn,
                            hours: usage.limits.universeAi.windowHours,
                            guest: usage.limits.universeAi.guest,
                            pool: usage.limits.universeAi.guestPool,
                            name,
                        })}</span
                    >
                    <span class="us-count">{text.ranOut({ count: usage.limits.ranOut.universeAi })}</span>
                    {#if usage.limits.askedMaker > 0}
                        <span class="us-count">{text.askedMaker({ count: usage.limits.askedMaker, name })}</span>
                    {/if}
                </span>
            </div>
            <div class="us-row block">
                <span class="us-rowtx">
                    <b>{text.botLimit({ name })}</b>
                    <span
                        >{usage.limits.botLimit
                            ? text.botLimitLine({ limit: usage.limits.botLimit })
                            : text.botLimitNone()}</span
                    >
                    {#if usage.limits.botLimit}
                        <span class="us-count">{text.reached({ count: usage.limits.ranOut.botLimit })}</span>
                    {/if}
                </span>
            </div>
        </div>
        <PageNote>{text.botLimitNote({ name })}</PageNote>
    {/if}
</div>

<style>
    .us-screen {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #fff;
    }
    .us-search {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(244, 242, 250, 0.66);
    }
    .us-search:focus-within {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .us-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13.5px;
        color: #fff;
        outline: none;
        box-shadow: none;
    }
    .us-sort {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .us-sort > span {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.66);
    }
    .us-people {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .us-pr {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 4px 2px;
    }
    .us-av {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        background: hsl(var(--h) 55% 42%);
    }
    .us-av.guest {
        color: rgba(244, 242, 250, 0.66);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .us-prtx,
    .us-rowtx {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .us-prtx b,
    .us-rowtx b {
        font-size: 13.5px;
        font-weight: 600;
    }
    .us-prtx span,
    .us-rowtx span {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.66);
    }
    .us-prtx span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .us-rowtx .us-count {
        color: #fff;
        margin-top: 4px;
    }
    .us-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .us-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
    }
    .us-row strong {
        flex: none;
        font-size: 13.5px;
        font-variant-numeric: tabular-nums;
    }
    .us-row strong.free {
        font-weight: 600;
        color: rgba(244, 242, 250, 0.66);
    }
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
    .us-none {
        margin: 0;
        padding: 8px 2px;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.66);
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
