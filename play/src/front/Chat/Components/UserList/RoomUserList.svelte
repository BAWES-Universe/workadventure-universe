<script lang="ts">
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { chatSearchBarValue, peopleSectionsOpenStore } from "../../Stores/ChatStore";
    import type { UserProviderMerger } from "../../UserProviderMerger/UserProviderMerger";
    import ChatHeader from "../ChatHeader.svelte";
    import UserList from "./UserList.svelte";
    import { IconChevronDown, IconMapPin } from "@wa-icons";

    /**
     * The People tab, in three parts: the room you're in first ("Test · 3 here", you at the top), then everyone
     * else online in this world under the name of their room, then the world's members who aren't online,
     * folded shut with a line saying who they are. Searching unfolds whatever matches.
     */
    export let userProviderMerger: UserProviderMerger;

    const USERS_BY_ROOM_LIMITATION = 200;

    interface RoomGroup {
        key: string;
        name: string;
        users: ChatUser[];
    }

    const gameScene = gameManager.getCurrentGameScene();
    const isMatrixChatEnabled = gameScene.room.isMatrixChatEnabled;
    const currentRoomUrl = gameScene.roomUrl;
    const mapRoomName = gameScene.room.roomName?.trim();

    $: usersByRoom = userProviderMerger.usersByRoomStore;
    $: query = $chatSearchBarValue.trim().toLocaleLowerCase();
    $: isSearching = query !== "";

    function matches(user: ChatUser): boolean {
        if (!isSearching) return true;
        return user.username ? user.username.toLocaleLowerCase().includes(query) : false;
    }

    function sortPeople(users: ChatUser[]): ChatUser[] {
        const mySpaceUserId = gameScene.connection?.getSpaceUserId();
        return [...users].sort((a, b) => {
            if (a.spaceUserId === mySpaceUserId) return -1;
            if (b.spaceUserId === mySpaceUserId) return 1;
            return a.username?.localeCompare(b.username || "") || -1;
        });
    }

    // Search first, then cap what is rendered: someone past the first 200 can still be found, and counts stay true.
    function shown(users: ChatUser[]): ChatUser[] {
        return users.filter(matches).slice(0, USERS_BY_ROOM_LIMITATION);
    }

    function roomNameOf(playUri: string, roomName: string | undefined): string {
        if (roomName?.trim()) return roomName.trim();
        try {
            return new URL(playUri, window.location.href).pathname;
        } catch {
            return playUri;
        }
    }

    // Everyone, split by where they are. Counts are of everyone in the section, before the search filters it.
    $: hereEntry = $usersByRoom.get(currentRoomUrl);
    $: hereAll = hereEntry ? sortPeople(hereEntry.users) : [];
    $: hereShown = shown(hereAll);
    $: hereName = hereEntry?.roomName?.trim() || mapRoomName || $LL.chat.peopleTab.thisRoom();

    $: elsewhereGroups = Array.from($usersByRoom.entries())
        .filter(([playUri]) => playUri !== undefined && playUri !== currentRoomUrl)
        .map(([playUri, entry]): RoomGroup => {
            const uri = playUri ?? "";
            return { key: uri, name: roomNameOf(uri, entry.roomName), users: sortPeople(entry.users) };
        })
        .filter((group) => group.users.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    $: elsewhereCount = elsewhereGroups.reduce((total, group) => total + group.users.length, 0);
    $: elsewhereShown = elsewhereGroups
        .map((group) => ({ ...group, users: shown(group.users) }))
        .filter((group) => group.users.length > 0);

    $: offlineAll = sortPeople($usersByRoom.get(undefined)?.users ?? []);
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
    <div class="max-h-full overflow-x-hidden overflow-y-auto pb-2" data-testid="peopleList">
        {#if hereAll.length > 0 && (!isSearching || hereShown.length > 0)}
            <section class="flex flex-col" data-testid="peopleHere">
                <h3
                    class="m-0 flex h-12 items-center gap-2.5 px-4 pt-1 text-sm font-bold text-white"
                    data-testid="peopleHereTitle"
                >
                    <span class="u-live-dot shrink-0" aria-hidden="true" />
                    <span class="truncate">{hereName}</span>
                    <span class="u-count shrink-0 font-normal"
                        >{$LL.chat.peopleTab.countHere({ count: hereAll.length })}</span
                    >
                </h3>
                <UserList userList={hereShown} {isMatrixChatEnabled} />
            </section>
        {/if}

        {#if elsewhereCount > 0 && (!isSearching || elsewhereShown.length > 0)}
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
                        class="shrink-0 text-white/60 transition-transform {elsewhereOpen
                            ? ''
                            : '-rotate-90 rtl:rotate-90'}"
                    />
                </button>
                {#if elsewhereOpen}
                    {#each elsewhereShown as group (group.key)}
                        <div class="flex items-center gap-2 px-4 pt-1.5 pb-0.5 text-xs font-semibold text-white/60">
                            <IconMapPin font-size="13" class="shrink-0 text-white/40" aria-hidden="true" />
                            <span class="truncate">{group.name}</span>
                        </div>
                        <UserList userList={group.users} {isMatrixChatEnabled} />
                    {/each}
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
                    <span class="u-count shrink-0">{offlineAll.length}</span>
                    <span class="grow" />
                    <IconChevronDown
                        font-size="18"
                        class="shrink-0 text-white/60 transition-transform {offlineOpen
                            ? ''
                            : '-rotate-90 rtl:rotate-90'}"
                    />
                </button>
                {#if offlineOpen}
                    <p class="m-0 px-4 pb-2 text-xs text-white/50">{$LL.chat.peopleTab.offlineHint()}</p>
                    <UserList userList={offlineShown} {isMatrixChatEnabled} />
                {/if}
            </section>
        {/if}

        {#if nothingMatches}
            <p class="m-0 px-4 py-6 text-center text-sm text-white/50" data-testid="peopleNoResults">
                {$LL.chat.oneList.noResultsPeople()}
            </p>
        {/if}
    </div>
</div>
