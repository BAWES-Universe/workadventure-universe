<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { UserInputManager } from "../../Phaser/UserInput/UserInputManager";
    import PopUpContainer from "./PopUpContainer.svelte";
    import PopUpHintText from "./PopUpHintText.svelte";

    export let message: string;
    export let click: () => void;
    export let userInputManager: UserInputManager;

    onMount(() => {
        userInputManager.addSpaceEventListener(click);
    });

    onDestroy(() => {
        userInputManager.removeSpaceEventListener(click);
    });
</script>

<PopUpContainer reduceOnSmallScreen={true}>
    <PopUpHintText {message} />
    <svelte:fragment slot="buttons">
        <button
            class="u-cta flex min-h-11 w-full max-w-96 cursor-pointer items-center justify-center rounded-full border-0 px-4 text-sm font-bold"
            on:click={click}>Open website</button
        >
    </svelte:fragment>
</PopUpContainer>
