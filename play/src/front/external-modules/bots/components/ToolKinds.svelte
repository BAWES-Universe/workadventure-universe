<script lang="ts">
    // What a server's tools do (prototype): each tool sits under one of four kinds of action, with where that came from,
    // and one choice per kind: runs right away, asks first, or off. A tool can be moved to another kind. A kind is only
    // ever a suggestion until someone who manages the bot confirms it.
    import PageChips from "./page/PageChips.svelte";
    import PageSegment from "./page/PageSegment.svelte";
    import type { KindedTool, ToolKind, ToolRun } from "../toolKindsModel";

    export let serverName: string;
    export let tools: KindedTool[];
    export let runs: Record<ToolKind, ToolRun>;
    /** A tool shown opened, with the kinds it can move to. */
    export let openTool: string | null = null;
    /** Who is looking, for "Confirmed by" once they confirm the tools. */
    export let viewerName = "you";
    /** Whether suggested kinds wait to be confirmed (off shows suggestions applying at once). */
    export let reviewRequired = true;
    /** A server from before kinds existed: it keeps working as it did in text until someone confirms its tools. */
    export let legacy = false;
    /** The bot's name: everyone who can chat with it can use this server's tools once they are confirmed. */
    export let botName = "this bot";

    $: needsReview = reviewRequired && tools.some((tool) => !tool.reviewedBy);

    const KINDS: Array<{ kind: ToolKind; title: string }> = [
        { kind: "look", title: "Looks things up" },
        { kind: "make", title: "Makes new things" },
        { kind: "change", title: "Changes things" },
        { kind: "send", title: "Deletes or sends out" },
    ];

    function runOptions(kind: ToolKind) {
        return [
            { value: "run" as ToolRun, label: "Right away", testId: `tool-run-${kind}` },
            { value: "ask" as ToolRun, label: "Asks first", testId: `tool-ask-${kind}` },
            { value: "off" as ToolRun, label: "Off", testId: `tool-off-${kind}` },
        ];
    }

    function fromLine(tool: KindedTool): string {
        if (tool.from === "you") return `Moved here by ${tool.reviewedBy ?? viewerName}`;
        const suggested = tool.from === "server" ? `Suggested by ${serverName}` : "Suggested from its description";
        return tool.reviewedBy ? `${suggested} · Confirmed by ${tool.reviewedBy}` : suggested;
    }

    function move(tool: KindedTool, kind: ToolKind) {
        tools = tools.map((one) =>
            one.name === tool.name ? { ...one, kind, from: "you", reviewedBy: viewerName } : one
        );
    }

    function acceptAll() {
        tools = tools.map((one) => (one.reviewedBy ? one : { ...one, reviewedBy: viewerName }));
    }
</script>

<div class="tk" data-testid="bot-tool-kinds">
    <div>
        <div class="tk-t">What its tools do</div>
        <div class="tk-m">Each tool sits under what it does. Tap a tool to move it.</div>
        {#if !needsReview && !legacy}
            <div class="tk-m" data-testid="bot-tool-audience">
                Everyone who can chat with {botName} can use these tools through {serverName}.
            </div>
        {/if}
    </div>
    {#if needsReview}
        <div class="tk-review" data-testid="bot-tool-review">
            <div class="tk-t">{legacy ? "Not checked yet" : "Check what each tool does"}</div>
            <div class="tk-m">
                {#if legacy}
                    This server works as it did before: in text chat its tools run right away for everyone who can
                    chat with the bot, and voice can't use them. Confirm what each tool does to use the settings below.
                {:else}
                    Below is what each tool seems to do. Until you confirm it, only people who manage this bot can
                    use these tools, and every use asks first. Once you confirm, everyone who can chat with
                    {botName} can use them through {serverName}.
                {/if}
            </div>
            <button type="button" class="tk-accept" on:click={acceptAll}>Confirm all tools</button>
        </div>
    {/if}
    {#each KINDS as group (group.kind)}
        {@const inGroup = tools.filter((tool) => tool.kind === group.kind)}
        {#if inGroup.length}
            <div class="tk-group" data-testid="bot-tool-kind-{group.kind}">
                <div class="tk-gt">{group.title} <span class="tk-count">{inGroup.length}</span></div>
                <PageSegment
                    label={group.title}
                    options={runOptions(group.kind)}
                    value={runs[group.kind]}
                    onPick={(run) => (runs = { ...runs, [group.kind]: run })}
                />
                <div class="tk-list">
                    {#each inGroup as tool (tool.name)}
                        {@const opened = openTool === tool.name}
                        <div class="tk-tool" class:opened>
                            <button
                                type="button"
                                class="tk-row"
                                aria-expanded={opened}
                                on:click={() => (openTool = opened ? null : tool.name)}
                            >
                                <span class="tk-name">{tool.title}</span>
                                <span class="tk-desc">{tool.description}</span>
                                <span class="tk-from" class:you={tool.from === "you"} class:new={reviewRequired && !tool.reviewedBy}
                                    >{fromLine(tool)}</span
                                >
                            </button>
                            {#if opened}
                                <div class="tk-move">
                                    <span class="tk-m">What this tool does</span>
                                    <PageChips
                                        label="What {tool.title} does"
                                        options={KINDS.map((k) => ({ value: k.kind, label: k.title }))}
                                        value={tool.kind}
                                        onPick={(kind) => move(tool, kind)}
                                    />
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    {/each}
</div>

<style>
    .tk {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .tk-t,
    .tk-gt {
        font-size: 13px;
        font-weight: 600;
    }
    .tk-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .tk-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .tk-count {
        margin-left: 4px;
        font-weight: 400;
        color: rgba(244, 242, 250, 0.55);
    }
    .tk-list {
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        overflow: hidden;
    }
    .tk-tool + .tk-tool {
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tk-row {
        display: flex;
        flex-direction: column;
        gap: 1px;
        width: 100%;
        min-height: 44px;
        padding: 8px 12px;
        border: 0;
        background: none;
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .tk-name {
        font-size: 13px;
        font-weight: 600;
    }
    .tk-desc {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.72);
    }
    .tk-from {
        font-size: 11.5px;
        color: rgba(244, 242, 250, 0.5);
    }
    .tk-from.you {
        color: #c4b5fd;
    }
    .tk-from.new {
        color: #fcd34d;
    }
    .tk-review {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(252, 211, 77, 0.08);
        box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.25);
    }
    .tk-accept {
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
        cursor: pointer;
    }
    .tk-accept:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .tk-move {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 0 12px 12px;
    }
    .tk-row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
</style>
