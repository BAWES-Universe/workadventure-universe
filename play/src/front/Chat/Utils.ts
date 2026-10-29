import * as Sentry from "@sentry/svelte";
import { openModal } from "svelte-modals";
import { get } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { iframeListener } from "../Api/IframeListener";
import { connectionManager } from "../Connection/ConnectionManager";
import { localUserStore } from "../Connection/LocalUserStore";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { SimpleCoWebsite } from "../WebRtc/CoWebsite/SimpleCoWebsite";
import { coWebsites } from "../Stores/CoWebsiteStore";
import { scriptUtils } from "../Api/ScriptUtils";
import { gameManager } from "../Phaser/Game/GameManager";
import { userIsConnected } from "../Stores/MenuStore";
import { warningMessageStore } from "../Stores/ErrorStore";
import { LL } from "../../i18n/i18n-svelte";
import { openChat } from "./openChat";
import { ChatsStillLoadingError } from "./Connection/ChatsStillLoadingError";
import { navChat, selectedChatMessageToReply } from "./Stores/ChatStore";
import type { ChatRoom } from "./Connection/ChatConnection";
import { selectedRoomStore } from "./Stores/SelectRoomStore";
import RequiresLoginForChatModal from "./Components/RequiresLoginForChatModal.svelte";

export type OpenCoWebsiteObject = {
    url: string;
    allowApi?: boolean;
    allowPolicy?: string;
    widthPercent?: number;
    closable?: boolean;
    hideUrl?: boolean;
};

//enlever les events lié au chat dans iframelistener
export const openCoWebSite = (
    { url, allowApi, allowPolicy, widthPercent, closable }: OpenCoWebsiteObject,
    source: MessageEventSource | null
) => {
    if (!url || !source) {
        throw new Error("Unknown query source");
    }

    const coWebsite: SimpleCoWebsite = new SimpleCoWebsite(
        new URL(url, iframeListener.getBaseUrlFromSource(source)),
        allowApi,
        allowPolicy,
        widthPercent,
        closable
    );

    return openSimpleCowebsite(coWebsite);
};

export const getCoWebSite = () => {
    return get(coWebsites).map((coWebsite: CoWebsite) => {
        return {
            id: coWebsite.getId(),
        };
    });
};

export const sendRedirectPricing = () => {
    if (connectionManager.currentRoom && connectionManager.currentRoom.pricingUrl) {
        window.location.href = connectionManager.currentRoom.pricingUrl;
    }
};

export const sendLogin = () => {
    analyticsClient.login();
    connectionManager.goToSignIn();
};

export const openTab = (url: string) => {
    scriptUtils.openTab(url);
};

/**
 * The direct chat with this person: the one that exists (inviting the person back if they deleted it), or a new one when
 * there is none. Joined when it was only an invite, waiting for the join when asked to.
 */
const findDirectChatRoom = async (chatID: string, waitForJoin: boolean) => {
    const chatConnection = await gameManager.getChatConnection();
    const room = await chatConnection.createDirectRoom(chatID);
    if (!room) throw new Error("Failed to create room");
    analyticsClient.createMatrixRoom();

    if (get(room.myMembership) === "invite") {
        const joining = room.joinRoom();
        if (waitForJoin) await joining;
        else joining.catch((error: unknown) => console.error(error));
    }
    return room;
};

function showDirectChatFailure(error: unknown, chatID: string): void {
    if (error instanceof ChatsStillLoadingError) {
        // Not a failure: the player just tries again in a moment.
        warningMessageStore.addWarningMessage(get(LL).chat.chatsStillLoading());
        return;
    }
    warningMessageStore.addWarningMessage(get(LL).chat.failedToOpenRoom({ roomId: chatID }));
    console.error(error);
    Sentry.captureException(error);
}

function showRoom(room: ChatRoom): void {
    selectedRoomStore.set(room);
    navChat.switchToChat();
    openChat("person");
}

export const openDirectChatRoom = async (chatID: string) => {
    try {
        if (!get(userIsConnected)) {
            openModal(RequiresLoginForChatModal);
            return;
        }
        // There is no chat with yourself (another of your tabs or devices has your chat id).
        if (chatID === localUserStore.getChatId()) return;
        showRoom(await findDirectChatRoom(chatID, false));
    } catch (error) {
        showDirectChatFailure(error, chatID);
    }
};

/**
 * Sends something to this person's direct chat, then opens it there. Says whether it went; when it did not, a line
 * says so (`notSentLine` when the sending itself failed).
 */
export const sendToDirectChat = async (
    chatID: string,
    send: (room: ChatRoom) => Promise<void>,
    notSentLine?: string
): Promise<boolean> => {
    if (!get(userIsConnected) || chatID === localUserStore.getChatId()) return false;
    let room: ChatRoom;
    try {
        room = await findDirectChatRoom(chatID, true);
    } catch (error) {
        showDirectChatFailure(error, chatID);
        return false;
    }
    try {
        // A reply picked in another chat would point at a message this one does not have.
        selectedChatMessageToReply.set(null);
        await send(room);
    } catch (error) {
        if (!notSentLine) {
            showDirectChatFailure(error, chatID);
            return false;
        }
        warningMessageStore.addWarningMessage(notSentLine);
        console.error(error);
        Sentry.captureException(error);
        return false;
    }
    showRoom(room);
    return true;
};

export const openChatRoom = async (roomId: string) => {
    try {
        if (!get(userIsConnected)) {
            openModal(RequiresLoginForChatModal);
            return;
        }
        const chatConnection = await gameManager.getChatConnection();
        const room = chatConnection.getRoomByID(roomId);

        if (!room) throw new Error("Failed to retrieve room");

        selectedRoomStore.set(room);
        navChat.switchToChat();
        openChat("person");
    } catch (error) {
        warningMessageStore.addWarningMessage(get(LL).chat.failedToOpenRoom({ roomId }));
        console.error(error);
        Sentry.captureException(error);
    }
};

export const openCoWebSiteWithoutSource = ({
    url,
    allowApi,
    allowPolicy,
    widthPercent,
    closable,
    hideUrl,
}: OpenCoWebsiteObject) => {
    if (!url) {
        throw new Error("Unknown query source");
    }

    const coWebsite: SimpleCoWebsite = new SimpleCoWebsite(
        new URL(url),
        allowApi,
        allowPolicy,
        widthPercent,
        closable,
        hideUrl
    );

    return openSimpleCowebsite(coWebsite);
};

const openSimpleCowebsite = (coWebsite: SimpleCoWebsite) => {
    coWebsites.add(coWebsite);

    return {
        id: coWebsite.getId(),
    };
};

export const closeCoWebsite = (coWebsiteId: string) => {
    const coWebsite = coWebsites.findById(coWebsiteId);

    if (!coWebsite) {
        console.warn("Unknown co-website, probably already closed", coWebsiteId);
        return;
    }

    coWebsites.remove(coWebsite);
};
