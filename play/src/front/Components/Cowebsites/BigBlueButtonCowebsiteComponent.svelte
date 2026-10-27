<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { BBBCoWebsite } from "../../WebRtc/CoWebsite/BBBCoWebsite";
    import { screenWakeLock } from "../../Utils/ScreenWakeLock";
    import { inExternalServiceStore } from "../../Stores/MyMediaStore";
    import meetingIcon from "../images/meeting.svg";
    import LL from "../../../i18n/i18n-svelte";
    import OpenHereRow from "../EmbedScreens/OpenHereRow.svelte";
    import OpenHereItemIcon from "../EmbedScreens/OpenHereItemIcon.svelte";
    import { openCoWebsiteInBrowserTab } from "../EmbedScreens/coWebsiteRow";
    import { IconExternalLink } from "@wa-icons";

    export let actualCowebsite: BBBCoWebsite;
    export let visible: boolean;
    let screenWakeRelease: (() => Promise<void>) | undefined;

    onMount(async () => {
        try {
            await screenWakeLock
                .requestWakeLock()
                .then((release) => (screenWakeRelease = release))
                .catch((error) => console.error(error));
            inExternalServiceStore.set(true);
        } catch (e) {
            console.error("Error with Screen Wake Lock :", e);
        }
    });

    onDestroy(async () => {
        try {
            if (screenWakeRelease) {
                await screenWakeRelease();
                // eslint-disable-next-line require-atomic-updates
                screenWakeRelease = undefined;
            }
            inExternalServiceStore.set(false);
        } catch (e) {
            console.error("Screen Wake off not successfully!", e);
        }
    });
</script>

<div class="flex flex-col w-full h-full" class:hidden={!visible}>
    <OpenHereRow
        name={$LL.cowebsite.bigBlueButton()}
        line={actualCowebsite.getHideUrl() ? undefined : actualCowebsite.getUrl().toString()}
    >
        <OpenHereItemIcon slot="icon" src={meetingIcon} background="#000" />
        {#if !actualCowebsite.getHideUrl()}
            <button
                type="button"
                class="open-here-action"
                title={$LL.cowebsite.openInBrowserTab()}
                aria-label={$LL.cowebsite.openInBrowserTab()}
                on:click={() => {
                    openCoWebsiteInBrowserTab(actualCowebsite);
                }}
            >
                <IconExternalLink font-size="20" />
            </button>
        {/if}
    </OpenHereRow>
    <div class="relative flex-1 min-h-0">
        <div class="absolute w-full h-full z-0">
            <iframe
                src={actualCowebsite.getUrl().toString()}
                frameborder="0"
                allow={actualCowebsite.getAllowPolicy()}
                title="Big Blue Button Meeting"
                class="bg-white w-full h-full"
                id="iframe"
            />
        </div>
    </div>
</div>
