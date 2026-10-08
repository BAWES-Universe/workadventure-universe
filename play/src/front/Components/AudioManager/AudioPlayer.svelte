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

    onMount(() => {
        const player = new AudioPlayback(
            (state) => {
                audioManagerPlayerState.set(state);
                if (state === "playing") {
                    audioManagerVisibilityStore.set("visible");
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
            }
        );
        const onVisibilityChange = () => player.setHidden(document.hidden);
        onVisibilityChange();
        const unsubscribeVolume = audioManagerVolumeStore.subscribe((controls) => player.setControls(controls));
        const unsubscribeSource = audioManagerSourceStore.subscribe((source) => player.setSource(source));
        const retrySubscription = audioManagerRetryPlaySubject.subscribe(() => player.retry());
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            unsubscribeVolume();
            unsubscribeSource();
            retrySubscription.unsubscribe();
            player.destroy();
        };
    });
</script>
