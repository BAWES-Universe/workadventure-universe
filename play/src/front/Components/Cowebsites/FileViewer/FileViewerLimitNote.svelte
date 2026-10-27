<script lang="ts">
    import { createEventDispatcher } from "svelte";

    /** What was cut ("Showing the first 1 MB.") and the button that saves the whole file. */
    export let message: string;
    export let action: string;

    const dispatch = createEventDispatcher<{ action: void }>();
</script>

<div class="limit" data-testid="fileViewerLimit">
    <span>{message}</span>
    <button type="button" on:click={() => dispatch("action")}>{action}</button>
</div>

<style>
    .limit {
        flex: none;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #fff8e1;
        color: #5d4a00;
        font-size: 12px;
        border-top: 1px solid #f0e2a8;
    }

    .limit button {
        margin-left: auto;
        min-height: 32px;
        padding: 0 4px;
        background: none;
        border: 0;
        color: #1a56c4;
        font: inherit;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }

    .limit button:hover {
        text-decoration: underline;
    }

    @media (pointer: coarse) {
        .limit button {
            min-height: 44px;
        }
    }
</style>
