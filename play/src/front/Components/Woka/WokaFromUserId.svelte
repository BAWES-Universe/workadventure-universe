<script lang="ts">
    import { onDestroy } from "svelte";
    import type { Unsubscriber } from "svelte/store";
    import type { GameScene } from "../../Phaser/Game/GameScene";
    import { whenGameScene } from "../../Phaser/Game/WhenGameScene";
    import Woka from "./Woka.svelte";

    export let userId: number | string;
    export let placeholderSrc: string;
    export let customWidth: string;

    let src: string;
    let unsubscribe: Unsubscriber | undefined;
    let shownFor: number | string | undefined;

    // The person card stays open when it turns to someone else: the picture follows whoever it shows now, instead
    // of keeping the first person's.
    $: if (userId !== shownFor) show(userId);

    function show(id: number | string) {
        shownFor = id;
        unsubscribe?.();
        src = placeholderSrc;
        // During a reconnect there is no map for a moment: find the woka once it is back (asking now would throw).
        unsubscribe = whenGameScene((gameScene) => {
            return subscribeToWoka(gameScene, id);
        });
    }

    function subscribeToWoka(gameScene: GameScene, id: number | string): Unsubscriber | undefined {
        let playerWokaPictureStore;
        if (id === -1) {
            playerWokaPictureStore = gameScene.CurrentPlayer.pictureStore;
        } else if (Number.isInteger(id)) {
            playerWokaPictureStore = gameScene.MapPlayersByKey.getNestedStore(
                id as number,
                (item) => item.pictureStore
            );
        } else {
            // eslint-disable-next-line svelte/require-store-reactive-access
            playerWokaPictureStore = [...gameScene.MapPlayersByKey].find(
                ([, player]) => player.userUuid === (id as string)
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
