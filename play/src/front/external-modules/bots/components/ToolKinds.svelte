<script lang="ts">
    // What a server's tools do (prototype): each tool in one of four groups, with where that came from, and one choice
    // per group: runs right away, asks first, or off. A tool can be moved to another group. A group is only ever a
    // suggestion until someone who manages the bot reviews it.
    import PageChips from "./page/PageChips.svelte";
    import PageSegment from "./page/PageSegment.svelte";
    import type { KindedTool, ToolKind, ToolRun } from "../toolKindsModel";

    export let serverName: string;
    export let tools: KindedTool[];
    export let runs: Record<ToolKind, ToolRun>;
    /** A tool shown opened, with its group choices. */
    export let openTool: string | null = null;
    /** Who is looking, for "Reviewed by" once they accept the groups. */
    export let viewerName = "you";

    $: needsReview = tools.some((tool) => !tool.reviewedBy);

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
        return tool.reviewedBy ? `${suggested} · Reviewed by ${tool.reviewedBy}` : suggested;
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
        <div class="tk-m">Each tool is in the group that matches what it does. Tap a tool to move it.</div>
    </div>
    {#if needsReview}
        <div class="tk-review" data-testid="bot-tool-review">
            <div class="tk-t">Needs review</div>
            <div class="tk-m">
                The groups below are suggestions. Until you review them, only people who manage this bot can use these
                tools, and every use asks first.
            </div>
            <button type="button" class="tk-accept" on:click={acceptAll}>Use these groups</button>
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
                                <span class="tk-from" class:you={tool.from === "you"} class:new={!tool.reviewedBy}
                                    >{fromLine(tool)}</span
                                >
                            </button>
                            {#if opened}
                                <div class="tk-move">
                                    <span class="tk-m">This tool</span>
                                    <PageChips
                                        label="Group for {tool.title}"
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
