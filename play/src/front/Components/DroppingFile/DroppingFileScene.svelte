<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import { draggingFilePosition } from "../../Stores/FileUploadStore";

    // The spot the file will land on, under the cursor. Only shown in edit mode (see FileListener).
    const WIDTH = 168;
    const HEIGHT = 104;

    $: left = ($draggingFilePosition?.x ?? 0) - WIDTH / 2;
    $: top = ($draggingFilePosition?.y ?? 0) - HEIGHT / 2;
</script>

{#if $draggingFilePosition}
    <div
        class="drop-target fixed z-50 pointer-events-none flex items-center justify-center text-center rounded-2xl px-3"
        style="left: {left}px; top: {top}px; width: {WIDTH}px; height: {HEIGHT}px;"
        aria-hidden={true}
        data-testid="drop-file-target"
    >
        <p class="m-0 text-sm font-bold text-white drop-shadow-sm">
            {$LL.mapEditor.entityEditor.dropToPlace()}
        </p>
    </div>
{/if}

<style>
    .drop-target {
        border: 2px dashed #c4b5fd;
        background: rgb(134 41 252 / 0.22);
    }
</style>
