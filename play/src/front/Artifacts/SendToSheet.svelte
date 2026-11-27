<script lang="ts">
    import { onDestroy } from "svelte";
    import { derived, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../i18n/i18n-svelte";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { localUserStore } from "../Connection/LocalUserStore";
    import type { PictureStore } from "../Stores/PictureStore";
    import { areaChatRooms } from "../Chat/Stores/AreaPresenceStore";
    import { currentChatPeople, requestChatPerson } from "../Chat/Stores/ChatPeopleLookup";
    import {
        createColourByChatIdStore,
        createNameByChatIdStore,
        createWokaByChatIdStore,
        personColour,
        personName,
        personPicture,
    } from "../Chat/Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../Chat/Stores/ChatUserWokaStore";
    import { showChatDoneToast } from "../Stores/ChatDoneToastStore";
    import { directRoomsWithStore } from "../Chat/Components/OneList/OneListStore";
    import { brickPicture, myBricksByChatId, myDeletedBrickChatIds, withMyBricks } from "../Chat/Bricks/MyBricksStore";
    import { ownBrickInChat, type BrickCard } from "../Chat/Bricks/Brick";
    import TopRowAvatar from "../Chat/Components/TopRow/TopRowAvatar.svelte";
    import Avatar from "../Chat/Components/Avatar.svelte";
    import AppSheet from "../Chat/Bricks/Apps/AppSheet.svelte";
    import {
        groupSendTargets,
        receiverOf,
        sendLinkChoice,
        sendLinkWords,
        sendParts,
        type ForwardingRoom,
        type SendPart,
        type SendTarget,
    } from "./sendTo";
    import { isBrickChat, sendEntriesStore, type SendEntry } from "./sendToTargets";
    import type { SendToRequest } from "./sendToStore";
    import { IconCheck, IconLoader } from "@wa-icons";

    /**
     * "Send to…" (what the person chooses in order): who gets it from the list of their chats, then what goes (the file, a link
     * to the document, or both), then Send. Nothing goes on a tap on a name alone. The file always opens for the receiver; what a
     * link can do depends on the document's own link setting, and each setting has its one plain line.
     */
    export let request: SendToRequest;
    export let onClose: () => void;

    const chat = gameManager.chatConnection;
    const myChatId = localUserStore.getChatId();

    // The chat of an area and the chat of a Brick that waits deleted stay out of the list, as in the list of chats
    const deletedBrickRoomIds = directRoomsWithStore(chat.directRooms, myDeletedBrickChatIds, chat.folders);
    const hiddenRoomIds: Readable<ReadonlySet<string>> = derived(
        [areaChatRooms.hiddenRoomIds, deletedBrickRoomIds],
        ([$area, $deleted]) => ($deleted.length === 0 ? $area : new Set([...$area, ...$deleted]))
    );
    const entries = sendEntriesStore(
        { directRooms: chat.directRooms, rooms: chat.rooms, folders: chat.folders },
        hiddenRoomIds
    );

    // The same names, pictures and colours as the list of chats: a person is called what they go by in Universe
    function sceneOrUndefined() {
        try {
            return gameManager.getCurrentGameScene();
        } catch {
            // No map yet: the chat's own names and pictures are all there is
            return undefined;
        }
    }
    const scene = sceneOrUndefined();
    const chatPeople = withMyBricks(currentChatPeople()?.store);
    const wokaByChatId: Readable<Map<string, PictureStore>> = scene
        ? createWokaByChatIdStore(scene.userProviderMerger, chatPeople)
        : readable(new Map<string, PictureStore>());
    const nameByChatId: Readable<Map<string, string>> = scene
        ? createNameByChatIdStore(scene.userProviderMerger, chatPeople)
        : readable(new Map<string, string>());
    const colourByChatId = scene
        ? createColourByChatIdStore(scene.userProviderMerger)
        : readable(new Map<string, string>());
    const colourOf: Readable<PersonColourOf> = derived(
        colourByChatId,
        ($colours) => (chatId: string | undefined, name: string | undefined) => personColour($colours, chatId, name)
    );
    interface Row {
        entry: SendEntry;
        id: string;
        title: string;
        partnerId: string | undefined;
        picture: PictureStore | undefined;
        group: SendTarget["group"];
        /** "12 people", for a group. */
        sub: string;
    }

    function rowOf(
        entry: SendEntry,
        bricksByChatId: ReadonlyMap<string, BrickCard>,
        names: Map<string, string>,
        wokas: Map<string, PictureStore>
    ): Row {
        const brick = ownBrickInChat(entry.memberIds, myChatId, bricksByChatId);
        const direct = entry.room.type === "direct" || brick !== undefined;
        const partnerId = direct ? entry.memberIds.find((id) => id !== myChatId) : undefined;
        const title = brick
            ? brick.name
            : entry.room.type === "direct"
            ? personName(names, partnerId, entry.roomName)
            : entry.roomName;
        const picture = brick
            ? brickPicture(brick.characterTextureId)
            : partnerId
            ? personPicture(wokas, partnerId, entry.room.pictureStore)
            : undefined;
        return {
            entry,
            id: entry.room.id,
            title,
            partnerId,
            picture,
            group: brick || isBrickChat(entry, myChatId) ? "brick" : "chat",
            sub:
                !direct && entry.memberIds.length > 0
                    ? $LL.chat.peopleTab.countPeople({ count: entry.memberIds.length })
                    : "",
        };
    }

    let search = "";
    let chosenId: string | undefined;
    // `choose`: what goes. `failed`: the last try did not go all the way.
    let step: "pick" | "choose" | "failed" = "pick";
    let sending = false;
    let destroyed = false;
    let fileOn = true;
    let linkOn = false;
    /** What is left to send after a try that did not go all the way: only these are tried again. */
    let failedParts: SendPart[] = [];
    let failedLine = "";

    $: rows = $entries.map((entry) => rowOf(entry, $myBricksByChatId, $nameByChatId, $wokaByChatId));
    // Someone outside the world is asked of Orbit (once), for their picture and the name they go by
    $: rows.forEach((row) => requestChatPerson(row.partnerId));
    $: byId = new Map(rows.map((row) => [row.id, row]));
    $: grouped = groupSendTargets(
        rows.map((row) => ({ id: row.id, name: row.title, group: row.group, timestamp: row.entry.timestamp })),
        search
    );
    $: bricks = grouped.bricks.map((target) => byId.get(target.id)).filter((row): row is Row => !!row);
    $: chats = grouped.chats.map((target) => byId.get(target.id)).filter((row): row is Row => !!row);
    $: chosen = chosenId ? byId.get(chosenId) : undefined;
    // A chat that left the list while its sheet was open (the person left it) takes the sheet back to the list, unless a try
    // just failed: the failure stays on show, with nothing to try again to
    $: chosenGone = chosenId !== undefined && !chosen;
    $: if (chosenGone && !sending && step !== "failed") backToList();

    $: receiver = chosen
        ? receiverOf(chosen.entry.room.type, chosen.entry.memberIds, myChatId, $myBricksByChatId)
        : "person";
    $: linkChoice = request.link
        ? sendLinkChoice({
              openScope: request.link.openScope,
              owner: request.link.owner,
              receiver,
              published: request.link.published,
              latest: request.link.latest,
          })
        : undefined;
    // A link that would open for nobody cannot stay ticked
    $: if (linkChoice && !linkChoice.usable) linkOn = false;
    $: parts = (
        [fileOn ? "file" : undefined, linkOn && linkChoice?.usable ? "link" : undefined] as (SendPart | undefined)[]
    ).filter((part): part is SendPart => part !== undefined);

    // The last name shown stays when the chat is gone, so the failure still says who it was for
    let lastWho = "";
    $: if (chosen) lastWho = chosen.title;
    $: who = chosen?.title ?? lastWho;
    $: fileLine =
        receiver === "myBrick"
            ? $LL.chat.sendTo.fileBrick({ name: request.fileName })
            : receiver === "group"
            ? $LL.chat.sendTo.fileOpensForGroup({ name: request.fileName })
            : $LL.chat.sendTo.fileOpensFor({ name: request.fileName, who });
    $: linkLine = linkChoice ? sendLinkWords(linkChoice.line, who, $LL.chat.sendTo) : "";

    function partName(part: SendPart): string {
        return part === "file" ? $LL.chat.sendTo.partFile() : $LL.chat.sendTo.partLink();
    }

    function backToList() {
        chosenId = undefined;
        step = "pick";
    }

    function pick(row: Row) {
        chosenId = row.id;
        fileOn = true;
        linkOn = false;
        failedParts = [];
        step = "choose";
    }

    async function send(what: readonly SendPart[]) {
        if (!chosen || sending || what.length === 0) return;
        const row = chosen;
        sending = true;
        try {
            const result = await sendParts(
                row.entry.room as unknown as ForwardingRoom,
                { makeFile: request.makeFile, link: request.link?.url },
                what
            );
            if (result.failed.length === 0) {
                showChatDoneToast($LL.chat.sendTo.sent({ who: row.title }));
                if (!destroyed) onClose();
                return;
            }
            if (destroyed) return;
            failedParts = result.failed;
            failedLine =
                result.sent.length === 0
                    ? $LL.chat.sendTo.failed()
                    : $LL.chat.sendTo.failedPartly({
                          sent: result.sent.map(partName).join(", "),
                          failed: result.failed.map(partName).join(", "),
                      });
            step = "failed";
        } finally {
            // eslint-disable-next-line require-atomic-updates -- only this function sets it, and a second send waits for it
            sending = false;
        }
    }

    onDestroy(() => {
        destroyed = true;
    });

    $: title = step === "pick" ? $LL.chat.sendTo.title() : $LL.chat.sendTo.titleTo({ who });
</script>

<AppSheet {title} {onClose} testId="sendToSheet" closeLabel={step === "pick" ? $LL.chat.sendTo.close() : undefined}>
    {#if step === "pick"}
        <input
            class="st-search"
            type="search"
            inputmode="search"
            autocomplete="off"
            placeholder={$LL.chat.sendTo.search()}
            aria-label={$LL.chat.sendTo.search()}
            data-testid="sendToSearch"
            bind:value={search}
        />
        <div class="st-list" data-testid="sendToList">
            {#each [{ label: $LL.chat.sendTo.bricks(), list: bricks, key: "bricks" }, { label: $LL.chat.sendTo.chats(), list: chats, key: "chats" }] as section (section.key)}
                {#if section.list.length > 0}
                    <p class="st-head">{section.label}</p>
                    {#each section.list as row (row.id)}
                        <button type="button" class="st-row" data-testid="sendToRow" on:click={() => pick(row)}>
                            {#if row.group === "chat" && row.entry.room.type !== "direct" && !row.picture}
                                <Avatar pictureStore={row.entry.room.pictureStore} fallbackName={row.title} size="lg" />
                            {:else}
                                <TopRowAvatar
                                    pictureStore={row.picture ?? row.entry.room.pictureStore}
                                    name={row.title}
                                    color={$colourOf(row.partnerId, row.title)}
                                    size="lg"
                                    ring={false}
                                />
                            {/if}
                            <span class="st-name">
                                <b>{row.title}</b>
                                {#if row.sub}<small>{row.sub}</small>{/if}
                            </span>
                        </button>
                    {/each}
                {/if}
            {/each}
            {#if bricks.length === 0 && chats.length === 0}
                <p class="st-note" data-testid="sendToEmpty">
                    {search.trim() === "" ? $LL.chat.sendTo.none() : $LL.chat.sendTo.noMatch()}
                </p>
            {/if}
        </div>
    {:else if step === "choose"}
        <div class="st-choices" role="group" aria-label={$LL.chat.sendTo.choose()}>
            <button
                type="button"
                role="checkbox"
                class="st-choice"
                class:picked={fileOn}
                aria-checked={fileOn}
                disabled={sending}
                data-testid="sendToFile"
                on:click={() => (fileOn = !fileOn)}
            >
                <span class="st-text"><b>{$LL.chat.sendTo.file()}</b><small>{fileLine}</small></span>
                <span class="st-box" aria-hidden="true"
                    >{#if fileOn}<IconCheck font-size="16" />{/if}</span
                >
            </button>
            {#if linkChoice}
                <button
                    type="button"
                    role="checkbox"
                    class="st-choice"
                    class:picked={linkOn && linkChoice.usable}
                    class:off={!linkChoice.usable}
                    aria-checked={linkOn && linkChoice.usable}
                    aria-disabled={!linkChoice.usable}
                    disabled={sending}
                    data-testid="sendToLink"
                    on:click={() => linkChoice?.usable && (linkOn = !linkOn)}
                >
                    <span class="st-text"
                        ><b>{$LL.chat.sendTo.link()}</b><small data-testid="sendToLinkLine">{linkLine}</small></span
                    >
                    <span class="st-box" aria-hidden="true"
                        >{#if linkOn && linkChoice.usable}<IconCheck font-size="16" />{/if}</span
                    >
                </button>
            {/if}
        </div>
    {:else}
        <p class="st-bad" role="alert" data-testid="sendToFailed">{failedLine}</p>
    {/if}
    <svelte:fragment slot="buttons">
        {#if step === "choose"}
            <button type="button" class="st-btn u-cta-secondary" data-testid="sendToCancel" on:click={onClose}
                >{$LL.chat.sendTo.cancel()}</button
            >
            <button
                type="button"
                class="st-btn u-cta"
                disabled={sending || parts.length === 0}
                data-testid="sendToSend"
                on:click={() => send(parts)}
                >{#if sending}<IconLoader font-size="18" class="animate-spin" />
                    {$LL.chat.sendTo.sending()}{:else}{$LL.chat.sendTo.send()}{/if}</button
            >
        {:else if step === "failed"}
            <button type="button" class="st-btn u-cta-secondary" data-testid="sendToClose" on:click={onClose}
                >{$LL.chat.sendTo.close()}</button
            >
            <button
                type="button"
                class="st-btn u-cta"
                disabled={sending || chosenGone}
                data-testid="sendToRetry"
                on:click={() => send(failedParts)}
                >{#if sending}<IconLoader font-size="18" class="animate-spin" />
                    {$LL.chat.sendTo.sending()}{:else}{$LL.chat.sendTo.tryAgain()}{/if}</button
            >
        {/if}
    </svelte:fragment>
</AppSheet>

<style>
    .st-search {
        width: 100%;
        min-height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-sizing: border-box;
        /* 16px keeps a phone from zooming into the field */
        font: inherit;
        font-size: 16px;
        color: #fff;
    }
    .st-search:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 1px;
    }
    .st-list {
        display: flex;
        flex-direction: column;
        max-height: min(52vh, 360px);
        overflow-y: auto;
        margin: 0 -8px;
    }
    .st-head {
        margin: 10px 8px 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
    .st-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        padding: 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .st-row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    @media (hover: hover) {
        .st-row:hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .st-name {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .st-name b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
    }
    .st-name small {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.6);
    }
    .st-note {
        margin: 8px;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .st-choices {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .st-choice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .st-choice.picked {
        border-color: rgba(167, 139, 250, 0.7);
        background: rgba(134, 41, 252, 0.22);
    }
    .st-choice.off {
        cursor: default;
        color: rgba(244, 242, 250, 0.6);
    }
    .st-choice:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .st-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .st-text b {
        font-size: 15px;
    }
    .st-text small {
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .st-box {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 7px;
        color: #fff;
    }
    .st-choice.picked .st-box {
        border-color: transparent;
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .st-choice.off .st-box {
        opacity: 0.4;
    }
    .st-bad {
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
        color: #ff8a7a;
    }
    /* Cancel and Send: the 44px size every sheet's buttons have, Send the gradient main button */
    .st-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 44px;
        padding: 0 20px;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
    }
    .st-btn:disabled {
        opacity: 0.5;
        cursor: default;
    }
</style>
