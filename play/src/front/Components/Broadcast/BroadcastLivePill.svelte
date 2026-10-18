<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { liveBarInLayoutStore, liveBroadcastStore, megaphoneSpacesStore } from "../../Stores/MegaphoneStore";
    import { requestedCameraState, requestedMicrophoneState } from "../../Stores/MediaStore";
    import { requestedScreenSharingState } from "../../Stores/ScreenSharingStore";
    import { endLiveBroadcast } from "./live";
    import { formatDuration } from "./voiceRecorder";
    import { isBroadcastReach, reachTitle } from "./reach";

    /** In the camera area, above the tiles (PresentationLayout), instead of over the map. */
    export let inline = false;

    // Right away, not after the first tick: the bar in the camera area is built again when the layout is (a picture in
    // picture window, a full screen share), long after the broadcast began.
    let seconds = 0;
    function updateSeconds() {
        const live = $liveBroadcastStore;
        seconds = live ? Math.floor((Date.now() - live.startedAt) / 1000) : 0;
    }
    updateSeconds();
    const ticker = setInterval(updateSeconds, 500);
    onDestroy(() => clearInterval(ticker));

    // The camera area takes the bar as long as it is on screen (it is not with a room website or a call in an
    // external service, nor in the picture-in-picture window); the one over the map steps aside meanwhile.
    onMount(() => {
        if (!inline) return;
        liveBarInLayoutStore.update((count) => count + 1);
        return () => liveBarInLayoutStore.update((count) => count - 1);
    });

    // The channel's space can go underneath us (a kick, the room's broadcast settings changed): the pill goes with it.
    // Only the broadcast's own space counts; walking through a Podium or Audience area while live changes nothing.
    // Turning the mic, camera and screen all off while live ends the broadcast too, as the megaphone always did:
    // nothing is sent any more, so the listeners' tile and the pill must not stay.
    $: if (
        !inline &&
        $liveBroadcastStore &&
        (!$megaphoneSpacesStore.has($liveBroadcastStore.scope) ||
            (!$requestedMicrophoneState && !$requestedCameraState && !$requestedScreenSharingState))
    ) {
        endLiveBroadcast();
    }

    $: live = $liveBroadcastStore;
    $: reachLine = live
        ? [isBroadcastReach(live.scope) ? reachTitle($LL, live.scope) : live.scope, live.reachLabel]
              .filter((part) => part)
              .join(" · ")
        : "";
</script>

{#if live && (inline || $liveBarInLayoutStore === 0)}
    <!-- In the camera area, right above the tiles, which sit under it (#1155). Where there are no tiles to sit above
         (a room website, an external call), it goes back over the map: under the status bar on a phone, under the
         bar's left end on a desktop, clear of the received cards on the right. The installed app's status bar is
         see-through, so a phone adds its inset (#969). -->
    <div
        class={inline
            ? "pointer-events-auto flex-none mx-auto mt-5 mb-2 w-[380px] max-w-[calc(100%-24px)] mobile:mt-0 mobile:mx-3 mobile:w-auto mobile:max-w-none"
            : "fixed z-[1100] pointer-events-auto inset-x-3 top-[calc(12px+env(safe-area-inset-top))] md:inset-x-auto md:left-4 md:top-20 md:w-[380px]"}
        in:fly={{ y: -12, duration: 180 }}
        data-testid="broadcast-live-pill"
    >
        <div class="u-surface rounded-2xl text-white flex items-center gap-3 ps-4 pe-2 py-2">
            <span class="u-live-coral-dot flex-none" aria-hidden="true" />
            <div class="flex-1 min-w-0 leading-tight">
                <div class="flex items-baseline gap-2">
                    <span class="text-xs font-extrabold tracking-widest uppercase" style="color: #f08a70">
                        {$LL.broadcast.live.live()}
                    </span>
                    <span class="text-sm font-bold tabular-nums">{formatDuration(seconds)}</span>
                </div>
                {#if reachLine}
                    <div class="text-xs text-white/60 truncate">{reachLine}</div>
                {/if}
            </div>
            <button
                type="button"
                class="u-cta-coral rounded-full flex-none flex items-center gap-2 px-4 h-11 text-sm font-bold"
                on:click={endLiveBroadcast}
                title={$LL.broadcast.live.endTitle()}
                data-testid="broadcast-end-live"
            >
                <span class="block w-2.5 h-2.5 rounded-[2px] bg-white" aria-hidden="true" />
                {$LL.broadcast.live.end()}
            </button>
        </div>
    </div>
{/if}
