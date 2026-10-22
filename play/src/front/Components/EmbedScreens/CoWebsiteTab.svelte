<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
    import LL from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import OpenHereItemIcon from "./OpenHereItemIcon.svelte";
    import { describeCoWebsite } from "./describeCoWebsite";
    import { IconX } from "@wa-icons";

    export let coWebsite: CoWebsite;
    export let active = false;

    const item = describeCoWebsite(coWebsite);
    let pill: HTMLElement | undefined;

    const dispatch = createEventDispatcher<{
        close: void;
    }>();

    // The picked tab always stays in view, however long the strip is.
    $: if (active && pill) pill.scrollIntoView({ inline: "nearest", block: "nearest" });

    function closeTab() {
        dispatch("close");
        analyticsClient.closeCowebsite();
    }

    function pick() {
        if (!active) analyticsClient.switchCowebsite();
    }
</script>

<!-- A tab is a pill: the item's icon, its name, and a close. The picked one is soft violet with a ring (the gradient is
     for go/on only), and a page its map says may not be closed has no close. -->
<div class="tab" class:picked={active} bind:this={pill}>
    <button type="button" class="tab-main" aria-current={active ? "true" : undefined} title={item.name} on:click={pick}>
        <OpenHereItemIcon badge={item.badge} src={item.iconSrc} background={item.iconBackground} size={24} />
        <span class="tab-name">{item.name}</span>
    </button>
    {#if coWebsite.isClosable()}
        <button
            type="button"
            class="tab-close"
            aria-label={$LL.cowebsite.closeItem({ name: item.name })}
            title={$LL.cowebsite.close()}
            on:click|stopPropagation={closeTab}
        >
            <IconX font-size="16" />
        </button>
    {/if}
</div>

<style>
    .tab {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 2px;
        height: 40px;
        max-width: 220px;
        padding-inline-start: 10px;
        padding-inline-end: 6px;
        border-radius: 999px;
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        flex: none;
    }

    .tab:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    .tab.picked {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }

    .tab-main {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .tab.picked .tab-main {
        cursor: default;
    }

    .tab-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }

    .tab-close {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #fff;
        opacity: 0.8;
        cursor: pointer;
    }

    .tab-close:hover {
        background: rgba(255, 255, 255, 0.2);
        opacity: 1;
    }
</style>
