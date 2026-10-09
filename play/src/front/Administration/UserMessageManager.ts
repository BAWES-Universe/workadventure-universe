import { AdminMessageEventTypes, adminMessagesService } from "../Connection/AdminMessagesService";
import { UPLOADER_URL } from "../Enum/EnvironmentVariable";
import { banMessageStore } from "../Stores/TypeMessageStore/BanMessageStore";
import { broadcastInboxStore, broadcastMetaReach } from "../Stores/BroadcastStore";
import { broadcastHtml } from "../Components/Broadcast/broadcastHtml";

class UserMessageManager {
    receiveBannedMessageListener!: () => void;

    constructor() {
        // Not unsubscribing is ok, this is a singleton.
        //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
        adminMessagesService.messageStream.subscribe((event) => {
            if (event.type === AdminMessageEventTypes.admin) {
                // A written broadcast: a card everyone sees and can read when they like.
                broadcastInboxStore.add({
                    ...broadcastMetaReach(event.broadcast, "room"),
                    html: broadcastHtml(event.text),
                    audioUrl: undefined,
                });
            } else if (event.type === AdminMessageEventTypes.audio) {
                // A voice note: the card plays it, with the sender's line of text under it.
                const caption = event.broadcast?.caption;
                broadcastInboxStore.add({
                    ...broadcastMetaReach(event.broadcast, "room"),
                    html: caption ? broadcastHtml(JSON.stringify({ ops: [{ insert: caption + "\n" }] })) : undefined,
                    audioUrl: UPLOADER_URL + event.text,
                });
            } else if (event.type === AdminMessageEventTypes.ban) {
                banMessageStore.addMessage(event.text);
            } else if (event.type === AdminMessageEventTypes.banned) {
                banMessageStore.addMessage(event.text);
                this.receiveBannedMessageListener();
            }
        });
    }

    setReceiveBanListener(callback: () => void) {
        this.receiveBannedMessageListener = callback;
    }
}
export const userMessageManager = new UserMessageManager();
