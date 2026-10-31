<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { iframeListener } from "../../Api/IframeListener";
    import type { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
    import LL from "../../../i18n/i18n-svelte";
    import OpenHereRow from "../EmbedScreens/OpenHereRow.svelte";
    import OpenHereItemIcon from "../EmbedScreens/OpenHereItemIcon.svelte";
    import {
        coWebsiteIconBackground,
        coWebsiteIconUrl,
        coWebsiteSiteName,
        copyCoWebsiteLink,
        openCoWebsiteInBrowserTab,
    } from "../EmbedScreens/coWebsiteRow";
    import { titleBarHiddenItemStore } from "../../Stores/TitleBarStore";
    import { IconCopy, IconExternalLink } from "@wa-icons";

    export let actualCowebsite: SimpleCoWebsite;
    export let visible: boolean;
    let iframeSimpleCowebsite: HTMLIFrameElement;
    export let allowApi: boolean;

    // A page a map opens with Hide URL keeps its address to itself: no line under the name, and nothing to copy or open.
    const hideUrl = actualCowebsite.getHideUrl();

    // "Hide title bar": while this page is the only thing open, it fills the window and the row is left out. Only the row
    // comes and goes: the iframe below sits outside of this block, so the page never reloads when the row toggles.
    $: titleBarHidden = $titleBarHiddenItemStore === actualCowebsite;

    onMount(() => {
        if (allowApi) {
            iframeListener.registerIframe(iframeSimpleCowebsite);
        }
    });

    onDestroy(() => {
        if (allowApi) {
            iframeListener.unregisterIframe(iframeSimpleCowebsite);
        }
    });
</script>

<div class="flex flex-col w-full h-full" class:hidden={!visible}>
    {#if !titleBarHidden}
        <OpenHereRow
            name={coWebsiteSiteName(actualCowebsite)}
            line={hideUrl ? undefined : actualCowebsite.getUrl().toString()}
        >
            <OpenHereItemIcon
                slot="icon"
                src={coWebsiteIconUrl(actualCowebsite)}
                background={coWebsiteIconBackground(actualCowebsite)}
            />
            {#if !hideUrl}
                <button
                    type="button"
                    class="open-here-action"
                    title={$LL.cowebsite.copyLink()}
                    aria-label={$LL.cowebsite.copyLink()}
                    on:click={() => copyCoWebsiteLink(actualCowebsite)}
                >
                    <IconCopy font-size="20" />
                </button>
                <button
                    type="button"
                    class="open-here-action"
                    title={$LL.cowebsite.openInBrowserTab()}
                    aria-label={$LL.cowebsite.openInBrowserTab()}
                    on:click={() => openCoWebsiteInBrowserTab(actualCowebsite)}
                >
                    <IconExternalLink font-size="20" />
                </button>
            {/if}
        </OpenHereRow>
    {/if}
    <div class="relative flex-1 min-h-0">
        <div class="absolute w-full h-full z-0">
            <iframe
                bind:this={iframeSimpleCowebsite}
                src={actualCowebsite.getUrl().toString()}
                frameborder="0"
                allow={actualCowebsite.getAllowPolicy()}
                title="Cowebsite"
                class="bg-white w-full h-full"
            />
        </div>
    </div>
</div>
