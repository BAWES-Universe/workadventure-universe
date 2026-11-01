/**
 * Relays a voice bot's audio connections between the game and the voice worker.
 *
 * The game opens them: its transport rules (back/src/Model/Strategies) decide who may connect, and tell the bot with
 * a start, signals and a disconnect, the same as for a person. The bot server only passes them on, with an epoch that
 * numbers each connection with a person so late messages from an older one can be told apart and dropped.
 *
 * Every refusal here ends the same way: the person's browser is told to disconnect, and the bot stays text-only.
 */
import type { PrivateEventPusherToFront, SpaceUser } from '@workadventure/messages';
import type { FromWorker, ToWorker, VoiceMode, VoiceSignal } from './protocol';
import type { VoiceLink } from './VoiceLink';

/** What the relay needs from the bot's connection to the game. */
export interface GameSide {
    /** The bot's own id in a space ("<room>_<id>"), or undefined when it is not in that space. */
    botSpaceUserId(spaceName: string): string | undefined;
    sendSignal(spaceName: string, receiverUserId: string, signal: string): void;
    sendDisconnect(spaceName: string, receiverUserId: string): void;
}

interface Call {
    spaceName: string;
    sessionId: string;
    participantId: string;
    epoch: number;
}

interface Bubble {
    sessionId: string;
    spaceName: string;
}

/** Setup data bigger than this is not a real offer or candidate. */
const MAX_SIGNAL_CHARS = 60000;
const MAX_ID_CHARS = 128;

export interface LinkHandlers {
    onMessage(message: FromWorker): void;
    onDown(): void;
}

export interface VoiceCallStats {
    started: number;
    refusedStart: number;
    rejectedFromGame: number;
    staleFromWorker: number;
    connected: number;
}

export class VoiceCalls {
    readonly stats: VoiceCallStats = { started: 0, refusedStart: 0, rejectedFromGame: 0, staleFromWorker: 0, connected: 0 };
    private readonly bubbles = new Map<string, Bubble>();
    private readonly calls = new Map<string, Call>();
    private epoch = 0;
    private bubbleSeq = 0;

    private readonly link: VoiceLink;

    constructor(
        private readonly botId: string,
        private readonly game: GameSide,
        /** Opens the socket to the worker, wired to this relay. */
        openLink: (handlers: LinkHandlers) => VoiceLink,
        private readonly log: (message: string) => void = () => undefined
    ) {
        this.link = openLink({
            onMessage: (message) => this.handleWorkerMessage(message),
            onDown: () => this.linkDown(),
        });
    }

    // ---- from the game ----

    /** A private event the bot received in a space. Anything that is not about an audio connection is ignored. */
    handlePrivateEvent(event: PrivateEventPusherToFront): void {
        const inner = event.spaceEvent?.event;
        if (!inner) return;
        const sender = event.sender;
        switch (inner.$case) {
            case 'webRtcStartMessage':
                if (this.fromAPerson(event, sender) && inner.webRtcStartMessage.userId === sender!.spaceUserId) {
                    this.start(event.spaceName, sender!);
                }
                break;
            case 'webRtcSignal':
                if (this.fromAPerson(event, sender)) this.signalFromPerson(event.spaceName, sender!, inner.webRtcSignal.signal);
                break;
            case 'webRtcDisconnectMessage':
                if (this.fromAPerson(event, sender)) this.end(event.spaceName, sender!.spaceUserId, 'left');
                break;
            // Screen-sharing connections are not audio connections with the bot: never answered
        }
    }

    /**
     * Only a person, talking to this bot in a space it is in, may open or feed a connection. This is the one check
     * every game event passes: the sender comes from the game server, not from the message.
     */
    private fromAPerson(event: PrivateEventPusherToFront, sender: SpaceUser | undefined): boolean {
        const ok =
            sender !== undefined &&
            sender.spaceUserId.length > 0 &&
            sender.spaceUserId.length <= MAX_ID_CHARS &&
            !isBotUser(sender) &&
            this.game.botSpaceUserId(event.spaceName) !== undefined &&
            event.receiverUserId === this.game.botSpaceUserId(event.spaceName) &&
            sender.spaceUserId !== event.receiverUserId;
        if (!ok) this.stats.rejectedFromGame++;
        return ok;
    }

    private start(spaceName: string, person: SpaceUser): void {
        const bubble = this.bubbleFor(spaceName);
        if (!bubble) {
            this.refuse(spaceName, person.spaceUserId);
            return;
        }
        const epoch = ++this.epoch;
        const key = callKey(spaceName, person.spaceUserId);
        // A newer connection replaces the one before it: the worker closes the old path when it opens the new one
        const call: Call = { spaceName, sessionId: bubble.sessionId, participantId: person.spaceUserId, epoch };
        this.calls.set(key, call);
        if (!this.link.send({ type: 'lane.open', sessionId: bubble.sessionId, participantId: person.spaceUserId, epoch, mode: 'talk' })) {
            this.calls.delete(key);
            this.refuse(spaceName, person.spaceUserId);
            return;
        }
        this.stats.started++;
    }

    private signalFromPerson(spaceName: string, person: SpaceUser, raw: string): void {
        const call = this.calls.get(callKey(spaceName, person.spaceUserId));
        const signal = call && parseSignal(raw);
        if (!call || !signal) {
            // No start came first (or it was ended), or this is not setup data
            this.stats.rejectedFromGame++;
            return;
        }
        const sent = this.link.send({ type: 'lane.signal', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, signal });
        if (!sent) this.drop(call, true);
    }

    private end(spaceName: string, personId: string, reason: 'left' | 'closed'): void {
        const call = this.calls.get(callKey(spaceName, personId));
        if (!call) return;
        this.calls.delete(callKey(spaceName, personId));
        this.link.send({ type: 'lane.close', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, reason });
    }

    /** The bot left a space: its connections there end with it. */
    spaceLeft(spaceName: string): void {
        for (const call of [...this.calls.values()]) if (call.spaceName === spaceName) this.end(spaceName, call.participantId, 'closed');
        const bubble = this.bubbles.get(spaceName);
        if (bubble) {
            this.bubbles.delete(spaceName);
            this.link.send({ type: 'session.end', sessionId: bubble.sessionId });
        }
    }

    private bubbleFor(spaceName: string): Bubble | undefined {
        const known = this.bubbles.get(spaceName);
        if (known) return known;
        const bubble: Bubble = { sessionId: `${this.botId}.${++this.bubbleSeq}`.slice(0, MAX_ID_CHARS), spaceName };
        if (!this.link.send({ type: 'session.open', sessionId: bubble.sessionId, bubbleId: spaceName.slice(0, MAX_ID_CHARS), botId: this.botId.slice(0, MAX_ID_CHARS) })) {
            return undefined;
        }
        this.bubbles.set(spaceName, bubble);
        return bubble;
    }

    private refuse(spaceName: string, personId: string): void {
        this.stats.refusedStart++;
        this.log(`voice: no audio connection for ${personId} (worker not available)`);
        this.game.sendDisconnect(spaceName, personId);
    }

    /** Ends a call the worker can no longer carry, and tells the person's browser so it does not wait for it. */
    private drop(call: Call, closeOnWorker: boolean): void {
        this.calls.delete(callKey(call.spaceName, call.participantId));
        if (closeOnWorker) {
            this.link.send({ type: 'lane.close', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, reason: 'failed' });
        }
        this.game.sendDisconnect(call.spaceName, call.participantId);
    }

    // ---- from the worker ----

    handleWorkerMessage(message: FromWorker): void {
        if (message.type === 'lane.signal' || message.type === 'participant.join' || message.type === 'participant.leave') {
            const call = this.currentCall(message.sessionId, message.participantId, message.epoch);
            if (!call) {
                this.stats.staleFromWorker++;
                return;
            }
            if (message.type === 'lane.signal') {
                this.game.sendSignal(call.spaceName, call.participantId, JSON.stringify(message.signal));
            } else if (message.type === 'participant.join') {
                this.stats.connected++;
            } else if (message.type === 'participant.leave') {
                this.drop(call, false);
            }
        } else if (message.type === 'error' && message.participantId !== undefined && message.epoch !== undefined) {
            // The worker refused this connection (for example, no room for it): the bot stays text-only
            const call = this.currentCall(message.sessionId, message.participantId, message.epoch);
            if (call && message.code === 'at_capacity') this.drop(call, false);
            else if (!call) this.stats.staleFromWorker++;
        }
    }

    private currentCall(sessionId: string, participantId: string, epoch: number): Call | undefined {
        for (const call of this.calls.values()) {
            if (call.sessionId === sessionId && call.participantId === participantId) return call.epoch === epoch ? call : undefined;
        }
        return undefined;
    }

    /** The worker went away: it holds none of this any more. People are told, so nobody waits on a silent call. */
    linkDown(): void {
        for (const call of [...this.calls.values()]) this.game.sendDisconnect(call.spaceName, call.participantId);
        this.calls.clear();
        this.bubbles.clear();
    }

    // ---- for what comes next (recognition, speaking): the controls of a bubble's audio ----

    say(spaceName: string, segmentId: string, text: string): boolean {
        const bubble = this.bubbles.get(spaceName);
        return !!bubble && this.link.send({ type: 'bot.say', sessionId: bubble.sessionId, segmentId, text, committed: true });
    }

    setMode(spaceName: string, mode: VoiceMode, personId?: string): boolean {
        const bubble = this.bubbles.get(spaceName);
        return !!bubble && this.link.send({ type: 'mode.set', sessionId: bubble.sessionId, mode, participantId: personId });
    }

    /** The bot leaves or is switched off: every connection ends. */
    shutdown(): void {
        for (const call of [...this.calls.values()]) this.game.sendDisconnect(call.spaceName, call.participantId);
        for (const bubble of this.bubbles.values()) this.link.send({ type: 'session.end', sessionId: bubble.sessionId });
        this.calls.clear();
        this.bubbles.clear();
        this.link.close();
    }

    hasCall(spaceName: string, personId: string): boolean {
        return this.calls.has(callKey(spaceName, personId));
    }
}

const callKey = (spaceName: string, personId: string): string => `${spaceName}\n${personId}`;

/** Bots are known by the tag or by the uuid prefix their token gives them (the same test the game server uses). */
function isBotUser(user: SpaceUser): boolean {
    return user.tags?.includes('bot') || user.uuid?.startsWith('bot-') || false;
}

/** The setup data of a call as a browser's simple-peer sends it: an offer or an ICE candidate. Nothing else is passed on. */
export function parseSignal(raw: string): VoiceSignal | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SIGNAL_CHARS) return null;
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    if (data.type === 'offer' && typeof data.sdp === 'string' && data.sdp.length > 0) return { type: 'offer', sdp: data.sdp };
    if (data.type === 'candidate' && data.candidate && typeof data.candidate.candidate === 'string' && data.candidate.candidate.length <= 2048) {
        const { candidate, sdpMLineIndex, sdpMid } = data.candidate;
        return {
            type: 'candidate',
            candidate: {
                candidate,
                sdpMLineIndex: Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 ? sdpMLineIndex : null,
                sdpMid: typeof sdpMid === 'string' && sdpMid.length <= 64 ? sdpMid : null,
            },
        };
    }
    return null;
}
