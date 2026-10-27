<script lang="ts">
    import SheetDragHandle from "./SheetDragHandle.svelte";

    /** The strip at the top of a bottom sheet (the chat's, the Open here window's): drag it, or tap it to step. */
    export let sheetHeight: number;
    export let onDrag: (height: number) => void;
    export let onRelease: (height: number) => void;
    export let onTap: () => void;
    export let label: string;
    export let testId: string;
</script>

<SheetDragHandle {sheetHeight} {onDrag} {onRelease} {onTap} {label} {testId} class="sheet-handle">
    <span class="sheet-grabber" aria-hidden="true" />
</SheetDragHandle>

<style>
    /* A 28px strip the whole width of the sheet takes the drag; the grabber shows where. */
    :global(.sheet-handle) {
        display: flex;
        flex: none;
        justify-content: center;
        width: 100%;
        height: 28px;
        padding: 10px 0 0;
        cursor: ns-resize;
    }
    .sheet-grabber {
        display: block;
        width: 40px;
        height: 5px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.28);
    }
    :global(.sheet-handle:focus-visible) {
        outline: none;
    }
    :global(.sheet-handle:focus-visible) .sheet-grabber {
        background: #fff;
    }
</style>
