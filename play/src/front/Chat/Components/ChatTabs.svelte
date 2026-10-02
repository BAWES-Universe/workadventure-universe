<script lang="ts">
    import { derived } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { navChat } from "../Stores/ChatStore";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { hideActionBarStoreBecauseOfChatBar } from "../ChatSidebarWidthStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { INITIAL_SIDEBAR_WIDTH } from "../../Stores/ChatStore";
    import ChatActionMenu from "./ChatActionMenu.svelte";

    /**
     * The top row of the chat: the Chats and People tabs and, on narrow screens, the close button.
     * It is mounted once, above the lists, so the gradient pill really slides from one tab to the other:
     * mounted inside each list it was re-created on every switch, and the slide never played.
     * The only presence number is on the People tab: everyone online in this world, this tab and its clones
     * included. Nothing here repeats it.
     */
    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    const gameScene = gameManager.getCurrentGameScene();
    const chat = gameManager.chatConnection;
    const hasChatsTab = gameScene.room.isChatEnabled;
    const hasPeopleTab = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const showPeopleCount = gameScene.room.isChatOnlineListEnabled;
    const worldUserCount = gameScene.worldUserCounter;
    const proximityChatRoom = gameScene.proximityChatRoom;
    const proximityUnread = proximityChatRoom.hasUnreadMessages;

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

    // The tabs are as tall as the action bar's buttons beside them. The bar sizes itself on the width left next
    // to the chat (its container), in three steps: 48px buttons under 640px and from 1280px, 40px between. A touch
    // screen always gets 48px, like the bar.
    let innerWidth = 0;
    $: barWidth = innerWidth - sideBarWidth;
    $: compact = innerWidth > 0 && barWidth >= 640 && barWidth < 1280;

    function onTabKeyDown(event: KeyboardEvent) {
        // Left and right move between the two tabs; the arrows never reach the game.
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        if (activeTab === "chats" && hasPeopleTab) navChat.switchToUserList();
        else if (activeTab === "people" && hasChatsTab) navChat.switchToChat();
    }
</script>

<svelte:window bind:innerWidth />

<div class="relative z-40 w-full">
    <div class="flex items-center gap-2 ps-2 pe-2 pt-2 pb-1">
        {#if hasChatsTab && hasPeopleTab}
            <div
                class="chat-tabs u-glass relative flex grow min-w-0 gap-1 rounded-full p-1"
                class:compact
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
</div>

<style>
    /* The track is a pill as tall as the action bar's pills (64px, 56px in the middle step); each tab is as tall as
       the bar's buttons (48px, 40px). The gradient pill slides under the open tab; the tabs stay transparent. */
    .chat-tabs {
        --tab-height: 3rem;
    }
    .chat-tabs.compact {
        --tab-height: 2.5rem;
    }
    @media (pointer: coarse) {
        .chat-tabs,
        .chat-tabs.compact {
            --tab-height: 3rem;
        }
    }
    .chat-tabs::before {
        content: "";
        position: absolute;
        top: 4px;
        bottom: 4px;
        inset-inline-start: 4px;
        width: calc(50% - 6px);
        border-radius: 9999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
        transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease;
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
    @media (prefers-reduced-motion: reduce) {
        .chat-tabs::before {
            transition: opacity 150ms ease;
        }
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
        height: var(--tab-height);
        padding: 0 0.75rem;
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        transition: color 150ms ease;
    }

    .chat-tab:hover {
        color: #fff;
        filter: none;
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
</style>
