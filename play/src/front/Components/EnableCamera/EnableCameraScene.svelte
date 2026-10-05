<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { EnableCameraScene } from "../../Phaser/Login/EnableCameraScene";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import {
        requestedCameraDeviceIdStore,
        batchGetUserMediaStore,
        cameraListStore,
        localVolumeStore,
        requestedMicrophoneDeviceIdStore,
        microphoneListStore,
        speakerListStore,
        requestedCameraState,
        requestedMicrophoneState,
        speakerSelectedStore,
        localStreamStore,
    } from "../../Stores/MediaStore";
    import type { Game } from "../../Phaser/Game/Game";
    import { LL } from "../../../i18n/i18n-svelte";
    import { myCameraStore, myMicrophoneStore } from "../../Stores/MyMediaStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { StringUtils } from "../../Utils/StringUtils";
    import { popupStore } from "../../Stores/PopupStore";
    import { hideHelpCameraSettings, showHelpCameraSettings } from "../../Stores/HelpSettingsStore";
    import bgMap from "../images/map-exemple.png";
    import JoinLegal from "../Join/JoinLegal.svelte";
    import MyWoka from "../Join/MyWoka.svelte";
    import HorizontalSoundMeterWidget from "./HorizontalSoundMeterWidget.svelte";
    import {
        IconCamera,
        IconChevronDown,
        IconHeadphonesOutline,
        IconLock,
        IconMicrophoneOn,
        IconPlay,
        IconX,
    } from "@wa-icons";

    export let game: Game;

    const enableCameraScene = game.scene.getScene(EnableCameraSceneName) as EnableCameraScene;
    // Opened from the game (Test my settings, the device list): the round close leads back into the room
    const canGoBack = gameManager.canResumeGame;
    const playerName = gameManager.getPlayerName() ?? "";

    let selectedCamera: string | undefined = undefined;
    let selectedMicrophone: string | undefined = undefined;
    // The devices to come back to when a switch is turned on again
    let lastCamera: string | undefined = undefined;
    let lastMicrophone: string | undefined = undefined;
    let cameraBlocked = false;
    let microphoneBlocked = false;
    const sound = new Audio("/resources/objects/webrtc-in.mp3");

    function submit() {
        selectCamera(selectedCamera);
        selectMicrophone(selectedMicrophone);
        enableCameraScene.login();
    }

    function srcObject(node: HTMLVideoElement, stream: MediaStream) {
        node.srcObject = stream;
        return {
            update(newStream: MediaStream) {
                if (node.srcObject != newStream) {
                    node.srcObject = newStream;
                }
            },
        };
    }

    let stream: MediaStream | undefined;

    const unsubscribeLocalStreamStore = localStreamStore.subscribe((value) => {
        if (value.type === "success") {
            stream = value.stream;

            if (stream !== undefined) {
                const videoTracks = stream.getVideoTracks();
                if (videoTracks.length > 0) {
                    selectedCamera = videoTracks[0].getSettings().deviceId;
                    lastCamera = selectedCamera;
                } else {
                    selectedCamera = undefined;
                }
                const audioTracks = stream.getAudioTracks();
                if (audioTracks.length > 0) {
                    selectedMicrophone = audioTracks[0].getSettings().deviceId;
                    lastMicrophone = selectedMicrophone;
                } else {
                    selectedMicrophone = undefined;
                }
            }
        } else {
            stream = undefined;
            selectedCamera = undefined;
            selectedMicrophone = undefined;
            if (value.error.name === "NotAllowedError") {
                checkPermissions().catch((e) => console.warn(e));
            }
        }
    });

    // Which device the browser refuses. Firefox can't be asked about the camera: it falls back to the stream error.
    async function permissionState(name: string): Promise<PermissionState | undefined> {
        try {
            return (await navigator.permissions.query({ name: name as PermissionName })).state;
        } catch {
            return undefined;
        }
    }

    async function checkPermissions() {
        const [camera, microphone] = await Promise.all([permissionState("camera"), permissionState("microphone")]);
        if (camera === undefined && microphone === undefined && $localStreamStore.type === "error") {
            cameraBlocked = $localStreamStore.error.name === "NotAllowedError";
            microphoneBlocked = cameraBlocked;
            return;
        }
        cameraBlocked = camera === "denied";
        microphoneBlocked = microphone === "denied";
    }

    onDestroy(() => {
        unsubscribeLocalStreamStore();
        hideHelpCameraSettings();
    });

    onMount(() => {
        //init the component to enable webcam and microphone
        batchGetUserMediaStore.startBatch();
        myCameraStore.set(true);
        myMicrophoneStore.set(true);
        requestedCameraState.enableWebcam();

        requestedMicrophoneState.enableMicrophone();

        batchGetUserMediaStore.commitChanges();
        sound.load();
        checkPermissions().catch((e) => console.warn(e));
    });

    function selectCamera(newCameraSelected: string | undefined = undefined) {
        selectedCamera = newCameraSelected;
        if (!selectedCamera) {
            localUserStore.setPreferredVideoInputDevice("");
            requestedCameraState.disableWebcam();
            return;
        }
        requestedCameraState.enableWebcam();
        requestedCameraDeviceIdStore.set(selectedCamera);
        localUserStore.setPreferredVideoInputDevice(selectedCamera);
    }

    function selectMicrophone(newMicrophoneSelected: string | undefined = undefined) {
        selectedMicrophone = newMicrophoneSelected;
        if (!selectedMicrophone) {
            localUserStore.setPreferredAudioInputDevice("");
            requestedMicrophoneState.disableMicrophone();
            return;
        }
        requestedMicrophoneState.enableMicrophone();
        requestedMicrophoneDeviceIdStore.set(selectedMicrophone);
        localUserStore.setPreferredAudioInputDevice(selectedMicrophone);
    }

    function selectSpeaker(deviceId: string | undefined) {
        localUserStore.setSpeakerDeviceId(deviceId ?? "");
        speakerSelectedStore.set(deviceId);
    }

    function toggleCamera() {
        if ($requestedCameraState) {
            selectCamera(undefined);
            return;
        }
        const deviceId = lastCamera ?? $cameraListStore?.[0]?.deviceId;
        if (deviceId) {
            selectCamera(deviceId);
        } else {
            requestedCameraState.enableWebcam();
        }
    }

    function toggleMicrophone() {
        if ($requestedMicrophoneState) {
            selectMicrophone(undefined);
            return;
        }
        const deviceId = lastMicrophone ?? $microphoneListStore?.[0]?.deviceId;
        if (deviceId) {
            selectMicrophone(deviceId);
        } else {
            requestedMicrophoneState.enableMicrophone();
        }
    }

    function tryAgain() {
        batchGetUserMediaStore.startBatch();
        requestedCameraState.enableWebcam();
        requestedMicrophoneState.enableMicrophone();
        batchGetUserMediaStore.commitChanges();
        checkPermissions().catch((e) => console.warn(e));
    }

    // The browser's "access needed" card only opens here when asked: the screen already says what is blocked, and on
    // a phone the card would sit over Save
    let helpAsked = false;

    function howToAllow() {
        helpAsked = true;
        showHelpCameraSettings();
    }

    function closeHelp() {
        helpAsked = false;
        popupStore.removePopup("cameraAccessDenied");
    }

    function playSoundClick() {
        sound.play().catch((e) => console.error(e));
    }

    function onSpeakerChange(event: Event) {
        selectSpeaker((event.currentTarget as HTMLSelectElement).value);
        playSoundClick();
    }

    $: cameraOn = $requestedCameraState;
    $: microphoneOn = $requestedMicrophoneState;
    $: videoStream =
        cameraOn && $localStreamStore.type === "success" && $localStreamStore.stream?.getVideoTracks().length
            ? $localStreamStore.stream
            : undefined;
    $: showSpeaker = $speakerSelectedStore != undefined && $speakerListStore && $speakerListStore.length > 0;
    $: helpPopup = helpAsked ? $popupStore.find((popup) => popup.uuid === "cameraAccessDenied") : undefined;
    // Closed from inside the card: a later error does not reopen it on its own
    $: if (helpAsked && !$popupStore.some((popup) => popup.uuid === "cameraAccessDenied")) helpAsked = false;
</script>

<div class="absolute start-0 top-0 w-dvw h-dvh bg-cover z-10" style="background-image: url('{bgMap}');" />
<div class="absolute start-0 top-0 w-dvw h-dvh z-20 enable-camera-overlay" />

<form
    class="enableCameraScene pointer-events-auto relative z-30 m-0 min-h-dvh flex md:items-center md:justify-center md:p-6"
    on:submit|preventDefault={submit}
>
    <div
        class="u-join-card w-full md:max-w-[920px] min-h-dvh md:min-h-0 !rounded-none md:!rounded-[24px] flex flex-col px-4 pt-5 md:p-7"
    >
        {#if canGoBack}
            <button
                type="button"
                class="u-close u-join-x enableCameraSceneBack !top-3.5 !right-3 md:!top-4 md:!right-4"
                aria-label={$LL.camera.enable.back()}
                title={$LL.camera.enable.back()}
                on:click={() => enableCameraScene.back()}
            >
                <IconX font-size="20" />
            </button>
        {/if}

        <header class="flex flex-col gap-1 md:gap-1.5 mb-3.5 md:mb-5 {canGoBack ? 'pe-12' : ''}">
            <span class="u-eyebrow">{$LL.camera.enable.eyebrow()}</span>
            <h2 class="u-join-title">{$LL.camera.enable.title()}</h2>
            <p class="u-join-sub hidden md:block">{$LL.camera.enable.subtitle()}</p>
        </header>

        <div class="grid gap-2.5 md:gap-6 md:grid-cols-[1.25fr_1fr]">
            <!-- CAMERA -->
            <div class="grid gap-2.5 md:gap-3 content-start">
                <div class="camera-preview relative overflow-hidden rounded-[18px] aspect-[4/3] md:aspect-video">
                    {#if videoStream}
                        <video
                            class="myCamVideoSetup absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                            use:srcObject={videoStream}
                            autoplay
                            muted
                            playsinline
                        />
                        {#if playerName}
                            <span class="camera-name-chip">
                                <span class="camera-name-dot" />
                                <span class="truncate">{playerName}</span>
                            </span>
                        {/if}
                    {:else if cameraBlocked}
                        <div class="camera-off-message">
                            <span class="camera-off-icon"><IconLock font-size="28" /></span>
                            <span class="text-base font-semibold text-white">{$LL.camera.enable.cameraBlocked()}</span>
                            <span class="font-normal">{$LL.camera.enable.blockedHint()}</span>
                            <span class="flex flex-wrap justify-center gap-2 mt-1">
                                <button
                                    type="button"
                                    class="u-join-btn u-join-btn-sm u-cta-secondary"
                                    on:click={howToAllow}>{$LL.camera.enable.howToAllow()}</button
                                >
                                <button
                                    type="button"
                                    class="u-join-btn u-join-btn-sm u-cta-secondary"
                                    on:click={tryAgain}>{$LL.camera.enable.tryAgain()}</button
                                >
                            </span>
                        </div>
                    {:else if !cameraOn}
                        <div class="camera-off-message">
                            <span class="camera-off-icon overflow-hidden"><MyWoka size={56} /></span>
                            <span class="text-base font-semibold text-white">{$LL.camera.enable.cameraOff()}</span>
                            <span class="font-normal">{$LL.camera.enable.cameraOffHint()}</span>
                        </div>
                    {:else}
                        <div class="camera-off-message">
                            <span class="font-normal">{$LL.camera.my.loading()}</span>
                        </div>
                    {/if}
                </div>
                <div class="u-join-label mt-1 md:mt-0">
                    <span>{$LL.camera.enable.camera()}</span>
                    <span class="flex items-center gap-2">
                        <span class="device-state">{cameraOn ? $LL.camera.enable.on() : $LL.camera.enable.off()}</span>
                        <button
                            type="button"
                            role="switch"
                            class="u-join-switch"
                            aria-checked={cameraOn}
                            aria-label={$LL.camera.enable.camera()}
                            on:click={toggleCamera}
                        />
                    </span>
                </div>
                <label class="u-join-field" class:opacity-50={!cameraOn}>
                    <IconCamera font-size="18" class="flex-none text-white/80" />
                    <select
                        aria-label={$LL.camera.enable.camera()}
                        value={selectedCamera ?? ""}
                        disabled={!cameraOn || !$cameraListStore?.length}
                        on:change={(e) => selectCamera(e.currentTarget.value || undefined)}
                    >
                        {#if !$cameraListStore?.length}
                            <option value="">{$LL.camera.enable.noDevice()}</option>
                        {/if}
                        {#each $cameraListStore ?? [] as camera (camera.deviceId)}
                            <option value={camera.deviceId}>{StringUtils.normalizeDeviceName(camera.label)}</option>
                        {/each}
                    </select>
                    <IconChevronDown font-size="16" class="flex-none text-white/70 pointer-events-none" />
                </label>
            </div>

            <!-- MICROPHONE AND SPEAKER -->
            <div class="grid gap-2.5 md:gap-3 content-start">
                <div class="u-join-label mt-1.5 md:mt-0">
                    <span>{$LL.camera.enable.microphone()}</span>
                    <span class="flex items-center gap-2">
                        <span class="device-state"
                            >{microphoneOn ? $LL.camera.enable.on() : $LL.camera.enable.off()}</span
                        >
                        <button
                            type="button"
                            role="switch"
                            class="u-join-switch"
                            aria-checked={microphoneOn}
                            aria-label={$LL.camera.enable.microphone()}
                            on:click={toggleMicrophone}
                        />
                    </span>
                </div>
                <label class="u-join-field" class:opacity-50={!microphoneOn}>
                    <IconMicrophoneOn font-size="18" class="flex-none text-white/80" />
                    <select
                        aria-label={$LL.camera.enable.microphone()}
                        value={selectedMicrophone ?? ""}
                        disabled={!microphoneOn || !$microphoneListStore?.length}
                        on:change={(e) => selectMicrophone(e.currentTarget.value || undefined)}
                    >
                        {#if !$microphoneListStore?.length}
                            <option value="">{$LL.camera.enable.noDevice()}</option>
                        {/if}
                        {#each $microphoneListStore ?? [] as microphone (microphone.deviceId)}
                            <option value={microphone.deviceId}
                                >{StringUtils.normalizeDeviceName(microphone.label)}</option
                            >
                        {/each}
                    </select>
                    <IconChevronDown font-size="16" class="flex-none text-white/70 pointer-events-none" />
                </label>
                {#if microphoneBlocked}
                    <p class="u-join-error">
                        {$LL.camera.enable.microphoneBlocked()}
                        {$LL.camera.enable.blockedHint()}
                    </p>
                {:else if microphoneOn}
                    <div class="grid gap-1.5">
                        <HorizontalSoundMeterWidget spectrum={$localVolumeStore} />
                        <p class="u-join-hint hidden md:block">{$LL.camera.enable.meterHint()}</p>
                    </div>
                {:else}
                    <p class="u-join-hint">{$LL.camera.enable.microphoneOff()}</p>
                {/if}

                {#if showSpeaker}
                    <div class="u-join-label mt-1.5 md:mt-2"><span>{$LL.camera.enable.speaker()}</span></div>
                    <label class="u-join-field">
                        <IconHeadphonesOutline font-size="18" class="flex-none text-white/80" />
                        <select
                            aria-label={$LL.camera.enable.speaker()}
                            value={$speakerSelectedStore ?? ""}
                            on:change={onSpeakerChange}
                        >
                            {#each $speakerListStore ?? [] as speaker (speaker.deviceId)}
                                <option value={speaker.deviceId}
                                    >{StringUtils.normalizeDeviceName(speaker.label)}</option
                                >
                            {/each}
                        </select>
                        <IconChevronDown font-size="16" class="flex-none text-white/70 pointer-events-none" />
                    </label>
                    <button
                        type="button"
                        class="u-join-btn u-join-btn-sm u-cta-secondary justify-self-start"
                        on:click={playSoundClick}
                    >
                        <IconPlay font-size="14" />
                        {$LL.camera.enable.testSound()}
                    </button>
                {/if}
            </div>
        </div>

        <footer
            class="enable-camera-footer mt-auto md:mt-6 pt-4 pb-4 md:pb-0 md:pt-[18px] flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-2 md:gap-4"
        >
            <JoinLegal classList="text-center md:text-start" />
            <button type="submit" class="u-join-btn u-cta w-full md:w-auto md:min-w-[200px] md:ms-auto"
                >{$LL.menu.settings.save()}</button
            >
        </footer>
    </div>
</form>

{#if helpPopup}
    <div class="fixed inset-x-0 bottom-0 z-[1000] flex justify-center p-3 pointer-events-none">
        <svelte:component this={helpPopup.component} {...helpPopup.props} on:close={closeHelp} />
    </div>
{/if}

<style lang="scss">
    .enable-camera-overlay {
        background: radial-gradient(ellipse at 50% 30%, rgb(20 18 30 / 0.7), rgb(10 8 20 / 0.88));
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }
    .camera-preview {
        background: radial-gradient(ellipse at 50% 35%, #4a3b5f, #211b30 70%);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .camera-preview:has(.camera-off-message) {
        background: #15121f;
    }
    .camera-off-message {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0 1rem;
        text-align: center;
        font-size: 0.875rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
    }
    .camera-off-icon {
        display: grid;
        place-items: center;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.06);
    }
    .camera-name-chip {
        position: absolute;
        left: 0.75rem;
        bottom: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        max-width: calc(100% - 1.5rem);
        height: 1.875rem;
        padding: 0 0.625rem;
        border-radius: 9999px;
        background: rgb(10 8 20 / 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        font-size: 0.8125rem;
        font-weight: 700;
        color: #fff;
    }
    .camera-name-dot {
        flex: none;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: #3fd27a;
        box-shadow: 0 0 8px #3fd27a;
    }
    .device-state {
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
        color: rgba(255, 255, 255, 0.55);
    }
    .enable-camera-footer {
        border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    @media (max-width: 767px) {
        .enable-camera-footer {
            position: sticky;
            bottom: 0;
            border-top: 0;
            background: linear-gradient(180deg, transparent, rgb(20 18 30 / 0.95) 30%);
        }
    }
</style>
