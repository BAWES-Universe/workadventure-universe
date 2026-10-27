import { get } from "svelte/store";
import * as Sentry from "@sentry/svelte";
import LL from "../../i18n/i18n-svelte";
import { SERVICE_WORKER_URL } from "../Network/ServiceWorker";
import type { NotificationWA } from "./Notification";
import { defaultOptions } from "./Notification";
export class MessageNotification implements NotificationWA {
    constructor(
        private userName: string,
        private message: string,
        private chatRoomId: string,
        private chatRoomName: string,
        private options = defaultOptions
    ) {}

    public async sendNotification() {
        try {
            const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);

            const numberOfChar = 60;
            const messageToDisplay =
                this.message.length > numberOfChar ? this.message.slice(0, numberOfChar) + "..." : this.message;
            const body = `${get(LL).notification.message({ name: this.userName })}: ${messageToDisplay}`;

            const data = {
                chatRoomId: this.chatRoomId,
                tabUrl: window.location.href,
            };

            // renotify is not in the DOM typings: a replacing notification still has to make its sound.
            const options: NotificationOptions & { renotify: boolean } = {
                ...this.options,
                body,
                data,
                // The tag the service worker gives a pushed notification of this chat, so one replaces the other.
                tag: `chat:${this.chatRoomId}`,
                renotify: true,
            };
            await registration.showNotification(this.chatRoomName, options);
        } catch (error) {
            console.error("Error while sending message notification", error);
            Sentry.captureException(error);
        }
    }
}
