<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
    import {
        displayedMegaphoneScreenStore,
        localStreamStore,
        localVolumeStore,
        requestedCameraState,
        requestedMicrophoneState,
    } from "../../Stores/MediaStore";
    import { requestedScreenSharingState } from "../../Stores/ScreenSharingStore";
    import { srcObject } from "../Video/utils";
    import WaveBars from "./WaveBars.svelte";
    import { startLiveBroadcast } from "./live";
    import { reachName } from "./reach";
    import {
        IconCamera,
        IconMicrophone,
        IconMicrophoneOff,
        IconScreenShare,
        IconSpeakerPhone,
        IconUser,
        IconVideoOff,
    } from "@wa-icons";

    export let reach: BroadcastReach;

    const dispatch = createEventDispatcher<{ live: void }>();

    $: stream = $localStreamStore.type === "success" ? $localStreamStore.stream : undefined;
    $: hasVideo = !!stream && stream.getVideoTracks().some((track) => track.enabled && track.readyState === "live");
    $: anythingOn = $requestedMicrophoneState || $requestedCameraState || $requestedScreenSharingState;
    // The meter's bars come in at 0 to about 200: scale them to the wave's 0 to 1.
    $: micLevels =
        $requestedMicrophoneState && $localVolumeStore ? $localVolumeStore.map((bar) => Math.min(1, bar / 150)) : [];
    $: name = reachName(reach, $broadcastReachInfoStore);

    function toggleMic() {
        if ($requestedMicrophoneState) requestedMicrophoneState.disableMicrophone();
        else requestedMicrophoneState.enableMicrophone();
    }
    function toggleCamera() {
        if ($requestedCameraState) requestedCameraState.disableWebcam();
        else requestedCameraState.enableWebcam();
    }
    function toggleScreen() {
        if ($requestedScreenSharingState) requestedScreenSharingState.disableScreenSharing();
        else requestedScreenSharingState.enableScreenSharing();
    }

    function goLive() {
        if (!anythingOn) return;
        if (startLiveBroadcast(reach)) dispatch("live");
    }

    onMount(() => {
        // The preview keeps the camera awake, and the mic comes on so going live is one tap.
        displayedMegaphoneScreenStore.set(true);
        if (!$requestedMicrophoneState) requestedMicrophoneState.enableMicrophone();
    });
    onDestroy(() => displayedMegaphoneScreenStore.set(false));
</script>

<div class="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-white/5 border border-white/10">
    {#if hasVideo}
        <video
            class="absolute inset-0 w-full h-full object-cover"
            style="transform: scaleX(-1)"
            use:srcObject={stream}
            autoplay
            muted
            playsinline
        />
    {:else}
        <div class="absolute inset-0 grid place-items-center text-white/30" aria-hidden="true">
            <IconUser font-size="72" />
        </div>
    {/if}
    <div
        class="absolute bottom-2 start-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium"
        style="background: rgba(10, 8, 20, 0.7)"
    >
        {#if $requestedMicrophoneState}
            <IconMicrophone font-size="14" aria-hidden="true" />
            <WaveBars levels={micLevels.slice(0, 4)} height={12} gap={2} barWidth={2} />
        {:else}
            <IconMicrophoneOff font-size="14" aria-hidden="true" />
        {/if}
        {$LL.broadcast.live.you()}
    </div>
</div>

<div class="grid grid-cols-3 gap-2">
    <div class="flex flex-col items-center gap-1.5">
        <button
            type="button"
            class="u-ab-btn rounded-full w-[52px] h-[52px] grid place-items-center text-white"
            data-state="normal"
            data-live={$requestedMicrophoneState ? "true" : undefined}
            aria-pressed={$requestedMicrophoneState}
            on:click={toggleMic}
            data-testid="broadcast-live-mic"
        >
            <span class="u-ab-state" aria-hidden="true" />
            {#if $requestedMicrophoneState}<IconMicrophone font-size="22" />{:else}<IconMicrophoneOff
                    font-size="22"
                />{/if}
        </button>
        <span class="text-xs {$requestedMicrophoneState ? 'font-bold' : 'text-white/60'}">
            {$requestedMicrophoneState ? $LL.broadcast.live.micOn() : $LL.broadcast.live.micOff()}
        </span>
    </div>
    <div class="flex flex-col items-center gap-1.5">
        <button
            type="button"
            class="u-ab-btn rounded-full w-[52px] h-[52px] grid place-items-center text-white"
            data-state="normal"
            data-live={$requestedCameraState ? "true" : undefined}
            aria-pressed={$requestedCameraState}
            on:click={toggleCamera}
            data-testid="broadcast-live-camera"
        >
            <span class="u-ab-state" aria-hidden="true" />
            {#if $requestedCameraState}<IconCamera font-size="22" />{:else}<IconVideoOff font-size="22" />{/if}
        </button>
        <span class="text-xs {$requestedCameraState ? 'font-bold' : 'text-white/60'}">
            {$requestedCameraState ? $LL.broadcast.live.cameraOn() : $LL.broadcast.live.cameraOff()}
        </span>
    </div>
    <div class="flex flex-col items-center gap-1.5">
        <button
            type="button"
            class="u-ab-btn rounded-full w-[52px] h-[52px] grid place-items-center text-white"
            data-state="normal"
            data-live={$requestedScreenSharingState ? "true" : undefined}
            aria-pressed={$requestedScreenSharingState}
            on:click={toggleScreen}
            data-testid="broadcast-live-screen"
        >
            <span class="u-ab-state" aria-hidden="true" />
            <IconScreenShare font-size="22" />
        </button>
        <span class="text-xs {$requestedScreenSharingState ? 'font-bold' : 'text-white/60'}">
            {$requestedScreenSharingState ? $LL.broadcast.live.sharing() : $LL.broadcast.live.shareScreen()}
        </span>
    </div>
</div>

<p class="m-0 text-center text-sm text-white/60">
    {#if !anythingOn}
        {$LL.broadcast.live.needs()}
    {:else if name}
        {$LL.broadcast.live.notice({ name })}
    {:else}
        {$LL.broadcast.live.noticeNoName()}
    {/if}
</p>

<button
    type="button"
    class="u-cta rounded-full w-full py-3.5 text-base font-bold flex items-center justify-center gap-2"
    disabled={!anythingOn}
    on:click={goLive}
    data-testid="broadcast-go-live"
>
    <IconSpeakerPhone font-size="18" aria-hidden="true" />
    {$LL.broadcast.live.go()}
</button>
