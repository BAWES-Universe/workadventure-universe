<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { UpdateMegaphoneSettingMessage } from "@workadventure/messages";
    import * as Sentry from "@sentry/svelte";
    import { requestedScreenSharingState } from "../../Stores/ScreenSharingStore";
    import {
        cameraListStore,
        displayedMegaphoneScreenStore,
        localStreamStore,
        localVolumeStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        streamingMegaphoneStore,
    } from "../../Stores/MediaStore";
    import {
        currentLiveStreamingSpaceStore,
        megaphoneCanBeUsedStore,
        megaphoneEnabledInRoomStore,
        megaphoneSpaceStore,
        requestedMegaphoneStore,
    } from "../../Stores/MegaphoneStore";
    import { mapEditorActivated } from "../../Stores/MenuStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { executeUpdateWAMSettings } from "../../Phaser/Game/MapEditor/Commands/Facades";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { StringUtils } from "../../Utils/StringUtils";
    import LL from "../../../i18n/i18n-svelte";
    import { srcObject } from "../Video/utils";
    import SoundMeterWidget from "../SoundMeterWidget.svelte";
    import Select from "../Input/Select.svelte";
    import microphoneImg from "../images/mic.svg";
    import cameraImg from "../images/cam.svg";
    import { megaphoneAudience } from "./GlobalMessageComposer";
    import type { MegaphoneAudience } from "./GlobalMessageComposer";
    import { IconAlertTriangle, IconInfoCircle } from "@wa-icons";

    const dispatch = createEventDispatcher<{ stopped: void }>();

    let turningOnMegaphone = false;
    // After "Turn it on", the server takes a moment to grant access. Keep the button pending until then, instead of
    // briefly showing "not allowed". Give up after a few seconds (e.g. the room's rights exclude this user).
    let awaitingMegaphoneAccess = false;
    let awaitingMegaphoneAccessTimeout: ReturnType<typeof setTimeout> | undefined;
    $: if ($megaphoneCanBeUsedStore) awaitingMegaphoneAccess = false;

    function getMegaphoneSettings() {
        // Called from a reactive statement: don't throw while the scene is switching or reconnecting.
        return gameManager.tryGetCurrentGameScene()?.wamFile?.settings?.megaphone;
    }

    // megaphoneCanBeUsedStore only says whether *this user* can use the megaphone. megaphoneEnabledInRoomStore tells
    // "off in this room" apart from "on, but you are not in the allowed tags", and follows changes made by others.
    $: megaphoneOnInRoom = $megaphoneCanBeUsedStore || $megaphoneEnabledInRoomStore;
    // Room settings live in the WAM file. A map without one (a plain TMJ map) has no megaphone setting to turn on.
    $: canTurnOnMegaphone = $mapEditorActivated && gameManager.tryGetCurrentGameScene()?.wamFile !== undefined;
    // Who hears the live message. Re-read whenever the server resends the megaphone setting: the scope only changes
    // together with it.
    let audience: MegaphoneAudience = "world";
    $: {
        void $megaphoneCanBeUsedStore;
        void $megaphoneEnabledInRoomStore;
        audience = megaphoneAudience(getMegaphoneSettings()?.scope);
    }

    async function turnOnMegaphone() {
        if (turningOnMegaphone || !canTurnOnMegaphone) {
            return;
        }
        const settings = getMegaphoneSettings();
        turningOnMegaphone = true;
        try {
            // Send the full setting (same defaults as Configure my room > Megaphone): the pusher builds the
            // megaphone space URL from the scope and title of this message alone.
            await executeUpdateWAMSettings({
                $case: "updateMegaphoneSettingMessage",
                updateMegaphoneSettingMessage: UpdateMegaphoneSettingMessage.fromJSON({
                    enabled: true,
                    scope: settings?.scope ?? "WORLD",
                    title: settings?.title ?? "MyMegaphone",
                    rights: settings?.rights ?? [],
                }),
            });
            audience = megaphoneAudience(getMegaphoneSettings()?.scope);
            // Keep the button pending until the server confirms, instead of flashing the old state.
            if (!$megaphoneCanBeUsedStore) {
                awaitingMegaphoneAccess = true;
                clearTimeout(awaitingMegaphoneAccessTimeout);
                awaitingMegaphoneAccessTimeout = setTimeout(() => {
                    awaitingMegaphoneAccess = false;
                }, 5000);
            }
        } catch (error) {
            // e.g. the game scene is not ready yet: leave the card as it is so the user can try again.
            console.error("Could not turn on the megaphone", error);
            Sentry.captureException(error);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            turningOnMegaphone = false;
        }
    }

    let videoElement: HTMLVideoElement;
    let stream: MediaStream | undefined;

    const unsubscribeLocalStreamStore = localStreamStore.subscribe((value) => {
        stream = value.type === "success" ? value.stream : undefined;
    });

    onDestroy(() => {
        clearTimeout(awaitingMegaphoneAccessTimeout);
        unsubscribeLocalStreamStore();
    });

    /** Shows the camera preview and device pickers. Nothing is broadcast until "Start megaphone". */
    function prepareLive() {
        streamingMegaphoneStore.set(true);
        displayedMegaphoneScreenStore.set(true);
        analyticsClient.openMegaphone();
    }

    function cancelPrepare() {
        streamingMegaphoneStore.set(false);
        displayedMegaphoneScreenStore.set(false);
    }

    let cameraDeviceId: string;
    function selectCamera() {
        requestedCameraDeviceIdStore.set(cameraDeviceId);
        localUserStore.setPreferredVideoInputDevice(cameraDeviceId);
    }

    let microphoneDeviceId: string;
    function selectMicrophone() {
        requestedMicrophoneDeviceIdStore.set(microphoneDeviceId);
        localUserStore.setPreferredAudioInputDevice(microphoneDeviceId);
    }

    function startLive() {
        analyticsClient.startMegaphone();
        currentLiveStreamingSpaceStore.set($megaphoneSpaceStore);
        requestedMegaphoneStore.set(true);
        $megaphoneSpaceStore?.startStreaming();
    }

    function stopLive() {
        analyticsClient.stopMegaphone();
        $megaphoneSpaceStore?.stopStreaming();
        currentLiveStreamingSpaceStore.set(undefined);
        requestedMegaphoneStore.set(false);
        dispatch("stopped");
    }

    $: nothingToStream = !$requestedCameraState && !$requestedMicrophoneState && !$requestedScreenSharingState;
    $: streamedParts = [
        $requestedCameraState ? $LL.megaphone.modal.liveMessage.yourCamera() : undefined,
        $requestedMicrophoneState ? $LL.megaphone.modal.liveMessage.yourMicrophone() : undefined,
        $requestedScreenSharingState ? $LL.megaphone.modal.liveMessage.yourScreen() : undefined,
    ].filter((part) => part !== undefined);
    $: streamedSummary =
        streamedParts.length <= 1
            ? streamedParts.join("")
            : `${streamedParts.slice(0, -1).join(", ")} ${$LL.megaphone.modal.liveMessage.and()} ${
                  streamedParts[streamedParts.length - 1]
              }`;
</script>

<div id="content-liveMessage" class="flex flex-col gap-3 text-white">
    {#if $requestedMegaphoneStore}
        <!-- Live: make it obvious that people are seeing and hearing you, and how to stop. -->
        <div
            id="active-liveMessage"
            class="flex flex-col gap-3 rounded-lg border border-danger-800/60 bg-danger-900/30 p-4"
            data-testid="megaphone-live-status"
            role="status"
        >
            <div class="flex items-center gap-2">
                <span class="relative flex h-3 w-3" aria-hidden="true">
                    <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
                    <span class="relative inline-flex h-3 w-3 rounded-full bg-danger" />
                </span>
                <span class="text-lg font-bold">{$LL.megaphone.modal.composer.youAreLive()}</span>
            </div>
            <p class="m-0 text-sm">
                {audience === "room"
                    ? $LL.megaphone.modal.composer.liveAudienceRoom()
                    : $LL.megaphone.modal.composer.liveAudienceWorld()}
            </p>
            {#if streamedSummary}
                <p class="m-0 text-sm opacity-80">
                    {$LL.megaphone.modal.composer.streaming({ what: streamedSummary })}
                </p>
            {/if}
            <button class="btn btn-danger w-full justify-center" data-testid="megaphone-stop" on:click={stopLive}>
                {$LL.megaphone.modal.liveMessage.stopMegaphone()}
            </button>
        </div>
    {:else if $displayedMegaphoneScreenStore}
        <!-- Getting ready: camera preview and devices. Nothing is sent yet. -->
        <div id="active-liveMessage" class="flex flex-col gap-3">
            <div class="flex flex-col md:flex-row gap-3">
                <div class="flex flex-col items-center md:w-1/2">
                    <video
                        bind:this={videoElement}
                        class="w-full max-h-[200px] rounded bg-black/40 object-contain"
                        style="-webkit-transform: scaleX(-1);transform: scaleX(-1);"
                        use:srcObject={stream}
                        autoplay
                        muted
                        playsinline
                    />
                    <div class="mt-2 flex w-full items-center justify-center">
                        <SoundMeterWidget
                            volume={$localVolumeStore}
                            cssClass="!bg-none !bg-transparent"
                            barColor="blue"
                        />
                    </div>
                </div>
                <div class="flex flex-col gap-2 md:w-1/2">
                    <div class="flex flex-row items-center gap-3">
                        <img draggable="false" src={cameraImg} class="h-8 w-8 p-0.5" alt="" />
                        <div class="w-full">
                            <Select bind:value={cameraDeviceId} onChange={() => selectCamera()}>
                                {#if $requestedCameraState && $cameraListStore && $cameraListStore.length > 0}
                                    {#each $cameraListStore as camera (camera.deviceId)}
                                        <option value={camera.deviceId}>
                                            {StringUtils.normalizeDeviceName(camera.label)}
                                        </option>
                                    {/each}
                                {/if}
                            </Select>
                        </div>
                    </div>
                    <div class="flex flex-row items-center gap-3">
                        <img draggable="false" src={microphoneImg} class="h-8 w-8 p-0.5" alt="" />
                        <div class="w-full">
                            <Select bind:value={microphoneDeviceId} onChange={() => selectMicrophone()}>
                                {#if $requestedMicrophoneState && $microphoneListStore && $microphoneListStore.length > 0}
                                    {#each $microphoneListStore as microphone (microphone.deviceId)}
                                        <option value={microphone.deviceId}>
                                            {StringUtils.normalizeDeviceName(microphone.label)}
                                        </option>
                                    {/each}
                                {/if}
                            </Select>
                        </div>
                    </div>
                </div>
            </div>

            {#if nothingToStream}
                <p class="m-0 text-sm text-warning-900">
                    <IconAlertTriangle font-size="14" />
                    {$LL.warning.megaphoneNeeds()}
                </p>
            {:else}
                <p class="m-0 text-sm">
                    {$LL.megaphone.modal.composer.willStream({ what: streamedSummary })}
                    {audience === "room"
                        ? $LL.megaphone.modal.composer.liveReachRoom()
                        : $LL.megaphone.modal.composer.liveReachWorld()}
                </p>
            {/if}

            <div class="flex flex-row gap-2">
                <button class="btn flex-1 justify-center bg-white/10 hover:bg-white/20" on:click={cancelPrepare}>
                    {$LL.megaphone.modal.liveMessage.cancel()}
                </button>
                <button
                    class="btn btn-light flex-[2] justify-center"
                    data-testid="megaphone-start"
                    on:click={startLive}
                    disabled={nothingToStream}
                >
                    {$LL.megaphone.modal.liveMessage.startMegaphone()}
                </button>
            </div>
        </div>
    {:else}
        <p class="m-0 text-sm opacity-80">
            {$LL.megaphone.modal.composer.liveIntro()}
            {#if $megaphoneCanBeUsedStore}
                {audience === "room"
                    ? $LL.megaphone.modal.composer.liveReachRoom()
                    : $LL.megaphone.modal.composer.liveReachWorld()}
            {/if}
        </p>

        {#if !$megaphoneCanBeUsedStore}
            {#if (!megaphoneOnInRoom || awaitingMegaphoneAccess) && canTurnOnMegaphone}
                <div class="flex flex-row flex-wrap items-center gap-2">
                    <p class="help-text !mb-0">
                        <IconInfoCircle class="mr-2 mb-1 min-w-6" font-size="18" />
                        {$LL.megaphone.modal.liveMessage.offInRoom()}
                    </p>
                    <button
                        class="btn btn-secondary btn-sm"
                        data-testid="megaphone-turn-on"
                        on:click={turnOnMegaphone}
                        disabled={turningOnMegaphone || awaitingMegaphoneAccess}
                    >
                        {$LL.megaphone.modal.liveMessage.turnOn()}
                    </button>
                </div>
            {:else}
                <p class="help-text !text-danger-800 !mb-0">
                    <IconInfoCircle class="mr-2 mb-1 min-w-6" font-size="18" />
                    {megaphoneOnInRoom
                        ? $LL.megaphone.modal.liveMessage.notAllowed()
                        : $LL.megaphone.modal.liveMessage.offAskEditor()}
                </p>
            {/if}
        {/if}

        <button
            class="btn btn-light w-full justify-center"
            data-testid="megaphone-prepare"
            on:click={prepareLive}
            disabled={!$megaphoneCanBeUsedStore}
        >
            {$LL.megaphone.modal.liveMessage.button()}
        </button>
    {/if}
</div>
