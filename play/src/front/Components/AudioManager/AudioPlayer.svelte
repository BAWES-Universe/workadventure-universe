<script context="module" lang="ts">
    // The map music hint is shown once per visit; a later blocked track retries silently on the next tap.
    let soundHintShown = false;
</script>

<script lang="ts">
    import { get } from "svelte/store";
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import {
        audioManagerPlayerState,
        audioManagerRetryPlaySubject,
        audioManagerSourceStore,
        audioManagerVisibilityStore,
        audioManagerVolumeStore,
        nativeSoundscapeListenerStore,
    } from "../../Stores/AudioManagerStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { activeSecondaryZoneActionBarStore } from "../../Stores/MenuStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { isTouchDevice } from "../../Utils/TouchDevice";
    import { SOUND_ICON_PATHS } from "../../Utils/HintKey";
    import { AudioPlayback } from "./AudioPlayback";
    import { NativeSoundscape } from "./NativeSoundscape";
    import type { State } from "./NativeSoundscape";

    // Computers show the hint above the player. Touch screens show it as a pill at the top of the screen.
    const DESKTOP_HINT_DURATION = 10000;
    const TOUCH_END_EVENTS = ["touchend", "pointerup"];

    let audioContainer: HTMLDivElement;
    let touchSoundHint = false;

    onMount(() => {
        let sourceUrl: string | undefined;
        let openOnPlay = false;
        let rejectedLateOptIn = false;
        let lastState: State;
        let position = get(nativeSoundscapeListenerStore);
        let player: AudioPlayback | NativeSoundscape;
        // Safari only lets audio start inside a touch gesture, so the retry runs synchronously in the first tap anywhere.
        const retryOnTap = () => {
            touchSoundHint = false;
            player.retry();
        };
        const disarmTapRetry = () => {
            for (const type of TOUCH_END_EVENTS) window.removeEventListener(type, retryOnTap, true);
        };
        const armTapRetry = () => {
            for (const type of TOUCH_END_EVENTS)
                window.addEventListener(type, retryOnTap, { capture: true, passive: true });
        };
        const onState = (state: State) => {
            // Multiple native channels share one UI; avoid duplicate warnings/bubbles.
            if (player instanceof NativeSoundscape && state === lastState) return;
            lastState = state;
            audioManagerPlayerState.set(state);
            if (state === "playing") {
                disarmTapRetry();
                touchSoundHint = false;
                audioManagerVisibilityStore.set("visible");
                if (openOnPlay) {
                    openOnPlay = false;
                    activeSecondaryZoneActionBarStore.set("audio-manager");
                }
            } else if (state === "not_allowed") {
                audioManagerVisibilityStore.set("visible");
                const touch = isTouchDevice();
                if (touch) {
                    disarmTapRetry();
                    armTapRetry();
                }
                if (soundHintShown) return;
                soundHintShown = true;
                if (touch) {
                    touchSoundHint = true;
                    return;
                }
                const gameScene = gameManager.getCurrentGameScene();
                gameScene?.CurrentPlayer.playText(
                    "audio-not-allowed",
                    $LL.audio.manager.notAllowed(),
                    DESKTOP_HINT_DURATION,
                    () => {
                        gameScene.CurrentPlayer.destroyText("audio-not-allowed");
                        player.retry();
                    },
                    undefined,
                    undefined,
                    "sound"
                );
            } else if (state === "error") {
                warningMessageStore.addWarningMessage($LL.audio.manager.error());
                audioManagerVisibilityStore.set("error");
            }
        };
        const onEnded = () => {
            actionsMenuStore.clear();
            audioManagerVisibilityStore.set("hidden");
            if (get(activeSecondaryZoneActionBarStore) === "audio-manager") {
                activeSecondaryZoneActionBarStore.set(undefined);
            }
        };
        const legacy = () => new AudioPlayback(onState, onEnded, undefined, undefined, audioContainer);
        player = legacy();
        const unsubscribeVolume = audioManagerVolumeStore.subscribe((controls) => player.setControls(controls));
        const unsubscribePosition = nativeSoundscapeListenerStore.subscribe((value) => {
            position = value;
            if (player instanceof NativeSoundscape) {
                if (value) player.setListenerPosition(value.x, value.y);
                else player.clearListenerPosition();
            }
        });
        const unsubscribeSource = audioManagerSourceStore.subscribe((source) => {
            const previousUrl = sourceUrl;
            if (source?.url !== sourceUrl) {
                rejectedLateOptIn = false;
                sourceUrl = source?.url;
                openOnPlay = sourceUrl !== undefined;
            }
            // Backend choice belongs to the initial music selection. A late first emitter
            // cannot adopt already-playing legacy media without restarting it; reject only
            // that unsupported opt-in and preserve the selected track and user controls.
            if (source?.soundscape && source.url === previousUrl && !(player instanceof NativeSoundscape)) {
                player.setSource(source);
                if (!rejectedLateOptIn) {
                    rejectedLateOptIn = true;
                    console.warn(
                        "nativeSoundscape must be present when music starts; late same-track opt-in was ignored. " +
                            "Use a full-coverage tile layer active at spawn."
                    );
                    warningMessageStore.addWarningMessage($LL.audio.manager.error());
                }
                return;
            }
            // Once opted in, removing/replacing an area emitter must not restart the
            // same music track. A source unload ends that graph-backed session.
            const spatial =
                source?.soundscape !== undefined ||
                (player instanceof NativeSoundscape && source?.url !== undefined && source.url === previousUrl);
            if (spatial !== player instanceof NativeSoundscape) {
                // Never overlap legacy and graph output; source metadata chooses one backend atomically.
                player.destroy();
                lastState = undefined;
                player = spatial ? new NativeSoundscape({ audioContainer, onPlayerState: onState, onEnded }) : legacy();
                player.setControls(get(audioManagerVolumeStore));
            }
            if (player instanceof NativeSoundscape) {
                if (position) player.setListenerPosition(position.x, position.y);
                else player.clearListenerPosition();
                player.setMusic(source);
                player.setEmitter(source?.soundscape);
            } else {
                player.setSource(source);
            }
        });
        const retrySubscription = audioManagerRetryPlaySubject.subscribe(() => player.retry());
        return () => {
            disarmTapRetry();
            unsubscribeVolume();
            unsubscribePosition();
            unsubscribeSource();
            retrySubscription.unsubscribe();
            player.destroy();
        };
    });
</script>

<!-- Real active media remain attached and component-owned in BOTH backends. -->
<div hidden bind:this={audioContainer} />

{#if touchSoundHint}
    <!-- Touch screens: a pill at the top that never covers the player or the bottom bar. A tap anywhere reaches the map, so it takes no taps itself. -->
    <div
        class="sound-hint u-hint pointer-events-none fixed left-1/2 z-[60] -translate-x-1/2"
        role="status"
        transition:fade={{ duration: 200 }}
        data-testid="sound-hint"
    >
        <span class="u-hint-row">
            <svg
                class="u-hint-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                {#each SOUND_ICON_PATHS as path (path)}
                    <path d={path} />
                {/each}
            </svg>
            <span>{$LL.audio.manager.notAllowedTouch()}</span>
        </span>
    </div>
{/if}

<style>
    .sound-hint {
        top: calc(env(safe-area-inset-top, 0px) + 10px);
        max-width: calc(100vw - 32px);
        padding: 0 16px 0 13px;
        font-size: 14px;
        line-height: 36px;
        white-space: nowrap;
    }
    .sound-hint .u-hint-row {
        gap: 8px;
    }
</style>
