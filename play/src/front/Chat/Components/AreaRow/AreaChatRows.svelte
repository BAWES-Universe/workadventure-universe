<script lang="ts">
    import { onMount } from "svelte";
    import { derived } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { fly, slide } from "svelte/transition";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomModeration,
        ChatRoomNotificationControl,
    } from "../../Connection/ChatConnection";
    import type { AreaChatRoomEntry } from "../../Stores/AreaPresenceStore";
    import { areaChatRooms } from "../../Stores/AreaPresenceStore";
    import AreaChatRow from "./AreaChatRow.svelte";

    type ManagedRoom = ChatRoom & ChatRoomMembershipManagement & ChatRoomModeration & ChatRoomNotificationControl;
    type VisibleRow = { entry: AreaChatRoomEntry<ChatRoom>; room: ManagedRoom };

    const chatRooms = gameManager.chatConnection.rooms;

    function isManagedRoom(room: ChatRoom): room is ManagedRoom {
        return "myMembership" in room && "areNotificationsMuted" in room && "hasPermissionTo" in room;
    }

    // One row per area room whose join has completed, the most recently entered first. The room object comes from
    // the live room list when it is there (reconnects), else from the join. A room that is left, or that the account
    // was removed from, is not shown even before the area is left.
    const visibleRows: Readable<VisibleRow[]> = derived(
        [areaChatRooms.rows, chatRooms],
        ([$rows, $chatRooms], set) => {
            const resolved: VisibleRow[] = [];
            for (const entry of $rows) {
                const room = $chatRooms.find((chatRoom) => chatRoom.id === entry.roomId) ?? entry.room;
                if (room && isManagedRoom(room)) resolved.push({ entry, room });
            }
            if (resolved.length === 0) {
                set([]);
                return;
            }
            return derived(
                resolved.map(({ room }) => room.myMembership),
                ($memberships) => resolved.filter((_, index) => $memberships[index] === "join")
            ).subscribe(set);
        },
        [] as VisibleRow[]
    );

    let reducedMotion = false;
    onMount(() => {
        const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
        if (!query) return;
        reducedMotion = query.matches;
        const onChange = (event: MediaQueryListEvent) => (reducedMotion = event.matches);
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    });

    $: duration = reducedMotion ? 0 : 200;
</script>

{#if $visibleRows.length > 0}
    <div class="flex flex-col gap-1 mt-1" data-testid="areaChatRows">
        {#each $visibleRows as row (row.entry.roomId)}
            <div in:fly={{ y: -6, duration }} out:slide={{ duration }}>
                <AreaChatRow room={row.room} areaName={row.entry.areaName} />
            </div>
        {/each}
    </div>
{/if}
