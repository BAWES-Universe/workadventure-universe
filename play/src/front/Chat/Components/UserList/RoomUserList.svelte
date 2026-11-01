<script lang="ts" context="module">
    // Where the People list was scrolled to when it last closed (in memory, for this visit).
    let lastScrollTop = 0;
</script>

<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { get } from "svelte/store";
    import type { Readable } from "svelte/store";
    import type { AvailabilityStatus } from "@workadventure/messages";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { chatSearchBarValue, peopleSectionsOpenStore, peopleViewStore } from "../../Stores/ChatStore";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import InviteFooter from "../InviteFooter.svelte";
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import { createColourByChatIdStore, createWokaByChatIdStore, personColour } from "../../Stores/ChatUserWokaStore";
    import { currentChatPeople, requestChatPerson } from "../../Stores/ChatPeopleLookup";
    import { fold } from "../../../Utils/foldTransition";
    import {
        friendsEnabledStore,
        friendsPresenceUnavailableStore,
        friendsStore,
        relationshipsStore,
    } from "../../Stores/FriendsStore";
    import { countPeopleAndBots, countPeopleElsewhere } from "../../UserProvider/WorldUserProvider";
    import UserList from "./UserList.svelte";
    import PeopleAndBots from "./PeopleAndBots.svelte";
    import type { SelfIdentity } from "./PersonActions";
    import type { PersonGroup } from "./PersonSessions";
    import { groupSessions } from "./PersonSessions";
    import PeopleChips from "./PeopleChips.svelte";
    import FriendsList from "./FriendsList.svelte";
    import FriendRequests from "./FriendRequests.svelte";
    import FriendFaces from "./FriendFaces.svelte";
    import UniverseSearch from "./UniverseSearch.svelte";
    import type { WorldSighting } from "./Friends";
    import { chatIdsToAsk, otherWorldFaces, placeFriends, savedLook } from "./Friends";
    import { friendNoticeStore } from "./FriendActions";
    import { IconChevronDown, IconMapPin } from "@wa-icons";

    /**
     * The People tab, in three parts: the room you're in first ("Test · 3 here", you at the top), then everyone
     * else online in this world under the name of their room, then the world's members who aren't online,
     * folded shut with a line saying who they are. Searching unfolds whatever matches.
     * Each person is one row however many sessions they have open; the counts still count sessions.
     * In each room, bots are listed after the people, in a group of their own.
     * Signed-in players also get Everyone | Friends | Requests chips: friends come first in each section with a
     * badge, friends in other worlds sit in one row of faces on top, and a search can reach all of Universe.
     */
    export let userProviderMerger: UserProviderMerger;

    const USERS_BY_ROOM_LIMITATION = 200;

    type Person = PersonGroup<ChatUser>;

    interface RoomGroup {
        key: string;
        name: string;
        people: Person[];
    }

    const gameScene = gameManager.getCurrentGameScene();
    const isMatrixChatEnabled = gameScene.room.isMatrixChatEnabled;
    const currentRoomUrl = gameScene.roomUrl;
    const mapRoomName = gameScene.room.roomName?.trim();

    $: usersByRoom = userProviderMerger.usersByRoomStore;
    $: query = $chatSearchBarValue.trim().toLocaleLowerCase();
    $: isSearching = query !== "";

    let listElement: HTMLDivElement | undefined;

    // Back from a person's card on a phone: the list is where it was left.
    onMount(async () => {
        if (!peopleCardReturn.takeScrollRestore()) return;
        await tick();
        if (listElement) listElement.scrollTop = lastScrollTop;
    });
    onDestroy(() => {
        lastScrollTop = listElement?.scrollTop ?? 0;
    });

    function matches(user: ChatUser): boolean {
        if (!isSearching) return true;
        return user.username ? user.username.toLocaleLowerCase().includes(query) : false;
    }

    function statusOf(user: ChatUser): AvailabilityStatus | undefined {
        return get(user.availabilityStatus);
    }

    function myIdentity(): SelfIdentity {
        return {
            spaceUserId: gameScene.connection?.getSpaceUserId(),
            chatId: localUserStore.getChatId() ?? undefined,
            uuid: localUserStore.getLocalUser()?.uuid,
        };
    }

    // You first, then your friends, then everyone by name.
    function sortPeople(people: Person[], friends: ReadonlySet<string>): Person[] {
        const isFriend = (person: Person) => (person.primary.uuid ? friends.has(person.primary.uuid) : false);
        return [...people].sort((a, b) => {
            if (a.isMe) return -1;
            if (b.isMe) return 1;
            const friendOrder = Number(isFriend(b)) - Number(isFriend(a));
            if (friendOrder !== 0) return friendOrder;
            return a.primary.username?.localeCompare(b.primary.username || "") || -1;
        });
    }

    // Search first, then cap what is rendered: someone past the first 200 can still be found, and counts stay true.
    function shown(people: Person[]): Person[] {
        return people.filter((person) => matches(person.primary)).slice(0, USERS_BY_ROOM_LIMITATION);
    }

    function roomNameOf(playUri: string, roomName: string | undefined): string {
        if (roomName?.trim()) return roomName.trim();
        try {
            return new URL(playUri, window.location.href).pathname;
        } catch {
            return playUri;
        }
    }

    // Counts are of sessions (one per open tab or device), before the search filters them: "6 people · 21 bots" is
    // unchanged. People and bots are counted apart (#1389), and Elsewhere counts people only (#1396).
    $: hereEntry = $usersByRoom.get(currentRoomUrl);
    $: hereCount = countPeopleAndBots(hereEntry?.users ?? []);
    $: hereCountText =
        hereCount.bots > 0
            ? `${$LL.chat.peopleTab.countPeople({ count: hereCount.people })} · ${$LL.chat.peopleTab.countBots({
                  count: hereCount.bots,
              })}`
            : $LL.chat.peopleTab.countPeople({ count: hereCount.people });
    $: hereName = hereEntry?.roomName?.trim() || mapRoomName || $LL.chat.peopleTab.thisRoom();
    $: elsewhereCount = countPeopleElsewhere($usersByRoom, currentRoomUrl);

    // Rows are of people: all the sessions of one account make one row, shown with the room of its primary session
    // (this tab for you, one on this map when there is one).
    $: onlinePeople = groupSessions(
        Array.from($usersByRoom.entries())
            .filter(([playUri]) => playUri !== undefined)
            .flatMap(([, entry]) => entry.users),
        myIdentity(),
        currentRoomUrl,
        statusOf
    );

    $: friendUuids = new Set(
        Array.from($relationshipsStore.entries())
            .filter(([, relationship]) => relationship === "friends")
            .map(([uuid]) => uuid)
    );

    $: hereAll = sortPeople(
        onlinePeople.filter((person) => person.primary.playUri === currentRoomUrl),
        friendUuids
    );
    $: hereShown = shown(hereAll);

    $: elsewhereGroups = Array.from(
        onlinePeople
            .filter((person) => person.primary.playUri !== currentRoomUrl)
            .reduce((groups, person) => {
                const uri = person.primary.playUri ?? "";
                const group = groups.get(uri) ?? {
                    key: uri,
                    name: roomNameOf(uri, $usersByRoom.get(uri)?.roomName ?? person.primary.roomName),
                    people: [],
                };
                group.people.push(person);
                groups.set(uri, group);
                return groups;
            }, new Map<string, RoomGroup>())
            .values()
    )
        .map((group) => ({ ...group, people: sortPeople(group.people, friendUuids) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    $: elsewhereShown = elsewhereGroups
        .map((group) => ({ ...group, all: group.people, people: shown(group.people) }))
        .filter((group) => group.people.length > 0);

    $: offlineCount = $usersByRoom.get(undefined)?.users.length ?? 0;
    $: offlineAll = sortPeople(
        groupSessions($usersByRoom.get(undefined)?.users ?? [], myIdentity(), currentRoomUrl, statusOf),
        friendUuids
    );
    $: offlineShown = shown(offlineAll);

    // Searching unfolds the sections that match; clearing the search goes back to what you had unfolded.
    $: elsewhereOpen = isSearching ? elsewhereShown.length > 0 : $peopleSectionsOpenStore.elsewhere;
    $: offlineOpen = isSearching ? offlineShown.length > 0 : $peopleSectionsOpenStore.offline;
    $: nothingMatches =
        isSearching && hereShown.length === 0 && elsewhereShown.length === 0 && offlineShown.length === 0;

    // Friends. Guests only ever see Everyone.
    $: friendsList = $friendsStore.status === "signedOut" ? undefined : $friendsStore.list;
    $: showRequests = (friendsList?.incoming.length ?? 0) + (friendsList?.outgoing.length ?? 0) > 0;
    $: view = $friendsEnabledStore ? $peopleViewStore : "everyone";
    // The last request answered: Requests goes away, and so does its view.
    $: if ($friendsStore.status === "ready" && $peopleViewStore === "requests" && !showRequests) {
        peopleViewStore.set("everyone");
    }

    // Friends online in this world, as the world's own list sees them (by account, their primary session).
    $: worldSightings = new Map<string, WorldSighting & { person: Person }>(
        onlinePeople
            .filter((person) => !person.isMe && person.primary.uuid && person.primary.playUri)
            .map((person) => [
                person.primary.uuid ?? "",
                {
                    person,
                    playUri: person.primary.playUri ?? "",
                    // This room only by a real name: an unnamed map's own name is only its link.
                    roomName:
                        person.primary.playUri === currentRoomUrl
                            ? hereEntry?.roomName?.trim() || mapRoomName || ""
                            : roomNameOf(
                                  person.primary.playUri ?? "",
                                  $usersByRoom.get(person.primary.playUri)?.roomName ?? person.primary.roomName
                              ),
                    status: statusOf(person.primary) ?? 0,
                },
            ])
    );
    $: placedFriends = placeFriends(
        friendsList?.friends ?? [],
        currentRoomUrl,
        (uuid) => worldSightings.get(uuid),
        !$friendsPresenceUnavailableStore
    );
    $: faces = otherWorldFaces(placedFriends);

    // Friends and requests the world isn't showing right now (offline, or in another world) keep their woka: the one
    // the world's member list saved, else the one Orbit draws for them, the same picture their direct chat shows. Its
    // background is from their name, as the game picks it online.
    const wokaByChatId = createWokaByChatIdStore(Promise.resolve(userProviderMerger), currentChatPeople()?.store);
    const colourByChatId = createColourByChatIdStore(Promise.resolve(userProviderMerger));
    $: friendsByUuid = new Map(
        [...(friendsList?.friends ?? []), ...(friendsList?.incoming ?? []), ...(friendsList?.outgoing ?? [])].map(
            (person) => [person.uuid, person]
        )
    );
    type Look = { picture?: Readable<string | undefined>; color?: string };
    function looks(
        sightings: typeof worldSightings,
        listed: typeof friendsByUuid,
        wokas: Map<string, PictureStore>,
        colours: Map<string, string>
    ): (uuid: string) => Look {
        return (uuid) => {
            const person = sightings.get(uuid)?.person;
            if (person) return { picture: person.primary.pictureStore, color: person.primary.color ?? undefined };
            return savedLook(listed.get(uuid), wokas, (chatId, name) => personColour(colours, chatId, name));
        };
    }
    $: lookOf = looks(worldSightings, friendsByUuid, $wokaByChatId, $colourByChatId);
    // Asked once per person while People is open, only for those shown: the Friends or Requests view, or the faces.
    const askedChatIds = new Set<string>();
    $: for (const chatId of chatIdsToAsk(
        view === "friends"
            ? placedFriends.map((entry) => entry.friend)
            : view === "requests"
            ? [...(friendsList?.incoming ?? []), ...(friendsList?.outgoing ?? [])]
            : faces.map((entry) => entry.friend),
        (uuid) => worldSightings.has(uuid),
        askedChatIds
    ))
        requestChatPerson(chatId);

    let highlightUuid: string | undefined;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    async function openFriend(uuid: string | undefined) {
        peopleViewStore.set("friends");
        highlightUuid = uuid;
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => (highlightUuid = undefined), 2400);
        await tick();
        if (uuid)
            listElement?.querySelector(`[data-friend="${CSS.escape(uuid)}"]`)?.scrollIntoView({ block: "center" });
        else if (listElement) listElement.scrollTop = 0;
    }
    onDestroy(() => {
        if (highlightTimer) clearTimeout(highlightTimer);
    });

    function toggle(section: "elsewhere" | "offline") {
        peopleSectionsOpenStore.update((open) => ({ ...open, [section]: !open[section] }));
    }
</script>

<div class="relative flex flex-col h-full">
    {#if $friendsEnabledStore}
        <PeopleChips
            friendsCount={friendsList?.friends.length ?? 0}
            incomingCount={friendsList?.incoming.length ?? 0}
            {showRequests}
        />
    {/if}
    <div bind:this={listElement} class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2" data-testid="peopleList">
        {#if $friendNoticeStore}
            <p
                class="u-glass mx-4 mb-2 rounded-2xl px-3 py-2 text-sm text-white/85"
                role="status"
                data-testid="friendNotice"
            >
                {$friendNoticeStore}
            </p>
        {/if}
        {#if view === "friends"}
            <FriendsList
                placed={placedFriends}
                {lookOf}
                {query}
                presenceUnavailable={$friendsPresenceUnavailableStore}
                {highlightUuid}
                {isMatrixChatEnabled}
            />
        {:else if view === "requests"}
            <FriendRequests
                incoming={friendsList?.incoming ?? []}
                outgoing={friendsList?.outgoing ?? []}
                {query}
                {lookOf}
            />
        {:else}
            {#if !isSearching}
                <FriendFaces {faces} {lookOf} on:open={(event) => openFriend(event.detail)} />
            {/if}
            {#if hereAll.length > 0 && (!isSearching || hereShown.length > 0)}
                <section class="flex flex-col" data-testid="peopleHere">
                    <h3
                        class="m-0 flex h-12 items-center gap-2.5 px-4 pt-1 text-sm font-bold text-white"
                        data-testid="peopleHereTitle"
                    >
                        <span class="u-live-dot shrink-0" aria-hidden="true" />
                        <span class="truncate">{hereName}</span>
                        <span class="u-count shrink-0 font-normal">{hereCountText}</span>
                    </h3>
                    <PeopleAndBots
                        all={hereAll}
                        shown={hereShown}
                        {isMatrixChatEnabled}
                        {isSearching}
                        testId="peopleHere"
                    />
                </section>
            {/if}

            {#if elsewhereGroups.length > 0 && (!isSearching || elsewhereShown.length > 0)}
                <section class="flex flex-col" data-testid="peopleElsewhere">
                    <button
                        type="button"
                        class="people-section-toggle group m-0 flex h-11 w-full items-center gap-2.5 rounded-none px-4 text-start text-sm font-bold text-white/85 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:bg-white/5"
                        aria-expanded={elsewhereOpen}
                        aria-label={(elsewhereOpen ? $LL.chat.peopleTab.collapse : $LL.chat.peopleTab.expand)({
                            section: $LL.chat.peopleTab.elsewhere(),
                        })}
                        data-testid="peopleElsewhereToggle"
                        on:click={() => toggle("elsewhere")}
                    >
                        <span class="u-eyebrow truncate">{$LL.chat.peopleTab.elsewhere()}</span>
                        <span class="u-count shrink-0">{elsewhereCount}</span>
                        <span class="grow" />
                        <IconChevronDown
                            font-size="18"
                            class="shrink-0 text-white/60 transition-transform duration-200 ease-out {elsewhereOpen
                                ? ''
                                : '-rotate-90 rtl:rotate-90'}"
                        />
                    </button>
                    {#if elsewhereOpen}
                        <div class="flex flex-col" transition:fold>
                            {#each elsewhereShown as group (group.key)}
                                <div
                                    class="flex items-center gap-2 px-4 pt-1.5 pb-0.5 text-xs font-semibold text-white/60"
                                >
                                    <IconMapPin font-size="13" class="shrink-0 text-white/40" aria-hidden="true" />
                                    <span class="truncate">{group.name}</span>
                                </div>
                                <PeopleAndBots
                                    all={group.all}
                                    shown={group.people}
                                    {isMatrixChatEnabled}
                                    {isSearching}
                                    peopleHeader={false}
                                    testId="peopleElsewhere"
                                />
                            {/each}
                        </div>
                    {/if}
                </section>
            {/if}

            {#if offlineAll.length > 0 && (!isSearching || offlineShown.length > 0)}
                <section class="flex flex-col" data-testid="peopleOffline">
                    <button
                        type="button"
                        class="people-section-toggle group m-0 flex h-11 w-full items-center gap-2.5 rounded-none px-4 text-start text-sm font-bold text-white/85 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:bg-white/5"
                        aria-expanded={offlineOpen}
                        aria-label={(offlineOpen ? $LL.chat.peopleTab.collapse : $LL.chat.peopleTab.expand)({
                            section: $LL.chat.peopleTab.offline(),
                        })}
                        data-testid="peopleOfflineToggle"
                        on:click={() => toggle("offline")}
                    >
                        <span class="u-eyebrow truncate">{$LL.chat.peopleTab.offline()}</span>
                        <span class="u-count shrink-0">{offlineCount}</span>
                        <span class="grow" />
                        <IconChevronDown
                            font-size="18"
                            class="shrink-0 text-white/60 transition-transform duration-200 ease-out {offlineOpen
                                ? ''
                                : '-rotate-90 rtl:rotate-90'}"
                        />
                    </button>
                    {#if offlineOpen}
                        <div class="flex flex-col" transition:fold>
                            <p class="m-0 px-4 pb-2 text-xs text-white/50">{$LL.chat.peopleTab.offlineHint()}</p>
                            <UserList people={offlineShown} {isMatrixChatEnabled} />
                        </div>
                    {/if}
                </section>
            {/if}

            {#if isSearching && $friendsEnabledStore}
                <UniverseSearch query={$chatSearchBarValue.trim()} nothingHere={nothingMatches} />
            {:else if nothingMatches}
                <p class="m-0 px-4 py-6 text-center text-sm text-white/50" data-testid="peopleNoResults">
                    {$LL.chat.oneList.noResultsPeople()}
                </p>
            {/if}
        {/if}
    </div>
    <InviteFooter />
</div>
