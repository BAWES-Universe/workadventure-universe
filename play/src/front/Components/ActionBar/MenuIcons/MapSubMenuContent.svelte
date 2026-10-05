<script lang="ts">
    import { getContext } from "svelte";
    import {
        globalMessageVisibleStore,
        mapManagerActivated,
        mapEditorMenuVisibleStore,
        openedMenuStore,
    } from "../../../Stores/MenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { modalIframeStore, modalVisibilityStore } from "../../../Stores/ModalStore";
    import { broadcastPanelOpenStore, toggleBroadcastPanel } from "../../../Stores/BroadcastStore";
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

    // On a phone these tools sit inside the profile menu rather than in their own Tools menu.
    const inProfileMenu = getContext("profileMenu");

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
    }

    // Broadcast: reach everyone at once (a message, a voice note, going live). The card opens over the map; the
    // game and the bar stay usable, so only the menu and the windows it would hide under close.
    function toggleBroadcast() {
        if ($broadcastPanelOpenStore) {
            broadcastPanelOpenStore.set(false);
            return;
        }
        closeMapMenu();
        resetChatVisibility();
        resetModalVisibility();
        mapEditorModeStore.switchMode(false);
        toggleBroadcastPanel();
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

    /** Closes the menu these tools are listed in, whichever one hosts them, so it never stays open behind the tool. */
    function closeMapMenu() {
        openedMenuStore.close(inProfileMenu ? "profileMenu" : "mapMenu");
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
    <ActionBarButton
        on:click={toggleBroadcast}
        label={$LL.broadcast.menu()}
        state={$broadcastPanelOpenStore ? "open" : "normal"}
        dataTestId="broadcast-menu"
    >
        <IconSpeakerPhone font-size="20" />
    </ActionBarButton>
{/if}

<AdditionalMenuItems menu="buildMenu" />
