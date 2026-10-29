<script lang="ts">
    import { onDestroy } from "svelte";
    import { derived, get, readable, type Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../../Phaser/Game/GameManager";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import type { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
    import { CONTINUE_WITHIN_MS, type ProximitySession } from "../../../Connection/Proximity/ProximitySessions";
    import { MatrixChatRoom } from "../../../Connection/Matrix/MatrixChatRoom";
    import { chatSearchBarValue, navChat } from "../../../Stores/ChatStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { toPlainText } from "../../OneList/OneListOrder";
    import { goToPersonRoom, walkToPerson } from "../../UserList/PersonNavigation";
    import { analyticsClient } from "../../../../Administration/AnalyticsClient";
    import { gameSceneIsLoadedStore } from "../../../../Stores/GameSceneStore";
    import { friendsEnabledStore, relationshipsStore } from "../../../Stores/FriendsStore";
    import { invitesEnabledStore } from "../../../Stores/RingStore";
    import { runFriendAction } from "../../UserList/FriendActions";
    import RingButton from "../../UserList/RingButton.svelte";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import { blackListManager } from "../../../../WebRtc/BlackListManager";
    import { isBotUser } from "../../../UserProvider/ChatUserMapper";
    import { botIdFromChatId } from "../../../Bots/BotChatStatus";
    import { botDmAccessCache } from "../../../Bots/BotStatusStore";
    import { openDirectChatRoom, sendToDirectChat } from "../../../Utils";
    import { userIsConnected } from "../../../../Stores/MenuStore";
    import { singlePlayback } from "../../../../Utils/SinglePlayback";
    import { formatDuration } from "../../../../Components/Broadcast/voiceRecorder";
    import { withoutBlankEdges } from "../BlankEdges";
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
    /** The proximity chat itself: what was left unsent here is taken out of it once it goes as a direct message. */
    export let room: ProximityChatRoom | undefined = undefined;

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
    // Bots are left out, as in People and on the map card: they can't be friends or come over (Walk to stays). A bot
    // you may message gets its own row with Message instead (below).
    $: metPeople = ((): { uuid: string; name: string }[] => {
        if (!$friendsEnabledStore) return [];
        const me = localUserStore.getLocalUser()?.uuid;
        const seen = new Set<string>();
        const people: { uuid: string; name: string }[] = [];
        session.participantIds.forEach((spaceUserId, index) => {
            const user = $worldUsers?.get(spaceUserId);
            if (!user?.uuid || !user.chatID || user.uuid === me || seen.has(user.uuid) || isBotUser(user)) return;
            seen.add(user.uuid);
            people.push({ uuid: user.uuid, name: user.name || session.participants[index] || "" });
        });
        return people;
    })();
    // The bots of this chat you may message: Message only once the owner's rule says yes, as on People and the map
    // card, so nobody refused sees a button that can't work.
    $: metBots = ((): { botId: string; chatID: string; name: string }[] => {
        const bots: { botId: string; chatID: string; name: string }[] = [];
        session.participantIds.forEach((spaceUserId, index) => {
            const user = $worldUsers?.get(spaceUserId);
            const botId = user && isBotUser(user) ? botIdFromChatId(user.chatID) : undefined;
            if (!user?.chatID || !botId || bots.some((bot) => bot.botId === botId)) return;
            bots.push({ botId, chatID: user.chatID, name: user.name || session.participants[index] || "" });
        });
        return bots;
    })();
    // Rebuilt only when the bots themselves change: the world's people change all the time, and a fresh store starts
    // at no while it asks again, which would make Message blink.
    let botsKey = "";
    let messageableBots: Readable<{ botId: string; chatID: string; name: string }[]> = readable([]);
    $: {
        const key = JSON.stringify(metBots);
        if (key !== botsKey) {
            botsKey = key;
            const bots = metBots;
            messageableBots = derived(
                bots.map((bot) => botDmAccessCache.store(bot.botId)),
                (allowed) => bots.filter((_, index) => allowed[index])
            );
        }
    }
    function messageBot(chatID: string) {
        analyticsClient.openedChat();
        openDirectChatRoom(chatID).catch((e) => console.error(e));
    }

    // Just the two of you, and you can both use direct messages (signed in, not a bot, nobody blocked): what was left
    // unsent can go to them as a direct message.
    $: directPartner = ((): { chatID: string; name: string } | undefined => {
        if (!$userIsConnected || session.isArea || session.participantIds.length !== 1) return undefined;
        const user = $worldUsers?.get(session.participantIds[0]);
        if (!user?.uuid || !user.chatID || isBotUser(user)) return undefined;
        if (user.uuid === localUserStore.getLocalUser()?.uuid || blackListManager.isBlackListed(user.uuid))
            return undefined;
        const relationship = $relationshipsStore.get(user.uuid);
        if (relationship === "blocked_by_me" || relationship === "blocked_by_them") return undefined;
        return { chatID: user.chatID, name: user.name || session.participants[0] || "" };
    })();

    let sendingDirect = false;
    async function sendDraftAsDirectMessage(chatID: string, text: string) {
        if (sendingDirect || !room) return;
        const proximityRoom = room;
        const leftIn = session;
        sendingDirect = true;
        try {
            const sent = await sendToDirectChat(chatID, (direct) => {
                // The box writes line breaks as <br>: they go out as line breaks, as Enter sends them.
                direct.sendMessage(withoutBlankEdges(text).replace(/<br\s*\/?>/gi, "\n"));
                return Promise.resolve();
            });
            if (sent) {
                analyticsClient.chatMessageSent("matrix");
                proximityRoom.takeUnsentDraft(leftIn);
            }
        } finally {
            // eslint-disable-next-line require-atomic-updates
            sendingDirect = false;
        }
    }

    async function sendVoiceNoteAsDirectMessage(chatID: string) {
        if (sendingDirect || !room) return;
        const proximityRoom = room;
        // Taken out before it goes: being back with them meanwhile can't put it in the recorder to send it twice.
        const stayId = proximityRoom.unsentVoiceNoteStayId(session);
        const note = stayId === undefined ? undefined : proximityRoom.takeUnsentVoiceNote(session);
        if (stayId === undefined || !note) return;
        sendingDirect = true;
        player?.pause();
        let sent = false;
        try {
            sent = await sendToDirectChat(
                chatID,
                async (direct) => {
                    if (!(direct instanceof MatrixChatRoom)) throw new Error("Not a Matrix room");
                    await direct.sendVoiceNote(note.file, note.details);
                },
                $LL.chat.voiceNote.notSent()
            );
            if (sent) analyticsClient.chatMessageSent("matrix");
        } finally {
            // Not sent: back in this chat, to try again.
            if (!sent) proximityRoom.keepUnsentVoiceNote(stayId, note);
            // eslint-disable-next-line require-atomic-updates
            sendingDirect = false;
        }
    }

    // The unsent voice note, to listen to here.
    let player: HTMLAudioElement | undefined;
    let playing = false;
    let voiceUrl: string | undefined;
    let voiceFile: File | undefined;
    $: setVoiceFile(session.unsentVoiceNote?.file);
    function setVoiceFile(file: File | undefined) {
        if (file === voiceFile) return;
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        voiceFile = file;
        voiceUrl = file ? URL.createObjectURL(file) : undefined;
        playing = false;
    }
    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((error) => console.warn(error));
    }

    // "Goes back in the box when you're with them again": only while coming back still carries on this chat.
    let canStillContinue = false;
    let continueTimer: ReturnType<typeof setTimeout> | undefined;
    $: watchContinuation(session.endedAt, session.isArea);
    function watchContinuation(endedAt: number | undefined, isArea: boolean) {
        if (continueTimer) clearTimeout(continueTimer);
        const left = endedAt === undefined || isArea ? 0 : endedAt + CONTINUE_WITHIN_MS - Date.now();
        canStillContinue = left > 0;
        if (canStillContinue) continueTimer = setTimeout(() => (canStillContinue = false), left);
    }

    $: voiceNoteLine = session.unsentVoiceNote
        ? [
              formatDuration(session.unsentVoiceNote.details.duration),
              ...(canStillContinue ? [$LL.chat.session.backInTheBox({ names: session.label })] : []),
          ].join(" · ")
        : "";

    onDestroy(() => {
        if (continueTimer) clearTimeout(continueTimer);
        if (copyTimer) clearTimeout(copyTimer);
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    });

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
        <div class="u-glass flex flex-col gap-2 rounded-xl px-3 py-2" data-testid="proximityUnsentDraft">
            <div class="flex items-start gap-2">
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
            {#if directPartner && room}
                {@const chatID = directPartner.chatID}
                <div class="flex">
                    <button
                        type="button"
                        class="u-cta m-0 flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold disabled:opacity-60"
                        data-testid="proximityDraftToDirect"
                        disabled={sendingDirect}
                        on:click={() => session.unsentDraft && sendDraftAsDirectMessage(chatID, session.unsentDraft)}
                    >
                        {$LL.chat.session.sendAsDirectMessage()}
                    </button>
                </div>
            {/if}
        </div>
    {/if}
    {#if session.unsentVoiceNote}
        <div class="u-glass flex flex-col gap-2 rounded-xl px-3 py-2" data-testid="proximityUnsentVoiceNote">
            <div class="flex min-w-0 flex-col">
                <span class="text-xs font-bold text-white/60">{$LL.chat.session.unsentVoiceNote()}</span>
                <span class="text-sm text-white/85">
                    {voiceNoteLine}
                </span>
            </div>
            <div class="flex flex-wrap gap-2">
                <button
                    type="button"
                    class="m-0 flex h-8 items-center gap-1 rounded-lg bg-white/10 px-2 text-xs font-bold text-white hover:bg-white/20"
                    data-testid="proximityUnsentVoicePlay"
                    on:click={togglePlay}
                >
                    {playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.play()}
                </button>
                {#if directPartner && room}
                    {@const chatID = directPartner.chatID}
                    <button
                        type="button"
                        class="u-cta m-0 flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold disabled:opacity-60"
                        data-testid="proximityVoiceToDirect"
                        disabled={sendingDirect}
                        on:click={() => sendVoiceNoteAsDirectMessage(chatID)}
                    >
                        {$LL.chat.session.sendAsDirectMessage()}
                    </button>
                {/if}
            </div>
            {#if voiceUrl}
                <audio
                    src={voiceUrl}
                    bind:this={player}
                    use:singlePlayback
                    on:play={() => (playing = true)}
                    on:pause={() => (playing = false)}
                    on:ended={() => (playing = false)}
                />
            {/if}
        </div>
    {/if}
    <p class="m-0 text-xs text-white/60">{$LL.chat.session.endedFooter()}</p>
    {#if metPeople.length > 0 || $messageableBots.length > 0}
        <div class="u-glass flex flex-col gap-1 rounded-[14px] px-3 py-2" data-testid="proximityMetPeople">
            <span class="u-eyebrow">{$LL.chat.session.youWereWith()}</span>
            {#each $messageableBots as bot (bot.botId)}
                <div class="flex min-h-9 items-center gap-2">
                    <span class="flex min-w-0 flex-auto items-center text-sm font-bold">
                        <span class="truncate">{bot.name}</span>
                    </span>
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-white"
                        aria-label={$LL.chat.userList.messageUser({ userName: bot.name })}
                        data-testid="proximityMessageBot"
                        on:click={() => messageBot(bot.chatID)}
                    >
                        <IconMessage font-size="14" />
                        {$LL.chat.userList.message()}
                    </button>
                </div>
            {/each}
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
                    {#if relationship !== "friends" && relationship !== "blocked_by_me" && relationship !== "blocked_by_them" && !blackListManager.isBlackListed(person.uuid) && $invitesEnabledStore}
                        <RingButton
                            uuid={person.uuid}
                            name={person.name}
                            status={undefined}
                            variant="pill"
                            testId="proximityInvite"
                        />
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
