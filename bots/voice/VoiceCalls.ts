/**
 * Relays a voice bot's audio connections between the game and the voice worker.
 *
 * The game opens them: its transport rules (back/src/Model/Strategies) decide who may connect, and tell the bot with
 * a start, signals and a disconnect, the same as for a person. When the game moves the bubble to LiveKit it tells the
 * bot with an invitation (a token for the bot's own identity) and later a disconnect. The bot server only passes this
 * on, with one epoch counter that numbers every path (a connection with a person, or the room) so late messages from
 * an older path can be told apart and dropped: the newest path is the only one that carries audio.
 *
 * Every refusal here ends the same way: the person's browser is told to disconnect, and the bot stays text-only.
 */
import type { PrivateEventPusherToFront, SpaceUser } from '@workadventure/messages';
import type { FromWorker, ToWorker, VoiceDraft, VoiceMode, VoiceSignal } from './protocol';
import type { VoiceLink } from './VoiceLink';

/** What the relay needs from the bot's connection to the game. */
export interface GameSide {
    /** The bot's own id in a space ("<room>_<id>"), or undefined when it is not in that space. */
    botSpaceUserId(spaceName: string): string | undefined;
    sendSignal(spaceName: string, receiverUserId: string, signal: string): void;
    sendDisconnect(spaceName: string, receiverUserId: string): void;
    /** Asks a person to make a new offer to the bot, as the game does when it starts a connection. */
    sendStart(spaceName: string, receiverUserId: string): void;
    /** Shows one person, and only them, what the bot hears them say (see handleSpeech). */
    sendDraft(spaceName: string, receiverUserId: string, draft: VoiceDraft): void;
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

/** The bot's LiveKit participant in a bubble, as the worker holds it. */
interface Room {
    spaceName: string;
    sessionId: string;
    epoch: number;
}

/** What the game gave the bot to join a bubble's LiveKit room. Kept while the game says the bubble is there. */
interface Invitation {
    serverUrl: string;
    token: string;
}

/** Setup data bigger than this is not a real offer or candidate. */
const MAX_SIGNAL_CHARS = 60000;
const MAX_ID_CHARS = 128;
const MAX_TOKEN_CHARS = 8192;
const MAX_URL_CHARS = 2048;
/** The most people the worker is told about in one room. */
const MAX_PEOPLE = 500;
/** Spoken lines remembered, so each is taken once and only if the bot heard it. Oldest first out. */
const MAX_SPOKEN = 200;

export interface LinkHandlers {
    onMessage(message: FromWorker): void;
    /** The socket to the worker is open (again). */
    onUp(): void;
    onDown(): void;
}

export interface VoiceCallStats {
    started: number;
    refusedStart: number;
    rejectedFromGame: number;
    staleFromWorker: number;
    connected: number;
    roomsJoined: number;
    roomsConnected: number;
    drafts: number;
}

export class VoiceCalls {
    readonly stats: VoiceCallStats = { started: 0, refusedStart: 0, rejectedFromGame: 0, staleFromWorker: 0, connected: 0, roomsJoined: 0, roomsConnected: 0, drafts: 0 };
    private readonly bubbles = new Map<string, Bubble>();
    private readonly calls = new Map<string, Call>();
    private readonly rooms = new Map<string, Room>();
    private readonly invitations = new Map<string, Invitation>();
    /** The people in each bubble the bot may hear: everyone but bots. Kept up to date by the bot's space events. */
    private readonly roster = new Map<string, Map<string, SpaceUser>>();
    /** Connections the worker lost by going away; asked for again when it is back. */
    private readonly lost = new Map<string, { spaceName: string; personId: string }>();
    /** The words each person is in the middle of saying, so they can be offered back if the worker goes away mid-sentence. */
    private readonly live = new Map<string, { spaceName: string; personId: string; turnId: string; text: string }>();
    /** What the bot heard each person say that they may send as their line, by space, person and turn. */
    private readonly spoken = new Map<string, { text: string; used: boolean }>();
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
            onUp: () => this.linkUp(),
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
            case 'livekitInvitationMessage':
                if (this.fromMyself(event)) this.joinRoom(event.spaceName, inner.livekitInvitationMessage.serverUrl, inner.livekitInvitationMessage.token);
                break;
            case 'livekitDisconnectMessage':
                if (this.fromMyself(event)) this.leaveRoom(event.spaceName);
                break;
            // Screen-sharing connections are not audio connections with the bot: never answered
        }
    }

    /**
     * The game sends a LiveKit invitation or disconnect as a private event from the invited user to itself, so only
     * an event the bot appears to send to itself is one. A person cannot make the game say that: the sender is set by
     * the game server, not the message.
     */
    private fromMyself(event: PrivateEventPusherToFront): boolean {
        const me = this.game.botSpaceUserId(event.spaceName);
        const ok = me !== undefined && event.receiverUserId === me && event.sender?.spaceUserId === me;
        if (!ok) this.stats.rejectedFromGame++;
        return ok;
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
        // The bubble is on peer-to-peer again: the worker closes the room when this newer path opens
        this.rooms.delete(spaceName);
        this.invitations.delete(spaceName);
        this.lost.delete(key);
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
        this.rooms.delete(spaceName);
        this.invitations.delete(spaceName);
        this.roster.delete(spaceName);
        for (const [key, lost] of this.lost) if (lost.spaceName === spaceName) this.lost.delete(key);
        for (const key of this.spoken.keys()) if (key.startsWith(`${spaceName}\n`)) this.spoken.delete(key);
        for (const [key, live] of this.live) if (live.spaceName === spaceName) this.live.delete(key);
    }

    // ---- LiveKit ----

    /** The game moved the bubble to LiveKit: the bot joins the room with its own token, and the room replaces every call. */
    private joinRoom(spaceName: string, serverUrl: string, token: string): void {
        if (!/^wss?:\/\//.test(serverUrl) || serverUrl.length > MAX_URL_CHARS || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
            this.stats.rejectedFromGame++;
            return;
        }
        // Remembered even if the worker is away, so the bot can join when it is back
        this.invitations.set(spaceName, { serverUrl, token });
        const bubble = this.bubbleFor(spaceName);
        if (!bubble) {
            this.log(`voice: no LiveKit audio in ${spaceName} (worker not available)`);
            return;
        }
        // Everything older is replaced by the room: the worker closes the connections with people, and so does this side
        for (const call of [...this.calls.values()]) if (call.spaceName === spaceName) this.calls.delete(callKey(spaceName, call.participantId));
        for (const [key, lost] of this.lost) if (lost.spaceName === spaceName) this.lost.delete(key);
        const room: Room = { spaceName, sessionId: bubble.sessionId, epoch: ++this.epoch };
        if (!this.link.send({ type: 'room.join', sessionId: room.sessionId, epoch: room.epoch, serverUrl, token })) {
            this.log(`voice: no LiveKit audio in ${spaceName} (worker not available)`);
            return;
        }
        this.rooms.set(spaceName, room);
        this.stats.roomsJoined++;
        this.sendPeople(room);
    }

    private leaveRoom(spaceName: string): void {
        this.invitations.delete(spaceName);
        const room = this.rooms.get(spaceName);
        if (!room) return;
        this.rooms.delete(spaceName);
        this.link.send({ type: 'room.leave', sessionId: room.sessionId, epoch: room.epoch });
    }

    /** Tells the worker whose microphone it may take from the room: the people in the bubble, never a bot. */
    private sendPeople(room: Room): void {
        const people = [...(this.roster.get(room.spaceName)?.keys() ?? [])].slice(0, MAX_PEOPLE).map((participantId) => ({ participantId, mode: 'talk' as const }));
        this.link.send({ type: 'room.people', sessionId: room.sessionId, epoch: room.epoch, people });
    }

    private rosterChanged(spaceName: string): void {
        const room = this.rooms.get(spaceName);
        if (room) this.sendPeople(room);
    }

    /** Everyone in a space the bot is in (all of them, replacing what was known). */
    spaceUsers(spaceName: string, users: readonly SpaceUser[]): void {
        const people = new Map<string, SpaceUser>();
        for (const user of users) if (this.isPerson(spaceName, user)) people.set(user.spaceUserId, user);
        this.roster.set(spaceName, people);
        this.rosterChanged(spaceName);
    }

    spaceUserJoined(spaceName: string, user: SpaceUser): void {
        if (!this.isPerson(spaceName, user)) return;
        let people = this.roster.get(spaceName);
        if (!people) this.roster.set(spaceName, (people = new Map()));
        people.set(user.spaceUserId, user);
        this.rosterChanged(spaceName);
    }

    spaceUserLeft(spaceName: string, spaceUserId: string): void {
        this.lost.delete(callKey(spaceName, spaceUserId));
        this.live.delete(callKey(spaceName, spaceUserId));
        if (this.roster.get(spaceName)?.delete(spaceUserId)) this.rosterChanged(spaceName);
    }

    private isPerson(spaceName: string, user: SpaceUser): boolean {
        return user.spaceUserId.length > 0 && user.spaceUserId.length <= MAX_ID_CHARS && !isBotUser(user) && user.spaceUserId !== this.game.botSpaceUserId(spaceName);
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
        } else if (message.type === 'room.state') {
            const room = this.currentRoom(message.sessionId, message.epoch);
            if (!room) {
                this.stats.staleFromWorker++;
            } else if (message.state === 'connected') {
                this.stats.roomsConnected++;
            } else {
                // The worker lost the bot's LiveKit connection, or never made it: the bot stays text-only until the game invites it again
                this.rooms.delete(room.spaceName);
                this.invitations.delete(room.spaceName);
                this.log(`voice: LiveKit audio in ${room.spaceName} ended (${message.state})`);
            }
        } else if (message.type === 'user.speech_started' || message.type === 'user.partial' || message.type === 'user.turn') {
            this.handleSpeech(message);
        } else if (message.type === 'error') {
            this.handleWorkerError(message);
        }
    }

    /**
     * What the worker heard a person say. It goes back to that person and nobody else: as a private event, drawn above
     * their message box. Only a finished stretch whose every word came through can become a line, and it is the
     * person's own game that sends it (so it is theirs, in the chat, like anything they type); words that did not all
     * come through are only offered back. A result from a path the bot has since replaced never becomes a line either.
     */
    private handleSpeech(message: Extract<FromWorker, { type: 'user.speech_started' | 'user.partial' | 'user.turn' }>): void {
        const bubble = [...this.bubbles.values()].find((b) => b.sessionId === message.sessionId);
        // The person must still be in the bubble: the words of someone who left are nobody's to see
        if (!bubble || !this.roster.get(bubble.spaceName)?.has(message.participantId)) {
            this.stats.staleFromWorker++;
            return;
        }
        const spaceName = bubble.spaceName;
        const call = this.calls.get(callKey(spaceName, message.participantId));
        const room = this.rooms.get(spaceName);
        const current = call ? call.epoch === message.epoch : room?.sessionId === message.sessionId && room.epoch === message.epoch;
        const to = message.participantId;
        if (message.type === 'user.turn' && this.live.get(callKey(spaceName, to))?.turnId === message.turnId) this.live.delete(callKey(spaceName, to));
        if (message.type === 'user.speech_started') {
            if (!current) this.stats.staleFromWorker++;
        } else if (message.type === 'user.partial') {
            if (!current) {
                this.stats.staleFromWorker++;
            } else {
                this.live.set(callKey(spaceName, to), { spaceName, personId: to, turnId: message.turnId, text: message.text });
                this.draft(spaceName, to, { turnId: message.turnId, state: 'live', text: message.text });
            }
        } else if (message.outcome === 'cleared' || !message.text) {
            this.draft(spaceName, to, { turnId: message.turnId, state: 'cleared', text: '' });
        } else if (message.outcome === 'final' && current) {
            this.remember(spaceName, to, message.turnId, message.text);
            this.draft(spaceName, to, { turnId: message.turnId, state: 'final', text: message.text });
        } else {
            // Lost, or finished on a path that has since been replaced: offered back, never sent
            this.stats.staleFromWorker += message.outcome === 'final' ? 1 : 0;
            this.remember(spaceName, to, message.turnId, message.text);
            this.draft(spaceName, to, { turnId: message.turnId, state: 'lost', text: message.text, reason: message.outcome === 'final' ? 'path' : message.reason });
        }
    }

    private draft(spaceName: string, personId: string, draft: VoiceDraft): void {
        this.stats.drafts++;
        this.game.sendDraft(spaceName, personId, draft);
    }

    private remember(spaceName: string, personId: string, turnId: string, text: string): void {
        this.spoken.set(spokenKey(spaceName, personId, turnId), { text, used: false });
        for (const oldest of this.spoken.keys()) {
            if (this.spoken.size <= MAX_SPOKEN) break;
            this.spoken.delete(oldest);
        }
    }

    /**
     * A chat line that says it was spoken to this bot. It is taken as a request once, and only when the bot did hear
     * those words from that person: anything else (a turn it never heard, the same turn again, other words) is just
     * an ordinary line from them.
     */
    acceptSpoken(spaceName: string, personId: string, turnId: string, text: string): 'new' | 'duplicate' | 'unknown' {
        const heard = this.spoken.get(spokenKey(spaceName, personId, turnId));
        if (!heard || heard.text !== text.trim()) return 'unknown';
        if (heard.used) return 'duplicate';
        heard.used = true;
        return 'new';
    }

    private handleWorkerError(message: Extract<FromWorker, { type: 'error' }>): void {
        if (message.participantId !== undefined && message.epoch !== undefined) {
            // The worker refused this connection (for example, no room for it): the bot stays text-only
            const call = this.currentCall(message.sessionId, message.participantId, message.epoch);
            if (call && message.code === 'at_capacity') this.drop(call, false);
            else if (!call) this.stats.staleFromWorker++;
        } else if (message.epoch !== undefined) {
            // About the room (no person is named)
            const room = this.currentRoom(message.sessionId, message.epoch);
            if (room && message.code === 'at_capacity') {
                this.rooms.delete(room.spaceName);
                this.invitations.delete(room.spaceName);
                this.log(`voice: no LiveKit audio in ${room.spaceName} (worker is full)`);
            } else if (!room) {
                this.stats.staleFromWorker++;
            }
        } else if (message.code === 'at_capacity' || message.code === 'no_session') {
            // About the whole bubble: the worker has no such session (it was refused, or it forgot it)
            this.evictBubble(message.sessionId);
        }
    }

    /**
     * Forgets a bubble the worker does not hold, so the next start opens a new one instead of reusing a dead one.
     * Whoever was waiting on it is told to disconnect and stays text-only.
     */
    private evictBubble(sessionId: string): void {
        for (const [spaceName, bubble] of this.bubbles) {
            if (bubble.sessionId !== sessionId) continue;
            this.bubbles.delete(spaceName);
            this.log(`voice: no audio session for ${spaceName} (worker refused it)`);
            for (const call of [...this.calls.values()]) if (call.sessionId === sessionId) this.drop(call, false);
            const room = this.rooms.get(spaceName);
            if (room?.sessionId === sessionId) {
                this.rooms.delete(spaceName);
                this.invitations.delete(spaceName);
            }
        }
    }

    private currentRoom(sessionId: string, epoch: number): Room | undefined {
        for (const room of this.rooms.values()) if (room.sessionId === sessionId) return room.epoch === epoch ? room : undefined;
        return undefined;
    }

    private currentCall(sessionId: string, participantId: string, epoch: number): Call | undefined {
        for (const call of this.calls.values()) {
            if (call.sessionId === sessionId && call.participantId === participantId) return call.epoch === epoch ? call : undefined;
        }
        return undefined;
    }

    /** The worker went away: it holds none of this any more. People are told, so nobody waits on a silent call. */
    linkDown(): void {
        // Whoever was mid-sentence gets their words back to decide on: nothing is sent for them
        for (const { spaceName, personId, turnId, text } of [...this.live.values()]) {
            this.remember(spaceName, personId, turnId, text);
            this.draft(spaceName, personId, { turnId, state: 'lost', text, reason: 'path' });
        }
        this.live.clear();
        for (const call of [...this.calls.values()]) {
            this.lost.set(callKey(call.spaceName, call.participantId), { spaceName: call.spaceName, personId: call.participantId });
            this.game.sendDisconnect(call.spaceName, call.participantId);
        }
        this.calls.clear();
        this.bubbles.clear();
        // The invitations stay: they are the game's, and still say where the bubble is
        this.rooms.clear();
    }

    /**
     * The worker is back (or reached for the first time). It holds nothing from before, so what the game still says
     * should exist is built again: the people who were connected are asked for a new offer, and a bubble that is on
     * LiveKit gets the bot back in its room. Anyone who is gone by now is simply not asked.
     */
    linkUp(): void {
        const lost = [...this.lost.values()];
        this.lost.clear();
        for (const { spaceName, personId } of lost) {
            const person = this.roster.get(spaceName)?.get(personId);
            if (!person || this.invitations.has(spaceName) || this.game.botSpaceUserId(spaceName) === undefined) continue;
            this.start(spaceName, person);
            if (this.calls.has(callKey(spaceName, personId))) this.game.sendStart(spaceName, personId);
        }
        for (const [spaceName, invitation] of [...this.invitations]) {
            if (!this.rooms.has(spaceName) && this.game.botSpaceUserId(spaceName) !== undefined) this.joinRoom(spaceName, invitation.serverUrl, invitation.token);
        }
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
        this.rooms.clear();
        this.invitations.clear();
        this.roster.clear();
        this.lost.clear();
        this.spoken.clear();
        this.live.clear();
        this.link.close();
    }

    hasCall(spaceName: string, personId: string): boolean {
        return this.calls.has(callKey(spaceName, personId));
    }
}

const callKey = (spaceName: string, personId: string): string => `${spaceName}\n${personId}`;
const spokenKey = (spaceName: string, personId: string, turnId: string): string => `${spaceName}\n${personId}\n${turnId}`;

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
