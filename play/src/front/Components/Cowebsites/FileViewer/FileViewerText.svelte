<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import {
        codeKindOfExtension,
        codeLinesOf,
        coloredCodeBlocks,
        type CodeKind,
    } from "../../../FileViewer/codeHighlight";
    import { extensionOf, type FileViewerKind } from "../../../FileViewer/fileKinds";
    import {
        MAX_TABLE_COLUMNS,
        MAX_TABLE_ROWS,
        decodeText,
        indentJson,
        parseCsv,
        renderMarkdown,
        type ParsedTable,
    } from "../../../FileViewer/textFiles";
    import CodeView from "./CodeView.svelte";
    import FileViewerLimitNote from "./FileViewerLimitNote.svelte";
    import FileViewerTable from "./FileViewerTable.svelte";

    export let bytes: ArrayBuffer;
    export let kind: FileViewerKind;
    export let name: string;

    /** The most lines of code drawn at once: the rest is one tap away as a download. */
    const MAX_CODE_LINES = 10_000;

    const dispatch = createEventDispatcher<{ loaded: { rowCount?: number }; failed: void; download: void }>();

    let html = "";
    let plain = "";
    let table: ParsedTable | undefined;
    let truncated = false;
    /** Code (JSON included) as it is shown, the text as the file has it, and what language it is. */
    let code: { shown: string; written: string; kind: CodeKind; lineCount: number; linesCut: boolean } | undefined;

    onMount(() => {
        try {
            const decoded = decodeText(new Uint8Array(bytes));
            truncated = decoded.truncated;
            if (kind === "markdown") html = renderMarkdown(decoded.text);
            else if (kind === "json" || kind === "code") code = codeOf(decoded.text);
            else if (kind === "csv") table = parseCsv(decoded.text, !decoded.truncated);
            else plain = decoded.text;
            dispatch("loaded", { rowCount: table?.totalRows });
        } catch (error) {
            console.warn("Could not read a text file to preview it", error);
            dispatch("failed");
        }
    });

    function codeOf(written: string) {
        const laidOut = kind === "json" ? indentJson(written) : written;
        const lines = codeLinesOf(laidOut);
        const linesCut = lines.length > MAX_CODE_LINES;
        return {
            shown: (linesCut ? lines.slice(0, MAX_CODE_LINES) : lines).join("\n"),
            written,
            kind: codeKindOfExtension(extensionOf(name)),
            lineCount: lines.length,
            linesCut,
        };
    }

    $: tableMessage = table
        ? [
              table.rowsCut
                  ? table.totalRows !== undefined
                      ? $LL.chat.fileViewer.rowsCut({ shown: MAX_TABLE_ROWS, total: table.totalRows })
                      : $LL.chat.fileViewer.rowsCutUnknown({ shown: MAX_TABLE_ROWS })
                  : truncated
                  ? $LL.chat.fileViewer.textCut()
                  : "",
              table.columnsCut ? $LL.chat.fileViewer.columnsCut({ shown: MAX_TABLE_COLUMNS }) : "",
          ]
              .filter(Boolean)
              .join(" ")
        : "";
</script>

{#if table}
    <FileViewerTable rows={table.rows} />
    {#if tableMessage}
        <FileViewerLimitNote
            message={tableMessage}
            action={truncated ? $LL.chat.fileViewer.downloadRest() : $LL.chat.fileViewer.downloadAll()}
            on:action={() => dispatch("download")}
        />
    {/if}
{:else if code}
    <div class="text-area code" data-testid="fileViewerText">
        <!-- A text cut at its first megabyte has more lines than it shows, and how many is not known. -->
        <CodeView
            code={code.shown}
            copyText={code.written}
            codeKind={code.kind}
            totalLines={truncated ? undefined : code.lineCount}
        />
    </div>
    {#if truncated || code.linesCut}
        <FileViewerLimitNote
            message={code.linesCut
                ? $LL.chat.fileViewer.codeLinesCut({ shown: MAX_CODE_LINES })
                : $LL.chat.fileViewer.textCut()}
            action={$LL.chat.fileViewer.downloadRest()}
            on:action={() => dispatch("download")}
        />
    {/if}
{:else}
    <div class="text-area" data-testid="fileViewerText">
        {#if kind === "markdown"}
            <!-- The text was cleaned by renderMarkdown: no scripts, styles, forms or outside pictures. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="md code-colors" use:coloredCodeBlocks={html}>{@html html}</div>
        {:else}
            <pre class="plain">{plain}</pre>
        {/if}
    </div>
    {#if truncated}
        <FileViewerLimitNote
            message={$LL.chat.fileViewer.textCut()}
            action={$LL.chat.fileViewer.downloadRest()}
            on:action={() => dispatch("download")}
        />
    {/if}
{/if}

<style>
    .text-area {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: #1b1a2b;
        padding: 18px 22px;
        color: #e9e8f5;
        line-height: 1.5;
        font-size: 14px;
        -webkit-overflow-scrolling: touch;
        user-select: text;
    }

    .text-area.code {
        --code-view-background: #1b1a2b;
        padding: 0;
    }

    .plain {
        margin: 0;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    /* The game's own styles shout headings in capitals: a file's headings read as written. */
    .md :global(h1),
    .md :global(h2),
    .md :global(h3),
    .md :global(h4),
    .md :global(h5),
    .md :global(h6) {
        text-transform: none;
        letter-spacing: normal;
        color: #f3f2fb;
    }

    .md :global(h1),
    .md :global(h2),
    .md :global(h3) {
        margin: 18px 0 6px;
        font-family: Sora, system-ui, sans-serif;
        line-height: 1.25;
    }

    .md :global(h1) {
        font-size: 20px;
    }

    .md :global(h2) {
        font-size: 17px;
    }

    .md :global(h3),
    .md :global(h4),
    .md :global(h5),
    .md :global(h6) {
        margin: 14px 0 4px;
        font-size: 15px;
    }

    .md > :global(:first-child) {
        margin-top: 0;
    }

    .md :global(p) {
        margin: 0 0 8px;
        color: #cfcde2;
    }

    .md :global(a) {
        color: #b9a6ff;
        text-decoration: underline;
        overflow-wrap: anywhere;
    }

    .md :global(ul),
    .md :global(ol) {
        margin: 0 0 8px;
        padding-left: 22px;
        color: #cfcde2;
    }

    .md :global(ul) {
        list-style: disc;
    }

    .md :global(ol) {
        list-style: decimal;
    }

    .md :global(blockquote) {
        margin: 0 0 8px;
        padding-left: 12px;
        border-left: 3px solid #3a3955;
        color: #a3a1bd;
    }

    .md :global(hr) {
        border: 0;
        border-top: 1px solid #3a3955;
        margin: 14px 0;
    }

    .md :global(table) {
        border-collapse: collapse;
        border: 0;
        border-radius: 0;
        margin: 4px 0 10px;
        font-size: 13px;
        width: auto;
        max-width: 100%;
    }

    .md :global(th),
    .md :global(td) {
        border: 1px solid #3a3955;
        padding: 5px 10px;
        color: #e9e8f5;
        text-align: left;
        text-transform: none;
        letter-spacing: normal;
        overflow-wrap: anywhere;
    }

    .md :global(th) {
        background: #25243a;
    }

    .md :global(pre) {
        margin: 10px 0 0;
        background: #0f0e1a;
        border-radius: 8px;
        padding: 8px 10px;
        overflow-x: auto;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 12px;
        color: #b9a6ff;
    }

    .md :global(code) {
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 12.5px;
    }

    .md :global(p code),
    .md :global(li code) {
        background: #0f0e1a;
        border-radius: 4px;
        padding: 1px 5px;
        color: #b9a6ff;
    }

    .md :global(img) {
        max-width: 100%;
    }
</style>
