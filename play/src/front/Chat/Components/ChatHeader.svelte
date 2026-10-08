<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { chatSearchBarValue, navChat } from "../Stores/ChatStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
    import { userIsConnected } from "../../Stores/MenuStore";
    import ChatHeaderNewMenu from "./Header/ChatHeaderNewMenu.svelte";
    import { focusChatSearchRequest, getNewChatOptions } from "./Header/ChatHeaderNewMenu";
    import { createSearchFilter } from "./Header/SearchFilter";
    import { IconSearch, IconX } from "@wa-icons";

    /**
     * The search row of a chat list: one search field for the open tab and the "+".
     * The Chats / People tabs above it live in ChatTabs, mounted once for both lists.
     */
    const gameScene = gameManager.getCurrentGameScene();
    const chat = gameManager.chatConnection;
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatStatusStore = chat.connectionStatus;
    const isMatrixGuest = chat.isGuest;
    let searchLoader = false;
    let searchInput: HTMLInputElement | undefined;
    const searchFilter = createSearchFilter((loading) => (searchLoader = loading));
    onDestroy(() => searchFilter.cancel());

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
        // Emptied field: the full lists come back at once, like with the clear button.
        if (value === "") {
            clearSearch(false);
            return;
        }
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
