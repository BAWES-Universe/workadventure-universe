<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import type { GameScene } from "../../Phaser/Game/GameScene";
    import { whenGameScene } from "../../Phaser/Game/WhenGameScene";
    import Woka from "./Woka.svelte";

    export let userId: number | string;
    export let placeholderSrc: string;
    export let customWidth: string;

    let src: string;
    let unsubscribe: Unsubscriber | undefined;

    onMount(() => {
        src = placeholderSrc;
        // During a reconnect there is no map for a moment: find the woka once it is back (asking now would throw).
        unsubscribe = whenGameScene((gameScene) => {
            return subscribeToWoka(gameScene);
        });
    });

    function subscribeToWoka(gameScene: GameScene): Unsubscriber | undefined {
        let playerWokaPictureStore;
        if (userId === -1) {
            playerWokaPictureStore = gameScene.CurrentPlayer.pictureStore;
        } else if (Number.isInteger(userId)) {
            playerWokaPictureStore = gameScene.MapPlayersByKey.getNestedStore(
                userId as number,
                (item) => item.pictureStore
            );
        } else {
            // eslint-disable-next-line svelte/require-store-reactive-access
            playerWokaPictureStore = [...gameScene.MapPlayersByKey].find(
                ([, player]) => player.userUuid === (userId as string)
            )?.[1].pictureStore;
        }

        return playerWokaPictureStore?.subscribe((source) => {
            src = source ?? placeholderSrc;
        });
    }
    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });
</script>

{#if src}
    <Woka {src} {customWidth} />
{/if}
