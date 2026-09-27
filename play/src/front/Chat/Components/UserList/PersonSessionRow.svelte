<script lang="ts">
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { getColorHexOfStatus } from "../../../Utils/AvailabilityStatus";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { getPersonActions } from "./PersonActions";
    import { statusLabel } from "./PersonStatus";
    import { goToPersonRoom, locatePerson, walkToPerson } from "./PersonNavigation";
    import { IconDoorIn, IconMapPin, IconWalk } from "@wa-icons";

    /**
     * One of a person's sessions (a tab or a device), listed under their row: which room it is in, its status, and
     * quick buttons to reach that exact session.
     */
    export let session: ChatUser;
    export let number: number;
    export let displayName: string;

    const currentGameScene = gameManager.tryGetCurrentGameScene();

    $: status = session.availabilityStatus;
    $: roomName = session.roomName?.trim() || $LL.chat.peopleTab.thisRoom();
    $: label = $LL.chat.peopleTab.sessionLabel({ number, room: roomName });

    // Always another session than this tab: it can be reached like anyone else, never messaged.
    $: actions = getPersonActions({
        isSelf: false,
        isMyAccount: true,
        status: $status,
        uuid: session.uuid,
        chatId: session.chatId,
        playUri: session.playUri,
        currentRoomUrl: currentGameScene?.roomUrl,
        visitCardUrl: undefined,
        isMatrixChatEnabled: false,
        roomCreationInProgress: false,
        iAmAdmin: false,
    });

    function walkTo() {
        analyticsClient.goToUser();
        walkToPerson(session);
    }

    function goToRoom() {
        analyticsClient.goToUser();
        goToPersonRoom(session);
    }

    function locate() {
        if (session.uuid == undefined) return;
        analyticsClient.openWokaMenu();
        peopleCardReturn.tappedPerson(session.uuid);
        locatePerson(session, displayName);
    }
</script>

<li class="flex min-h-11 items-center gap-2 ps-12 pe-2" data-testid="personSession">
    <div class="min-w-0 flex-auto">
        <div class="truncate text-xs font-semibold text-white/80" title={label}>{label}</div>
        {#if $status}
            <div
                class="flex items-center text-xs opacity-75 brightness-150"
                style="color:{getColorHexOfStatus($status)}"
            >
                <span class="me-1 h-1.5 w-1.5 rounded-full" style="background:{getColorHexOfStatus($status)}" />
                {statusLabel($status, $LL)}
            </div>
        {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
        {#if actions.walkTo}
            <PersonActionButton
                primary
                label={$LL.chat.userList.walkTo()}
                ariaLabel={$LL.chat.userList.walkToUser({ userName: label })}
                testId={`walk-to-session-${number}`}
                on:click={walkTo}
            >
                <IconWalk font-size="20" />
            </PersonActionButton>
        {:else if actions.goToRoom}
            <PersonActionButton
                primary
                label={$LL.chat.userList.goToRoom()}
                ariaLabel={$LL.chat.userList.goToRoomOfUser({ userName: label })}
                testId={`go-to-room-session-${number}`}
                on:click={goToRoom}
            >
                <IconDoorIn font-size="20" />
            </PersonActionButton>
        {/if}
        {#if actions.locate}
            <PersonActionButton
                label={$LL.chat.userList.follow()}
                testId={`locate-session-${number}`}
                on:click={locate}
            >
                <IconMapPin font-size="20" />
            </PersonActionButton>
        {/if}
    </div>
</li>
