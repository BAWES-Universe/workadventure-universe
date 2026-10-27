import { z } from "zod";
import * as Sentry from "@sentry/svelte";
import type { Subscriber, Unsubscriber, Writable } from "svelte/store";
import { statusChanger } from "../Components/ActionBar/AvailabilityStatus/statusChanger";
import { localUserStore } from "../Connection/LocalUserStore";
import type { ChatRoom } from "../Chat/Connection/ChatConnection";
import { gameManager } from "../Phaser/Game/GameManager";
import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
import { proximityMeetingStore } from "../Stores/MyMediaStore";
import { openChat } from "../Chat/openChat";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { waitForStoreValue } from "../Stores/Utils/waitForStoreValue";
import type { NotificationWA } from "./Notification";
import { findChatRoom } from "./findChatRoom";

type SelectedRoomStore = {
    subscribe: (this: void, run: Subscriber<ChatRoom | undefined>) => Unsubscriber;
    set: (value: ChatRoom | undefined) => void;
};

class NotificationManager {
    constructor(private proximityMeetingStore: Writable<boolean>, private selectedRoomStore: SelectedRoomStore) {
        this.listenToServiceWorker();
        this.openPendingChat();
    }

    public hasNotification(): boolean {
        if (typeof Notification === "undefined") {
            return false;
        }
        return (
            Notification.permission === "granted" &&
            statusChanger.allowNotificationSound() &&
            localUserStore.getNotification()
        );
    }

    public createNotification(notification: NotificationWA) {
        if (document.hasFocus()) {
            return;
        }

        if (this.hasNotification()) {
            notification.sendNotification().catch((error) => {
                Sentry.captureException(error);
                console.error("Error while sending notification", error);
            });
        }
    }

    // The service worker sends a tapped chat notification to the one window it brought forward or opened.
    private listenToServiceWorker() {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
            return;
        }
        // Lives as long as the page, like the manager itself.
        // eslint-disable-next-line listeners/no-missing-remove-event-listener
        navigator.serviceWorker.addEventListener("message", this.onServiceWorkerMessage);
        // Delivers what the worker sent while this page was still loading (a window the tap just opened).
        navigator.serviceWorker.startMessages();
    }

    private readonly onServiceWorkerMessage = (event: MessageEvent): void => {
        const result = NotificationSchema.safeParse(event.data);
        if (!result.success) {
            return;
        }
        const { chatRoomId } = result.data.data;
        // Kept for this tab until the chat is open: getting in may first go to sign-in and come back as a new page.
        storePendingChat(chatRoomId);
        this.openNotificationChat(chatRoomId);
    };

    /** A tapped chat this tab had not opened yet when it went to sign in. */
    private openPendingChat() {
        const chatRoomId = readPendingChat(Date.now());
        if (chatRoomId) {
            this.openNotificationChat(chatRoomId);
        }
    }

    private openNotificationChat(chatRoomId: string) {
        this.handleMessageNotification(chatRoomId)
            .catch((error) => {
                Sentry.captureException(error);
                console.error("Could not open the chat of a notification:", error);
            })
            .finally(() => clearPendingChat(chatRoomId));
    }

    private async handleMessageNotification(chatRoomId: string) {
        // A window the tap just opened is still getting in: its chat is ready once the room is.
        await waitForStoreValue(gameSceneIsLoadedStore);
        openChat("notification");
        let room: ChatRoom | undefined;
        if (chatRoomId === "proximity") {
            this.proximityMeetingStore.set(true);
            // The live scene only: the one kept on screen while getting back in has handed its chat over.
            const liveScene = gameManager.tryGetCurrentGameScene();
            room = liveScene?.hasProximityChatRoom ? liveScene.proximityChatRoom : undefined;
        } else {
            room = await findChatRoom(await gameManager.getChatConnection(), chatRoomId);
        }
        if (room) {
            this.selectedRoomStore.set(room);
        }
    }
}

const NotificationSchema = z.object({
    type: z.literal("openChat"),
    data: z.object({
        chatRoomId: z.string(),
    }),
});

const PENDING_CHAT_KEY = "notificationPendingChat";
// Longer than signing in takes; a tap older than this is no longer what they came back for.
export const PENDING_CHAT_MAX_AGE_MS = 10 * 60 * 1000;

function storePendingChat(chatRoomId: string): void {
    // A nearby chat ends with its page, so it is never kept.
    if (chatRoomId === "proximity") return;
    try {
        sessionStorage.setItem(PENDING_CHAT_KEY, JSON.stringify({ chatRoomId, at: Date.now() }));
    } catch {
        // No session storage (private mode, blocked): the chat still opens when no sign-in comes in between.
    }
}

export function readPendingChat(now: number): string | undefined {
    try {
        const stored = sessionStorage.getItem(PENDING_CHAT_KEY);
        if (!stored) return undefined;
        const pending = PendingChatSchema.safeParse(JSON.parse(stored));
        if (!pending.success || now - pending.data.at > PENDING_CHAT_MAX_AGE_MS) {
            sessionStorage.removeItem(PENDING_CHAT_KEY);
            return undefined;
        }
        return pending.data.chatRoomId;
    } catch {
        return undefined;
    }
}

/** Only the chat just opened: a later tap waiting behind it stays kept. */
function clearPendingChat(chatRoomId: string): void {
    try {
        if (readPendingChat(Date.now()) === chatRoomId) sessionStorage.removeItem(PENDING_CHAT_KEY);
    } catch {
        // Nothing was kept.
    }
}

const PendingChatSchema = z.object({ chatRoomId: z.string(), at: z.number() });

export const notificationManager = new NotificationManager(proximityMeetingStore, selectedRoomStore);
