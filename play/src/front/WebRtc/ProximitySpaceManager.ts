import type { Subscription } from "rxjs";
import Debug from "debug";
import * as Sentry from "@sentry/svelte";
import { get } from "svelte/store";
import { AbortError } from "@workadventure/shared-utils/src/Abort/AbortError";
import { FilterType } from "@workadventure/messages";
import type { RoomConnection } from "../Connection/RoomConnection";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";
import type { SpaceRegistryInterface } from "../Space/SpaceRegistry/SpaceRegistryInterface";
import { audienceCanTalkStore } from "../Stores/MediaStore";
import { leaveAreaSpaceIfJoined } from "../Phaser/Game/MapEditor/leaveAreaSpace";

const debug = Debug("ProximitySpaceManager");

export class ProximitySpaceManager {
    private joinSpaceRequestMessageSubscription: Subscription;
    private leaveSpaceRequestMessageSubscription: Subscription;
    /**
     * Bubbles joined beside the nearby chat (#1624): in an Audience that lets people talk and has its own chat
     * channel, that channel holds the nearby chat, so the bubble brings its sound and pictures only. By space name,
     * with what stops the join while it is not done yet.
     */
    private readonly bubblesBesideChat = new Map<string, AbortController>();

    public constructor(
        roomConnection: RoomConnection,
        private proximityChatRoom: ProximityChatRoom,
        private spaceRegistry: SpaceRegistryInterface
    ) {
        this.joinSpaceRequestMessageSubscription = roomConnection.joinSpaceRequestMessage.subscribe(
            ({ spaceName, propertiesToSync }) => {
                const join = this.chatHoldsAnotherSpace()
                    ? this.joinBesideChat(spaceName, propertiesToSync)
                    : this.proximityChatRoom.joinSpace(spaceName, propertiesToSync);
                join.catch((e) => {
                    if (e instanceof AbortError) {
                        debug("Join space aborted. The user left the space before finalizing the join", e);
                        return;
                    }
                    console.error(e);
                    Sentry.captureException(e);
                });
            }
        );

        this.leaveSpaceRequestMessageSubscription = roomConnection.leaveSpaceRequestMessage.subscribe(
            ({ spaceName }) => {
                const leave = this.bubblesBesideChat.has(spaceName)
                    ? this.leaveBesideChat(spaceName)
                    : this.proximityChatRoom.leaveSpace(spaceName);
                leave.catch((e) => {
                    console.error("Error while leaving space", e);
                    Sentry.captureException(e);
                });
            }
        );
    }

    /** The nearby chat is busy with an Audience's own channel while we stand where people may talk in bubbles. */
    private chatHoldsAnotherSpace(): boolean {
        return (
            get(audienceCanTalkStore) &&
            (this.proximityChatRoom.currentSpaceName !== undefined || this.proximityChatRoom.isJoiningSpace)
        );
    }

    private async joinBesideChat(spaceName: string, propertiesToSync: string[]): Promise<void> {
        const abortController = new AbortController();
        this.bubblesBesideChat.set(spaceName, abortController);
        await this.spaceRegistry.joinSpace(spaceName, FilterType.ALL_USERS, propertiesToSync, abortController.signal);
    }

    private async leaveBesideChat(spaceName: string): Promise<void> {
        const abortController = this.bubblesBesideChat.get(spaceName);
        this.bubblesBesideChat.delete(spaceName);
        abortController?.abort(new AbortError("Left the bubble before it was joined"));
        await leaveAreaSpaceIfJoined(this.spaceRegistry, spaceName);
    }

    public destroy() {
        this.joinSpaceRequestMessageSubscription.unsubscribe();
        this.leaveSpaceRequestMessageSubscription.unsubscribe();
        for (const abortController of this.bubblesBesideChat.values()) {
            abortController.abort(new AbortError("The scene is closing"));
        }
        this.bubblesBesideChat.clear();
    }
}
