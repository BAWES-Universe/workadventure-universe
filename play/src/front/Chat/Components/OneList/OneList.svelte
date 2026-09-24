<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { flip } from "svelte/animate";
    import { fade } from "svelte/transition";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomModeration,
        ChatRoomNotificationControl,
        RoomFolder as RoomFolderType,
    } from "../../Connection/ChatConnection";
    import { chatSearchBarValue } from "../../Stores/ChatStore";
    import { areaChatRooms } from "../../Stores/AreaPresenceStore";
    import { WOKA_BY_CHAT_ID_CONTEXT, createWokaByChatIdStore } from "../../Stores/ChatUserWokaStore";
    import Room from "../Room/Room.svelte";
    import RoomInvitation from "../Room/RoomInvitation.svelte";
    import RoomFolder from "../RoomFolder.svelte";
    import type { OneListEntry } from "./OneListStore";
    import { ONE_LIST_FREEZE_CONTEXT, OrderFreeze, createOneListStore, freezeWhileHeld } from "./OneListStore";

    type ManagedRoom = ChatRoom & ChatRoomMembershipManagement & ChatRoomModeration & ChatRoomNotificationControl;

    /** Rows rendered before "Show more": enough for everyday use, light on a phone with hundreds of rooms. */
    const PAGE_SIZE = 50;

    const chat = gameManager.chatConnection;

    const entries = createOneListStore({
        directRooms: chat.directRooms,
        rooms: chat.rooms,
        invitations: chat.invitations,
        folders: chat.folders,
        // Area chat rooms have their own row under the top row and never show here, even while joining or leaving.
        hiddenRoomIds: areaChatRooms.hiddenRoomIds,
        search: chatSearchBarValue,
    });

    // Nothing reorders while a finger or pointer is down on a row, or while a row menu is open.
    // Per tab and in memory, like everything else in the list.
    const orderFreeze = new OrderFreeze();
    setContext(ONE_LIST_FREEZE_CONTEXT, orderFreeze);
    // One lookup for every row: direct chats show the other person's woka when the room has no picture.
    setContext(WOKA_BY_CHAT_ID_CONTEXT, createWokaByChatIdStore(gameManager.getCurrentGameScene().userProviderMerger));
    const displayed = freezeWhileHeld(entries, orderFreeze.held);
    const pointerHolder = {};

    function onPointerDown() {
        orderFreeze.hold(pointerHolder);
    }

    function onPointerUp() {
        orderFreeze.release(pointerHolder);
    }

    let reducedMotion = false;
    onMount(() => {
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        window.addEventListener("blur", onPointerUp);

        const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        const onChange = (event: MediaQueryListEvent) => (reducedMotion = event.matches);
        if (query) {
            reducedMotion = query.matches;
            query.addEventListener("change", onChange);
        }

        return () => {
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("blur", onPointerUp);
            query?.removeEventListener("change", onChange);
            orderFreeze.release(pointerHolder);
        };
    });

    let showAll = false;

    function asRoom(entry: OneListEntry): ManagedRoom {
        return entry.item as ManagedRoom;
    }

    function asInvitation(entry: OneListEntry): ChatRoom & ChatRoomMembershipManagement {
        return entry.item as ChatRoom & ChatRoomMembershipManagement;
    }

    function asFolder(entry: OneListEntry): RoomFolderType & ChatRoomModeration {
        return entry.item as RoomFolderType & ChatRoomModeration;
    }

    $: duration = reducedMotion ? 0 : 220;
    $: visibleEntries = showAll ? $displayed : $displayed.slice(0, PAGE_SIZE);
    $: hiddenCount = Math.max(0, $displayed.length - PAGE_SIZE);
    $: isSearching = $chatSearchBarValue.trim() !== "";
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<ul
    class="one-list m-0 p-0 list-none flex flex-col"
    aria-label={$LL.chat.oneList.label()}
    data-testid="oneChatList"
    on:pointerdown={onPointerDown}
>
    {#each visibleEntries as entry (entry.id)}
        <li
            class="one-list-item relative"
            data-testid="oneChatListItem"
            data-kind={entry.kind}
            data-room-id={entry.id}
            animate:flip={{ duration }}
            in:fade={{ duration }}
        >
            {#if entry.kind === "invitation"}
                <RoomInvitation room={asInvitation(entry)} />
            {:else if entry.kind === "folder"}
                <RoomFolder
                    folder={asFolder(entry)}
                    rootFolder={true}
                    summary={{
                        timestamp: entry.timestamp,
                        unreadCount: entry.unreadCount,
                        hasUnread: entry.hasUnread,
                    }}
                />
            {:else}
                <Room room={asRoom(entry)} />
            {/if}
        </li>
    {/each}
</ul>

{#if hiddenCount > 0}
    <div class="flex justify-center px-2 pt-1 pb-2">
        <button
            class="m-0 h-9 w-full rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10"
            data-testid="oneChatListShowMore"
            on:click={() => (showAll = !showAll)}
        >
            {showAll ? $LL.chat.showLess() : $LL.chat.showMore({ number: hiddenCount })}
        </button>
    </div>
{/if}

{#if $displayed.length === 0}
    <p class="m-0 px-4 py-6 text-center text-sm text-white/50" data-testid="oneChatListEmpty">
        {isSearching ? $LL.chat.oneList.noResults() : $LL.chat.oneList.empty()}
    </p>
{/if}

<style>
    /* Subtle separators that start after the avatar, like the apps people know. RTL-aware. */
    .one-list-item + .one-list-item::before {
        content: "";
        position: absolute;
        top: 0;
        inset-inline-start: 3.75rem;
        inset-inline-end: 0.5rem;
        height: 1px;
        background: rgb(255 255 255 / 0.06);
        pointer-events: none;
    }
</style>
