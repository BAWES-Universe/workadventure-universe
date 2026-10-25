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
        this.handleMessageNotification(result.data.data.chatRoomId).catch((error) => {
            Sentry.captureException(error);
            console.error("Could not open the chat of a notification:", error);
        });
    };

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

export const notificationManager = new NotificationManager(proximityMeetingStore, selectedRoomStore);
