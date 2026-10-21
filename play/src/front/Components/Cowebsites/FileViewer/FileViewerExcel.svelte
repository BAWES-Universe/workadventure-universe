<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "../../../FileViewer/textFiles";
    import { columnLetters, readSpreadsheet, type SheetView } from "../../../FileViewer/spreadsheet";
    import FileViewerLimitNote from "./FileViewerLimitNote.svelte";

    export let bytes: ArrayBuffer;

    const dispatch = createEventDispatcher<{ loaded: { sheetCount: number }; failed: void; download: void }>();

    let sheets: SheetView[] = [];
    let current = 0;
    let scroller: HTMLDivElement | undefined;

    onMount(() => {
        readSpreadsheet(bytes).then(
            (read) => {
                if (read.length === 0) {
                    dispatch("failed");
                    return;
                }
                sheets = read;
                dispatch("loaded", { sheetCount: read.length });
            },
            (error) => {
                // A damaged or password-locked file.
                console.warn("Could not read a spreadsheet to preview it", error);
                dispatch("failed");
            }
        );
    });

    function pick(index: number): void {
        current = index;
        if (scroller) {
            scroller.scrollTop = 0;
            scroller.scrollLeft = 0;
        }
    }

    $: sheet = sheets[current] as SheetView | undefined;
    $: note = sheet
        ? [
              sheet.rowsCut
                  ? sheet.totalRows !== undefined
                      ? $LL.chat.fileViewer.rowsCut({ shown: MAX_TABLE_ROWS, total: sheet.totalRows })
                      : $LL.chat.fileViewer.rowsCutUnknown({ shown: MAX_TABLE_ROWS })
                  : "",
              sheet.columnsCut ? $LL.chat.fileViewer.columnsCut({ shown: MAX_TABLE_COLUMNS }) : "",
          ]
              .filter(Boolean)
              .join(" ")
        : "";
</script>

{#if sheet}
    <div class="sheetwrap" data-testid="fileViewerSheet">
        <div class="sheet">
            <div class="scroller" bind:this={scroller}>
                <table>
                    <thead>
                        <tr>
                            <th class="corner" />
                            {#each { length: sheet.columnCount } as _, column (column)}
                                <th class="letter">{columnLetters(column)}</th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each sheet.rows as row, line (line)}
                            <tr class:first={line === 0}>
                                <th class="number">{line + 1}</th>
                                {#each row as cell, column (column)}
                                    <!-- A cell is text, never HTML. A long value is cut with "..." and kept whole in the tooltip. -->
                                    <td class:num={cell.number} title={cell.text.length > 40 ? cell.text : undefined}
                                        >{cell.text}</td
                                    >
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
        {#if note}
            <FileViewerLimitNote
                message={note}
                action={$LL.chat.fileViewer.downloadAll()}
                on:action={() => dispatch("download")}
            />
        {/if}
        {#if sheets.length > 1}
            <div class="tabs" role="tablist">
                {#each sheets as tab, index (index)}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={index === current}
                        class:on={index === current}
                        on:click={() => pick(index)}>{tab.name}</button
                    >
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .sheetwrap {
        flex: 1;
        min-height: 0;
        /* A wide sheet scrolls inside the panel: it never makes the panel wider. */
        min-width: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        background: #fff;
    }

    .sheet {
        flex: 1;
        min-height: 0;
        min-width: 0;
        position: relative;
    }

    /* Out of the flow, so a wide sheet never makes the panel wider: it scrolls inside the panel. */
    .scroller {
        position: absolute;
        inset: 0;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
    }

    table {
        border-collapse: separate;
        border-spacing: 0;
        border: 0;
        border-radius: 0;
        /* The page's own table style adds outer space and stretches rows: a sheet has neither. */
        margin: 0;
        height: auto;
        width: max-content;
        min-width: 0;
        font-size: 12px;
        color: #202124;
    }

    th,
    td {
        border-right: 1px solid #e1e3e6;
        border-bottom: 1px solid #e1e3e6;
        padding: 6px 10px;
        height: auto;
        line-height: 1.35;
        text-transform: none;
        letter-spacing: normal;
        font-size: 12px;
        color: #202124;
        white-space: nowrap;
        vertical-align: middle;
        text-align: left;
        max-width: 360px;
        overflow: hidden;
        text-overflow: ellipsis;
        background: #fff;
    }

    td.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    tr.first td {
        font-weight: 700;
        background: #f8fafd;
    }

    th.letter,
    th.number,
    th.corner {
        background: #f1f3f4;
        color: #5f6368;
        font-weight: 500;
        text-align: center;
        position: sticky;
    }

    th.letter {
        top: 0;
        padding: 4px 10px;
        z-index: 1;
    }

    th.number {
        left: 0;
        width: 30px;
        min-width: 30px;
        padding: 6px 6px;
        z-index: 1;
    }

    th.corner {
        top: 0;
        left: 0;
        z-index: 2;
    }

    .tabs {
        flex: none;
        display: flex;
        gap: 2px;
        background: #f1f3f4;
        border-top: 1px solid #dadce0;
        padding: 0 6px;
        overflow-x: auto;
    }

    .tabs button {
        flex: none;
        background: none;
        border: 0;
        border-radius: 0;
        padding: 10px 14px;
        font: inherit;
        font-size: 12px;
        color: #444;
        white-space: nowrap;
        cursor: pointer;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .tabs button:hover {
        background: #e8eaed;
    }

    .tabs button.on {
        background: #fff;
        color: #1e7145;
        font-weight: 700;
        box-shadow: inset 0 3px 0 #1e7145;
    }

    .tabs button:focus-visible {
        outline: 2px solid #1e7145;
        outline-offset: -2px;
    }

    @media (pointer: coarse) {
        .tabs button {
            padding: 13px 14px;
            min-height: 44px;
        }
    }
</style>
