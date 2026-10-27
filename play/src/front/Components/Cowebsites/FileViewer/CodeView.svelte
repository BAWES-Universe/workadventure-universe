<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { colorLines, loadHighlighter, type CodeKind } from "../../../FileViewer/codeHighlight";
    import { IconCheck, IconCopy } from "@wa-icons";

    /**
     * The lines shown, numbered (the first ones when the code is cut). Given as lines, not as text: a blank line that
     * closes the file stays a row of its own.
     */
    export let lines: string[];
    /** What Copy puts on the clipboard, when it is not the code shown: the whole text as written. */
    export let copyText: string | undefined = undefined;
    /** The language it is colored as, and the name shown over it. */
    export let codeKind: CodeKind;
    /** The number of lines the whole text has, when more than are shown. */
    export let totalLines: number | undefined = undefined;

    let colored: string[] | undefined;
    let copyState: "idle" | "copied" | "failed" = "idle";
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;
    let body: HTMLDivElement | undefined;

    onDestroy(() => {
        destroyed = true;
        if (copyTimer) clearTimeout(copyTimer);
    });

    $: shown = lines.join("\n");
    $: lineCount = totalLines ?? lines.length;
    // Line numbers keep one width, from the widest number.
    $: numberWidth = `${String(lines.length).length}ch`;
    $: void color(shown, codeKind);

    async function color(text: string, kind: CodeKind) {
        colored = undefined;
        if (!kind.language) return;
        try {
            const hljs = await loadHighlighter();
            if (destroyed || text !== shown || kind !== codeKind) return;
            colored = colorLines(hljs, text, kind.language);
        } catch (error) {
            // Without the highlighter (offline for a moment) the code stays readable, just without colors.
            console.warn("Could not load the code colors", error);
        }
    }

    function showCopyState(state: "copied" | "failed") {
        copyState = state;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => (copyState = "idle"), 2000);
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(copyText ?? shown);
            showCopyState("copied");
        } catch (error) {
            console.warn("Could not copy the code", error);
            // The clipboard said no (an older browser, a locked frame): the code is selected, ready for Ctrl or Cmd C.
            if (body) {
                const range = document.createRange();
                range.selectNodeContents(body);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
            showCopyState("failed");
        }
    }
</script>

<div class="code-view" data-testid="codeView">
    <div class="code-bar">
        <span class="code-meta">{codeKind.label} · {$LL.chat.codeView.lines({ count: lineCount })}</span>
        <button type="button" class="code-copy" on:click={copy} data-testid="codeViewCopy">
            {#if copyState === "copied"}<IconCheck font-size="14" />{:else}<IconCopy font-size="14" />{/if}
            {copyState === "copied"
                ? $LL.chat.codeView.copied()
                : copyState === "failed"
                ? $LL.chat.codeView.copyFailed()
                : $LL.chat.codeView.copy()}
        </button>
    </div>
    <div
        class="code-lines code-colors language-{codeKind.language ?? 'plaintext'}"
        style:--number-width={numberWidth}
        bind:this={body}
        data-testid="codeViewLines"
        data-colored={colored ? "true" : "false"}
    >
        {#each lines as line, index (index)}
            <div class="code-line">
                <span class="code-number" aria-hidden="true">{index + 1}</span>
                {#if colored}
                    <!-- Colored by the highlighter: the code's text escaped, inside its own color spans only. -->
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class="code-text">{@html colored[index] || " "}</span>
                {:else}
                    <span class="code-text">{line || " "}</span>
                {/if}
            </div>
        {/each}
    </div>
</div>

<style>
    .code-view {
        min-height: 100%;
    }
    .code-bar {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        box-sizing: border-box;
        padding: 0 8px 0 14px;
        /* The surface it sits on: the bar covers the lines scrolling under it. */
        background: var(--code-view-background, #0f0c19);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .code-meta {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
    }
    .code-copy {
        position: relative;
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        box-sizing: border-box;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    /* The pill is 32px tall; the part that takes a tap is 44px. */
    .code-copy::before {
        content: "";
        position: absolute;
        inset: -6px -4px;
    }
    .code-copy:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .code-copy:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 2px;
    }
    .code-lines {
        padding: 10px 0 12px;
        font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.6;
        font-variant-ligatures: none;
        tab-size: 2;
        color: rgba(255, 255, 255, 0.84);
        user-select: text;
    }
    .code-line {
        display: grid;
        grid-template-columns: calc(var(--number-width) + 26px) minmax(0, 1fr);
    }
    .code-number {
        box-sizing: border-box;
        padding-right: 14px;
        text-align: right;
        color: rgba(255, 255, 255, 0.26);
        font-variant-numeric: tabular-nums;
        user-select: none;
    }
    /* Indents stay as written; a long line wraps under its own number, so nothing scrolls sideways. */
    .code-text {
        min-width: 0;
        padding-right: 14px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
</style>
