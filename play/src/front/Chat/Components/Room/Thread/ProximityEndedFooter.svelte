<script lang="ts">
    import { onDestroy } from "svelte";
    import { get, readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../../Phaser/Game/GameManager";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import type { ProximitySession } from "../../../Connection/Proximity/ProximitySessions";
    import { chatSearchBarValue, navChat } from "../../../Stores/ChatStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { toPlainText } from "../../OneList/OneListOrder";
    import { goToPersonRoom, walkToPerson } from "../../UserList/PersonNavigation";
    import { analyticsClient } from "../../../../Administration/AnalyticsClient";
    import { gameSceneIsLoadedStore } from "../../../../Stores/GameSceneStore";
    import { friendsEnabledStore, relationshipsStore } from "../../../Stores/FriendsStore";
    import { runFriendAction } from "../../UserList/FriendActions";
    import RingButton from "../../UserList/RingButton.svelte";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import {
        IconCheck,
        IconCopy,
        IconDoorIn,
        IconMessage,
        IconSearch,
        IconUserCheck,
        IconUserPlus,
        IconWalk,
    } from "@wa-icons";

    /**
     * What replaces the composer once a proximity chat has ended: nothing can be sent to it any more, so the
     * footer says so and offers a way back to the people. "Walk to" only when that exact avatar is in this room;
     * "Go to {room}" names the room and never promises to land next to the person (one account can be in several
     * tabs, and the room link can only name the account); "Find people" for anyone who can't be placed.
     */
    export let session: ProximitySession<ChatMessage>;
    /** The chat you're in right now, if any: someone from this one who is in it gets "Continue with". */
    export let live: ProximitySession<ChatMessage> | undefined = undefined;
    export let onContinue: () => void = () => undefined;

    type WayBack =
        | { kind: "continue"; key: string; name: string; act: () => void }
        | { kind: "walk"; key: string; name: string; act: () => void }
        | { kind: "go"; key: string; room: string; act: () => void }
        | { kind: "find"; key: string; names: string[]; act: () => void };

    // No scene while a reconnect swaps it: the footer still shows, and picks the new scene up once it has loaded.
    let gameScene = gameManager.tryGetCurrentGameScene();
    onDestroy(
        gameSceneIsLoadedStore.subscribe(() => {
            const scene = gameManager.tryGetCurrentGameScene();
            if (scene !== gameScene) gameScene = scene;
        })
    );
    $: worldUsers = gameScene?.allUsersInWorldStore ?? readable(undefined);
    $: currentRoomUrl = gameScene?.roomUrl;
    $: hasPeopleTab = gameScene
        ? gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled
        : false;

    let roomNames = new Map<string, string>();
    $: loadRoomNames(gameScene);

    function loadRoomNames(scene: typeof gameScene) {
        roomNames = new Map();
        scene?.userProviderMerger
            .then((merger) => {
                if (scene !== gameScene) return;
                const byRoom = get(merger.usersByRoomStore);
                const names = new Map<string, string>();
                for (const [playUri, room] of byRoom) {
                    if (playUri && room.roomName) names.set(playUri, room.roomName);
                }
                roomNames = names;
            })
            .catch((e) => console.error(e));
    }

    let copied = false;
    let copyTimer: ReturnType<typeof setTimeout> | undefined;

    function copyDraft(text: string) {
        navigator.clipboard
            ?.writeText(toPlainText(text))
            .then(() => {
                copied = true;
                if (copyTimer) clearTimeout(copyTimer);
                copyTimer = setTimeout(() => (copied = false), 2000);
            })
            .catch((e) => console.error(e));
    }

    function findPeople(names: string[]) {
        selectedRoomStore.set(undefined);
        chatSearchBarValue.set(names[0] ?? "");
        navChat.switchToUserList();
    }

    $: waysBack = ((): WayBack[] => {
        const ways: WayBack[] = [];
        const missing: string[] = [];
        const seenRooms = new Set<string>();
        session.participantIds.forEach((spaceUserId, index) => {
            const name = session.participants[index] ?? "";
            // Already together again: no need to walk anywhere, just carry on in the live chat.
            if (
                live &&
                !live.isArea &&
                (live.participantIds.includes(spaceUserId) || live.participants.includes(name))
            ) {
                ways.push({ kind: "continue", key: `continue:${name}`, name, act: onContinue });
                return;
            }
            const user = $worldUsers?.get(spaceUserId);
            if (!user || !user.playUri) {
                if (name) missing.push(name);
                return;
            }
            if (user.playUri === currentRoomUrl) {
                ways.push({
                    kind: "walk",
                    key: `walk:${spaceUserId}`,
                    name: user.name || name,
                    act: () => {
                        analyticsClient.goToUser();
                        walkToPerson({ spaceUserId, uuid: user.uuid, playUri: user.playUri });
                    },
                });
                return;
            }
            if (seenRooms.has(user.playUri)) return;
            seenRooms.add(user.playUri);
            const playUri = user.playUri;
            ways.push({
                kind: "go",
                key: `go:${playUri}`,
                room: roomNames.get(playUri) ?? "",
                act: () => {
                    analyticsClient.goToUser();
                    goToPersonRoom({ uuid: user.uuid, playUri });
                },
            });
        });
        if (missing.length > 0 && hasPeopleTab) {
            ways.push({ kind: "find", key: "find", names: missing, act: () => findPeople(missing) });
        }
        return ways.slice(0, 4);
    })();

    // "You were with": the signed-in people of this chat (only they have a chat id), each with Add friend unless you
    // are friends already or asked. How most friendships start: you met, so you add. Friends can be rung back.
    $: metPeople = ((): { uuid: string; name: string }[] => {
        if (!$friendsEnabledStore) return [];
        const me = localUserStore.getLocalUser()?.uuid;
        const seen = new Set<string>();
        const people: { uuid: string; name: string }[] = [];
        session.participantIds.forEach((spaceUserId, index) => {
            const user = $worldUsers?.get(spaceUserId);
            if (!user?.uuid || !user.chatID || user.uuid === me || seen.has(user.uuid)) return;
            seen.add(user.uuid);
            people.push({ uuid: user.uuid, name: user.name || session.participants[index] || "" });
        });
        return people;
    })();
    let adding = new Set<string>();
    async function addFriend(person: { uuid: string; name: string }) {
        adding = new Set(adding).add(person.uuid);
        const action = $relationshipsStore.get(person.uuid) === "request_received" ? "accept" : "request";
        await runFriendAction(person.uuid, person.name, action);
        adding.delete(person.uuid);
        adding = new Set(adding);
    }
</script>

<div
    class="flex flex-col gap-2 border border-solid border-x-0 border-b-0 border-t border-white/10 px-3 py-3"
    data-testid="proximityEndedFooter"
>
    {#if session.unsentDraft}
        <div class="u-glass flex items-start gap-2 rounded-xl px-3 py-2" data-testid="proximityUnsentDraft">
            <div class="flex min-w-0 grow flex-col">
                <span class="text-xs font-bold text-white/60">{$LL.chat.session.unsentDraft()}</span>
                <span class="line-clamp-3 text-sm text-white/85">{toPlainText(session.unsentDraft)}</span>
            </div>
            <button
                type="button"
                class="m-0 flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2 text-xs font-bold text-white hover:bg-white/20"
                on:click={() => session.unsentDraft && copyDraft(session.unsentDraft)}
            >
                <IconCopy font-size="14" />
                {copied ? $LL.chat.session.copied() : $LL.chat.session.copy()}
            </button>
        </div>
    {/if}
    <p class="m-0 text-xs text-white/60">{$LL.chat.session.endedFooter()}</p>
    {#if metPeople.length > 0}
        <div class="u-glass flex flex-col gap-1 rounded-[14px] px-3 py-2" data-testid="proximityMetPeople">
            <span class="u-eyebrow">{$LL.chat.session.youWereWith()}</span>
            {#each metPeople as person (person.uuid)}
                {@const relationship = $relationshipsStore.get(person.uuid) ?? "none"}
                <div class="flex min-h-9 items-center gap-2">
                    <span class="flex min-w-0 flex-auto items-center gap-1 text-sm font-bold">
                        <span class="truncate">{person.name}</span>
                        {#if relationship === "friends"}
                            <span class="flex shrink-0 text-[#c4b5fd]" title={$LL.chat.friends.friendBadge()}>
                                <IconUserCheck font-size="14" aria-label={$LL.chat.friends.friendBadge()} />
                            </span>
                        {/if}
                    </span>
                    {#if relationship === "friends"}
                        <RingButton
                            uuid={person.uuid}
                            name={person.name}
                            status={undefined}
                            variant="pill"
                            testId="proximityRing"
                        />
                    {:else if relationship === "request_sent"}
                        <span class="flex shrink-0 items-center gap-1 text-xs font-bold text-white/60">
                            <IconCheck font-size="14" />
                            {$LL.chat.friends.requestSent()}
                        </span>
                    {:else if relationship === "none" || relationship === "request_received"}
                        <button
                            type="button"
                            class="u-cta-secondary m-0 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white disabled:opacity-60"
                            aria-label={relationship === "request_received"
                                ? $LL.chat.friends.acceptFrom({ userName: person.name })
                                : $LL.chat.friends.addUserAsFriend({ userName: person.name })}
                            disabled={adding.has(person.uuid)}
                            data-testid="proximityAddFriend"
                            on:click={() => addFriend(person)}
                        >
                            <IconUserPlus font-size="14" />
                            {relationship === "request_received"
                                ? $LL.chat.friends.accept()
                                : $LL.chat.friends.addFriend()}
                        </button>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
    {#if waysBack.length > 0}
        <div class="flex flex-wrap gap-2">
            {#each waysBack as way (way.key)}
                <button
                    type="button"
                    class="m-0 flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-bold {way.kind === 'find'
                        ? 'u-cta-secondary'
                        : 'u-cta'}"
                    data-testid="proximityWayBack"
                    data-kind={way.kind}
                    on:click={way.act}
                >
                    {#if way.kind === "continue"}
                        <IconMessage font-size="16" />
                        {$LL.chat.session.continueWith({ name: way.name })}
                    {:else if way.kind === "walk"}
                        <IconWalk font-size="16" />
                        {$LL.chat.userList.walkToUser({ userName: way.name })}
                    {:else if way.kind === "go"}
                        <IconDoorIn font-size="16" />
                        {way.room ? $LL.chat.session.goTo({ room: way.room }) : $LL.chat.session.goToRoom()}
                    {:else}
                        <IconSearch font-size="16" />
                        {$LL.chat.session.findPeople()}
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>
