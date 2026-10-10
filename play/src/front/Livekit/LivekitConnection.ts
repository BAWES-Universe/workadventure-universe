import Debug from "debug";
import { ConnectionError } from "livekit-client";
import type { Subscription } from "rxjs";
import * as Sentry from "@sentry/svelte";
import type { Readable } from "svelte/store";
import type { SpaceInterface } from "../Space/SpaceInterface";
import type { StreamableSubjects } from "../Space/SpacePeerManager/SpacePeerManager";
import { CommunicationMessageType } from "../Space/SpacePeerManager/CommunicationMessageType";
import { streamingMegaphoneStore } from "../Stores/MediaStore";
import { LiveKitRoom } from "./LiveKitRoom";

const debug = Debug("LivekitConnection");

// When the media server connection is lost for good, a new room is built after these delays (livekit-client already
// tried to resume the old one for about 50 seconds). After the last one, we give up until the back invites us again.
const REBUILD_DELAYS_MS = [1_000, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000];

export enum CommunicationType {
    NONE = "NONE",
    WEBRTC = "WEBRTC",
    LIVEKIT = "LIVEKIT",
}

export class LivekitConnection {
    private readonly unsubscribers: Subscription[] = [];
    private livekitRoom: LiveKitRoom | undefined;
    private shutdownAbortController: AbortController | undefined;
    private streamToDispatch: MediaStream | undefined;
    // The last invitation of the back, used again to build a new room when the connection is lost
    private lastInvitation: { serverUrl: string; token: string } | undefined;
    private rebuildTimeout: ReturnType<typeof setTimeout> | undefined;
    private rebuildAttempts = 0;
    private destroyed = false;
    constructor(
        private space: SpaceInterface,
        private _streamableSubjects: StreamableSubjects,
        private _blockedUsersStore: Readable<Set<string>>,
        private _streamingMegaphoneStore = streamingMegaphoneStore
    ) {
        this.initialize();
    }

    private createLivekitRoom(serverUrl: string, token: string, shutdownAbortSignal: AbortSignal): LiveKitRoom {
        this.livekitRoom = new LiveKitRoom(
            serverUrl,
            token,
            this.space,
            this._streamableSubjects,
            this._blockedUsersStore,
            shutdownAbortSignal
        );
        this._streamingMegaphoneStore.set(true);
        return this.livekitRoom;
    }

    /**
     * Connects to the media server with an invitation of the back. A room already there is torn down first, so that
     * two rooms never share the same identity.
     */
    private connect(serverUrl: string, token: string): void {
        if (this.livekitRoom) {
            debug("Replacing the existing Livekit room");
            this.shutdownAbortController?.abort();
            this.livekitRoom.destroy();
            this.livekitRoom = undefined;
        }
        this.shutdownAbortController = new AbortController();
        const room = this.createLivekitRoom(serverUrl, token, this.shutdownAbortController.signal);
        room.onConnectionLost = () => this.handleConnectionLost(room);

        (async () => {
            await room.prepareConnection();
            await room.joinRoom();
            if (this.livekitRoom === room) {
                // Connected: a later loss starts its attempts from the shortest delay again
                this.rebuildAttempts = 0;
            }
            if (this.streamToDispatch) {
                await this.dispatchStream(this.streamToDispatch);
            }
            this.streamToDispatch = undefined;
        })().catch((err) => {
            if (err instanceof ConnectionError && err.message === "Client initiated disconnect") {
                // This error is triggered when the "destroy" method is called before Livekit connection completes.
                // It can happen when the user leaves the space just after joining it.
                // In this case, we don't want to log an error.
                debug("Livekit connection aborted because the user left the space");
                return;
            }
            if (this.livekitRoom !== room) {
                // Replaced meanwhile (a new invitation, or a rebuild already scheduled by the room itself)
                debug("A Livekit room that was already replaced could not connect", err);
                return;
            }
            if (this.rebuildAttempts > 0) {
                // Rebuilding after a lost connection, and the network is still down: try again later.
                debug("Could not rebuild the Livekit room", err);
                this.handleConnectionLost(room);
                return;
            }
            console.error("An error occurred in LivekitConnection initialize", err);
            Sentry.captureException(err);
        });
    }

    /**
     * The room lost the media server for good (see LiveKitRoom.handleDisconnected) and already tore itself down.
     * Without a new room, nobody in the space hears or sees us again, and we hear nobody, until we leave the space.
     */
    private handleConnectionLost(room: LiveKitRoom): void {
        if (this.livekitRoom !== room || this.destroyed || !this.lastInvitation) {
            return;
        }
        // The participants of the dead room stop reacting
        this.shutdownAbortController?.abort();
        this.shutdownAbortController = undefined;
        room.destroy();
        this.livekitRoom = undefined;

        const delay = REBUILD_DELAYS_MS[this.rebuildAttempts];
        if (delay === undefined) {
            console.error("Could not reconnect to the Livekit room, giving up");
            Sentry.captureMessage("Could not reconnect to the Livekit room after several attempts, giving up", {
                level: "warning",
            });
            return;
        }
        this.rebuildAttempts++;
        const invitation = this.lastInvitation;
        this.cancelRebuild();
        this.rebuildTimeout = setTimeout(() => {
            this.rebuildTimeout = undefined;
            debug("Rebuilding the Livekit room, attempt " + this.rebuildAttempts);
            this.connect(invitation.serverUrl, invitation.token);
        }, delay);
    }

    private cancelRebuild(): void {
        if (this.rebuildTimeout) {
            clearTimeout(this.rebuildTimeout);
            this.rebuildTimeout = undefined;
        }
    }

    private initialize() {
        this.unsubscribers.push(
            this.space.observePrivateEvent(CommunicationMessageType.LIVEKIT_INVITATION_MESSAGE).subscribe((message) => {
                const serverUrl = message.livekitInvitationMessage.serverUrl;
                const token = message.livekitInvitationMessage.token;
                // A fresh invitation of the back wins over any rebuild in progress
                this.cancelRebuild();
                this.rebuildAttempts = 0;
                this.lastInvitation = { serverUrl, token };
                this.connect(serverUrl, token);
            })
        );
        this.unsubscribers.push(
            this.space.observePrivateEvent(CommunicationMessageType.LIVEKIT_DISCONNECT_MESSAGE).subscribe((message) => {
                // We are told to leave: no new room either
                const wasRebuilding = this.rebuildTimeout !== undefined;
                this.cancelRebuild();
                this.lastInvitation = undefined;
                if (!this.livekitRoom) {
                    if (wasRebuilding) {
                        return;
                    }
                    console.error("LivekitRoom not found");
                    Sentry.captureException(new Error("LivekitRoom not found"));
                    return;
                }
                this.shutdownAbortController?.abort();
                this.shutdownAbortController = undefined;
                this.livekitRoom?.destroy();
                this.livekitRoom = undefined;
            })
        );
    }

    async dispatchStream(mediaStream: MediaStream): Promise<void> {
        if (!this.livekitRoom) {
            this.streamToDispatch = mediaStream;
            return;
        }

        try {
            await this.livekitRoom.dispatchStream(mediaStream);
        } catch (err) {
            console.error("Error dispatching stream to Livekit room:", err);
            Sentry.captureException(err);
            throw err;
        }
    }

    destroy() {
        this.destroyed = true;
        const wasRebuilding = this.rebuildTimeout !== undefined;
        this.cancelRebuild();
        if (!this.livekitRoom && !wasRebuilding) {
            return;
        }

        try {
            this.shutdownAbortController?.abort();
            this.shutdownAbortController = undefined;
            this.livekitRoom?.destroy();
            this.livekitRoom = undefined;
        } catch (err) {
            console.error("Error destroying Livekit room:", err);
            Sentry.captureException(err);
        }
        this._streamingMegaphoneStore.set(false);
        for (const subscription of this.unsubscribers) {
            subscription.unsubscribe();
        }
    }

    /**
     * Starts the shutdown process of the communication state. It does not remove all video peers immediately,
     * but any asynchronous operation receiving a new stream should be ignored after this call.
     */
    shutdown() {
        this.cancelRebuild();
        this.lastInvitation = undefined;
        this.shutdownAbortController?.abort();
        this.shutdownAbortController = undefined;
    }
}
