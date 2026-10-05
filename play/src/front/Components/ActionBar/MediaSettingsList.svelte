<script lang="ts">
    import { fly } from "svelte/transition";
    import { clickOutside } from "svelte-outside";
    import { createEventDispatcher } from "svelte";
    import { EnableCameraScene, EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import {
        cameraListStore,
        enableCameraSceneVisibilityStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        speakerListStore,
        speakerSelectedStore,
        silentStore,
        usedCameraDeviceIdStore,
        usedMicrophoneDeviceIdStore,
    } from "../../Stores/MediaStore";

    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { StringUtils } from "../../Utils/StringUtils";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import { backgroundProcessingEnabledStore } from "../../Stores/BackgroundTransformStore";
    import BackgroundPanel from "./BackgroundPanel.svelte";
    import NoiseFilterChoice from "./NoiseFilterChoice.svelte";
    import { IconCamera, IconMicrophoneOn, IconHeadphones, IconCheck } from "@wa-icons";

    export let mediaSettingsDisplayed = false;

    let tab: "devices" | "background" = "devices";

    function showTab(newTab: "devices" | "background") {
        if (newTab === "background" && tab !== "background") {
            analyticsClient.openBackgroundSettings();
        }
        tab = newTab;
    }

    const dispatch = createEventDispatcher<{
        close: void;
    }>();

    function selectCamera(deviceId: string) {
        requestedCameraDeviceIdStore.set(deviceId);
        localUserStore.setPreferredVideoInputDevice(deviceId);
        mediaSettingsDisplayed = false;
    }

    function selectMicrophone(deviceId: string) {
        requestedMicrophoneDeviceIdStore.set(deviceId);
        localUserStore.setPreferredAudioInputDevice(deviceId);
        //microphoneActive = false;
    }

    function selectSpeaker(deviceId: string) {
        localUserStore.setSpeakerDeviceId(deviceId);
        speakerSelectedStore.set(deviceId);
    }

    function cameraClick(): void {
        if ($silentStore) return;
        if ($requestedCameraState === true) {
            requestedCameraState.disableWebcam();
        } else {
            requestedCameraState.enableWebcam();
        }
    }

    function openEnableCameraScene() {
        enableCameraSceneVisibilityStore.showEnableCameraScene();
        gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
    }

    function microphoneClick(): void {
        if ($silentStore) return;
        if ($requestedMicrophoneState === true) {
            requestedMicrophoneState.disableMicrophone();
        } else {
            requestedMicrophoneState.enableMicrophone();
        }
    }
</script>

<!-- Same box as before: 256px wide, under the mic and camera on desktop and above them on phones, centred on them.
     The height cap now includes the footer, so a long list on a phone no longer pushes the top off screen.
     Only the inside is in Universe style: the raised ink surface, violet eyebrows, 40px rows (48px on phones), our
     purple for the device in use, and gradient buttons to turn the camera or microphone back on. -->
<div
    class="device-list absolute top-20 bottom-auto mobile:top-auto mobile:bottom-20 start-1/2 transform -translate-x-1/2 text-white rounded-2xl w-64 overflow-hidden flex flex-col after:content-[''] after:absolute after:z-0 after:w-full after:bg-transparent after:h-full after:-top-4 after:-start-0 transition-all"
    style="max-height: calc(100vh - 160px);"
    in:fly={{ y: 40, duration: 150 }}
    use:clickOutside={() => dispatch("close")}
>
    <!-- Devices | Background: pill tabs in the same violet as the selected device. The dot means an effect is on. -->
    <div class="tabs relative z-10 mx-1.5 mt-1.5" role="tablist">
        <button
            type="button"
            role="tab"
            aria-selected={tab === "devices"}
            class:on={tab === "devices"}
            on:click|stopPropagation={() => showTab("devices")}>{$LL.camera.backgroundEffects.devicesTab()}</button
        >
        <button
            type="button"
            role="tab"
            aria-selected={tab === "background"}
            class:on={tab === "background"}
            data-testid="background-tab"
            on:click|stopPropagation={() => showTab("background")}
        >
            {$LL.camera.backgroundEffects.backgroundTab()}
            {#if $backgroundProcessingEnabledStore}<span class="tab-dot" />{/if}
        </button>
    </div>
    {#if tab === "background"}
        <div
            class="relative z-10 flex flex-col min-h-0 flex-1 overflow-auto px-1.5 pt-2 pb-1 *:shrink-0"
            role="tabpanel"
        >
            <BackgroundPanel />
        </div>
    {:else}
        <div
            class="relative z-10 flex flex-col min-h-0 flex-1 overflow-auto px-1.5 pt-2 pb-1 *:shrink-0"
            role="tabpanel"
        >
            <div class="u-eyebrow px-2 py-1.5">{$LL.actionbar.subtitle.camera()}</div>
            {#if $silentStore == false && $requestedCameraState && $cameraListStore && $cameraListStore.length > 0}
                {#each $cameraListStore as camera, index (index)}
                    <button
                        type="button"
                        class="device-row group min-h-10 mobile:min-h-12"
                        class:selected={$usedCameraDeviceIdStore === camera.deviceId}
                        aria-pressed={$usedCameraDeviceIdStore === camera.deviceId}
                        title={StringUtils.normalizeDeviceName(camera.label)}
                        on:click|stopPropagation|preventDefault={() => {
                            analyticsClient.selectCamera();
                            selectCamera(camera.deviceId);
                        }}
                    >
                        <span class="device-tile"><IconCamera font-size="16" /></span>
                        <span class="device-name">{StringUtils.normalizeDeviceName(camera.label)}</span>
                        {#if $usedCameraDeviceIdStore === camera.deviceId}
                            <IconCheck font-size="16" class="shrink-0 text-[#c4b5fd]" />
                        {/if}
                    </button>
                {/each}
            {:else}
                <div class="device-off">
                    <span class="device-off-dot" />
                    {#if $cameraListStore == undefined || $cameraListStore.length == 0}
                        {$LL.actionbar.camera.noDevices()}
                    {:else}
                        {$LL.actionbar.camera.disabled()}
                    {/if}
                </div>
                {#if $silentStore == false && $requestedCameraState == false}
                    <button
                        type="button"
                        class="u-cta flex items-center justify-center h-10 mobile:h-12 mx-1 mb-1 rounded-xl text-sm font-bold"
                        on:click={() => analyticsClient.camera()}
                        on:click={cameraClick}
                    >
                        {$LL.actionbar.camera.activate()}
                    </button>
                {/if}
            {/if}
            <div class="h-px bg-white/10 mx-1.5 my-1.5" />
            <div class="u-eyebrow px-2 py-1.5">{$LL.actionbar.subtitle.microphone()}</div>
            {#if $silentStore == false && $requestedMicrophoneState && $microphoneListStore && $microphoneListStore.length > 0}
                {#each $microphoneListStore as microphone, index (index)}
                    <button
                        type="button"
                        class="device-row group min-h-10 mobile:min-h-12"
                        class:selected={$usedMicrophoneDeviceIdStore === microphone.deviceId}
                        aria-pressed={$usedMicrophoneDeviceIdStore === microphone.deviceId}
                        title={StringUtils.normalizeDeviceName(microphone.label)}
                        on:click={() => {
                            analyticsClient.selectMicrophone();
                        }}
                        on:click|stopPropagation|preventDefault={() => selectMicrophone(microphone.deviceId)}
                    >
                        <span class="device-tile"><IconMicrophoneOn font-size="16" /></span>
                        <span class="device-name">{StringUtils.normalizeDeviceName(microphone.label)}</span>
                        {#if $usedMicrophoneDeviceIdStore === microphone.deviceId}
                            <IconCheck font-size="16" class="shrink-0 text-[#c4b5fd]" />
                        {/if}
                    </button>
                {/each}
                <NoiseFilterChoice />
            {:else}
                <div class="device-off">
                    <span class="device-off-dot" />
                    {#if $microphoneListStore == undefined || $microphoneListStore.length == 0}
                        {$LL.actionbar.microphone.noDevices()}
                    {:else}
                        {$LL.actionbar.microphone.disabled()}
                    {/if}
                </div>
                {#if $silentStore == false && $requestedMicrophoneState == false}
                    <button
                        type="button"
                        class="u-cta flex items-center justify-center h-10 mobile:h-12 mx-1 mb-1 rounded-xl text-sm font-bold"
                        on:click={() => analyticsClient.microphone()}
                        on:click={microphoneClick}
                    >
                        {$LL.actionbar.microphone.activate()}
                    </button>
                {/if}
            {/if}
            {#if $speakerListStore !== undefined}
                <div class="h-px bg-white/10 mx-1.5 my-1.5" />
                <div class="u-eyebrow px-2 py-1.5">{$LL.actionbar.subtitle.speaker()}</div>
            {/if}
            {#if $speakerSelectedStore != undefined && $speakerListStore && $speakerListStore.length > 0}
                {#each $speakerListStore as speaker, index (index)}
                    <button
                        type="button"
                        class="device-row group min-h-10 mobile:min-h-12"
                        class:selected={$speakerSelectedStore === speaker.deviceId}
                        aria-pressed={$speakerSelectedStore === speaker.deviceId}
                        title={StringUtils.normalizeDeviceName(speaker.label)}
                        on:click={() => {
                            analyticsClient.selectSpeaker();
                        }}
                        on:click|stopPropagation|preventDefault={() => selectSpeaker(speaker.deviceId)}
                    >
                        <span class="device-tile"><IconHeadphones font-size="16" /></span>
                        <span class="device-name">{StringUtils.normalizeDeviceName(speaker.label)}</span>
                        {#if $speakerSelectedStore === speaker.deviceId}
                            <IconCheck font-size="16" class="shrink-0 text-[#c4b5fd]" />
                        {/if}
                    </button>
                {/each}
            {:else if $speakerListStore !== undefined}
                <div class="device-off">
                    {#if $speakerListStore.length === 0}
                        {$LL.actionbar.speaker.noDevices()}
                    {:else}
                        {$LL.actionbar.speaker.disabled()}
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
    <div class="relative z-10 flex shrink-0 gap-2 p-2.5 border-t border-white/5">
        <button
            type="button"
            class="u-cta-secondary flex-1 flex items-center justify-center h-[38px] mobile:h-12 rounded-xl text-[13px] font-bold text-nowrap"
            on:click={openEnableCameraScene}>{$LL.actionbar.test()}</button
        >
        <button
            type="button"
            class="flex-1 flex items-center justify-center h-[38px] mobile:h-12 rounded-xl text-[13px] font-bold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            on:click|stopPropagation|preventDefault={() => dispatch("close")}
        >
            {$LL.actionbar.close()}
        </button>
    </div>
</div>

<style>
    .device-list {
        background: var(--u-surface-bg);
        box-shadow: var(--u-surface-shadow);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    .device-list button {
        font-family: inherit;
    }
    .tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        padding: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .tabs button {
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 1px solid transparent;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.62);
        cursor: pointer;
        transition: background-color 150ms ease, color 150ms ease;
    }
    .tabs button:hover:not(.on) {
        color: #fff;
        background: rgba(255, 255, 255, 0.05);
    }
    .tabs button:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .tabs button.on {
        background: rgba(134, 41, 252, 0.2);
        border-color: rgba(167, 139, 250, 0.45);
        color: #fff;
    }
    .tab-dot {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 0 0 2px rgba(134, 41, 252, 0.3);
    }
    .device-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        margin-bottom: 2px;
        padding: 0 0.5rem 0 0.375rem;
        border: 1px solid transparent;
        border-radius: 0.75rem;
        font-size: 0.875rem;
        text-align: start;
        color: rgba(255, 255, 255, 0.85);
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease;
    }
    .device-row:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
    }
    .device-row:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
    .device-row.selected {
        background: rgba(134, 41, 252, 0.16);
        border-color: rgba(167, 139, 250, 0.45);
        color: #fff;
        font-weight: 700;
    }
    .device-tile {
        flex: none;
        display: grid;
        place-items: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 0.5625rem;
        opacity: 0.55;
    }
    .device-row.selected .device-tile {
        opacity: 1;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 4px 12px -4px rgba(134, 41, 252, 0.8);
    }
    .device-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .device-off {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.125rem 0.5rem 0.5rem;
        font-size: 0.8125rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .device-off-dot {
        flex: none;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: #e96d51;
        box-shadow: 0 0 0 3px rgba(233, 109, 81, 0.2);
    }
</style>
