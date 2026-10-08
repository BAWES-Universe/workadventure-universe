<script lang="ts">
    import { get } from "svelte/store";
    import { onMount } from "svelte";
    import {
        audioManagerPlayerState,
        audioManagerRetryPlaySubject,
        audioManagerSourceStore,
        audioManagerVisibilityStore,
        audioManagerVolumeStore,
    } from "../../Stores/AudioManagerStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { actionsMenuStore } from "../../Stores/ActionsMenuStore";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { activeSecondaryZoneActionBarStore } from "../../Stores/MenuStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { AudioPlayback } from "./AudioPlayback";

    let audioContainer: HTMLDivElement;

    onMount(() => {
        let sourceUrl: string | undefined;
        let openOnPlay = false;
        const player = new AudioPlayback(
            (state) => {
                audioManagerPlayerState.set(state);
                if (state === "playing") {
                    audioManagerVisibilityStore.set("visible");
                    if (openOnPlay) {
                        openOnPlay = false;
                        activeSecondaryZoneActionBarStore.set("audio-manager");
                    }
                } else if (state === "not_allowed") {
                    // Keep the existing native retry button and player speech bubble.
                    audioManagerVisibilityStore.set("visible");
                    const gameScene = gameManager.getCurrentGameScene();
                    gameScene?.CurrentPlayer.playText(
                        "audio-not-allowed",
                        $LL.audio.manager.notAllowed(),
                        10000,
                        () => {
                            gameScene.CurrentPlayer.destroyText("audio-not-allowed");
                            player.retry();
                        }
                    );
                } else if (state === "error") {
                    warningMessageStore.addWarningMessage($LL.audio.manager.error());
                    audioManagerVisibilityStore.set("error");
                }
            },
            () => {
                actionsMenuStore.clear();
                audioManagerVisibilityStore.set("hidden");
                if (get(activeSecondaryZoneActionBarStore) === "audio-manager") {
                    activeSecondaryZoneActionBarStore.set(undefined);
                }
            },
            undefined,
            undefined,
            audioContainer
        );
        const unsubscribeVolume = audioManagerVolumeStore.subscribe((controls) => player.setControls(controls));
        const unsubscribeSource = audioManagerSourceStore.subscribe((source) => {
            if (source?.url !== sourceUrl) {
                sourceUrl = source?.url;
                // Preserve the existing source-start panel behavior without reopening it
                // on gain updates or pause/resume after the user has closed it.
                openOnPlay = sourceUrl !== undefined;
            }
            player.setSource(source);
        });
        const retrySubscription = audioManagerRetryPlaySubject.subscribe(() => player.retry());
        return () => {
            unsubscribeVolume();
            unsubscribeSource();
            retrySubscription.unsubscribe();
            player.destroy();
        };
    });
</script>

<!-- Keep native media attached as before, with only active transition slots in the DOM. -->
<div hidden bind:this={audioContainer} />
