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
    import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { isTodoListVisibleStore } from "../../../Stores/TodoListStore";
    import { isCalendarVisibleStore } from "../../../Stores/CalendarStore";
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { enterExploreTheRoom } from "../../../Phaser/Game/MapEditor/ExploreTheRoom";
    import { botEditorAvailableStore, openBotEditorFromMenu } from "../../../external-modules/bots/index";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import { IconMapEditor, IconRobot, IconSpeakerPhone, IconZoomOutArea } from "@wa-icons";

    function openBotEditorMenu() {
        closeMapMenu();
        // Activate the map editor mode first (same as the Map editor button) —
        // the bot editor is a tool inside that mode's sidebar. The module then
        // waits for the sidebar to mount and opens the bot editor.
        if (!$mapEditorModeStore) {
            toggleMapEditorMode();
        }
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
        analyticsClient.globalMessage();
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

    // Always enters explore, even when the map editor is already open (toggling here used to close it).
    function openMapExplorer() {
        if (!$mapEditorModeStore) analyticsClient.toggleMapEditor(true);
        isTodoListVisibleStore.set(false);
        isCalendarVisibleStore.set(false);
        closeMapMenu();
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
    <ActionBarButton on:click={openMapExplorer} label={$LL.mapEditor.sideBar.exploreTheRoom()}>
        <IconZoomOutArea font-size="20" />
    </ActionBarButton>
{/if}
{#if $globalMessageVisibleStore}
    <ActionBarButton on:click={toggleGlobalMessage} label={$LL.actionbar.globalMessage()}>
        <IconSpeakerPhone font-size="20" />
    </ActionBarButton>
{/if}

<AdditionalMenuItems menu="buildMenu" />
