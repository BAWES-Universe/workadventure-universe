<script lang="ts">
    // The Areas panel on a computer: "New area" and the areas of the room as rows; tapping one picks it on the map,
    // which opens its settings here. On a phone the list is the Areas sheet (AreaSheet.svelte) and this panel only
    // holds the settings of the picked area.
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { mapEditorSelectedAreaPreviewStore } from "../../../Stores/MapEditorStore";
    import { editAreaListShownStore } from "../../../Stores/EditModeStore";
    import PanelHeader from "./PanelHeader.svelte";
    import AreaSettings from "./AreaSettings.svelte";
    import AreaRows from "./AreaRows.svelte";
    import { roomAreasStore } from "./roomAreas";
    import { startNewArea } from "./newArea";
    import { IconPlus } from "@wa-icons";

    // Picking another area (or none) shows its page again; only pressing Settings on its bar puts the list back.
    let lastPicked = $mapEditorSelectedAreaPreviewStore;
    $: if ($mapEditorSelectedAreaPreviewStore !== lastPicked) {
        lastPicked = $mapEditorSelectedAreaPreviewStore;
        editAreaListShownStore.set(false);
    }
</script>

{#if $mapEditorSelectedAreaPreviewStore && !$editAreaListShownStore}
    <AreaSettings />
{:else}
    <PanelHeader
        title={$LL.mapEditor.edit.areas.title()}
        subtitle={$mobileLayoutStore
            ? $LL.mapEditor.edit.areas.subtitlePhone()
            : $LL.mapEditor.edit.areas.subtitleDesktop()}
    />
    <button type="button" class="em-new u-cta" data-testid="area-new" on:click={startNewArea}>
        <IconPlus font-size="18" />{$LL.mapEditor.edit.areas.newArea()}
    </button>
    <div class="em-ebi">{$LL.mapEditor.edit.areas.inThisRoom()}</div>
    <div class="em-scroll">
        {#if $roomAreasStore.length === 0}
            <p class="em-empty">{$LL.mapEditor.edit.areas.noAreas()}</p>
        {/if}
        <AreaRows areas={$roomAreasStore} />
    </div>
{/if}

<style>
    .em-new {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: none;
        height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
    }
    .em-ebi {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 8px 0 0;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #a78bfa;
    }
    .em-ebi::before {
        content: "";
        width: 12px;
        height: 1px;
        background: currentColor;
    }
    .em-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .em-empty {
        margin: 8px 0;
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
