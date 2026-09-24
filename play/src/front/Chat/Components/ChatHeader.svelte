<script lang="ts">
    import { onMount, tick } from "svelte";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { chatSearchBarValue, navChat, joignableRoom } from "../Stores/ChatStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
    import { hideActionBarStoreBecauseOfChatBar } from "../ChatSidebarWidthStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { userIsConnected } from "../../Stores/MenuStore";
    import OnlineUsersCount from "./OnlineUsersCount.svelte";
    import ChatActionMenu from "./ChatActionMenu.svelte";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { IconMessageCircle2, IconSearch, IconUsers, IconX } from "@wa-icons";

    const gameScene = gameManager.getCurrentGameScene();
    const chat = gameManager.chatConnection;
    const showChatButton = gameScene.room.isChatEnabled;
    const showUserListButton = gameScene.room.isChatOnlineListEnabled;
    const showNavBar = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatStatusStore = chat.connectionStatus;
    const isMatrixGuest = chat.isGuest;
    let typingTimer: ReturnType<typeof setTimeout>;
    let searchLoader = false;
    let searchInput: HTMLInputElement | undefined;
    const DONE_TYPING_INTERVAL = 2000;

    $: isInSpecificDiscussion = $selectedRoomStore !== undefined;

    // Search is always visible: rooms and people on the Chat tab while the chat is up, people on the People tab.
    $: showSearch = $navChat.key === "users" || ($navChat.key === "chat" && $chatStatusStore !== "OFFLINE");

    // One "+" for New message, New room and New folder. Hidden for guests: saved conversations need an account.
    $: newChatOptions =
        $navChat.key === "chat"
            ? getNewChatOptions({
                  isSignedIn: $userIsConnected,
                  isMatrixGuest: $isMatrixGuest,
                  chatStatus: $chatStatusStore,
                  isPeopleListEnabled: showUserListButton,
              })
            : [];

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            // First Escape clears the search, the next one leaves the field.
            if ($chatSearchBarValue !== "") {
                event.stopPropagation();
                clearSearch(false);
            } else {
                searchInput?.blur();
            }
            return;
        }
        if ($chatSearchBarValue === "") joignableRoom.set([]);
        clearTimeout(typingTimer);
    };

    const handleKeyUp = (event: KeyboardEvent, userProviderMerger: UserProviderMerger) => {
        if (event.key === "Escape") return;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            searchLoader = true;
            if ($navChat.key === "chat" && $chatSearchBarValue.trim() !== "") {
                searchAccessibleRooms();
            }

            userProviderMerger
                .setFilter($chatSearchBarValue)
                .catch((e) => console.error(e))
                .finally(() => {
                    searchLoader = false;
                });
        }, DONE_TYPING_INTERVAL);
    };

    const searchAccessibleRooms = () => {
        chat.searchAccessibleRooms($chatSearchBarValue)
            .then((chatRooms: { id: string; name: string | undefined }[]) => {
                joignableRoom.set(chatRooms);
            })
            .catch((e) => console.error(e))
            .finally(() => {
                searchLoader = false;
            });
        return;
    };

    function clearSearch(refocus: boolean) {
        clearTimeout(typingTimer);
        searchLoader = false;
        chatSearchBarValue.set("");
        joignableRoom.set([]);
        userProviderMergerPromise
            .then((userProviderMerger) => userProviderMerger.setFilter(""))
            .catch((e) => console.error(e));
        if (refocus) searchInput?.focus();
    }

    function focusChatInput() {
        // Disable input manager to prevent the game from receiving the input
        chatInputFocusStore.set(true);
    }
    function unfocusChatInput() {
        // Enable input manager to allow the game to receive the input
        chatInputFocusStore.set(false);
    }

    // New message switches to the People tab; its header takes the focus request and focuses search.
    onMount(() => {
        if ($navChat.key !== "users" || !$focusChatSearchRequest) return;
        focusChatSearchRequest.set(false);
        userProviderMergerPromise
            .then(() => tick())
            .then(() => searchInput?.focus())
            .catch((e) => console.error(e));
    });
</script>

<div class="relative z-40 w-full">
    <div class="p-2 flex items-center w-full">
        <div>
            {#if showNavBar}
                {#if $navChat.key === "chat" && showUserListButton}
                    <button
                        class="userList p-3 hover:bg-white/10 rounded aspect-square w-12 h-12 !text-white"
                        on:click={() => navChat.switchToUserList()}
                    >
                        <IconUsers font-size="20" />
                    </button>
                {:else if showChatButton}
                    <button
                        class="p-3 hover:bg-white/10 rounded aspect-square w-12 h-12 !text-white"
                        on:click={() => navChat.switchToChat()}
                    >
                        <IconMessageCircle2 font-size="20" />
                    </button>
                {/if}
            {/if}
        </div>
        <div class="flex flex-col items-center justify-center grow">
            <div class="text-md font-bold h-5">
                {#if $navChat.key === "chat"}
                    {$LL.chat.chat()}
                {:else}
                    {$LL.chat.users()}
                {/if}
            </div>
            {#if gameScene.room.isChatOnlineListEnabled}
                <OnlineUsersCount />
            {/if}
        </div>
        <div class="relative">
            <ChatActionMenu
                hasCloseChat={$hideActionBarStoreBecauseOfChatBar && !isInSpecificDiscussion}
                hasSearch={false}
            />
        </div>
    </div>

    {#if showSearch || newChatOptions.length > 0}
        <!-- Search and one "+". The "+" menu is positioned against this row. -->
        <div class="relative flex items-center gap-2 px-2 pb-2" data-testid="chatListCreateEntry">
            {#if showSearch}
                {#await userProviderMergerPromise}
                    <div class="grow" />
                {:then userProviderMerger}
                    <div
                        class="chat-search group relative grow min-w-0 h-11 flex items-center rounded-full bg-white/10 border border-solid border-white/10 focus-within:border-white/30 focus-within:bg-white/15 transition-colors"
                    >
                        <IconSearch
                            font-size="18"
                            class="pointer-events-none absolute start-3.5 text-white/60 group-focus-within:text-white"
                            aria-hidden="true"
                        />
                        <input
                            bind:this={searchInput}
                            type="search"
                            autocomplete="new-password"
                            data-testid="chatSearchInput"
                            class="wa-searchbar chat-search-input block w-full h-full m-0 border-none bg-transparent text-white text-sm placeholder:text-white/50 placeholder:text-sm ps-10 pe-11 py-0 rounded-full focus:outline-none"
                            placeholder={$navChat.key === "users"
                                ? $LL.chat.header.searchPeople()
                                : $LL.chat.header.searchChat()}
                            aria-label={$navChat.key === "users"
                                ? $LL.chat.header.searchPeople()
                                : $LL.chat.header.searchChat()}
                            on:keydown={handleKeyDown}
                            on:keyup={(event) => handleKeyUp(event, userProviderMerger)}
                            bind:value={$chatSearchBarValue}
                            on:focusin={focusChatInput}
                            on:focusout={unfocusChatInput}
                        />
                        <div class="absolute end-1 flex items-center">
                            {#if searchLoader}
                                <div class="h-9 w-9 flex items-center justify-center" aria-hidden="true">
                                    <LoadingSmall />
                                </div>
                            {:else if $chatSearchBarValue !== ""}
                                <button
                                    type="button"
                                    data-testid="chatSearchClear"
                                    class="m-0 p-0 h-9 w-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10"
                                    aria-label={$LL.chat.header.clearSearch()}
                                    title={$LL.chat.header.clearSearch()}
                                    on:click={() => clearSearch(true)}
                                >
                                    <IconX font-size="16" />
                                </button>
                            {/if}
                        </div>
                    </div>
                {/await}
            {:else}
                <div class="grow" />
            {/if}
            {#if newChatOptions.length > 0}
                <ChatHeaderNewMenu options={newChatOptions} />
            {/if}
        </div>
    {/if}
</div>

<style>
    /* The field has its own clear button; hide the browser's. */
    .chat-search-input::-webkit-search-cancel-button,
    .chat-search-input::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
    }
</style>
