<script lang="ts">
    // The title line of a panel: an optional back circle, the title, one line under it, and room for a trailing control.
    // On a phone the panel covers the map, so every header also has a chevron that tucks the panel away; the tool
    // stays lit on the rail and tapping it there brings the panel back.
    import { LL } from "../../../../i18n/i18n-svelte";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import { mapEditorVisibilityStore } from "../../../Stores/MapEditorStore";
    import { IconChevronDown, IconChevronLeft } from "@wa-icons";

    export let title: string;
    export let subtitle: string | undefined = undefined;
    export let onBack: (() => void) | undefined = undefined;
    export let backLabel = "Back";
    /** The buttons stay at the top when the lines beside them change height (the name field and its hint). */
    export let alignTop = false;

    function hidePanel() {
        mapEditorVisibilityStore.set(false);
    }
</script>

<div class="em-head" class:em-top={alignTop}>
    {#if onBack}
        <button type="button" class="em-back" aria-label={backLabel} data-testid="edit-panel-back" on:click={onBack}>
            <IconChevronLeft font-size="18" />
        </button>
    {/if}
    <div class="em-head-text">
        <div class="em-title"><slot name="title">{title}</slot></div>
        {#if subtitle || $$slots.subtitle}
            <div class="em-sub"><slot name="subtitle">{subtitle}</slot></div>
        {/if}
    </div>
    <slot name="trailing" />
    {#if $mobileLayoutStore}
        <button
            type="button"
            class="em-back em-hide"
            aria-label={$LL.mapEditor.edit.hidePanel()}
            title={$LL.mapEditor.edit.hidePanel()}
            data-testid="edit-panel-hide"
            on:click={hidePanel}
        >
            <IconChevronDown font-size="18" />
        </button>
    {/if}
</div>

<style>
    .em-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        min-height: 40px;
    }
    .em-top {
        align-items: flex-start;
    }
    /* The title line is as tall as the name field, so swapping the name for its field moves nothing. */
    .em-top .em-title {
        display: flex;
        align-items: center;
        min-height: 34px;
    }
    .em-head-text {
        flex: 1;
        min-width: 0;
    }
    .em-title {
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-sub {
        margin-top: 1px;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-back {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    /* The hide chevron: a 44px tap target drawn as the same 34px circle. */
    .em-hide {
        position: relative;
        width: 44px;
        height: 44px;
        margin-right: -5px;
        background: none;
    }
    .em-hide::before {
        content: "";
        position: absolute;
        inset: 5px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
    }
    .em-hide :global(svg) {
        position: relative;
    }
    @media (hover: hover) {
        .em-back:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
