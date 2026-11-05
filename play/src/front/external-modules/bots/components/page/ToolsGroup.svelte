<script lang="ts">
    // Tools: the bot's MCP servers, its Patience (how long it waits for a tool to answer before giving up), its longest
    // reply and steps (lower than its key's, Orbit #666), and whether people near it see which tool it calls.
    import { onMount } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotAiOptions, BotData } from "../../types";
    import { botApiService, type McpServer } from "../../services/BotApiService";
    import { DEFAULT_TOOL_TIMEOUT_SECONDS, showsToolCalls, withShowToolCalls } from "../../behaviorModel";
    import BotMcpServersEditor from "../BotMcpServersEditor.svelte";
    import { shortName } from "../../modelPickerModel";
    import { botToolsStore, loadBotToolSettings } from "../../stores/BotToolsStore";
    import type { ToolsScreen } from "../../toolsModel";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import PageChips from "./PageChips.svelte";
    import PageSwitch from "./PageSwitch.svelte";
    import { durationChips, durationLabel } from "./duration";
    import {
        REPLY_CHOICES,
        STEP_CHOICES,
        ceilingFor,
        choicesUnder,
        limitChips,
        modelCapFor,
        tokensLabel,
    } from "./replyLimits";
    import { IconChevronDown, IconTool } from "@wa-icons";

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
    /** A server's row or Asking for approvals opens a screen of its own in place of the bot page */
    export let onOpenScreen: (screen: ToolsScreen) => void;

    let servers: McpServer[] | undefined;
    $: if (servers) onToolCount?.(servers.length);

    // Asking for approvals says what the bot does today on its row; shown with Orbit's default until it has answered
    let settingsFor: string | undefined;
    $: if (bot.id !== settingsFor) {
        settingsFor = bot.id;
        if (botApiService.isInitialized()) {
            loadBotToolSettings(bot.id).catch((e) => console.error("[ToolsGroup] Failed to load approvals:", e));
        }
    }
    $: approvals = $botToolsStore && $botToolsStore.botId === bot.id ? $botToolsStore.settings : undefined;
    $: approvalsBrief =
        approvals && approvals.askBeforeMaking === null
            ? page.tools.approvals.briefNoLimit()
            : page.tools.approvals.brief({ count: approvals?.askBeforeMaking ?? 5 });

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
    // A sign-in the bot server found lost leads the closed group's line (#1819)
    $: lost = (servers ?? []).filter((s) => s.signInLostAt);
    $: lostLine =
        lost.length === 1
            ? page.tools.needsSignIn({ server: lost[0].name })
            : lost.length > 1
            ? page.tools.needSignInMany({ count: lost.length })
            : "";
    $: brief = lostLine ? `${lostLine} · ${waits}` : names ? `${names} · ${waits}` : waits;
    // What the bot runs on, as the model's limit below finds it: Orbit's current pick when the bot has none saved
    $: ceiling = ceilingFor(aiOptions, bot.aiProviderRef ?? aiOptions?.current ?? undefined);
    // A model that writes less than the key allows is where the bot stops (Orbit #673): its limit is the first chip
    $: modelCap = modelCapFor(aiOptions, bot);
    $: stopsAtModel = modelCap !== null && (ceiling === null || modelCap.tokens < ceiling.reply) ? modelCap : null;
    $: replyLimit = stopsAtModel
        ? limitChips(stopsAtModel.tokens, choicesUnder(stopsAtModel.tokens), bot.maxReplyTokens, tokensLabel, {
              keysLimit: page.tools.keysLimit,
              keysLimitIs: page.tools.modelsLimitIs,
          })
        : limitChips(ceiling?.reply ?? null, REPLY_CHOICES, bot.maxReplyTokens, tokensLabel, page.tools);
    $: modelStops = stopsAtModel
        ? ceiling
            ? page.tools.modelStopsKey({
                  model: shortName(stopsAtModel.model),
                  limit: tokensLabel(stopsAtModel.tokens),
                  key: tokensLabel(ceiling.reply),
              })
            : page.tools.modelStops({ model: shortName(stopsAtModel.model), limit: tokensLabel(stopsAtModel.tokens) })
        : null;
    $: stepLimit = limitChips(ceiling?.steps ?? null, STEP_CHOICES, bot.maxSteps, String, page.tools);
</script>

<PageGroup id="tools" icon={IconTool} title={page.tools.title()} {brief} {open} {onToggle}>
    <BotMcpServersEditor
        botId={bot.id}
        onServers={(loaded) => (servers = loaded)}
        onOpenServer={(serverId) => onOpenScreen({ kind: "server", serverId })}
    />
    <button
        type="button"
        class="bp-drill"
        data-testid="bot-tools-approvals-row"
        on:click={() => onOpenScreen({ kind: "approvals" })}
    >
        <span class="bp-dtx">
            <b>{page.tools.approvals.title()}</b>
            <span>{approvalsBrief}</span>
        </span>
        <span class="bp-chev"><IconChevronDown font-size="18" /></span>
    </button>
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
        {#if modelStops}<div class="bp-stop" data-testid="bot-model-stops">{modelStops}</div>{/if}
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
    /* Asking for approvals: a title, one line under it and an arrow, like the rows around it; the whole row is one tap */
    .bp-drill {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-drill:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .bp-drill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bp-dtx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .bp-dtx b {
        font-size: 14px;
        font-weight: 600;
    }
    .bp-dtx span {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .bp-chev {
        transform: rotate(90deg);
    }
    /* Where the bot's model stops (Orbit #673): a quiet note under the chips, not a warning */
    .bp-stop {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.86);
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
    }
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
