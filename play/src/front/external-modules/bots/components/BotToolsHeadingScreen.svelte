<script lang="ts">
    // One heading's page (game #1655, mock approved 3 Nov): what the heading covers, the choice for all its tools with a
    // line saying what it does, and the tools themselves. Tapping a tool opens where it can move; a moved tool follows
    // its new heading's choice. There is no search here: the server's page has the one. BotEditor puts the title and
    // the back circle up.
    import LL from "../../../../i18n/i18n-svelte";
    import type { BotData } from "../types";
    import { botToolsStore, chooseSetting, loadServerTools, moveTool } from "../stores/BotToolsStore";
    import {
        HEADINGS,
        SETTINGS,
        exampleHeading,
        toolLabel,
        toolsUnder,
        type Heading,
        type ServerTool,
        type Setting,
    } from "../toolsModel";
    import PageSegment from "./page/PageSegment.svelte";

    export let bot: BotData;
    export let serverId: string;
    export let heading: Heading | "unsorted";

    $: text = $LL.mapEditor.edit.bots.page.tools;
    $: botName = bot.name || "Bot";
    $: held = $botToolsStore && $botToolsStore.botId === bot.id ? $botToolsStore : undefined;
    $: serverName = held?.servers?.find((one) => one.id === serverId)?.name ?? "";
    $: data = held?.tools[serverId];
    $: tools = data ? toolsUnder(data.tools, heading) : [];

    // Fresh when the page opens: another person may have moved or confirmed a tool since the server's page loaded
    let loadedFor: string | undefined;
    $: if (`${bot.id}/${serverId}` !== loadedFor) {
        loadedFor = `${bot.id}/${serverId}`;
        loadServerTools(bot.id, serverId).catch((error) =>
            console.error("[BotToolsHeadingScreen] Failed to load the tools:", error)
        );
    }

    let opened: string | null = null;
    let moving = false;
    let moved: string | null = null;
    let problem: string | null = null;

    async function move(tool: ServerTool, to: Heading) {
        moving = true;
        problem = null;
        try {
            await moveTool(bot.id, serverId, tool.id, to);
            moved = text.moved({ tool: toolLabel(tool), heading: text.headings[to].title() });
            opened = null;
        } catch (error) {
            problem = error instanceof Error && error.message ? error.message : text.saveFailed();
        } finally {
            moving = false;
        }
    }

    async function choose(value: Setting) {
        if (heading === "unsorted") return;
        problem = null;
        try {
            await chooseSetting(bot.id, serverId, heading, value);
        } catch (error) {
            problem = error instanceof Error && error.message ? error.message : text.saveFailed();
        }
    }

    /** A person put it here: it sits under a heading other than the one suggested */
    function isMoved(tool: ServerTool): boolean {
        return tool.heading !== null && tool.heading !== tool.suggestedHeading;
    }

    function fromLine(tool: ServerTool): string {
        if (isMoved(tool)) return tool.movedBy ? text.movedBy({ name: tool.movedBy }) : text.movedNobody();
        const suggested = tool.suggestedHeading
            ? tool.suggestionSource === "description"
                ? text.suggestedDescription()
                : tool.suggestionSource === "builtIn"
                ? text.suggestedBuiltIn()
                : text.suggestedBy({ server: serverName })
            : text.notSorted();
        if (tool.state !== "confirmed") return `${suggested} · ${text.notConfirmedYet()}`;
        return `${suggested} · ${
            tool.confirmedBy ? text.confirmedBy({ name: tool.confirmedBy }) : text.confirmedNobody()
        }`;
    }

    $: others = HEADINGS.filter((one) => one !== heading);
</script>

<div class="th-screen" data-testid="bot-tools-heading-screen">
    <p class="th-line">{text.headings[heading].hint()}</p>
    {#if heading !== "unsorted" && data}
        <b class="th-when">{text.whenUses({ bot: botName, count: tools.length })}</b>
        <PageSegment
            label={text.whenUses({ bot: botName, count: tools.length })}
            value={data.settings[heading]}
            options={SETTINGS.map((setting) => ({
                value: setting,
                label: text.choices[setting](),
                testId: `bot-tools-page-choice-${setting}`,
            }))}
            onPick={choose}
        />
        <span class="th-effect">{text.effects[data.settings[heading]]()}</span>
    {/if}
    <div class="th-count">
        <b>{text.count({ count: tools.length })}</b>
        <span>{text.from({ server: serverName })}</span>
    </div>
    <p class="th-line">
        {heading === "unsorted"
            ? text.moveHintUnsorted()
            : text.moveHint({ example: text.headings[exampleHeading(heading)].title() })}
    </p>
    {#if moved}<p class="th-moved" role="status" data-testid="bot-tools-moved">{moved}</p>{/if}
    {#if problem}<p class="th-fail" role="alert">{problem}</p>{/if}
    <ul class="th-tools">
        {#each tools as tool (tool.id)}
            {@const open = opened === tool.id}
            <li class:open>
                <button
                    type="button"
                    class="th-tool"
                    aria-expanded={open}
                    data-testid="bot-tools-tool-{tool.name}"
                    on:click={() => (opened = open ? null : tool.id)}
                >
                    <b>{toolLabel(tool)}</b>
                    {#if tool.description}<span class="th-desc">{tool.description}</span>{/if}
                    <span class="th-from" class:moved={isMoved(tool)}>{fromLine(tool)}</span>
                </button>
                {#if open}
                    <div class="th-move" role="group" aria-label={text.moveTo()}>
                        <span>{text.moveTo()}</span>
                        {#each others as to (to)}
                            <button
                                type="button"
                                class="th-to"
                                disabled={moving}
                                data-testid="bot-tools-move-{to}"
                                on:click={() => move(tool, to)}>{text.headings[to].title()}</button
                            >
                        {/each}
                    </div>
                {/if}
            </li>
        {/each}
    </ul>
</div>

<style>
    .th-screen {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #fff;
    }
    .th-line {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.72);
    }
    .th-when {
        font-size: 14px;
        font-weight: 650;
    }
    .th-effect {
        padding: 0 6px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.72);
    }
    .th-count {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-top: 4px;
    }
    .th-count b {
        font-size: 14px;
        font-weight: 650;
    }
    .th-count span {
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
    }
    .th-tools {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        overflow: hidden;
    }
    .th-tools li + li {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .th-tools li.open {
        background: rgba(255, 255, 255, 0.04);
    }
    .th-tool {
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
        .th-tool:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .th-tool:focus-visible,
    .th-to:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .th-tool b {
        font-size: 14px;
        font-weight: 600;
    }
    .th-desc {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.72);
    }
    .th-from {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.52);
    }
    .th-from.moved {
        color: #c9b8ff;
    }
    .th-move {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 2px 12px 12px;
    }
    .th-move > span {
        flex: 1 0 100%;
        font-size: 12px;
        color: rgba(244, 242, 250, 0.64);
    }
    .th-to {
        min-height: 44px;
        margin: 0;
        padding: 0 14px;
        border: 1px solid rgba(243, 241, 250, 0.15);
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .th-to:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (hover: hover) {
        .th-to:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .th-moved {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: #c9b8ff;
    }
    .th-fail {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
</style>
