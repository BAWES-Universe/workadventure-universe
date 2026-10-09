<script lang="ts">
    // Tools: the bot's MCP servers, and its Patience, how long it waits for a tool to answer before giving up.
    import { onMount } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import { botApiService, type McpServer } from "../../services/BotApiService";
    import { DEFAULT_TOOL_TIMEOUT_SECONDS } from "../../behaviorModel";
    import BotMcpServersEditor from "../BotMcpServersEditor.svelte";
    import PageGroup from "./PageGroup.svelte";
    import PageField from "./PageField.svelte";
    import PageChips from "./PageChips.svelte";
    import { durationChips, durationLabel } from "./duration";
    import { IconTool } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;
    /** Room for a fifth choice (10 min) on a wide panel. */
    export let wide = false;

    let servers: McpServer[] | undefined;

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
</PageGroup>
