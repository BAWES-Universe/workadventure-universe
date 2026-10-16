<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { SelectCharacterSceneName } from "../../Phaser/Login/SelectCharacterScene";
    import { areCharacterTexturesValid } from "../../Connection/LocalUserUtils";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { selectCharacterSceneVisibleStore } from "../../Stores/SelectCharacterStore";
    import { refusedPickerStore, wokaRefusedStore } from "../../Stores/WokaRefusedStore";
    import { EnableCameraSceneName } from "../../Phaser/Login/EnableCameraScene";
    import { LL } from "../../../i18n/i18n-svelte";
    import WokaSelectScene from "./WokaSelectScene.svelte";
    import WokaCustomizeScene from "./WokaCustomizeScene.svelte";

    let buildOwnWoka = false;
    let error: string | null = null;
    // Opened from the menu, the room is waiting: the round close leads back into it with the WOKA unchanged.
    // Opened from the "can't be worn here" popup: it leads back to the popup, because there is no room to return to yet.
    const fromRefusal = get(refusedPickerStore) === "woka";
    const canGoBack = gameManager.canResumeGame || fromRefusal;
    let saving = false;

    function setSaving(value: boolean) {
        saving = value;
    }

    function close() {
        if (fromRefusal) {
            refusedPickerStore.set(undefined);
            selectCharacterSceneVisibleStore.set(false);
            wokaRefusedStore.set("woka");
            return;
        }
        leaveToRoom();
    }

    // Back into the room, which joins again with the WOKA that was just saved
    function leaveToRoom() {
        refusedPickerStore.set(undefined);
        selectCharacterSceneVisibleStore.set(false);
        gameManager.tryToStopScene(SelectCharacterSceneName);
        gameManager.tryResumingGame(EnableCameraSceneName);
    }

    // Saves first: the WOKA you wear changes, and the picker closes, only once the save went through. When it did
    // not, the picker stays open and says so, and you still wear the one you had.
    async function saveAndContinue(texturesId: string[]) {
        if (saving) return;
        error = null; // Reset error message
        saving = true;
        try {
            if (!areCharacterTexturesValid(texturesId)) {
                error = $LL.woka.selectWoka.saveError();
                return;
            }

            analyticsClient.validationWoka("SelectWoka");
            const result = await connectionManager.saveTextures(texturesId);
            if (result !== "saved") {
                error =
                    result === "notAllowed" ? $LL.woka.selectWoka.saveNotAllowed() : $LL.woka.selectWoka.saveFailed();
                return;
            }
            gameManager.setCharacterTextureIds(texturesId);
            leaveToRoom();
        } catch (err) {
            console.error("Error saving textures:", err);
            error = $LL.woka.selectWoka.saveFailed();
        } finally {
            setSaving(false);
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
            saveError={error ?? ""}
            close={canGoBack ? close : undefined}
        />
    {:else}
        <WokaSelectScene
            customize={() => (buildOwnWoka = true)}
            {saveAndContinue}
            saveError={error ?? ""}
            close={canGoBack ? close : undefined}
        />
    {/if}
{/if}
