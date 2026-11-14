import type { Observable } from "rxjs";
import type { Readable } from "svelte/store";
import type { CallEvent } from "./CallSession";

/** What the call needs to know of the bot's sound in the call's space: whether it is speaking. */
export interface CallPeerLike {
    readonly showVoiceIndicator: Readable<boolean>;
}

export interface CallPeersLike {
    readonly videoPeerAdded: Observable<CallPeerLike>;
    readonly videoPeerRemoved: Observable<CallPeerLike>;
    getVideoForUser(spaceUserId: string): CallPeerLike | undefined;
}

/**
 * Tells the call when the bot is speaking (game #2004), from the sound that comes in from the bot in the call's space.
 * The call's space holds only the person and the bot, so any other member's sound is the bot's. Speaking counts as
 * something happening, so the call is not quiet while the bot talks. Returns what stops the watching.
 */
export function watchBotSpeaking(
    peers: CallPeersLike,
    memberIds: readonly string[],
    send: (event: CallEvent) => void,
    now: () => number
): () => void {
    const watching = new Map<CallPeerLike, () => void>();
    const watch = (peer: CallPeerLike): void => {
        if (watching.has(peer)) return;
        watching.set(
            peer,
            peer.showVoiceIndicator.subscribe((speaking) => send({ type: "bot-speaking", speaking, now: now() }))
        );
    };
    const added = peers.videoPeerAdded.subscribe(watch);
    const removed = peers.videoPeerRemoved.subscribe((peer) => {
        watching.get(peer)?.();
        watching.delete(peer);
        send({ type: "bot-speaking", speaking: false, now: now() });
    });
    // A peer that was already there before the watching began
    for (const id of memberIds) {
        const peer = peers.getVideoForUser(id);
        if (peer) watch(peer);
    }
    return () => {
        added.unsubscribe();
        removed.unsubscribe();
        for (const stop of watching.values()) stop();
        watching.clear();
    };
}
