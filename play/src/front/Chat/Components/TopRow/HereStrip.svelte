<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { navChat } from "../../Stores/ChatStore";
    import {
        adminDashboardActivatedStore,
        inviteUserActivated,
        showMenuItem,
        SubMenusInterface,
    } from "../../../Stores/MenuStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { openAdminModalFromMenu } from "../../../external-modules/admin-api/index";
    import WokaFromUserId from "../../../Components/Woka/WokaFromUserId.svelte";
    import TopRowAvatar from "./TopRowAvatar.svelte";
    import { countWorldPresence, formatHereLine, peopleOnThisMap } from "./TopRowSummary";
    import { IconUserPlus, IconWorldSearch } from "@wa-icons";

    /**
     * Who is on this map, in one line: your woka and the next few, "Map · 3 here" and "You, Omar +1".
     * Tapping it opens the People tab. Invite and Orbit sit next to it as icon buttons.
     */
    const MAX_OTHER_AVATARS = 2;

    const gameScene = gameManager.getCurrentGameScene();
    // "Yourself" is this tab's own avatar, never the account: other tabs of the same account count as people.
    const mySpaceUserId = gameScene.connection?.getSpaceUserId();
    const roomUrl = gameScene.roomUrl;
    const mapName = gameScene.room.roomName?.trim();
    const isOnlineListEnabled = gameScene.room.isChatOnlineListEnabled;
    const canSeeWhoIsHere = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const worldUsers = gameScene.allUsersInWorldStore;

    function openUserList() {
        navChat.switchToUserList();
    }

    function openOrbit() {
        openAdminModalFromMenu();
    }

    function openInvite() {
        analyticsClient.openInvite();
        showMenuItem(SubMenusInterface.invite);
    }

    // Only what the People tab would show: nothing when the online list is disabled, nothing before it is loaded.
    $: others = isOnlineListEnabled && $worldUsers ? peopleOnThisMap($worldUsers.values(), mySpaceUserId, roomUrl) : [];
    $: presence =
        isOnlineListEnabled && $worldUsers
            ? countWorldPresence($worldUsers.values(), mySpaceUserId, roomUrl)
            : undefined;
    $: shownOthers = others.slice(0, MAX_OTHER_AVATARS);

    $: title = mapName || $LL.chat.here.thisMap();
    $: subtitle = presence
        ? formatHereLine(
              others.map((user) => user.name),
              presence.elsewhere,
              {
                  you: $LL.chat.topRow.you(),
                  onlyYou: $LL.chat.here.onlyYou(),
                  elsewhere: $LL.chat.topRow.elsewhereInWorld,
                  separator: $LL.chat.topRow.separator(),
                  two: $LL.chat.topRow.twoNames,
                  more: $LL.chat.topRow.moreNames,
              }
          )
        : undefined;
</script>

<div class="flex items-center gap-2 px-2 py-2" data-testid="hereStrip">
    <button
        type="button"
        class="group flex min-w-0 grow items-center gap-3 m-0 rounded-xl px-1.5 py-1 text-start bg-transparent enabled:hover:bg-contrast-200/10 focus:outline-none focus-visible:bg-contrast-200/10 disabled:cursor-default"
        disabled={!canSeeWhoIsHere}
        aria-label={canSeeWhoIsHere ? $LL.chat.here.seeWhoIsHere({ mapName: title }) : undefined}
        title={canSeeWhoIsHere ? $LL.chat.here.seeWhoIsHere({ mapName: title }) : undefined}
        data-testid="hereStripPeople"
        on:click={openUserList}
    >
        <div class="flex shrink-0 items-center" aria-hidden="true">
            <div
                class="relative h-8 w-8 rounded-full overflow-hidden ring-2 ring-contrast bg-contrast-600 flex items-center justify-center"
                style:z-index={MAX_OTHER_AVATARS + 1}
            >
                <div class="translate-y-[3px]">
                    <WokaFromUserId userId={-1} customWidth="28px" placeholderSrc="" />
                </div>
            </div>
            {#each shownOthers as person, index (person.spaceUserId)}
                <div class="-ms-2.5" style:z-index={MAX_OTHER_AVATARS - index}>
                    <TopRowAvatar pictureStore={person.pictureStore} name={person.name} />
                </div>
            {/each}
        </div>
        <div class="flex min-w-0 flex-col">
            <div class="truncate text-sm font-bold text-white" data-testid="hereStripTitle">
                {title}{#if presence}<span class="font-normal text-white/50">
                        {$LL.chat.topRow.separator()}{$LL.chat.here.countHere({ count: others.length + 1 })}</span
                    >{/if}
            </div>
            {#if subtitle}
                <div class="truncate text-xs text-white/60" data-testid="hereStripSubtitle">{subtitle}</div>
            {/if}
        </div>
    </button>

    {#if $inviteUserActivated}
        <button
            type="button"
            class="m-0 h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-white/5 text-white/70 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label={$LL.chat.topRow.inviteSomeone()}
            title={$LL.chat.topRow.inviteSomeone()}
            data-testid="hereStripInvite"
            on:click={openInvite}
        >
            <IconUserPlus font-size="18" />
        </button>
    {/if}
    {#if $adminDashboardActivatedStore}
        <button
            type="button"
            class="m-0 h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-white/5 text-white/70 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label={$LL.chat.topRow.exploreWithOrbit()}
            title={$LL.chat.topRow.exploreWithOrbit()}
            data-testid="hereStripOrbit"
            on:click={openOrbit}
        >
            <IconWorldSearch font-size="18" />
        </button>
    {/if}
</div>
