<script lang="ts">
    import {
        globalMessageVisibleStore,
        mapManagerActivated,
        mapEditorMenuVisibleStore,
        openedMenuStore,
    } from "../../../Stores/MenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import {
        modalIframeStore,
        modalVisibilityStore,
        showModalGlobalComminucationVisibilityStore,
    } from "../../../Stores/ModalStore";
    import { mapEditorModeStore, mapExplorationModeStore } from "../../../Stores/MapEditorStore";
    import { lookAroundNoteSeenStore } from "../../../Stores/LookAroundStore";
    import { enterExploreTheRoom } from "../../../Phaser/Game/MapEditor/ExploreTheRoom";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { isTodoListVisibleStore } from "../../../Stores/TodoListStore";
    import { isCalendarVisibleStore } from "../../../Stores/CalendarStore";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { botEditorAvailableStore, openBotEditorFromMenu } from "../../../external-modules/bots/index";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import { IconMapEditor, IconRobot, IconSpeakerPhone, IconZoomOutArea } from "@wa-icons";

    function openBotEditorMenu() {
        closeMapMenu();
        isTodoListVisibleStore.set(false);
        isCalendarVisibleStore.set(false);
        if (!$mapEditorModeStore) {
            analyticsClient.toggleMapEditor(true);
        }
        // The bot editor is a tool inside edit mode. The module switches the mode on itself, so that on a phone the
        // panel comes out at once with the bot list, then waits for the sidebar to mount and opens the editor.
        openBotEditorFromMenu();
    }

    function resetChatVisibility() {
        chatVisibilityStore.set(false);
    }

    function resetModalVisibility() {
        modalVisibilityStore.set(false);
        modalIframeStore.set(null);
        showModalGlobalComminucationVisibilityStore.set(false);
    }

    function toggleGlobalMessage() {
        if ($showModalGlobalComminucationVisibilityStore) {
            showModalGlobalComminucationVisibilityStore.set(false);
            return;
        }

        closeMapMenu();
        resetChatVisibility();
        resetModalVisibility();
        mapEditorModeStore.switchMode(false);
        showModalGlobalComminucationVisibilityStore.set(true);
    }

    function toggleMapEditorMode() {
        //if (isMobile) return;
        if ($mapEditorModeStore) gameManager.getCurrentGameScene().getMapEditorModeManager().equipTool(undefined);
        analyticsClient.toggleMapEditor(!$mapEditorModeStore);
        mapEditorModeStore.switchMode(!$mapEditorModeStore);
        isTodoListVisibleStore.set(false);
        isCalendarVisibleStore.set(false);
        closeMapMenu();
    }

    function openLookAround() {
        isTodoListVisibleStore.set(false);
        isCalendarVisibleStore.set(false);
        closeMapMenu();
        lookAroundNoteSeenStore.set(true);
        enterExploreTheRoom();
    }

    function closeMapMenu() {
        openedMenuStore.close("mapMenu");
    }
</script>

{#if $mapEditorMenuVisibleStore}
    <ActionBarButton
        on:click={toggleMapEditorMode}
        label={$LL.actionbar.mapEditor()}
        state={$mapEditorModeStore ? "active" : "normal"}
    >
        <IconMapEditor font-size="20" />
    </ActionBarButton>
{/if}
{#if $botEditorAvailableStore && $mapEditorMenuVisibleStore}
    <ActionBarButton on:click={openBotEditorMenu} label={$LL.actionbar.botEditor()}>
        <IconRobot font-size="20" />
    </ActionBarButton>
{/if}
{#if $mapManagerActivated}
    <ActionBarButton
        on:click={openLookAround}
        label={$LL.mapEditor.lookAround.title()}
        state={$mapExplorationModeStore ? "active" : "normal"}
    >
        <IconZoomOutArea font-size="20" />
    </ActionBarButton>
{/if}
{#if $globalMessageVisibleStore}
    <ActionBarButton on:click={toggleGlobalMessage} label={$LL.actionbar.globalMessage()}>
        <IconSpeakerPhone font-size="20" />
    </ActionBarButton>
{/if}

<AdditionalMenuItems menu="buildMenu" />
