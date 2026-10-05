<script lang="ts">
    import { onDestroy } from "svelte";
    import {
        audioManagerFileStore,
        audioManagerVisibilityStore,
        bubbleSoundStore,
    } from "../../Stores/AudioManagerStore";
    import { LL, locale } from "../../../i18n/i18n-svelte";
    import type { Locales } from "../../../i18n/i18n-types";
    import { displayableLocales, setCurrentLocale } from "../../Utils/locales";
    import { gameManager } from "../../Phaser/Game/GameManager";

    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import {
        PEER_SCREEN_SHARE_LOW_BANDWIDTH,
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH,
        PEER_VIDEO_LOW_BANDWIDTH,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH,
    } from "../../Enum/EnvironmentVariable";
    import { videoBandwidthStore } from "../../Stores/MediaStore";
    import { screenShareBandwidthStore } from "../../Stores/ScreenSharingStore";
    import { volumeProximityDiscussionStore } from "../../Stores/PeerStore";
    import SettingSection from "./Settings/SettingSection.svelte";
    import SettingSwitch from "./Settings/SettingSwitch.svelte";
    import SettingChoice from "./Settings/SettingChoice.svelte";
    import SettingLink from "./Settings/SettingLink.svelte";
    import { IconMute, IconPlayFilled, IconUnMute } from "@wa-icons";

    /**
     * The settings, as two pages of plain rows under violet labels, like the profile menu: "general" and "sound"
     * (Sound and video). Choices show their value and open underneath; switches are the brand gradient when on.
     * On a computer each page is two columns.
     */
    export let section: "general" | "sound" = "general";
    /** The pages a row here opens inside the settings window (Map credits, and Report when the room has it). */
    export let pages: { key: string; label: string }[] = [];
    export let onOpenPage: (key: string) => void = () => {};

    let fullscreen: boolean = localUserStore.getFullscreen();
    let notification: boolean = localUserStore.getNotification();
    let allowPictureInPicture: boolean = localUserStore.getAllowPictureInPicture();
    let blockAudio: boolean = localUserStore.getBlockAudio();
    let forceCowebsiteTrigger: boolean = localUserStore.getForceCowebsiteTrigger();
    let ignoreFollowRequests: boolean = localUserStore.getIgnoreFollowRequests();
    let decreaseAudioPlayerVolumeWhileTalking: boolean = localUserStore.getDecreaseAudioPlayerVolumeWhileTalking();
    let disableAnimations: boolean = localUserStore.getDisableAnimations();
    let valueCameraPrivacySettings = localUserStore.getCameraPrivacySettings();
    let valueMicrophonePrivacySettings = localUserStore.getMicrophonePrivacySettings();

    // Safari on iPhone has neither full screen nor (outside a home screen app) notifications: no row for them there.
    const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled === true;
    const canNotify = typeof Notification !== "undefined";

    type Quality = "low" | "recommended" | "unlimited";

    function qualityOf(value: number | "unlimited", low: number): Quality {
        return value === "unlimited" ? "unlimited" : value === low ? "low" : "recommended";
    }

    let videoQuality: Quality = qualityOf(localUserStore.getVideoBandwidth(), PEER_VIDEO_LOW_BANDWIDTH);
    let screenShareQuality: Quality = qualityOf(
        localUserStore.getScreenShareBandwidth(),
        PEER_SCREEN_SHARE_LOW_BANDWIDTH
    );

    let volumeProximityDiscussion = localUserStore.getVolumeProximityDiscussion();
    let valueBubbleSound = localUserStore.getBubbleSound();
    const sound = new Audio();

    /** The one choice that is open, if any: opening another closes it. */
    let openChoice: string | undefined = undefined;

    function toggleChoice(id: string) {
        openChoice = openChoice === id ? undefined : id;
    }

    $: qualityOptions = [
        { value: "low", label: $LL.menu.settings.quality.saveData(), hint: $LL.menu.settings.quality.saveDataHint() },
        { value: "recommended", label: $LL.menu.settings.quality.normal() },
        { value: "unlimited", label: $LL.menu.settings.quality.best(), hint: $LL.menu.settings.quality.bestHint() },
    ];

    const localeOptions = displayableLocales.map((displayable) => ({
        value: displayable.id,
        label: `${
            displayable.language
                ? displayable.language.charAt(0).toUpperCase() + displayable.language.slice(1)
                : displayable.id
        } (${displayable.region})`,
    }));

    $: bubbleSoundOptions = [
        { value: "ding", label: $LL.menu.settings.bubbleSoundOptions.ding() },
        { value: "wobble", label: $LL.menu.settings.bubbleSoundOptions.wobble() },
    ];

    async function selectLocale(value: string) {
        openChoice = undefined;
        await setCurrentLocale(value as Locales);
    }

    function selectVideoQuality(value: string) {
        videoQuality = value as Quality;
        openChoice = undefined;
        videoBandwidthStore.setBandwidth(
            videoQuality === "low"
                ? PEER_VIDEO_LOW_BANDWIDTH
                : videoQuality === "unlimited"
                ? "unlimited"
                : PEER_VIDEO_RECOMMENDED_BANDWIDTH
        );
    }

    function selectScreenShareQuality(value: string) {
        screenShareQuality = value as Quality;
        openChoice = undefined;
        screenShareBandwidthStore.setBandwidth(
            screenShareQuality === "low"
                ? PEER_SCREEN_SHARE_LOW_BANDWIDTH
                : screenShareQuality === "unlimited"
                ? "unlimited"
                : PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH
        );
    }

    function changeFullscreen() {
        analyticsClient.settingFullscreen(fullscreen ? "true" : "false");

        if (document.fullscreenElement !== null && !fullscreen) {
            document.exitFullscreen().catch((e) => console.error(e));
        } else if (fullscreen) {
            document.documentElement.requestFullscreen().catch((e) => console.error(e));
        }
        localUserStore.setFullscreen(fullscreen);
    }

    // Leaving full screen with Esc or the browser's own control turns the switch off too.
    function onFullscreenChange() {
        if (document.fullscreenElement === null && fullscreen) {
            fullscreen = false;
            localUserStore.setFullscreen(false);
        }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    onDestroy(() => document.removeEventListener("fullscreenchange", onFullscreenChange));

    function changeNotification() {
        analyticsClient.settingNotification(notification ? "true" : "false");

        if (Notification.permission === "granted") {
            localUserStore.setNotification(notification);
        } else {
            Notification.requestPermission()
                .then((response) => {
                    if (response === "granted") {
                        localUserStore.setNotification(notification);
                    } else {
                        localUserStore.setNotification(false);
                        notification = false;
                    }
                })
                .catch((e) => console.error(e));
        }
    }

    function changePictureInPicture() {
        analyticsClient.settingPictureInPicture(allowPictureInPicture ? "true" : "false");
        localUserStore.setAllowPictureInPicture(allowPictureInPicture);
    }

    function changeBlockAudio() {
        if (blockAudio) {
            audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("disabledBySettings");
        }
        localUserStore.setBlockAudio(blockAudio);
    }

    function changeForceCowebsiteTrigger() {
        analyticsClient.settingAskWebsite(forceCowebsiteTrigger ? "true" : "false");
        localUserStore.setForceCowebsiteTrigger(forceCowebsiteTrigger);
    }

    function changeIgnoreFollowRequests() {
        analyticsClient.settingRequestFollow(ignoreFollowRequests ? "true" : "false");
        localUserStore.setIgnoreFollowRequests(ignoreFollowRequests);
    }

    function changeDecreaseAudioPlayerVolumeWhileTalking() {
        analyticsClient.settingDecreaseAudioVolume(decreaseAudioPlayerVolumeWhileTalking ? "true" : "false");
        localUserStore.setDecreaseAudioPlayerVolumeWhileTalking(decreaseAudioPlayerVolumeWhileTalking);
    }

    function changeDisableAnimations() {
        localUserStore.setDisableAnimations(disableAnimations);
        if (disableAnimations) {
            gameManager.getCurrentGameScene().animatedTiles.pause();
        } else {
            gameManager.getCurrentGameScene().animatedTiles.resume();
        }
    }

    function changeCameraPrivacySettings() {
        analyticsClient.settingCamera(valueCameraPrivacySettings ? "true" : "false");
        localUserStore.setCameraPrivacySettings(valueCameraPrivacySettings);
    }

    function changeMicrophonePrivacySettings() {
        analyticsClient.settingMicrophone(valueMicrophonePrivacySettings ? "true" : "false");
        localUserStore.setMicrophonePrivacySettings(valueMicrophonePrivacySettings);
    }

    function updateVolumeProximityDiscussion() {
        analyticsClient.settingAudioVolume();
        localUserStore.setVolumeProximityDiscussion(volumeProximityDiscussion);
        volumeProximityDiscussionStore.set(volumeProximityDiscussion);
    }

    function selectBubbleSound(value: string) {
        if (value !== "ding" && value !== "wobble") return;
        valueBubbleSound = value;
        openChoice = undefined;
        localUserStore.setBubbleSound(valueBubbleSound);
        bubbleSoundStore.set(valueBubbleSound);
        playBubbleSound();
    }

    function playBubbleSound() {
        sound.src = `/resources/objects/webrtc-in-${valueBubbleSound}.mp3`;
        sound.volume = 0.2;
        sound.play().catch((e) => console.error(e));
    }

    $: volumePercent = Math.round(volumeProximityDiscussion * 100);
</script>

<div class="u-set-page" data-testid="settings-{section}">
    {#if section === "sound"}
        <div class="u-set-col">
            <SettingSection title={$LL.menu.settings.sections.video()}>
                <SettingChoice
                    id="video-quality"
                    label={$LL.menu.settings.cameraQuality()}
                    value={videoQuality}
                    options={qualityOptions}
                    open={openChoice === "video-quality"}
                    onToggle={() => toggleChoice("video-quality")}
                    onSelect={selectVideoQuality}
                />
                <SettingChoice
                    id="screen-share-quality"
                    label={$LL.menu.settings.screenShareQuality()}
                    value={screenShareQuality}
                    options={qualityOptions}
                    open={openChoice === "screen-share-quality"}
                    onToggle={() => toggleChoice("screen-share-quality")}
                    onSelect={selectScreenShareQuality}
                />
            </SettingSection>
        </div>
        <div class="u-set-col">
            <SettingSection title={$LL.menu.settings.sections.sound()}>
                <div class="u-set-row u-set-slider-row">
                    <label class="u-set-label" for="voices-nearby">{$LL.menu.settings.voicesNearby()}</label>
                    <div class="u-set-slider">
                        <IconMute font-size="18" aria-hidden="true" />
                        <input
                            id="voices-nearby"
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            style="--u-fill: {volumePercent}%"
                            aria-valuetext="{volumePercent}%"
                            bind:value={volumeProximityDiscussion}
                            on:change={updateVolumeProximityDiscussion}
                        />
                        <IconUnMute font-size="18" aria-hidden="true" />
                    </div>
                </div>
                <SettingChoice
                    id="bubble-sound"
                    label={$LL.menu.settings.joinSound()}
                    wideLabel={$LL.menu.settings.joinSoundShort()}
                    value={valueBubbleSound}
                    options={bubbleSoundOptions}
                    open={openChoice === "bubble-sound"}
                    onToggle={() => toggleChoice("bubble-sound")}
                    onSelect={selectBubbleSound}
                >
                    <button
                        slot="extra"
                        type="button"
                        class="u-set-play"
                        aria-label={$LL.menu.settings.playJoinSound()}
                        title={$LL.menu.settings.playJoinSound()}
                        on:click={playBubbleSound}
                    >
                        <IconPlayFilled font-size="14" />
                    </button>
                </SettingChoice>
                <SettingSwitch
                    id="decreaseAudioPlayerVolumeWhileTalking-toggle"
                    label={$LL.menu.settings.lowerMusicWhileTalking()}
                    bind:checked={decreaseAudioPlayerVolumeWhileTalking}
                    onChange={changeDecreaseAudioPlayerVolumeWhileTalking}
                />
                <SettingSwitch
                    id="changeBlockAudio"
                    label={$LL.menu.settings.muteMapSounds()}
                    bind:checked={blockAudio}
                    onChange={changeBlockAudio}
                />
            </SettingSection>
        </div>
    {:else}
        <div class="u-set-col">
            <SettingSection>
                <SettingChoice
                    id="language"
                    label={$LL.menu.settings.language.title()}
                    value={$locale}
                    options={localeOptions}
                    open={openChoice === "language"}
                    onToggle={() => toggleChoice("language")}
                    onSelect={selectLocale}
                />
            </SettingSection>
            <SettingSection title={$LL.menu.settings.sections.notifications()}>
                {#if canNotify}
                    <SettingSwitch
                        id="notification-toggle"
                        label={$LL.menu.settings.notifications()}
                        bind:checked={notification}
                        onChange={changeNotification}
                    />
                {/if}
                <SettingSwitch
                    id="ignoreFollowRequests-toggle"
                    label={$LL.menu.settings.ignoreFollowRequests()}
                    bind:checked={ignoreFollowRequests}
                    onChange={changeIgnoreFollowRequests}
                />
            </SettingSection>
            <SettingSection title={$LL.menu.settings.sections.away()}>
                <SettingSwitch
                    id="cam-toggle"
                    label={$LL.menu.settings.keepCameraOn()}
                    hint={valueCameraPrivacySettings
                        ? $LL.menu.settings.keptOnWhenAway()
                        : $LL.menu.settings.turnedOffWhenAway()}
                    bind:checked={valueCameraPrivacySettings}
                    onChange={changeCameraPrivacySettings}
                />
                <SettingSwitch
                    id="mic-toggle"
                    label={$LL.menu.settings.keepMicOn()}
                    hint={valueMicrophonePrivacySettings
                        ? $LL.menu.settings.keptOnWhenAway()
                        : $LL.menu.settings.turnedOffWhenAway()}
                    bind:checked={valueMicrophonePrivacySettings}
                    onChange={changeMicrophonePrivacySettings}
                />
            </SettingSection>
        </div>
        <div class="u-set-col">
            <SettingSection title={$LL.menu.settings.sections.screen()}>
                <SettingSwitch
                    id="cowebsiteTrigger-toggle"
                    label={$LL.menu.settings.askBeforeWebsites()}
                    bind:checked={forceCowebsiteTrigger}
                    onChange={changeForceCowebsiteTrigger}
                />
                <SettingSwitch
                    id="changeDisableAnimations"
                    label={$LL.menu.settings.calmMap()}
                    bind:checked={disableAnimations}
                    onChange={changeDisableAnimations}
                />
                <SettingSwitch
                    id="picture-in-picture-toggle"
                    label={$LL.menu.settings.pictureInPicture()}
                    bind:checked={allowPictureInPicture}
                    onChange={changePictureInPicture}
                />
                {#if canFullscreen}
                    <SettingSwitch
                        id="fullscreen-toggle"
                        label={$LL.menu.settings.fullscreen()}
                        bind:checked={fullscreen}
                        onChange={changeFullscreen}
                    />
                {/if}
            </SettingSection>
            <SettingSection title={pages.length > 1 ? $LL.menu.settings.sections.help() : undefined}>
                {#each pages as page (page.key)}
                    <SettingLink
                        label={page.label}
                        testId="settings-page-{page.key}"
                        onClick={() => onOpenPage(page.key)}
                    />
                {/each}
            </SettingSection>
        </div>
    {/if}
</div>
