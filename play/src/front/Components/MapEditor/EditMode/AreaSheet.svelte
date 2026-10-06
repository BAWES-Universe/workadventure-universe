<script lang="ts">
    // The Areas tool on a phone: the map stays in view and a small sheet at the bottom holds "New area" and the way
    // to the list. Pulled up (a swipe up, or "All areas"), it lists the areas of the room; a tap on one glides the map
    // to it and picks it. A swipe down, or a tap on the handle, puts it back.
    import { fly } from "svelte/transition";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { editAreaSheetOpenStore } from "../../../Stores/EditModeStore";
    import AreaRows from "./AreaRows.svelte";
    import { roomAreasStore } from "./roomAreas";
    import { startNewArea } from "./newArea";
    import { IconChevronUp, IconPlus } from "@wa-icons";

    const SWIPE = 30;
    let swipeFrom: number | undefined;

    $: open = $editAreaSheetOpenStore;
    $: count = $roomAreasStore.length;

    function swipeStart(event: PointerEvent) {
        swipeFrom = event.clientY;
    }
    function swipeEnd(event: PointerEvent) {
        if (swipeFrom === undefined) return;
        const moved = event.clientY - swipeFrom;
        swipeFrom = undefined;
        if (moved < -SWIPE) editAreaSheetOpenStore.set(true);
        else if (moved > SWIPE) editAreaSheetOpenStore.set(false);
    }
    function newArea() {
        editAreaSheetOpenStore.set(false);
        startNewArea();
    }
</script>

<div
    class="as-sheet u-surface pointer-events-auto"
    class:as-open={open}
    transition:fly={{ y: 60, duration: 200 }}
    data-testid="area-sheet"
>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="as-top"
        on:pointerdown={swipeStart}
        on:pointerup={swipeEnd}
        on:pointercancel={() => (swipeFrom = undefined)}
    >
        <button
            type="button"
            class="as-grab"
            aria-label={$LL.mapEditor.edit.areas.allAreas({ count })}
            aria-expanded={open}
            data-testid="area-sheet-grab"
            on:click={() => editAreaSheetOpenStore.set(!open)}
        >
            <i />
        </button>
        {#if open}
            <h4>{$LL.mapEditor.edit.areas.allAreas({ count })}</h4>
            <p>{$LL.mapEditor.edit.areas.listHint()}</p>
        {:else}
            <h4>{$LL.mapEditor.edit.areas.title()}</h4>
            <p>{$LL.mapEditor.edit.areas.sheetHint()}</p>
        {/if}
    </div>
    {#if open}
        <div class="as-list">
            {#if count === 0}
                <p class="as-empty">{$LL.mapEditor.edit.areas.noAreas()}</p>
            {/if}
            <AreaRows areas={$roomAreasStore} />
        </div>
    {/if}
    <div class="as-btns">
        <button type="button" class="as-cta u-cta" data-testid="area-new" on:click={newArea}>
            <IconPlus font-size="20" />{$LL.mapEditor.edit.areas.newArea()}
        </button>
        {#if !open}
            <button
                type="button"
                class="as-sec"
                data-testid="area-all"
                on:click={() => editAreaSheetOpenStore.set(true)}
            >
                {$LL.mapEditor.edit.areas.allAreas({ count })}
                <IconChevronUp font-size="18" />
            </button>
        {/if}
    </div>
</div>

<style>
    .as-sheet {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        max-height: 70%;
        padding: 10px 18px calc(26px + env(safe-area-inset-bottom, 0px));
        border-radius: 26px 26px 0 0;
        color: #fff;
        z-index: 2;
    }
    .as-top {
        touch-action: none;
    }
    .as-grab {
        display: grid;
        place-items: center;
        width: 100%;
        height: 24px;
        margin: -6px 0 6px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
    }
    .as-grab i {
        width: 44px;
        height: 5px;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.25);
    }
    h4 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        text-transform: none;
        letter-spacing: normal;
    }
    p {
        margin: 2px 0 14px;
        font-size: 14px;
        color: rgba(244, 242, 250, 0.64);
    }
    .as-list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: grid;
        align-content: start;
        gap: 4px;
        margin-top: 4px;
    }
    .as-empty {
        margin: 4px 10px;
    }
    .as-btns {
        display: flex;
        gap: 10px;
    }
    .as-open .as-btns {
        margin-top: 12px;
    }
    .as-cta,
    .as-sec {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 48px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 16px;
        cursor: pointer;
    }
    .as-cta {
        flex: 1;
        font-weight: 700;
    }
    .as-sec {
        padding: 0 18px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
    }
</style>
