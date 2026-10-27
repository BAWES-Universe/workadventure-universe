<script lang="ts">
    // Tools: the bot's MCP servers, its Patience (how long it waits for a tool to answer before giving up), its longest
    // reply and steps (lower than its key's, Orbit #666), and whether people near it see which tool it calls.
    import { onMount } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotAiOptions, BotData } from "../../types";
    import { botApiService, type McpServer } from "../../services/BotApiService";
    import { DEFAULT_TOOL_TIMEOUT_SECONDS, showsToolCalls, withShowToolCalls } from "../../behaviorModel";
    import BotMcpServersEditor from "../BotMcpServersEditor.svelte";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import PageChips from "./PageChips.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import { durationChips, durationLabel } from "./duration";
    import { REPLY_CHOICES, STEP_CHOICES, ceilingFor, limitChips, tokensLabel } from "./replyLimits";
    import { IconTool } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;
    /** Room for a fifth choice (10 min) on a wide panel. */
    export let wide = false;
    /** How many tools the bot has, each time that is known or changes */
    export let onToolCount: ((count: number) => void) | undefined = undefined;
    /** What "Runs on" offers (loaded by the Mind group): each choice's longest reply and steps. */
    export let aiOptions: BotAiOptions | null = null;

    let servers: McpServer[] | undefined;
    $: if (servers) onToolCount?.(servers.length);

    onMount(() => {
        // The group's one-line summary names the tools while it is closed
        if (!botApiService.isInitialized()) return;
        const botId = bot.id;
        botApiService
            .getBotMcpServers(botId)
            .then((loaded) => {
                if (bot.id === botId && servers === undefined) servers = loaded;
            })
            .catch((e) => console.error("[ToolsGroup] Failed to load the bot's tools:", e));
    });

    $: page = $LL.mapEditor.edit.bots.page;
    $: patience = typeof bot.toolTimeoutSeconds === "number" ? bot.toolTimeoutSeconds : DEFAULT_TOOL_TIMEOUT_SECONDS;
    $: toolCalls = showsToolCalls(bot);
    $: choices = wide ? [15, 30, 90, 180, 600] : [15, 30, 90, 180];
    $: names =
        servers === undefined
            ? undefined
            : servers.length === 0
            ? page.tools.none()
            : servers.length <= 2
            ? servers.map((s) => s.name).join(", ")
            : page.tools.count({ count: servers.length });
    $: waits = page.tools.waits({ patience: durationLabel(patience) });
    $: brief = names ? `${names} · ${waits}` : waits;
    $: ceiling = ceilingFor(aiOptions, bot.aiProviderRef);
    $: replyLimit = limitChips(ceiling?.reply ?? null, REPLY_CHOICES, bot.maxReplyTokens, tokensLabel, page.tools);
    $: stepLimit = limitChips(ceiling?.steps ?? null, STEP_CHOICES, bot.maxSteps, String, page.tools);
</script>

<PageGroup id="tools" icon={IconTool} title={page.tools.title()} {brief} {open} {onToggle}>
    <BotMcpServersEditor botId={bot.id} onServers={(loaded) => (servers = loaded)} />
    <PageField title={page.tools.patience()} hint={page.tools.patienceHint()}>
        <PageChips
            label={page.tools.patience()}
            options={durationChips(choices, patience)}
            value={patience}
            onPick={(seconds) =>
                onChange({
                    ...bot,
                    toolTimeoutSeconds: seconds === DEFAULT_TOOL_TIMEOUT_SECONDS ? null : seconds,
                })}
        />
    </PageField>
    <PageField title={page.tools.longestReply()} hint={page.tools.longestReplyHint()}>
        <PageChips
            label={page.tools.longestReply()}
            options={replyLimit.options}
            value={replyLimit.value}
            onPick={(tokens) => onChange({ ...bot, maxReplyTokens: tokens || null })}
        />
    </PageField>
    <PageField title={page.tools.steps()} hint={page.tools.stepsHint()}>
        <PageChips
            label={page.tools.steps()}
            options={stepLimit.options}
            value={stepLimit.value}
            onPick={(steps) => onChange({ ...bot, maxSteps: steps || null })}
        />
    </PageField>
    <label class="bp-set" for="bot-show-tool-calls-{bot.id}">
        <span class="bp-tx">
            <span class="bp-t">{page.tools.showToolCalls()}</span>
            <span class="bp-m">{toolCalls ? page.tools.showToolCallsOn() : page.tools.showToolCallsOff()}</span>
        </span>
        <PageSwitch
            checked={toolCalls}
            label={page.tools.showToolCalls()}
            id="bot-show-tool-calls-{bot.id}"
            testId="bot-show-tool-calls"
            onChange={(show) => onChange(withShowToolCalls(bot, show))}
        />
    </label>
</PageGroup>

<style>
    /* A setting with a switch: the whole row is the tap area, 44 px tall like the bot page's other rows */
    .bp-set {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        cursor: pointer;
    }
    .bp-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .bp-t {
        font-size: 13px;
        font-weight: 600;
    }
    .bp-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
