<script lang="ts">
    /** The rows of a table. Every cell is drawn as text, never as HTML. The first row is the header. */
    export let rows: string[][];

    $: header = rows[0] ?? [];
    $: body = rows.slice(1);
</script>

<div class="table-area" data-testid="fileViewerTable">
    <table style:min-width="calc({header.length} * 96px)">
        <thead>
            <tr>
                {#each header as cell, column (column)}<th>{cell}</th>{/each}
            </tr>
        </thead>
        <tbody>
            {#each body as row, line (line)}
                <tr>
                    {#each row as cell, column (column)}<td>{cell}</td>{/each}
                </tr>
            {/each}
        </tbody>
    </table>
</div>

<style>
    .table-area {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: #1b1a2b;
        padding: 18px 22px;
        -webkit-overflow-scrolling: touch;
    }

    table {
        border-collapse: collapse;
        border: 0;
        border-radius: 0;
        /* Fills the panel; with many columns it grows past it and scrolls sideways inside it. */
        width: 100%;
        font-size: 13px;
        color: #e9e8f5;
    }

    th,
    td {
        border: 1px solid #3a3955;
        padding: 5px 10px;
        text-align: left;
        text-transform: none;
        letter-spacing: normal;
        vertical-align: top;
        white-space: pre-wrap;
        overflow-wrap: break-word;
    }

    th {
        background: #25243a;
        font-weight: 600;
        position: sticky;
        top: -18px;
    }

    @media (max-width: 640px) {
        .table-area {
            padding: 14px;
        }

        th {
            top: -14px;
        }
    }
</style>
