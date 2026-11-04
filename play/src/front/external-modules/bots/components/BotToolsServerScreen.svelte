<script lang="ts">
    // One MCP server's page (game #1655, mock approved 3 Nov): its address and actions, its tools sorted under four
    // headings, one choice per heading (Right away, Asks first or Off) and one search for all of its tools. A heading's
    // row opens the page with that heading's tools. BotEditor puts the title and the back circle up.
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotData } from "../types";
    import { botToolsStore, chooseSetting, confirmAllTools, loadServerTools } from "../stores/BotToolsStore";
    import {
        SETTINGS,
        briefNames,
        headingOf,
        searchTools,
        toCheck,
        toolLabel,
        toolsUnder,
        usedHeadings,
        type Heading,
        type ServerTool,
        type Setting,
    } from "../toolsModel";
    import BotMcpServersEditor from "./BotMcpServersEditor.svelte";
    import PageSegment from "./page/PageSegment.svelte";
    import PageButton from "./page/PageButton.svelte";
    import PageNote from "./page/PageNote.svelte";
    import { IconChevronDown, IconSearch } from "@wa-icons";

    export let bot: BotData;
    export let serverId: string;
    export let onOpenHeading: (heading: Heading | "unsorted") => void;
    /** The server was removed from here: back to the bot page */
    export let onGone: () => void;

    $: text = $LL.mapEditor.edit.bots.page.tools;
    $: botName = bot.name || "Bot";
    $: held = $botToolsStore && $botToolsStore.botId === bot.id ? $botToolsStore : undefined;
    $: server = held?.servers?.find((one) => one.id === serverId);
    $: data = held?.tools[serverId];
    $: tools = data?.tools ?? [];
    $: serverName = server?.name ?? "";
    $: waiting = toCheck(tools);
    // A server from before tools were checked says so; until then it keeps working in text as it did
    $: unchecked = data?.state === "notCheckedYet";
    $: needsConfirm = tools.length > 0 && (unchecked || waiting > 0);
    // What the banner is about: every tool of an old server, else the ones still waiting. With only one, it is named.
    $: checking = unchecked ? tools : tools.filter((tool) => tool.state !== "confirmed");
    $: onlyTool = checking.length === 1 ? toolLabel(checking[0]) : undefined;
    $: headings = usedHeadings(tools);

    // Read when the page opens: another person may have moved or confirmed a tool since the list was last loaded
    let loadFailed = false;
    let loadedFor: string | undefined;
    $: if (`${bot.id}/${serverId}` !== loadedFor) {
        loadedFor = `${bot.id}/${serverId}`;
        retry();
    }
    function retry() {
        loadFailed = false;
        loadServerTools(bot.id, serverId).catch((error) => {
            console.error("[BotToolsServerScreen] Failed to load the tools:", error);
            loadFailed = true;
        });
    }

    let query = "";
    $: found = searchTools(tools, query);

    let confirming = false;
    let problem: string | null = null;
    async function confirmAll() {
        confirming = true;
        problem = null;
        try {
            await confirmAllTools(bot.id, serverId);
        } catch (error) {
            problem = error instanceof Error && error.message ? error.message : text.confirmFailed();
        } finally {
            confirming = false;
        }
    }

    async function choose(heading: Heading, value: Setting) {
        problem = null;
        try {
            await chooseSetting(bot.id, serverId, heading, value);
        } catch (error) {
            problem = error instanceof Error && error.message ? error.message : text.saveFailed();
        }
    }

    function headingTitle(heading: Heading | "unsorted"): string {
        return text.headings[heading].title();
    }
    function choiceLabel(setting: Setting): string {
        return text.choices[setting]();
    }
    /** The first names, which may be cut short, and "+N more", which never is */
    function namesOf(under: ServerTool[]): { names: string; more: string } {
        const { names, more } = briefNames(under);
        return { names: names.join(", "), more: more > 0 ? text.moreNames({ count: more }) : "" };
    }
    function whereLine(tool: ServerTool): string {
        const heading = headingOf(tool);
        if (!heading || !data) return text.notSorted();
        return text.searchWhere({ heading: headingTitle(heading), choice: choiceLabel(data.settings[heading]) });
    }
</script>

<div class="ts-screen" data-testid="bot-tools-server">
    <BotMcpServersEditor botId={bot.id} onlyServerId={serverId} onRemoved={onGone} />

    {#if !server}
        <!-- The server list is still loading, or the server is gone -->
    {:else if !data}
        {#if loadFailed}
            <p class="ts-fail" role="alert">
                {text.loadFailed()}
                <button type="button" class="ts-retry" on:click={retry}>{text.retry()}</button>
            </p>
        {/if}
    {:else if tools.length === 0}
        <PageNote>{text.notSortedYet({ server: serverName })}</PageNote>
    {:else}
        {#if needsConfirm}
            <section class="ts-check" data-testid="bot-tools-confirm">
                <b
                    >{onlyTool
                        ? text.checkTitleOne({ tool: onlyTool })
                        : text.checkTitle({ server: serverName, count: checking.length })}</b
                >
                <p>
                    {unchecked ? text.checkOldLine({ server: serverName }) : text.checkLine({ server: serverName })}
                </p>
                <PageButton go tall testId="bot-tools-confirm-all" disabled={confirming} on:click={confirmAll}
                    >{confirming
                        ? text.confirming()
                        : onlyTool
                        ? text.confirmOne({ tool: onlyTool })
                        : text.confirmAll()}</PageButton
                >
            </section>
        {/if}
        {#if problem}<p class="ts-fail" role="alert">{problem}</p>{/if}
        <p class="ts-line">
            {text.sorted({ server: serverName, tools: text.count({ count: tools.length }), bot: botName })}
        </p>
        <label class="ts-search">
            <IconSearch font-size="18" />
            <input
                type="search"
                data-testid="bot-tools-search"
                placeholder={text.search({ count: tools.length, server: serverName })}
                aria-label={text.search({ count: tools.length, server: serverName })}
                bind:value={query}
            />
        </label>
        {#if query.trim()}
            <p class="ts-line" data-testid="bot-tools-search-count">
                {found.length === 0
                    ? text.searchNone()
                    : text.searchMatches({ found: found.length, count: tools.length })}
            </p>
            {#if found.length > 0}
                <ul class="ts-found">
                    {#each found as tool (tool.id)}
                        <li>
                            <button
                                type="button"
                                class="ts-result"
                                on:click={() => onOpenHeading(headingOf(tool) ?? "unsorted")}
                            >
                                <b>{toolLabel(tool)}</b>
                                {#if tool.description}<span class="ts-desc">{tool.description}</span>{/if}
                                <span class="ts-where">{whereLine(tool)}</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        {:else}
            {#each headings as heading (heading)}
                {@const under = toolsUnder(tools, heading)}
                {@const checking = toCheck(under)}
                <section class="ts-card" data-testid="bot-tools-heading-{heading}">
                    <b class="ts-title">{headingTitle(heading)}</b>
                    <span class="ts-hint">{text.headings[heading].hint()}</span>
                    {#if heading !== "unsorted"}
                        <PageSegment
                            label={headingTitle(heading)}
                            value={data.settings[heading]}
                            options={SETTINGS.map((setting) => ({
                                value: setting,
                                label: choiceLabel(setting),
                                testId: `bot-tools-choice-${heading}-${setting}`,
                            }))}
                            onPick={(value) => choose(heading, value)}
                        />
                        <span class="ts-effect">{text.effects[data.settings[heading]]()}</span>
                    {/if}
                    <button
                        type="button"
                        class="ts-row"
                        data-testid="bot-tools-open-{heading}"
                        on:click={() => onOpenHeading(heading)}
                    >
                        <span class="ts-rowtx">
                            <span class="ts-count"
                                >{text.count({ count: under.length })}{#if checking > 0}<span class="ts-warn">
                                        {text.toCheck({ count: checking })}</span
                                    >{/if}</span
                            >
                            <span class="ts-namesrow"
                                ><span class="ts-names">{namesOf(under).names}</span>{#if namesOf(under).more}<span
                                        class="ts-more">{namesOf(under).more}</span
                                    >{/if}</span
                            >
                        </span>
                        <span class="ts-chev"><IconChevronDown font-size="18" /></span>
                    </button>
                </section>
            {/each}
        {/if}
    {/if}
</div>

<style>
    .ts-screen {
        display: flex;
        flex-direction: column;
        gap: 12px;
        color: #fff;
    }
    .ts-line {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.72);
    }
    .ts-check {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(251, 191, 36, 0.08);
        box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35);
    }
    .ts-check b {
        font-size: 14px;
        font-weight: 600;
    }
    .ts-check p {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.72);
    }
    .ts-search {
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
    .ts-search:focus-within {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .ts-search input {
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
    /* A heading: its name and what it covers, the choice, what the choice does, then one row for its tools */
    .ts-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 12px 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
    }
    .ts-title {
        font-size: 14px;
        font-weight: 650;
    }
    .ts-hint {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .ts-effect {
        padding: 0 6px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.72);
    }
    /* The whole row is one tap: the count, the first names and the arrow. Nothing in it looks like a button. */
    .ts-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: calc(100% + 12px);
        min-height: 52px;
        margin: 0 -6px;
        padding: 6px 6px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .ts-row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .ts-row:focus-visible,
    .ts-result:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .ts-rowtx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .ts-count {
        font-size: 14px;
        font-weight: 600;
    }
    .ts-warn {
        margin-inline-start: 8px;
        font-size: 12.5px;
        font-weight: 600;
        color: #fbbf24;
    }
    .ts-namesrow {
        display: flex;
        gap: 4px;
        min-width: 0;
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
        white-space: nowrap;
    }
    .ts-names {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .ts-more {
        flex: none;
    }
    .ts-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .ts-chev {
        transform: rotate(90deg);
    }
    .ts-found {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        overflow: hidden;
    }
    .ts-found li + li {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .ts-result {
        display: flex;
        flex-direction: column;
        gap: 1px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 9px 12px;
        border: 0;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .ts-result:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .ts-result b {
        font-size: 14px;
        font-weight: 600;
    }
    .ts-desc,
    .ts-where {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.72);
    }
    .ts-where {
        color: rgba(244, 242, 250, 0.52);
    }
    .ts-fail {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .ts-retry {
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
