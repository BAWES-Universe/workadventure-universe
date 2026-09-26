<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { computePosition, flip, shift, offset, autoUpdate } from "@floating-ui/dom";
    import type { Readable } from "svelte/store";
    import businessCard from "../../images/business-cards.svg";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { requestVisitCardsStore } from "../../../Stores/GameStore";
    import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { showReportScreenStore } from "../../../Stores/ShowReportScreenStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { locatePerson } from "./PersonNavigation";
    import { openPersonMenuStore } from "./PersonMenuStore";
    import { IconForbid, IconDots, IconMapPin } from "@wa-icons";

    export let user: ChatUser;
    /** Locate (follow) the person, listed when they are on this map. */
    export let showLocate = false;
    export let showBusinessCard = false;
    export let showBan = false;

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

    function repositionIfOverflowing() {
        if (!buttonElement || !popoversElement) return;
        computePosition(buttonElement, popoversElement, {
            middleware: [offset(6), flip(), shift({ padding: 5 })],
        })
            .then(({ x, y }) => {
                Object.assign(popoversElement.style, {
                    left: `${x}px`,
                    top: `${y}px`,
                });
            })
            .catch((error) => {
                console.error("Failed to compute popover position : ", error);
            });
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

    const openBusinessCard = (visitCardUrl: string | undefined) => {
        analyticsClient.showBusinessCard();

        // If woka menu is open, close it
        if ($wokaMenuStore) {
            wokaMenuStore.clear();
        }

        if (visitCardUrl) {
            if ($requestVisitCardsStore == visitCardUrl) {
                requestVisitCardsStore.set(null);
                closeChatUserMenu();
                return;
            }
            requestVisitCardsStore.set(visitCardUrl);
        }
        closeChatUserMenu();
    };

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
        peopleCardReturn.tappedPerson();

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
            class="wa-dropdown-menu u-glass z-10 mr-1 fixed rounded-xl p-1 shadow-2xl"
        >
            {#if showLocate}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="menuitem"
                    tabindex={userToLocate == undefined ? -1 : 0}
                    aria-disabled={userToLocate == undefined}
                    class={`follow wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 px-3 min-h-10 w-full text-sm rounded cursor-pointer ${
                        userToLocate == undefined ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
                    }`}
                    on:click|stopPropagation={locateUser}
                    on:keydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            locateUser();
                        }
                    }}
                >
                    <IconMapPin class="w-4" />
                    {$LL.chat.userList.follow()}
                </span>
            {/if}
            {#if showBusinessCard}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="menuitem"
                    tabindex="0"
                    class="businessCard wa-dropdown-item text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 px-3 min-h-10 w-full text-sm rounded cursor-pointer"
                    on:click|stopPropagation={() => openBusinessCard(user.visitCardUrl)}
                    on:keydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openBusinessCard(user.visitCardUrl);
                        }
                    }}
                    ><img class="noselect" src={businessCard} alt="" height="13" width="13" draggable="false" />
                    {$LL.chat.userList.businessCard()}</span
                >
            {/if}

            {#if showBan}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <span
                    role="menuitem"
                    tabindex="0"
                    class="ban wa-dropdown-item text-pop-red text-nowrap flex gap-2 items-center hover:bg-white/10 m-0 px-3 min-h-10 w-full text-sm rounded cursor-pointer"
                    on:click|stopPropagation={banUser}
                    on:keydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            banUser();
                        }
                    }}><IconForbid font-size="13" /> {$LL.chat.ban.title()}</span
                >
            {/if}
        </div>
    {/if}
</div>
