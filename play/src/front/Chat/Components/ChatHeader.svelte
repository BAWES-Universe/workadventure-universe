<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { chatSearchBarValue, chatSearchOpenStore, navChat } from "../Stores/ChatStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { focusChatSearchRequest } from "./Header/ChatHeaderNewMenu";
    import { createSearchFilter } from "./Header/SearchFilter";
    import { IconSearch, IconX } from "@wa-icons";

    /**
     * The search field of the chat footer, with its Cancel: one search for the open tab (Chats or People), shown in the
     * footer's place while a search is open (InviteFooter). The Chats / People tabs live in ChatTabs.
     */
    const gameScene = gameManager.getCurrentGameScene();
    const userProviderMergerPromise = gameScene.userProviderMerger;
    let searchLoader = false;
    let searchInput: HTMLInputElement | undefined;
    const searchFilter = createSearchFilter((loading) => (searchLoader = loading));

    $: placeholder = $navChat.key === "users" ? $LL.chat.header.searchPeople() : $LL.chat.header.searchChat();

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            // First Escape clears the search, the next one closes it.
            if ($chatSearchBarValue !== "") clearSearch(false);
            else cancel();
        }
    };

    // Every change of the field, however it was made, filters the lists: the text as it is now, once typing pauses.
    const handleInput = (event: Event) => {
        const value = (event.currentTarget as HTMLInputElement).value;
        // Emptied field: the full lists come back at once, like with the clear button.
        if (value === "") {
            clearSearch(false);
            return;
        }
        searchFilter.schedule(value, (text) =>
            userProviderMergerPromise.then((userProviderMerger) => userProviderMerger.setFilter(text))
        );
    };

    function clearSearch(refocus: boolean) {
        searchFilter.cancel();
        chatSearchBarValue.set("");
        userProviderMergerPromise
            .then((userProviderMerger) => userProviderMerger.setFilter(""))
            .catch((e) => console.error(e));
        if (refocus) searchInput?.focus();
    }

    /** Cancel: clear the text and close the field; the footer shows Invite, search and "+" again. */
    function cancel() {
        clearSearch(false);
        focusChatSearchRequest.set(false);
        chatSearchOpenStore.set(false);
    }

    function focusChatInput() {
        // Disable input manager to prevent the game from receiving the input
        chatInputFocusStore.set(true);
    }
    function unfocusChatInput() {
        // Enable input manager to allow the game to receive the input
        chatInputFocusStore.set(false);
    }

    // The search button, New message and Find people ask for the focus: the field takes it as it appears, in the
    // tap that opened it, so the phone's keyboard comes up with it.
    onMount(() => {
        if (!$focusChatSearchRequest) return;
        focusChatSearchRequest.set(false);
        searchInput?.focus();
    });

    onDestroy(() => {
        searchFilter.cancel();
        // A field removed while it has the focus does not always report it leaving: give the game its keys back.
        unfocusChatInput();
    });
</script>

<div class="flex w-full items-center gap-2" data-testid="chatSearchRow">
    <div class="chat-search u-glass group relative grow min-w-0 h-11 flex items-center rounded-full transition-colors">
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
            {placeholder}
            aria-label={placeholder}
            on:keydown={handleKeyDown}
            on:input={handleInput}
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
    <!-- mousedown keeps the focus in the field, so the phone's keyboard doesn't fold (and shift this button) before the tap lands. -->
    <button
        type="button"
        data-testid="chatSearchCancel"
        class="u-glass-btn px-4 text-sm font-bold"
        on:mousedown|preventDefault
        on:click={cancel}
    >
        {$LL.chat.header.cancelSearch()}
    </button>
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
