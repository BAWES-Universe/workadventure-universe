<script lang="ts">
    import { tick } from "svelte";
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

    // The pill can be dragged or flicked to the other tab, like a switch: it follows the finger, then snaps to the
    // tab it is nearer, or to the one it was flicked toward, and that tab opens. A movement under 6px is a tap and
    // left to the tabs' own click. Only the track takes the gesture; the lists below keep scrolling as before.
    const isRTL = document.documentElement.dir === "rtl";
    let track: HTMLDivElement;
    let pillX: number | undefined;
    let drag:
        | {
              pointerId: number;
              startX: number;
              base: number;
              travel: number;
              moved: boolean;
              samples: { x: number; t: number }[];
          }
        | undefined;
    // A drag ends with a click on the tab under the finger: ignore that one.
    let ignoreClicksUntil = 0;

    function startDrag(event: PointerEvent) {
        if (!hasChatsTab || !hasPeopleTab || activeTab === undefined) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        // The pill is half the track less 6px, and moves its own width plus the 4px gap: half the track less 2px.
        const travel = track.clientWidth / 2 - 2;
        drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            base: activeTab === "people" ? travel : 0,
            travel,
            moved: false,
            samples: [{ x: event.clientX, t: event.timeStamp }],
        };
    }

    function moveDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = (event.clientX - drag.startX) * (isRTL ? -1 : 1);
        if (!drag.moved) {
            if (Math.abs(dx) < 6) return;
            drag.moved = true;
            track.setPointerCapture(event.pointerId);
        }
        pillX = Math.min(drag.travel, Math.max(0, drag.base + dx));
        drag.samples = [...drag.samples, { x: event.clientX, t: event.timeStamp }].slice(-5);
    }

    function endDrag(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const ended = drag;
        drag = undefined;
        if (!ended.moved) return;
        ignoreClicksUntil = event.timeStamp + 400;
        const position = pillX ?? ended.base;
        pillX = undefined;
        if (event.type === "pointercancel") return;
        const first = ended.samples[0];
        const last = ended.samples[ended.samples.length - 1];
        const velocity = last.t > first.t ? ((last.x - first.x) * (isRTL ? -1 : 1)) / (last.t - first.t) : 0;
        const toPeople = Math.abs(velocity) > 0.4 ? velocity > 0 : position > ended.travel / 2;
        if (toPeople && activeTab !== "people") navChat.switchToUserList();
        else if (!toPeople && activeTab !== "chats") navChat.switchToChat();
    }

    function openTab(tab: "chats" | "people", event: MouseEvent) {
        if (event.timeStamp < ignoreClicksUntil) return;
        if (tab === "chats") navChat.switchToChat();
        else navChat.switchToUserList();
    }

    let chatsTab: HTMLButtonElement;
    let peopleTab: HTMLButtonElement;

    async function onTabKeyDown(event: KeyboardEvent) {
        // Left and right move between the two tabs, and the focus moves with them, as in any tab list; the arrows
        // never reach the game.
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        if (activeTab === "chats" && hasPeopleTab) {
            navChat.switchToUserList();
            await tick();
            peopleTab?.focus();
        } else if (activeTab === "people" && hasChatsTab) {
            navChat.switchToChat();
            await tick();
            chatsTab?.focus();
        }
    }
</script>

<svelte:window bind:innerWidth />

<div class="relative z-40 w-full">
    <div class="flex items-center gap-2 ps-2 pe-2 pt-2 pb-1">
        {#if hasChatsTab && hasPeopleTab}
            <div
                class="chat-tabs u-glass relative flex grow min-w-0 gap-1 rounded-full p-1"
                class:compact
                class:dragging={pillX !== undefined}
                role="tablist"
                data-active={activeTab}
                style={pillX !== undefined ? `--pill-x: ${isRTL ? -pillX : pillX}px` : undefined}
                bind:this={track}
                on:pointerdown={startDrag}
                on:pointermove={moveDrag}
                on:pointerup={endDrag}
                on:pointercancel={endDrag}
            >
                <button
                    type="button"
                    role="tab"
                    class="chat-tab {activeTab === 'chats' ? 'is-active' : ''}"
                    aria-selected={activeTab === "chats"}
                    tabindex={activeTab === "chats" ? 0 : -1}
                    data-testid="chatTabChats"
                    bind:this={chatsTab}
                    on:click={(event) => openTab("chats", event)}
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
                    bind:this={peopleTab}
                    on:click={(event) => openTab("people", event)}
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
    /* Dragged: the pill sits under the finger, with no easing to lag behind it. Let go, and the rules above take
       over again with their transition, so it glides from where it was dropped. */
    .chat-tabs {
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
    }
    .chat-tabs.dragging.dragging::before {
        opacity: 1;
        transform: translateX(var(--pill-x));
        transition: none;
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

    /* A tap focuses the tab, and the game's global focus rule then draws the system's blue ring around it at
       once, ahead of the sliding pill. Only the keyboard gets a ring. */
    .chat-tab:focus:not(:focus-visible) {
        outline: none;
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
