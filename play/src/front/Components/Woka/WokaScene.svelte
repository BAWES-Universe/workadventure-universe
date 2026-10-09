<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { SelectCharacterSceneName } from "../../Phaser/Login/SelectCharacterScene";
    import { areCharacterTexturesValid } from "../../Connection/LocalUserUtils";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { selectCharacterSceneVisibleStore } from "../../Stores/SelectCharacterStore";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import { LL } from "../../../i18n/i18n-svelte";
    import WokaSelectScene from "./WokaSelectScene.svelte";
    import WokaCustomizeScene from "./WokaCustomizeScene.svelte";

    let buildOwnWoka = false;
    let error: string | null = null;
    // Opened from the menu, the room is waiting: the round close leads back into it with the WOKA unchanged
    const canGoBack = gameManager.canResumeGame;

    function close() {
        selectCharacterSceneVisibleStore.set(false);
        gameManager.tryToStopScene(SelectCharacterSceneName);
        gameManager.tryResumingGame(EnableCameraSceneName);
    }

    async function saveAndContinue(texturesId: string[]) {
        error = null; // Reset error message
        try {
            if (!areCharacterTexturesValid(texturesId)) {
                error = $LL.woka.selectWoka.saveError();
                return;
            }

            analyticsClient.validationWoka("SelectWoka");
            gameManager.setCharacterTextureIds(texturesId);
            await connectionManager.saveTextures(texturesId);
            close();
        } catch (err) {
            console.error("Error saving textures:", err);
            error = $LL.woka.selectWoka.saveError();
        }
    }

    // Function to handle keyboard navigation
    function useKeyboardNavigation(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        // Escape goes from Build your WOKA back to the picker, and from the picker back to the room
        if (buildOwnWoka) buildOwnWoka = false;
        else if (canGoBack) close();
    }

    let mounted = false;

    onMount(() => {
        mounted = true;
        // Get the current textures
        const currentTextures = gameManager.getCharacterTextureIds();
        if (currentTextures && currentTextures.length > 1) {
            buildOwnWoka = true; // If there are textures, we assume the user wants to customize their Woka
        }
        // Add keyboard navigation listener
        window.addEventListener("keydown", useKeyboardNavigation);
    });

    onDestroy(() => {
        mounted = false;
        // Clean up the scene visibility store when the component is destroyed
        selectCharacterSceneVisibleStore.set(false);
        // Remove keyboard navigation listener
        window.removeEventListener("keydown", useKeyboardNavigation);
    });
</script>

{#if mounted}
    {#if buildOwnWoka}
        <WokaCustomizeScene
            back={() => (buildOwnWoka = false)}
            {saveAndContinue}
            close={canGoBack ? close : undefined}
        />
    {:else}
        <WokaSelectScene
            customize={() => (buildOwnWoka = true)}
            {saveAndContinue}
            close={canGoBack ? close : undefined}
        />
    {/if}
{/if}

{#if error}
    <p class="woka-save-error u-join-error" role="alert">{error}</p>
{/if}

<style>
    .woka-save-error {
        position: fixed;
        left: 50%;
        bottom: 6.5rem;
        z-index: 5;
        transform: translateX(-50%);
        padding: 0.5rem 0.875rem;
        border-radius: 12px;
        background: rgb(20 18 30 / 0.96);
        pointer-events: auto;
    }
</style>
