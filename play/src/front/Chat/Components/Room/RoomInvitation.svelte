<script lang="ts">
    import type { ChatRoomMembershipManagement, ChatRoom } from "../../Connection/ChatConnection";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { selectedRoomStore } from "../../Stores/SelectRoomStore";
    import Avatar from "../Avatar.svelte";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import { formatRowTime } from "../OneList/OneListOrder";
    import { minuteClock } from "../OneList/MinuteClock";
    import { IconLoader, IconMail } from "@wa-icons";

    export let room: ChatRoom & ChatRoomMembershipManagement;
    let roomName = room.name;
    let loadingInvitation = false;
    const inviterName = room.inviterName;
    const inviteTimestamp = room.inviteTimestamp;

    $: timeLabel =
        inviteTimestamp === undefined
            ? ""
            : formatRowTime(inviteTimestamp, $minuteClock, $locale, {
                  justNow: $LL.chat.oneList.justNow(),
                  minutes: (count) => $LL.chat.oneList.minutesShort({ count }),
                  yesterday: $LL.chat.oneList.yesterday(),
              });

    function joinRoom() {
        loadingInvitation = true;

        room.joinRoom()
            .then(() => {
                if (!room.isRoomFolder) selectedRoomStore.set(room);
            })
            .catch(() => {
                warningMessageStore.addWarningMessage($LL.chat.failedToJoinRoom());
            })
            .finally(() => {
                loadingInvitation = false;
            });
    }

    function leaveRoom() {
        loadingInvitation = true;
        room.leaveRoom()
            .catch(() => {
                warningMessageStore.addWarningMessage($LL.chat.failedToLeaveRoom());
            })
            .finally(() => {
                loadingInvitation = false;
            });
    }
</script>

<div
    class="text-md flex flex-wrap gap-x-3 gap-y-2 items-center min-h-14 ps-2 pe-2 py-2 rounded-xl bg-secondary/10 hover:bg-white/10 transition-colors test-userinvitation"
    data-testid="userInvitation"
>
    <div class="flex min-w-[9rem] flex-1 items-center gap-3">
        <div class="relative shrink-0">
            <Avatar
                pictureStore={room.pictureStore}
                fallbackName={$roomName}
                size="lg"
                round={room.type === "direct"}
            />
            <span
                class="absolute -bottom-1 -end-1 h-5 w-5 rounded-full bg-secondary text-white flex items-center justify-center ring-2 ring-contrast"
                aria-hidden="true"
            >
                <IconMail font-size="11" />
            </span>
        </div>
        <div class="flex min-w-0 grow flex-col text-start">
            <div class="flex min-w-0 items-baseline gap-2">
                <span class="min-w-0 grow truncate text-sm font-bold text-white">{$roomName}</span>
                {#if timeLabel}
                    <span class="shrink-0 text-[11px] text-secondary-400 font-semibold">{timeLabel}</span>
                {/if}
            </div>
            <span class="truncate text-xs text-white/70" data-testid="invitationFrom">
                {inviterName ? $LL.chat.oneList.invitedYou({ name: inviterName }) : $LL.chat.oneList.invited()}
            </span>
        </div>
    </div>
    {#if loadingInvitation}
        <div class="flex h-8 items-center justify-center px-2">
            <IconLoader class="animate-spin" />
        </div>
    {:else}
        <div class="flex shrink-0 gap-1.5 ms-auto">
            <button
                class="border border-solid border-danger text-danger hover:bg-danger-400/10 rounded-full text-xs h-8 px-3 m-0"
                on:click={() => leaveRoom()}
            >
                {$LL.chat.decline()}
            </button>
            <button
                class="border border-solid border-success bg-success/15 text-success hover:bg-success-400/25 rounded-full text-xs h-8 px-3 m-0"
                data-testid="acceptInvitationButton"
                on:click={() => joinRoom()}
            >
                {$LL.chat.accept()}
            </button>
        </div>
    {/if}
</div>
