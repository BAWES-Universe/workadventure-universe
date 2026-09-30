<script lang="ts" context="module">
    // Where the People list was scrolled to when it last closed (in memory, for this visit).
    let lastScrollTop = 0;
</script>

<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { get } from "svelte/store";
    import type { AvailabilityStatus } from "@workadventure/messages";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { chatSearchBarValue, peopleSectionsOpenStore } from "../../Stores/ChatStore";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import ChatHeader from "../ChatHeader.svelte";
    import InviteFooter from "../InviteFooter.svelte";
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import { fold } from "../../../Utils/foldTransition";
    import UserList from "./UserList.svelte";
    import PeopleAndBots from "./PeopleAndBots.svelte";
    import type { SelfIdentity } from "./PersonActions";
    import type { PersonGroup } from "./PersonSessions";
    import { groupSessions } from "./PersonSessions";
    import { IconChevronDown, IconMapPin } from "@wa-icons";

    /**
     * The People tab, in three parts: the room you're in first ("Test · 3 here", you at the top), then everyone
     * else online in this world under the name of their room, then the world's members who aren't online,
     * folded shut with a line saying who they are. Searching unfolds whatever matches.
     * Each person is one row however many sessions they have open; the counts still count sessions.
     * In each room, bots are listed after the people, in a group of their own.
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

    // You first, then everyone by name.
    function sortPeople(people: Person[]): Person[] {
        return [...people].sort((a, b) => {
            if (a.isMe) return -1;
            if (b.isMe) return 1;
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

    // Counts are of sessions (one per open tab or device), before the search filters them: "26 here" is unchanged.
    $: hereEntry = $usersByRoom.get(currentRoomUrl);
    $: hereCount = hereEntry?.users.length ?? 0;
    $: hereName = hereEntry?.roomName?.trim() || mapRoomName || $LL.chat.peopleTab.thisRoom();
    $: elsewhereCount = Array.from($usersByRoom.entries())
        .filter(([playUri]) => playUri !== undefined && playUri !== currentRoomUrl)
        .reduce((total, [, entry]) => total + entry.users.length, 0);

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

    $: hereAll = sortPeople(onlinePeople.filter((person) => person.primary.playUri === currentRoomUrl));
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
        .map((group) => ({ ...group, people: sortPeople(group.people) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    $: elsewhereShown = elsewhereGroups
        .map((group) => ({ ...group, all: group.people, people: shown(group.people) }))
        .filter((group) => group.people.length > 0);

    $: offlineCount = $usersByRoom.get(undefined)?.users.length ?? 0;
    $: offlineAll = sortPeople(
        groupSessions($usersByRoom.get(undefined)?.users ?? [], myIdentity(), currentRoomUrl, statusOf)
    );
    $: offlineShown = shown(offlineAll);

    // Searching unfolds the sections that match; clearing the search goes back to what you had unfolded.
    $: elsewhereOpen = isSearching ? elsewhereShown.length > 0 : $peopleSectionsOpenStore.elsewhere;
    $: offlineOpen = isSearching ? offlineShown.length > 0 : $peopleSectionsOpenStore.offline;
    $: nothingMatches =
        isSearching && hereShown.length === 0 && elsewhereShown.length === 0 && offlineShown.length === 0;

    function toggle(section: "elsewhere" | "offline") {
        peopleSectionsOpenStore.update((open) => ({ ...open, [section]: !open[section] }));
    }
</script>

<div class="flex flex-col h-full">
    <ChatHeader />
    <div bind:this={listElement} class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2" data-testid="peopleList">
        {#if hereAll.length > 0 && (!isSearching || hereShown.length > 0)}
            <section class="flex flex-col" data-testid="peopleHere">
                <h3
                    class="m-0 flex h-12 items-center gap-2.5 px-4 pt-1 text-sm font-bold text-white"
                    data-testid="peopleHereTitle"
                >
                    <span class="u-live-dot shrink-0" aria-hidden="true" />
                    <span class="truncate">{hereName}</span>
                    <span class="u-count shrink-0 font-normal"
                        >{$LL.chat.peopleTab.countHere({ count: hereCount })}</span
                    >
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
                            <div class="flex items-center gap-2 px-4 pt-1.5 pb-0.5 text-xs font-semibold text-white/60">
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

        {#if nothingMatches}
            <p class="m-0 px-4 py-6 text-center text-sm text-white/50" data-testid="peopleNoResults">
                {$LL.chat.oneList.noResultsPeople()}
            </p>
        {/if}
    </div>
    <InviteFooter />
</div>
