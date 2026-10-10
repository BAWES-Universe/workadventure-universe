<script lang="ts">
    import { get } from "svelte/store";
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
    import { AudioPlayback } from "./AudioPlayback";
    import { NativeSoundscape } from "./NativeSoundscape";
    import type { State } from "./NativeSoundscape";

    let audioContainer: HTMLDivElement;

    onMount(() => {
        let sourceUrl: string | undefined;
        let openOnPlay = false;
        let rejectedLateOptIn = false;
        let lastState: State;
        let position = get(nativeSoundscapeListenerStore);
        let player: AudioPlayback | NativeSoundscape;
        const onState = (state: State) => {
            // Multiple native channels share one UI; avoid duplicate warnings/bubbles.
            if (player instanceof NativeSoundscape && state === lastState) return;
            lastState = state;
            audioManagerPlayerState.set(state);
            if (state === "playing") {
                audioManagerVisibilityStore.set("visible");
                if (openOnPlay) {
                    openOnPlay = false;
                    activeSecondaryZoneActionBarStore.set("audio-manager");
                }
            } else if (state === "not_allowed") {
                audioManagerVisibilityStore.set("visible");
                const gameScene = gameManager.getCurrentGameScene();
                gameScene?.CurrentPlayer.playText("audio-not-allowed", $LL.audio.manager.notAllowed(), 10000, () => {
                    gameScene.CurrentPlayer.destroyText("audio-not-allowed");
                    player.retry();
                });
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
