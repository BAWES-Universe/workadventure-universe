<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fade } from "svelte/transition";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import { findGroupOpenStore } from "../Stores/ChatStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { areaChatRooms, withoutAreaChatRooms } from "../Stores/AreaPresenceStore";
    import LoadingSmall from "../images/loading-small.svelte";
    import Avatar from "./Avatar.svelte";
    import { IconChevronLeft, IconChevronRight, IconLoader, IconSearch, IconX } from "@wa-icons";

    /**
     * The public Matrix directory as its own page: Back, a search of its own, and a Join button per group.
     * It is the same directory the header search used to mix into the chat list; the main search now only
     * filters what you already have.
     */
    type PublicGroup = { id: string; name: string | undefined };

    const chat = gameManager.chatConnection;
    const hiddenAreaRoomIds = areaChatRooms.hiddenRoomIds;
    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const DONE_TYPING_INTERVAL = 600;

    let query = "";
    let results: PublicGroup[] = [];
    let loading = false;
    let failed = false;
    let joiningId: string | undefined;
    let joinError: string | undefined;
    let searchInput: HTMLInputElement | undefined;
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    let requestSequence = 0;

    function close() {
        findGroupOpenStore.set(false);
    }

    async function search() {
        const sequence = ++requestSequence;
        loading = true;
        failed = false;
        try {
            const found = await chat.searchAccessibleRooms(query.trim());
            if (sequence !== requestSequence) return;
            results = found;
        } catch (error) {
            console.error(error);
            if (sequence !== requestSequence) return;
            failed = true;
            results = [];
        } finally {
            if (sequence === requestSequence) loading = false;
        }
    }

    function onInput() {
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            search().catch((e) => console.error(e));
        }, DONE_TYPING_INTERVAL);
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.stopPropagation();
            if (query !== "") {
                query = "";
                search().catch((e) => console.error(e));
            } else {
                close();
            }
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (typingTimer) clearTimeout(typingTimer);
            search().catch((e) => console.error(e));
        }
    }

    async function join(group: PublicGroup) {
        joiningId = group.id;
        joinError = undefined;
        try {
            const room = await chat.joinRoom(group.id);
            close();
            selectedRoomStore.set(room);
        } catch (error) {
            console.error(error);
            joinError = error instanceof Error ? error.message : "Unknown error";
            setTimeout(() => (joinError = undefined), 4000);
        } finally {
            joiningId = undefined;
        }
    }

    $: visibleResults = withoutAreaChatRooms(results, $hiddenAreaRoomIds);

    onMount(() => {
        searchInput?.focus();
        search().catch((e) => console.error(e));
    });

    onDestroy(() => {
        if (typingTimer) clearTimeout(typingTimer);
        chatInputFocusStore.set(false);
    });
</script>

<div class="flex h-full flex-col" data-testid="findGroupPage">
    <div class="flex items-center gap-1 p-2">
        <button
            type="button"
            class="m-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-0 text-white hover:bg-white/10"
            aria-label={$LL.chat.findGroup.back()}
            title={$LL.chat.findGroup.back()}
            data-testid="findGroupBack"
            on:click={close}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <h2 class="m-0 grow truncate text-md font-bold">{$LL.chat.findGroup.title()}</h2>
    </div>
    <div class="px-2 pb-2">
        <div
            class="group relative flex h-11 items-center rounded-full border border-solid border-white/10 bg-white/10 transition-colors focus-within:border-white/30 focus-within:bg-white/15"
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
                class="find-group-input block h-full w-full rounded-full border-none bg-transparent ps-10 pe-11 text-sm text-white placeholder:text-sm placeholder:text-white/50 focus:outline-none"
                placeholder={$LL.chat.findGroup.search()}
                aria-label={$LL.chat.findGroup.search()}
                data-testid="findGroupSearch"
                bind:value={query}
                on:input={onInput}
                on:keydown={onKeyDown}
                on:focusin={() => chatInputFocusStore.set(true)}
                on:focusout={() => chatInputFocusStore.set(false)}
            />
            <div class="absolute end-1 flex items-center">
                {#if loading}
                    <div class="flex h-9 w-9 items-center justify-center" aria-hidden="true"><LoadingSmall /></div>
                {:else if query !== ""}
                    <button
                        type="button"
                        class="m-0 flex h-9 w-9 items-center justify-center rounded-full p-0 text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label={$LL.chat.header.clearSearch()}
                        on:click={() => {
                            query = "";
                            search().catch((e) => console.error(e));
                        }}
                    >
                        <IconX font-size="16" />
                    </button>
                {/if}
            </div>
        </div>
        <p class="m-0 px-2 pt-2 text-xs text-white/50">{$LL.chat.findGroup.hint()}</p>
    </div>

    <div class="min-h-0 grow overflow-y-auto px-2 pb-2">
        {#if failed}
            <div class="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-white/60">
                <span>{$LL.chat.findGroup.error()}</span>
                <button
                    type="button"
                    class="m-0 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
                    on:click={() => search().catch((e) => console.error(e))}>{$LL.chat.findGroup.retry()}</button
                >
            </div>
        {:else if !loading && visibleResults.length === 0}
            <p class="m-0 px-4 py-6 text-center text-sm text-white/50" data-testid="findGroupEmpty">
                {$LL.chat.findGroup.empty()}
            </p>
        {:else}
            <ul class="m-0 flex list-none flex-col p-0" data-testid="findGroupList">
                {#each visibleResults as group (group.id)}
                    <li
                        class="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5"
                        data-testid="findGroupRow"
                    >
                        <Avatar pictureStore={undefined} fallbackName={group.name ?? ""} />
                        <span class="min-w-0 grow truncate text-sm font-bold text-white/90"
                            >{group.name ?? group.id}</span
                        >
                        <button
                            type="button"
                            class="m-0 flex h-9 shrink-0 items-center rounded-lg bg-secondary px-3 text-sm font-bold text-white hover:bg-secondary-600 disabled:opacity-60"
                            disabled={joiningId !== undefined}
                            data-testid="findGroupJoin"
                            on:click={() => join(group).catch((e) => console.error(e))}
                        >
                            {#if joiningId === group.id}
                                <IconLoader class="animate-spin" font-size="16" />
                            {:else}
                                {$LL.chat.join()}
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
        {#if joinError}
            <div transition:fade class="mt-2 rounded-lg bg-red-500/80 p-2 text-sm text-white">{joinError}</div>
        {/if}
    </div>
</div>

<style>
    .find-group-input::-webkit-search-cancel-button,
    .find-group-input::-webkit-search-decoration {
        -webkit-appearance: none;
        appearance: none;
    }
</style>
