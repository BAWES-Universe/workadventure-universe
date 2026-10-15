<script lang="ts">
    import type { Game } from "../Phaser/Game/Game";
    import { errorStore } from "../Stores/ErrorStore";
    import { errorScreenStore } from "../Stores/ErrorScreenStore";
    import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
    import { enableCameraSceneVisibilityStore } from "../Stores/MediaStore";
    import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
    import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
    import { wokaRefusedStore } from "../Stores/WokaRefusedStore";
    import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
    import { refreshPromptStore } from "../Stores/RefreshPromptStore";
    import { forceRefreshChatStore } from "../Stores/ChatStore";
    import { loaderVisibleStore } from "../Stores/LoaderStore";
    import { broadcastPanelOpenStore } from "../Stores/BroadcastStore";
    import { isActivatedStore as calendarIsActivatedStore, isCalendarVisibleStore } from "../Stores/CalendarStore";
    import { isActivatedStore as todoListIsActivatedStore, isTodoListVisibleStore } from "../Stores/TodoListStore";
    import { draggingFile } from "../Stores/FileUploadStore";
    import ChatSidebar from "../Chat/ChatSidebar.svelte";
    import { isBanScreen } from "../Connection/BanApi";
    import { softReconnect, softReconnectGeneration } from "../Connection/SoftReconnect";
    import LoginScene from "./Login/LoginScene.svelte";
    import MainLayout from "./MainLayout.svelte";
    import SelectCompanionScene from "./SelectCompanion/SelectCompanionScene.svelte";
    import ErrorDialog from "./UI/ErrorDialog.svelte";
    import ErrorScreen from "./UI/ErrorScreen.svelte";
    import BanScreen from "./UI/BanScreen.svelte";
    import RefreshPrompt from "./RefreshPrompt.svelte";
    import EnableCameraScene from "./EnableCamera/EnableCameraScene.svelte";
    import BroadcastPanel from "./Broadcast/BroadcastPanel.svelte";
    import Calendar from "./Calendar/Calendar.svelte";
    import TodoList from "./TodoList/TodoList.svelte";
    import FloatingUiPopupList from "./Util/FloatingUiPopupList.svelte";
    import MainModal from "./Modal/MainModal.svelte";
    import DroppingFileScene from "./DroppingFile/DroppingFileScene.svelte";
    import WokaScene from "./Woka/WokaScene.svelte";
    import WokaRefusedPopup from "./Woka/WokaRefusedPopup.svelte";
    import ReconnectRoomPicture from "./Reconnect/ReconnectRoomPicture.svelte";
    import ReconnectPill from "./Reconnect/ReconnectPill.svelte";

    export let game: Game;

    /**
     * When changing map from an exit on the current map, the Chat and the MainLayout are not really destroyed
     * due to an internal issue of Svelte, we use a #key directive to force the destruction of the components.
     * https://github.com/sveltejs/svelte/issues/5268
     */

    // Getting back in after the connection dropped, with the room kept on screen (#958): the chat stays up while the
    // game rebuilds the room, then starts again on it (a new generation) once it is back in.
    $: keepingRoom = $softReconnect?.picture !== undefined;
</script>

<!-- The loading screen is #boot-splash in index.html (BootSplash.ts, #981). -->
{#if $draggingFile}
    <div>
        <DroppingFileScene />
    </div>
{/if}
{#if $errorScreenStore !== undefined}
    <div class="bg-contrast">
        <!-- A ban gets its own screen: what the admin said, an appeal, and a way out to the rest of Universe. -->
        {#if isBanScreen($errorScreenStore)}
            <BanScreen />
        {:else}
            <ErrorScreen />
        {/if}
    </div>
{:else if $errorStore.length > 0 && !keepingRoom}
    <!-- (While the room is kept on screen, its pill says what is going on: a dialog waits until the game is back.) -->
    <div class="bg-contrast">
        <ErrorDialog />
    </div>
{:else if $loginSceneVisibleStore}
    <div class="h-dvh overflow-y-auto">
        <LoginScene {game} />
    </div>
{:else if $wokaRefusedStore}
    <WokaRefusedPopup kind={$wokaRefusedStore} />
{:else if $selectCharacterSceneVisibleStore}
    <div class="absolute inset-0 h-dvh">
        <WokaScene />
    </div>
{:else if $selectCompanionSceneVisibleStore}
    <div>
        <SelectCompanionScene {game} />
    </div>
{:else if $enableCameraSceneVisibilityStore}
    <div class="h-dvh overflow-y-auto">
        <EnableCameraScene {game} />
    </div>
{:else if ($gameSceneIsLoadedStore || keepingRoom) && !$loaderVisibleStore}
    <!-- While the room is kept on screen, the chat stays open and usable, over a still picture of the room and the bar. -->
    <ReconnectRoomPicture />
    {#key $softReconnectGeneration}
        {#if $refreshPromptStore && $gameSceneIsLoadedStore}
            <RefreshPrompt />
        {/if}
        {#key $forceRefreshChatStore}
            <ChatSidebar />
            {#if $gameSceneIsLoadedStore}
                {#if $broadcastPanelOpenStore}
                    <BroadcastPanel />
                {/if}

                <MainLayout />
            {/if}
        {/key}
        {#if $gameSceneIsLoadedStore}
            <MainModal />

            {#if $calendarIsActivatedStore && $isCalendarVisibleStore}
                <Calendar />
            {/if}
            {#if $todoListIsActivatedStore && $isTodoListVisibleStore}
                <TodoList />
            {/if}
        {/if}
    {/key}
{/if}
<ReconnectPill />

<FloatingUiPopupList />
<!-- </div> -->
