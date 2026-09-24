import { SayMessageType } from "@workadventure/messages";
import type { RoomConnection } from "../../../Connection/RoomConnection";
import type { Player } from "../../Player/Player";
import { hasMovedEventName } from "../../Player/Player";
import type { HasPlayerMovedInterface } from "../../../Api/Events/HasPlayerMovedInterface";

let lastSayPopupCloseDate: number | undefined = undefined;

export function popupJustClosed(): void {
    lastSayPopupCloseDate = Date.now();
}

export function isPopupJustClosed(): boolean {
    if (lastSayPopupCloseDate) {
        const timeSinceLastClose = Date.now() - lastSayPopupCloseDate;
        return timeSinceLastClose < 500;
    }
    return false;
}

/**
 * Sends what the local player says or thinks, and the empty "clear" that follows, so late arrivals
 * don't get a stale line (the server keeps only the newest message). Stacking and per-line timing
 * happen in the renderer (`Character.say`), for local and remote players alike.
 */
export class SayManager {
    private bubbleDestroyTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
    private cancelThinkListener: ((event: HasPlayerMovedInterface) => void) | undefined = undefined;

    public constructor(private roomConnection: RoomConnection, private currentPlayer: Player) {}

    public say(text: string, type: SayMessageType, duration: number | undefined): void {
        this.clearBubbleDestroyTimeout();
        // Any new send replaces the previous Think's "clear on move" listener, so an old listener
        // can never clear newer speech.
        this.removeCancelThinkListener();

        const player = this.currentPlayer;
        player.say(text, type);
        this.roomConnection.emitPlayerSayMessage({ message: text, type });

        if (type === SayMessageType.ThinkingCloud && text) {
            const cancelThink = (event: HasPlayerMovedInterface) => {
                if (!event.moving) {
                    return;
                }
                this.clearBubbleDestroyTimeout();
                this.removeCancelThinkListener();
                player.say("", type);
                this.roomConnection.emitPlayerSayMessage({ message: "", type });
            };

            this.cancelThinkListener = cancelThink;
            this.currentPlayer.on(hasMovedEventName, cancelThink);
        }

        if (duration) {
            this.bubbleDestroyTimeout = setTimeout(() => {
                this.bubbleDestroyTimeout = undefined;
                player.say("", type);
                this.roomConnection.emitPlayerSayMessage({ message: "", type });
            }, duration);
        }
    }

    public close(): void {
        this.clearBubbleDestroyTimeout();
        this.removeCancelThinkListener();
    }

    private clearBubbleDestroyTimeout(): void {
        if (this.bubbleDestroyTimeout) {
            clearTimeout(this.bubbleDestroyTimeout);
            this.bubbleDestroyTimeout = undefined;
        }
    }

    private removeCancelThinkListener(): void {
        if (this.cancelThinkListener) {
            this.currentPlayer.off(hasMovedEventName, this.cancelThinkListener);
            this.cancelThinkListener = undefined;
        }
    }
}
