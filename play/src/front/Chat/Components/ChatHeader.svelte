<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { derived } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { chatSearchBarValue, navChat } from "../Stores/ChatStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
    import { hideActionBarStoreBecauseOfChatBar } from "../ChatSidebarWidthStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { userIsConnected } from "../../Stores/MenuStore";
    import ChatActionMenu from "./ChatActionMenu.svelte";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { createSearchFilter } from "./Header/SearchFilter";
    import { IconSearch, IconX } from "@wa-icons";

    /**
     * The top of the chat: two tabs, Chats and People, one search field for the open tab and the "+".
     * The only presence number is on the People tab: everyone online in this world, this tab and its clones
     * included. Nothing here repeats it.
     */
    const gameScene = gameManager.getCurrentGameScene();
    const chat = gameManager.chatConnection;
    const hasChatsTab = gameScene.room.isChatEnabled;
    const hasPeopleTab = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const showPeopleCount = gameScene.room.isChatOnlineListEnabled;
    const worldUserCount = gameScene.worldUserCounter;
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatStatusStore = chat.connectionStatus;
    const isMatrixGuest = chat.isGuest;
    const proximityChatRoom = gameScene.proximityChatRoom;
    const proximityUnread = proximityChatRoom.hasUnreadMessages;
    let searchLoader = false;
    let searchInput: HTMLInputElement | undefined;
    const searchFilter = createSearchFilter((loading) => (searchLoader = loading));
    onDestroy(() => searchFilter.cancel());

    // A dot on the Chats tab when any saved conversation or the proximity chat has something unread.
    const savedUnread: Readable<boolean> = derived(
        [chat.rooms, chat.directRooms],
        ([$rooms, $directRooms], set) => {
            const all = [...$rooms, ...$directRooms];
            if (all.length === 0) {
                set(false);
                return;
            }
            return derived(
                all.map((room) => room.hasUnreadMessages),
                ($flags) => $flags.some(Boolean)
            ).subscribe(set);
        },
        false
    );

    $: isInSpecificDiscussion = $selectedRoomStore !== undefined;
    $: hasUnreadChats = $savedUnread || $proximityUnread;
    $: activeTab = $navChat.key === "users" ? "people" : $navChat.key === "chat" ? "chats" : undefined;

    // Search is always visible: the open tab's own list only. People search reaches the world's members too.
    $: showSearch = $navChat.key === "users" || ($navChat.key === "chat" && $chatStatusStore !== "OFFLINE");

    // One "+" for New message, New group, Find a group and New folder. Hidden for guests: saved chat needs an account.
    $: newChatOptions =
        $navChat.key === "chat"
            ? getNewChatOptions({
                  isSignedIn: $userIsConnected,
                  isMatrixGuest: $isMatrixGuest,
                  chatStatus: $chatStatusStore,
                  isPeopleListEnabled: gameScene.room.isChatOnlineListEnabled,
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
    };

    // Every change of the field, however it was made, filters the lists: the text as it is now, once typing pauses.
    const handleInput = (event: Event, userProviderMerger: UserProviderMerger) => {
        const value = (event.currentTarget as HTMLInputElement).value;
        searchFilter.schedule(value, (text) => userProviderMerger.setFilter(text));
    };

    function clearSearch(refocus: boolean) {
        searchFilter.cancel();
        chatSearchBarValue.set("");
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

    function onTabKeyDown(event: KeyboardEvent) {
        // Left and right move between the two tabs; the arrows never reach the game.
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        if (activeTab === "chats" && hasPeopleTab) navChat.switchToUserList();
        else if (activeTab === "people" && hasChatsTab) navChat.switchToChat();
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
    <div class="flex items-center gap-2 ps-2 pe-2 pt-2 pb-1">
        {#if hasChatsTab && hasPeopleTab}
            <div
                class="chat-tabs u-glass relative flex grow min-w-0 gap-1 rounded-xl p-1"
                role="tablist"
                data-active={activeTab}
            >
                <button
                    type="button"
                    role="tab"
                    class="chat-tab {activeTab === 'chats' ? 'is-active' : ''}"
                    aria-selected={activeTab === "chats"}
                    tabindex={activeTab === "chats" ? 0 : -1}
                    data-testid="chatTabChats"
                    on:click={() => navChat.switchToChat()}
                    on:keydown={onTabKeyDown}
                >
                    <span class="truncate">{$LL.chat.header.tabChats()}</span>
                    {#if hasUnreadChats}
                        <span
                            class="chat-tab-dot h-2 w-2 shrink-0 rounded-full bg-secondary-200"
                            role="img"
                            aria-label={$LL.chat.header.unreadChats()}
                            data-testid="chatTabChatsUnread"
                        />
                    {/if}
                </button>
                <button
                    type="button"
                    role="tab"
                    class="chat-tab userList {activeTab === 'people' ? 'is-active' : ''}"
                    aria-selected={activeTab === "people"}
                    tabindex={activeTab === "people" ? 0 : -1}
                    data-testid="chatTabPeople"
                    on:click={() => navChat.switchToUserList()}
                    on:keydown={onTabKeyDown}
                >
                    <span class="truncate">{$LL.chat.header.tabPeople()}</span>
                    {#if showPeopleCount && $worldUserCount > 0}
                        <span
                            class="chat-tab-count shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums leading-4"
                            aria-label={$LL.chat.header.peopleOnline({ count: $worldUserCount })}
                            title={$LL.chat.header.peopleOnline({ count: $worldUserCount })}
                            data-testid="chatTabPeopleCount">{$worldUserCount}</span
                        >
                    {/if}
                </button>
            </div>
        {:else}
            <div class="grow min-w-0 px-2 text-md font-bold truncate">
                {#if $navChat.key === "users"}
                    {$LL.chat.header.tabPeople()}
                {:else}
                    {$LL.chat.header.tabChats()}
                {/if}
            </div>
        {/if}
        <div class="relative shrink-0">
            <ChatActionMenu hasCloseChat={$hideActionBarStoreBecauseOfChatBar && !isInSpecificDiscussion} />
        </div>
    </div>

    {#if showSearch || newChatOptions.length > 0}
        <!-- Search and one "+". The "+" menu is positioned against this row. -->
        <div class="relative flex items-center gap-2 px-2 pt-2 pb-2">
            {#if showSearch}
                {#await userProviderMergerPromise}
                    <div class="grow" />
                {:then userProviderMerger}
                    <div
                        class="chat-search u-glass group relative grow min-w-0 h-11 flex items-center rounded-full transition-colors"
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
                            on:input={(event) => handleInput(event, userProviderMerger)}
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
    /* A gradient pill slides under the open tab; the tabs themselves stay transparent above it. */
    .chat-tabs::before {
        content: "";
        position: absolute;
        top: 4px;
        bottom: 4px;
        inset-inline-start: 4px;
        width: calc(50% - 6px);
        border-radius: 0.625rem;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
        transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease;
        opacity: 0;
    }
    .chat-tabs[data-active="chats"]::before {
        opacity: 1;
    }
    .chat-tabs[data-active="people"]::before {
        opacity: 1;
        transform: translateX(calc(100% + 4px));
    }
    :global([dir="rtl"]) .chat-tabs[data-active="people"]::before {
        transform: translateX(calc(-100% - 4px));
    }

    .chat-tab {
        position: relative;
        z-index: 1;
        margin: 0;
        display: flex;
        flex: 1 1 0;
        min-width: 0;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        height: 2.25rem;
        padding: 0 0.75rem;
        border-radius: 0.625rem;
        font-size: 0.875rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        transition: color 150ms ease;
    }

    .chat-tab:hover {
        color: #fff;
    }

    .chat-tab:focus-visible {
        outline: 2px solid rgb(255 255 255 / 0.7);
        outline-offset: -2px;
    }

    .chat-tab.is-active {
        color: #fff;
        text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    }

    .chat-tab-count {
        background: rgb(255 255 255 / 0.1);
        color: rgb(255 255 255 / 0.85);
        transition: background-color 150ms ease, color 150ms ease;
    }

    .chat-tab.is-active .chat-tab-count {
        background: #e9c74c;
        color: #1b1233;
    }

    .chat-search {
        background: rgba(255, 255, 255, 0.06);
    }
    .chat-search:focus-within {
        border-color: rgba(167, 139, 250, 0.6);
        box-shadow: 0 0 0 3px rgba(134, 41, 252, 0.18);
    }

    /* The field has its own clear button; hide the browser's. */
    .chat-search-input::-webkit-search-cancel-button,
    .chat-search-input::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
    }
</style>
