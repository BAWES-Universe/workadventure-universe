import { derived, get, readable } from "svelte/store";
import type { Readable } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import { GUEST_TOKEN_ASIDE_MS, localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { LL } from "../../../i18n/i18n-svelte";
import { userIsConnected } from "../../Stores/MenuStore";
import { chatSearchBarValue } from "../Stores/ChatStore";
import type { ChatRoom } from "../Connection/ChatConnection";
import { showRoom } from "../Utils";
import { brickEntry, type OneListEntry } from "../Components/OneList/OneListStore";
import { guestBrickCard, parseGuestChat, serializeGuestChat } from "./GuestBrick";
import { GuestBrickChatRoom } from "./GuestBrickChatRoom";
import { bringGuestChat } from "./GuestBrickCarry";
import { myBricksStore } from "./MyBricksStore";

/**
 * The Brick for guests in this game (#1997): one chat for the page, kept on the device (see GuestBrickChatRoom). It is
 * made the first time it is needed, and only for someone who has not signed in.
 */
let room: GuestBrickChatRoom | undefined;

export function guestBrickRoom(): GuestBrickChatRoom {
    room ??= new GuestBrickChatRoom({
        ll: LL,
        guestId: () => localUserStore.guestId(),
        roomUrl: () => botApiService.getRoomId(),
        ask: (request) => botApiService.guestBrickReply(request),
        readSaved: () => localUserStore.getGuestBrickChat(),
        save: (raw) => localUserStore.setGuestBrickChat(raw),
        drop: () => localUserStore.dropGuestBrickChat(),
        now: () => Date.now(),
        newTurnId: () => uuidv4(),
        keepMs: GUEST_TOKEN_ASIDE_MS,
        // The same uploader as the nearby chat; the receipt it gives is what the bot server takes as proof the file is the guest's
        // Loaded when first used: the uploader's settings and the game come with the page, not with this store
        upload: async (file) => {
            const [{ uploadToUploader }, { UploadFailure }, { gameManager }] = await Promise.all([
                import("../Components/Room/UploadToUploader"),
                import("../Components/Room/UploadFailure"),
                import("../../Phaser/Game/GameManager"),
            ]);
            let userToken: string | undefined;
            try {
                userToken = gameManager.getCurrentGameScene().connection?.userRoomToken;
            } catch {
                userToken = undefined;
            }
            const uploaded = await uploadToUploader(file, userToken, "guest-brick");
            if (!uploaded.receipt) throw new UploadFailure("other", undefined, "no-receipt");
            return { ...uploaded, receipt: uploaded.receipt };
        },
        refreshReceipt: async (receipt) =>
            (await import("../Components/Room/UploadToUploader")).refreshUploadReceipt(receipt),
        delivered: (delivery) => botApiService.guestBrickDelivered(delivery),
        takes: () => botApiService.guestBrickTakes(),
    });
    return room;
}

/** Opens the chat with the Brick for guests, as it stands on this device. */
export function openGuestBrickChat(): ChatRoom {
    const chat = guestBrickRoom();
    chat.refresh();
    showRoom(chat);
    return chat;
}

/** When this page first drew the Brick's row: the time the row says while nothing has been said yet. */
const shownAt = Date.now();
/** When this page loaded: a card the guest closed is remembered for this visit to the page only. */
export const guestBrickShownAt = shownAt;

/**
 * The row of the Brick for guests in Chats: only for someone who has not signed in, and never for an account, whose
 * Brick is its own. It sits in the list like any chat, sorted in by the last thing said.
 */
export const guestBrickEntries: Readable<OneListEntry[]> = derived(
    [userIsConnected, chatSearchBarValue, LL],
    ([$signedIn, $search, $LL], set) => {
        if ($signedIn) {
            set([]);
            return;
        }
        const chat = guestBrickRoom();
        return derived(chat.last, ($last) => $last).subscribe(($last) => {
            const card = { ...guestBrickCard($LL, shownAt), createdAt: new Date($last?.at ?? shownAt).toISOString() };
            set([brickEntry(card, $search)]);
        });
    },
    [] as OneListEntry[]
);

/** Always "online": the Brick for guests is Universe's own and answers whenever it is asked. */
export const guestBrickOnline = readable("online" as const);

/**
 * Hand-overs Orbit made to this account, as this page knows them: for when even the small mark of it could not be saved.
 * A mark is for one account's one chat (guest id and chat address), so a chat left by an earlier account is never taken as handed over to another.
 */
const takenThisPage = new Set<string>();
const takenMark = (guestId: string, myChatId: string): string => `${guestId}|${myChatId}`;

/**
 * A guest signed in with a chat they had with the Brick for guests (#1997): the first time the chat with their own Brick
 * is open (from its row or from its chat, whichever the person opens), that chat is brought into it. Never for a guest, and only into the one Brick everyone gets.
 */
export function bringGuestChatInto(brickId: string): void {
    const myChatId = localUserStore.getChatId();
    const own = get(myBricksStore)?.find((brick) => brick.id === brickId);
    if (!get(userIsConnected) || !myChatId || !own?.isDefault) return;
    bringGuestChat({
        read: () => {
            const chat = parseGuestChat(localUserStore.getGuestBrickChat(), null, Date.now());
            if (!chat) return chat;
            // Taken only when Orbit handed it to this very account: a mark left by an earlier account on this device is not theirs
            const mark = takenMark(chat.guestId, myChatId);
            const rest = { ...chat };
            delete rest.carryTaken;
            return takenThisPage.has(mark) || localUserStore.getGuestBrickChatTaken() === mark
                ? { ...rest, carryTaken: true as const }
                : rest;
        },
        keep: (chat) => {
            const rest = { ...chat };
            delete rest.carryTaken;
            if (chat.carryTaken) {
                const mark = takenMark(chat.guestId, myChatId);
                takenThisPage.add(mark);
                localUserStore.setGuestBrickChatTaken(mark);
            }
            localUserStore.setGuestBrickChat(serializeGuestChat(rest));
        },
        drop: () => localUserStore.dropGuestBrickChat(),
        take: (guestId) => botApiService.takeGuestChat(guestId),
        parts: () => botApiService.botServerCarriesParts(),
        carry: async (carryId, lines, part) => {
            try {
                return await botApiService.carryGuestChat(brickId, myChatId, carryId, lines, part);
            } catch (error) {
                // Not this person's chat or Brick: it is not theirs to bring
                if ((error as { status?: number }).status === 403) return "refused";
                throw error;
            }
        },
        sleep: (ms) =>
            new Promise((resolve) => {
                setTimeout(resolve, ms);
            }),
        now: () => Date.now(),
    }).catch((error) => console.error(error));
}
