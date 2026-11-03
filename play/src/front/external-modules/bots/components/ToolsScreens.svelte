<script lang="ts">
    // Prototype (mock 1 redo): Tools on inner screens, so a bot with many servers and tools stays short.
    // Server screen: its address and actions, then its four headings, each with its setting and a count that opens
    // the heading's own screen. Heading screen: that heading's tools, searchable, each one movable. "When it asks
    // first" holds the asking settings. Design B opens a heading's tools in place; design C sorts by heading first.
    import { onDestroy, onMount } from "svelte";
    import { botApiService, type McpServer } from "../services/BotApiService";
    import type { KindedTool, ToolKind, ToolRun, ToolsScreen } from "../toolKindsModel";
    import PageSegment from "./page/PageSegment.svelte";
    import PageChips from "./page/PageChips.svelte";
    import PageField from "./page/PageField.svelte";
    import { IconChevronRight, IconSearch, IconTool } from "@wa-icons";

    export let botId: string;
    export let screen: ToolsScreen;
    export let onClose: () => void;
    /** Which design is shown: a (inner screens), b (in place), c (by heading first) */
    export let design: "a" | "b" | "c" = "a";
    export let viewerName = "Khalid";
    export let botName = "The bot";

    let stack: ToolsScreen[] = [screen];
    $: current = stack[stack.length - 1];
    function go(next: ToolsScreen) {
        stack = [...stack, next];
        search = "";
        openTool = null;
    }
    function back() {
        if (stack.length <= 1) onClose();
        else stack = stack.slice(0, -1);
        search = "";
        openTool = null;
    }

    let servers: McpServer[] = [];
    onMount(() => {
        void botApiService.getBotMcpServers(botId).then((loaded) => (servers = loaded));
        window.addEventListener("mock-back", back);
        const q = new URLSearchParams(location.search);
        // Shots open deeper screens straight away
        const kind = q.get("kind") as ToolKind | null;
        if (kind && current.k === "server") stack = [...stack, { k: "heading", id: current.id, kind }];
        search = q.get("q") ?? "";
        openTool = q.get("tool");
    });
    onDestroy(() => window.removeEventListener("mock-back", back));

    $: server = current.k === "server" || current.k === "heading" ? servers.find((s) => s.id === current.id) : undefined;
    $: tools = (server?.toolKinds?.tools ?? []) as KindedTool[];
    $: legacy = server?.toolKinds?.legacy ?? false;
    $: unconfirmed = tools.filter((t) => !t.reviewedBy);
    $: changed = tools.filter((t) => t.changedSince && !t.reviewedBy);

    // The title in the panel's header, like the other inner screens
    $: title =
        current.k === "asking"
            ? "Checking with people"
            : current.k === "kind"
            ? KIND_TITLE[current.kind]
            : current.k === "heading"
            ? `${server?.name ?? ""} · ${KIND_TITLE[current.kind]}`
            : server?.name ?? "";
    $: if (typeof document !== "undefined") {
        const t = document.getElementById("title");
        if (t) t.textContent = title;
    }

    const KINDS: ToolKind[] = ["look", "make", "change", "send"];
    const KIND_TITLE: Record<ToolKind, string> = {
        look: "Looks things up",
        make: "Makes new things",
        change: "Changes things",
        send: "Deletes or sends out",
    };
    const KIND_HINT: Record<ToolKind, string> = {
        look: "Reads and finds things. Changes nothing.",
        make: "Makes something new, like an image or a song",
        change: "Creates or edits things in another app, like a Linear issue",
        send: "Deletes things, or sends email and messages outside Universe",
    };
    function runOptions(kind: ToolKind) {
        return [
            { value: "run" as ToolRun, label: "Right away", testId: `tool-run-${kind}` },
            { value: "ask" as ToolRun, label: "Asks first", testId: `tool-ask-${kind}` },
            { value: "off" as ToolRun, label: "Off", testId: `tool-off-${kind}` },
        ];
    }
    function setRun(target: McpServer, kind: ToolKind, run: ToolRun) {
        if (!target.toolKinds) return;
        target.toolKinds.runs = { ...target.toolKinds.runs, [kind]: run };
        servers = servers;
    }
    function fromLine(target: McpServer, tool: KindedTool): string {
        if (tool.changedSince && !tool.reviewedBy) return `Changed since ${tool.changedSince} confirmed it · not confirmed yet`;
        if (tool.from === "you") return `Moved here by ${tool.reviewedBy ?? viewerName}`;
        const suggested = tool.from === "server" ? `Suggested by ${target.name}` : "Suggested from its description";
        return tool.reviewedBy ? `${suggested} · Confirmed by ${tool.reviewedBy}` : suggested;
    }
    function move(target: McpServer, tool: KindedTool, kind: ToolKind) {
        if (!target.toolKinds) return;
        target.toolKinds.tools = target.toolKinds.tools.map((one) =>
            one.name === tool.name ? { ...one, kind, from: "you", reviewedBy: viewerName } : one
        );
        servers = servers;
    }
    function confirmAll(target: McpServer) {
        if (!target.toolKinds) return;
        target.toolKinds.tools = target.toolKinds.tools.map((one) => (one.reviewedBy ? one : { ...one, reviewedBy: viewerName }));
        target.toolKinds.legacy = false;
        servers = servers;
    }
    function toCheck(list: KindedTool[]): number {
        return list.filter((t) => !t.reviewedBy).length;
    }
    function matches(tool: KindedTool, q: string): boolean {
        const s = q.trim().toLocaleLowerCase();
        return !s || tool.title.toLocaleLowerCase().includes(s) || tool.description.toLocaleLowerCase().includes(s);
    }

    let search = "";
    let openTool: string | null = null;
    /** Design B: the headings opened in place */
    let shown: Partial<Record<ToolKind, boolean>> = {};
    $: if (design === "b" && typeof location !== "undefined") {
        const k = new URLSearchParams(location.search).get("open") as ToolKind | null;
        if (k && shown[k] === undefined) shown = { ...shown, [k]: true };
    }

    // "When it asks first" (prototype values, recommended defaults picked)
    let direction = "rarely";
    let batch = 5;
    let wait = 10;
    let quiet = 60;
    let most = 8;
    let allowedChats = 2;
</script>

{#if current.k === "asking"}
    <div class="ts" data-testid="tools-asking">
        <p class="ts-lead">Before {botName} changes, deletes or sends something with its tools, it shows the person a card and waits for their tap. These set how long it waits and when else it asks.</p>
        <PageField title="Waits for a tap" hint="If nobody answers the card, it does nothing and says so">
            <PageChips
                label="Waits for a tap"
                options={[{ value: 5, label: "5 min" }, { value: 10, label: "10 min" }, { value: 30, label: "30 min" }]}
                value={wait}
                onPick={(v) => (wait = v)}
            />
        </PageField>
        <PageField title="Asks before making more than" hint="The same kind of thing, like images or songs, in one request">
            <PageChips
                label="Asks before making more than"
                options={[{ value: 3, label: "3" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: 0, label: "No limit" }]}
                value={batch}
                onPick={(v) => (batch = v)}
            />
        </PageField>
        <PageField
            title="Asks which way to go"
            hint="Before a long or costly job that could go very different ways. Otherwise it picks and says what it picked."
        >
            <PageChips
                label="Asks which way to go"
                options={[{ value: "rarely", label: "Rarely" }, { value: "big", label: "Before bigger jobs" }, { value: "never", label: "Never" }]}
                value={direction}
                onPick={(v) => (direction = v)}
            />
        </PageField>
        <div class="ts-sec">“Allow more”</div>
        <p class="ts-m">A card can offer “allow more of the same in this chat”. It ends when the person leaves, or:</p>
        <PageField title="When they're quiet for" hint="They send nothing in that chat for this long">
            <PageChips
                label="When they're quiet for"
                options={[{ value: 30, label: "30 min" }, { value: 60, label: "1 hour" }, { value: 120, label: "2 hours" }]}
                value={quiet}
                onPick={(v) => (quiet = v)}
            />
        </PageField>
        <PageField title="After at most" hint="Even in a busy chat">
            <PageChips
                label="After at most"
                options={[{ value: 4, label: "4 hours" }, { value: 8, label: "8 hours" }, { value: 24, label: "24 hours" }]}
                value={most}
                onPick={(v) => (most = v)}
            />
        </PageField>
        <div class="ts-set" data-testid="bot-allowed-more">
            <span class="ts-tx">
                <span class="ts-t">Allowed more right now</span>
                <span class="ts-m"
                    >{allowedChats
                        ? "Khalid: more WEB issues in Linear · Omar: more MAP issues in Linear"
                        : "Nobody. Every change asks first."}</span
                >
            </span>
            {#if allowedChats}
                <button type="button" class="ts-end" on:click={() => (allowedChats = 0)}>End all</button>
            {/if}
        </div>
    </div>
{:else if current.k === "kind"}
    <!-- Design C: one heading across every server -->
    <div class="ts" data-testid="tools-kind">
        <p class="ts-lead">{KIND_HINT[current.kind]}. Each server keeps its own setting.</p>
        {#each servers.filter((s) => s.toolKinds?.tools.some((t) => t.kind === current.kind)) as s (s.id)}
            {@const list = (s.toolKinds?.tools ?? []).filter((t) => t.kind === current.kind)}
            <div class="ts-card">
                <div class="ts-ct">{s.name} <span class="ts-count">{list.length}</span></div>
                <PageSegment
                    label="{s.name}: {KIND_TITLE[current.kind]}"
                    options={runOptions(current.kind)}
                    value={s.toolKinds?.runs[current.kind] ?? "ask"}
                    onPick={(run) => setRun(s, current.kind, run)}
                />
                <div class="ts-list">
                    {#each list as tool (tool.name)}
                        <div class="ts-tool">
                            <span class="ts-name">{tool.title}</span>
                            <span class="ts-desc">{tool.description}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
{:else if server}
    <div class="ts" data-testid="tools-{current.k}">
        {#if current.k === "server"}
            <!-- The panel title already names the server, so this says only how it is -->
            <div class="ts-state"><i class="ts-dot" />Connected · {tools.length} tools</div>
            <div class="ts-url">{server.serverUrl}</div>
            <div class="ts-actions">
                <button type="button" class="ts-chip">Test server</button>
                <button type="button" class="ts-chip">Edit server</button>
                <button type="button" class="ts-chip ts-bad">Remove server</button>
            </div>
            {#if legacy || unconfirmed.length}
                <div class="ts-review" data-testid="bot-tool-review">
                    <div class="ts-t">
                        {legacy
                            ? "Not checked yet"
                            : changed.length && changed.length === unconfirmed.length
                            ? `${changed.length} tool changed`
                            : `Check what ${unconfirmed.length === 1 ? "this tool does" : `these ${unconfirmed.length} tools do`}`}
                    </div>
                    <div class="ts-m">
                        {#if legacy}
                            Added before tools had headings. In text chat its tools still run right away for everyone who
                            can chat with the bot, and voice can't use them. Look over the headings below, then confirm.
                        {:else if changed.length && changed.length === unconfirmed.length}
                            {server.name} changed what {changed.map((t) => t.title).join(", ")} says it does: “{changed[0]
                                .description}”. Until you confirm it again, only people who manage this bot can use it, and
                            every use asks first.
                        {:else}
                            Each tool below sits where {server.name} or its description suggests. Until you confirm, only
                            people who manage this bot can use them, and every use asks first.
                        {/if}
                    </div>
                    <button type="button" class="ts-accept" on:click={() => server && confirmAll(server)}
                        >{legacy || unconfirmed.length > 1 ? "Confirm all tools" : "Confirm it"}</button
                    >
                </div>
            {/if}
            <label class="ts-search">
                <IconSearch font-size="16" />
                <input type="search" placeholder="Find a tool in {server.name}" aria-label="Find a tool" bind:value={search} />
            </label>
            {#if search.trim()}
                {@const found = tools.filter((t) => matches(t, search))}
                <div class="ts-m">{found.length} found</div>
                <div class="ts-list">
                    {#each found as tool (tool.name)}
                        {@const opened = openTool === tool.name}
                        <div class="ts-tool">
                            <button type="button" class="ts-row" on:click={() => (openTool = opened ? null : tool.name)}>
                                <span class="ts-name">{tool.title}</span>
                                <span class="ts-desc">{tool.description}</span>
                                <span class="ts-from">{KIND_TITLE[tool.kind]} · {server.toolKinds?.runs[tool.kind] === "run" ? "Right away" : server.toolKinds?.runs[tool.kind] === "ask" ? "Asks first" : "Off"}</span>
                            </button>
                            {#if opened}
                                <div class="ts-move">
                                    <span class="ts-m">What this tool does</span>
                                    <PageChips
                                        label="What {tool.title} does"
                                        options={KINDS.map((k) => ({ value: k, label: KIND_TITLE[k] }))}
                                        value={tool.kind}
                                        onPick={(kind) => server && move(server, tool, kind)}
                                    />
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else}
                {#each KINDS as kind (kind)}
                    {@const list = tools.filter((t) => t.kind === kind)}
                    {#if list.length}
                        <div class="ts-card" data-testid="tools-heading-{kind}">
                            <div class="ts-ct">{KIND_TITLE[kind]}</div>
                            <div class="ts-m">{KIND_HINT[kind]}</div>
                            <PageSegment
                                label={KIND_TITLE[kind]}
                                options={runOptions(kind)}
                                value={server.toolKinds?.runs[kind] ?? "ask"}
                                onPick={(run) => server && setRun(server, kind, run)}
                            />
                            {#if design === "b" && shown[kind]}
                                <div class="ts-list">
                                    {#each list as tool (tool.name)}
                                        <div class="ts-tool">
                                            <span class="ts-name">{tool.title}</span>
                                            <span class="ts-desc">{tool.description}</span>
                                            <span class="ts-from" class:new={!tool.reviewedBy}>{fromLine(server, tool)}</span>
                                        </div>
                                    {/each}
                                </div>
                                <button type="button" class="ts-open" on:click={() => (shown = { ...shown, [kind]: false })}
                                    >Hide tools</button
                                >
                            {:else}
                                <button
                                    type="button"
                                    class="ts-open"
                                    data-testid="tools-open-{kind}"
                                    on:click={() =>
                                        design === "b"
                                            ? (shown = { ...shown, [kind]: true })
                                            : server && go({ k: "heading", id: server.id, kind })}
                                >
                                    <span class="ts-tx">
                                        <span>{list.length} {list.length === 1 ? "tool" : "tools"}</span>
                                        {#if toCheck(list)}<span class="ts-warn">{toCheck(list)} to check</span>{/if}
                                    </span>
                                    <IconChevronRight font-size="18" />
                                </button>
                            {/if}
                        </div>
                    {/if}
                {/each}
            {/if}
        {:else}
            {@const kind = current.kind}
            {@const list = tools.filter((t) => t.kind === kind)}
            <p class="ts-lead">{KIND_HINT[kind]}</p>
            <PageSegment
                label={KIND_TITLE[kind]}
                options={runOptions(kind)}
                value={server.toolKinds?.runs[kind] ?? "ask"}
                onPick={(run) => server && setRun(server, kind, run)}
            />
            {#if list.length > 8}
                <label class="ts-search">
                    <IconSearch font-size="16" />
                    <input type="search" placeholder="Find one of {list.length} tools" aria-label="Find a tool" bind:value={search} />
                </label>
            {/if}
            <div class="ts-m">Tap a tool to move it to another heading.</div>
            <div class="ts-list">
                {#each list.filter((t) => matches(t, search)) as tool (tool.name)}
                    {@const opened = openTool === tool.name}
                    <div class="ts-tool">
                        <button type="button" class="ts-row" aria-expanded={opened} on:click={() => (openTool = opened ? null : tool.name)}>
                            <span class="ts-name">{tool.title}</span>
                            <span class="ts-desc">{tool.description}</span>
                            <span class="ts-from" class:you={tool.from === "you"} class:new={!tool.reviewedBy}
                                >{fromLine(server, tool)}</span
                            >
                        </button>
                        {#if opened}
                            <div class="ts-move">
                                <span class="ts-m">What this tool does</span>
                                <PageChips
                                    label="What {tool.title} does"
                                    options={KINDS.map((k) => ({ value: k, label: KIND_TITLE[k] }))}
                                    value={tool.kind}
                                    onPick={(next) => server && move(server, tool, next)}
                                />
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .ts {
        display: flex;
        flex-direction: column;
        gap: 12px;
        color: #fff;
    }
    .ts-lead {
        margin: 0;
        font-size: 13px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.72);
    }
    .ts-hd {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
    }
    .ts-ico {
        position: relative;
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .ts-state {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.8);
    }
    .ts-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #4ade80;
    }
    .ts-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .ts-t,
    .ts-ct,
    .ts-sec {
        font-size: 13px;
        font-weight: 600;
    }
    .ts-hd .ts-t {
        font-size: 15px;
    }
    .ts-sec {
        margin-top: 4px;
        font-size: 14px;
    }
    .ts-count {
        margin-left: 4px;
        font-weight: 400;
        color: rgba(244, 242, 250, 0.55);
    }
    .ts-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    p.ts-m {
        margin: 0;
    }
    .ts-url {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.55);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .ts-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .ts-chip {
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
    }
    .ts-chip.ts-bad {
        color: #fca5a5;
    }
    .ts-review {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(252, 211, 77, 0.08);
        box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.25);
    }
    .ts-accept {
        align-self: flex-start;
        min-height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
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
    .ts-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
    }
    .ts-open {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 4px 0 2px;
        border: 0;
        background: none;
        color: #fff;
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
    }
    .ts-open .ts-tx {
        flex-direction: row;
        gap: 10px;
        align-items: baseline;
    }
    .ts-warn {
        font-size: 12.5px;
        font-weight: 600;
        color: #fcd34d;
    }
    .ts-list {
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        overflow: hidden;
    }
    .ts-card .ts-list {
        background: rgba(255, 255, 255, 0.03);
    }
    .ts-tool {
        display: flex;
        flex-direction: column;
    }
    .ts-card .ts-tool,
    .ts-tool > .ts-row {
        padding: 8px 12px;
    }
    .ts-tool + .ts-tool {
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ts-row {
        display: flex;
        flex-direction: column;
        gap: 1px;
        width: 100%;
        min-height: 44px;
        border: 0;
        background: none;
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .ts-name {
        font-size: 13px;
        font-weight: 600;
    }
    .ts-desc {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.72);
    }
    .ts-from {
        font-size: 11.5px;
        color: rgba(244, 242, 250, 0.5);
    }
    .ts-from.you {
        color: #c4b5fd;
    }
    .ts-from.new {
        color: #fcd34d;
    }
    .ts-move {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 12px 12px;
    }
    .ts-set {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
    }
    .ts-end {
        flex: none;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        font-size: 13px;
        font-weight: 600;
        color: #fca5a5;
    }
</style>
