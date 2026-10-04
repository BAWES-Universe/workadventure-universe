<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { currentLiveStreamingSpaceStore, liveBroadcastStore } from "../../Stores/MegaphoneStore";
    import { requestedCameraState, requestedMicrophoneState } from "../../Stores/MediaStore";
    import { requestedScreenSharingState } from "../../Stores/ScreenSharingStore";
    import { endLiveBroadcast } from "./live";
    import { formatDuration } from "./voiceRecorder";
    import { isBroadcastReach, reachTitle } from "./reach";

    let seconds = 0;
    const ticker = setInterval(() => {
        const live = $liveBroadcastStore;
        seconds = live ? Math.floor((Date.now() - live.startedAt) / 1000) : 0;
    }, 500);
    onDestroy(() => clearInterval(ticker));

    // The server (a kick, a lost connection) or a speaker zone can end the stream underneath us: the pill goes with it.
    // Turning the mic, camera and screen all off while live ends the broadcast too, as the megaphone always did:
    // nothing is sent any more, so the listeners' tile and the pill must not stay.
    $: if (
        $liveBroadcastStore &&
        ($currentLiveStreamingSpaceStore === undefined ||
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

{#if live}
    <!-- Over the map at the top: under the status bar on a phone (the tiles sit below it), under the bar's left end on
         a desktop, clear of the tiles in the middle and the received cards on the right. -->
    <div
        class="fixed z-[1100] pointer-events-auto inset-x-3 top-3 lg:inset-x-auto lg:left-4 lg:top-20 lg:w-[380px]"
        transition:fly={{ y: -12, duration: 180 }}
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
                class="u-cta-coral rounded-full flex-none flex items-center gap-2 px-4 py-2 text-sm font-bold"
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
