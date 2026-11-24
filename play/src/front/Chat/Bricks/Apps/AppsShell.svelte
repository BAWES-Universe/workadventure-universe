<script lang="ts">
    import PanelHeader from "../../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import KeySheetHost from "./KeySheetHost.svelte";

    /**
     * The frame of every Apps page: the panel header (a back arrow and the page's name) over one scrolling body whose rows,
     * sections and notes are drawn like the bot page's own. Pages put their rows inside as the default slot.
     */
    export let title: string;
    export let backLabel: string;
    export let onBack: () => void;
    export let testId: string;
</script>

<div class="ax flex h-full min-h-0 flex-col" data-testid={testId}>
    <KeySheetHost />
    <PanelHeader {title} {onBack} {backLabel} canHide={false} />
    <div class="ax-body">
        <slot />
    </div>
</div>

<style>
    .ax {
        box-sizing: border-box;
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .ax-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 0;
        flex: 1;
        overflow-y: auto;
        padding-bottom: 20px;
        scrollbar-width: none;
    }
</style>
