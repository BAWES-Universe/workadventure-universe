<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { autoUpdate } from "@floating-ui/dom";
    import type { Readable } from "svelte/store";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { requestVisitCardsStore } from "../../../Stores/GameStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { showReportScreenStore } from "../../../Stores/ShowReportScreenStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import { openOrbitProfile } from "../../../external-modules/admin-api/index";
    import RoomOption from "../Room/RoomMenu/RoomOption.svelte";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { placePersonMenu } from "./PersonMenuPlacement";
    import { locatePerson } from "./PersonNavigation";
    import { openPersonMenuStore } from "./PersonMenuStore";
    import type { FriendMenuAction } from "./FriendMenuAction";
    import { IconForbid, IconDots, IconMapPin, IconUserCircle } from "@wa-icons";

    export let user: ChatUser;
    /** Locate (follow) the person, listed when they are on this map. */
    export let showLocate = false;
    /** Their profile in Orbit. */
    export let showViewProfile = false;
    export let showBan = false;
    /** Add friend, or what comes next with them (cancel, accept, remove). */
    export let friendAction: FriendMenuAction | undefined = undefined;
    /** Entries moved here from the row to keep it short (Message, when the row shows Ring). */
    export let extraActions: FriendMenuAction[] = [];

    let popoversElement: HTMLDivElement;

    let buttonElement: HTMLButtonElement | undefined;

    let chatMenuActive = false;
    // Opening this menu closes any other person's: only one is ever open.
    const menuId = `person-menu-${Math.random().toString(36).slice(2, 9)}`;
    $: if (chatMenuActive && $openPersonMenuStore !== menuId) chatMenuActive = false;

    let usersByRoomStore:
        | Readable<Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>>
        | undefined = undefined;

    let cleanup: undefined | (() => void);

    $: if (popoversElement && buttonElement) {
        cleanup = autoUpdate(buttonElement, popoversElement, repositionIfOverflowing);
    }
    $: usersByRoomMap = usersByRoomStore && $usersByRoomStore ? $usersByRoomStore : new Map();
    // Flatten usersByRoomMap into a list of users with playUri from their room
    $: usersWithRoomPlayUri = (() => {
        const usersList: (ChatUser & { playUri: string })[] = [];
        for (const [playUri, roomData] of usersByRoomMap.entries()) {
            for (const user of roomData.users) {
                usersList.push({
                    ...user,
                    playUri: playUri ?? user.playUri ?? "",
                });
            }
        }
        return usersList;
    })();
    // Match by space user id when known, so another tab of the same account is located, not the first one found.
    $: userToLocate = usersWithRoomPlayUri.find((u) =>
        user.spaceUserId ? u.spaceUserId === user.spaceUserId : u.uuid === user.uuid
    );

    // A line before the first red item, when something sits above it.
    $: hasRowsBeforeFriend = extraActions.length > 0 || showLocate || showViewProfile;
    $: hasRowsBeforeBan = hasRowsBeforeFriend || friendAction !== undefined;

    function repositionIfOverflowing() {
        if (!buttonElement || !popoversElement) return;
        placePersonMenu(buttonElement, popoversElement);
    }

    const closeChatUserMenu = () => {
        chatMenuActive = false;
        if ($openPersonMenuStore === menuId) openPersonMenuStore.set(undefined);
    };

    const toggleChatUSerMenu = () => {
        if (chatMenuActive) {
            closeChatUserMenu();
            return;
        }
        openPersonMenuStore.set(menuId);
        chatMenuActive = true;
    };

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
        if (
            event.target &&
            popoversElement &&
            !popoversElement.contains(event.target as Node) &&
            !buttonElement?.contains(event.target as Node)
        ) {
            closeChatUserMenu();
        }
    };

    onMount(() => {
        gameManager
            .getCurrentGameScene()
            .userProviderMerger.then((merger: UserProviderMerger) => {
                usersByRoomStore = merger.usersByRoomStore;
            })
            .catch((error) => {
                console.error("Failed to get users by room store : ", error);
            });
    });

    onDestroy(() => {
        if (cleanup) cleanup();
        if ($openPersonMenuStore === menuId) openPersonMenuStore.set(undefined);
    });

    function viewProfile() {
        if (!user.uuid) return;
        openOrbitProfile(user.uuid);
        closeChatUserMenu();
    }

    function banUser() {
        if (user.username && user.uuid) {
            showReportScreenStore.set({ userUuid: user.uuid, userName: user.username });
        }
    }

    function locateUser() {
        if (userToLocate == undefined || userToLocate.uuid == undefined) return;

        // Check if visit card url is the same as the current visit card url
        if ($requestVisitCardsStore != undefined) {
            requestVisitCardsStore.set(null);
        }

        // Track the open woka menu action
        analyticsClient.openWokaMenu();
        peopleCardReturn.tappedPerson(userToLocate.uuid);

        // Opens the menu on this exact avatar when it is in view (by space user id, so clones are told apart),
        // otherwise asks the server for the position.
        locatePerson(userToLocate, user.username);
        closeChatUserMenu();
    }
</script>

<svelte:window on:click={handleClickOutside} on:touchstart={handleClickOutside} />
<div class="wa-dropdown">
    <PersonActionButton
        label={$LL.chat.userList.moreActions({ userName: user.username ?? "" })}
        testId={`more-actions-${user.username}`}
        expanded={chatMenuActive}
        hasPopup
        bind:buttonElement
        on:click={toggleChatUSerMenu}
    >
        <IconDots font-size="18" />
    </PersonActionButton>
    {#if chatMenuActive}
        <div
            bind:this={popoversElement}
            role="menu"
            class="wa-dropdown-menu u-surface fixed z-40 w-max min-w-48 rounded-2xl p-1"
        >
            {#each extraActions as action (action.label)}
                <RoomOption
                    role="menuitem"
                    IconComponent={action.icon}
                    title={action.label}
                    on:click={() => {
                        action.act();
                        closeChatUserMenu();
                    }}
                />
            {/each}

            {#if showLocate}
                <RoomOption
                    role="menuitem"
                    IconComponent={IconMapPin}
                    title={$LL.chat.userList.follow()}
                    bg={userToLocate == undefined ? "opacity-50" : ""}
                    disabled={userToLocate == undefined}
                    on:click={locateUser}
                />
            {/if}
            {#if showViewProfile}
                <RoomOption
                    role="menuitem"
                    IconComponent={IconUserCircle}
                    title={$LL.chat.userList.viewProfile()}
                    dataTestId={`view-profile-${user.username}`}
                    on:click={viewProfile}
                />
            {/if}

            {#if friendAction}
                {#if friendAction.danger && hasRowsBeforeFriend}
                    <div class="u-menu-divider" />
                {/if}
                <RoomOption
                    role="menuitem"
                    IconComponent={friendAction.icon}
                    title={friendAction.label}
                    dataTestId={`friend-action-${user.username}`}
                    bg={friendAction.danger ? "u-danger" : ""}
                    on:click={() => {
                        friendAction?.act();
                        closeChatUserMenu();
                    }}
                />
            {/if}

            {#if showBan}
                {#if hasRowsBeforeBan && !friendAction?.danger}
                    <div class="u-menu-divider" />
                {/if}
                <RoomOption
                    role="menuitem"
                    IconComponent={IconForbid}
                    title={$LL.chat.ban.title()}
                    bg="u-danger"
                    on:click={banUser}
                />
            {/if}
        </div>
    {/if}
</div>
