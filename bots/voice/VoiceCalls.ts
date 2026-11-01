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
 *
 * Who hears and who speaks for a bubble is the bot's maker's choice in Orbit (#1746, `VoiceSettings`). When the bot
 * server has it, a bubble's session is opened with that choice (provider, model, voice and key), and what the worker
 * sends before the session is open waits for it. A bot Orbit says does not speak gets no session at all and stays text-only.
 * Just before each spoken turn Orbit is asked again (`beforeSpeaking`): a bot that no longer speaks answers in text for
 * that turn; one whose settings changed has the bubble's session closed and opened again with the new ones, and the people
 * in it reconnect, as after the worker comes back. The worker reads the settings when it creates a session, so this is
 * the only way a change reaches a bubble.
 */
import type { PrivateEventPusherToFront, SpaceUser } from '@workadventure/messages';
import type { FromWorker, ProviderPart, ToWorker, VoiceDraft, VoiceMode, VoiceSignal, VoiceStatus } from './protocol';
import type { TurnDecision } from './BotSpeech';
import type { VoiceLink } from './VoiceLink';
import type { ActiveVoice, PartProvider, VoiceSettings } from './VoiceSettings';

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
    /** Tells one person where their audio with the bot stands (see VoiceStatus): the game draws its Voice button from it. */
    sendStatus(spaceName: string, receiverUserId: string, status: VoiceStatus): void;
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
    /** What the session was opened with, without the keys (see VoiceSettings). Only for a bot whose voice comes from Orbit. */
    signature?: string;
    /** A provider refused its key: the next turn fetches the keys again by opening the session anew. */
    stale?: boolean;
}

/** The bot's LiveKit participant in a bubble, as the worker holds it. */
interface Room {
    spaceName: string;
    sessionId: string;
    epoch: number;
    /** The worker said the bot is in the room. */
    connected?: boolean;
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
/** What is held for a session that is still waiting for Orbit's answer: the setup data of a few connections, no more. */
const MAX_HELD = 100;
/** Sessions whose providers are remembered, so a late report from the worker is still told to Orbit for the right provider. */
const MAX_SESSIONS = 50;
/** The modes a person may choose for themselves (#1666): talk and listen, speak and read, type and listen, text only. */
const PERSON_MODES: readonly VoiceMode[] = ['talk', 'speak_and_read', 'type_and_listen', 'off'];
const DEFAULT_PERSON_MODE: VoiceMode = 'talk';

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
    spoken: number;
    stoppedBySpeech: number;
}

export class VoiceCalls {
    readonly stats: VoiceCallStats = { started: 0, refusedStart: 0, rejectedFromGame: 0, staleFromWorker: 0, connected: 0, roomsJoined: 0, roomsConnected: 0, drafts: 0, spoken: 0, stoppedBySpeech: 0 };
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
    /** Calls whose audio is connected both ways, and the rooms the bot is in: whether anyone can hear it now. */
    private readonly joined = new Map<string, number>();
    /** Who is speaking to the bot right now in each bubble, and when someone last started. */
    private readonly talking = new Map<string, Set<string>>();
    private readonly lastSpeechAt = new Map<string, number>();
    /** Called when someone's audio is connected (a call or the room): what was waiting for an audience can be said. */
    onAudience?: (spaceName: string) => void;
    /** What each person's mode is, as they chose it. Missing: the default. Kept so a choice made before the audio connects still applies. */
    private readonly modes = new Map<string, VoiceMode>();
    /** The last status each person was told, so only a change is sent. */
    private readonly told = new Map<string, VoiceStatus>();
    /** Called when a reply's voice stopped part-way because someone spoke over it. */
    onStopped?: (spaceName: string, segmentId: string) => void;
    /** Sessions waiting for Orbit's answer before they are opened, with what the worker is to get once they are. */
    private readonly opening = new Map<string, ToWorker[]>();
    /** The provider each part of a session runs on, to report how its calls went. */
    private readonly sessions = new Map<string, Record<ProviderPart, PartProvider>>();
    /** Only for a bot whose voice Orbit decides (see VoiceSettings): asked just before a reply is said. */
    readonly beforeSpeaking?: (spaceName: string) => Promise<TurnDecision>;
    private epoch = 0;
    private bubbleSeq = 0;

    private readonly link: VoiceLink;

    constructor(
        private readonly botId: string,
        private readonly game: GameSide,
        /** Opens the socket to the worker, wired to this relay. */
        openLink: (handlers: LinkHandlers) => VoiceLink,
        private readonly log: (message: string) => void = () => undefined,
        /** What each bubble hears and speaks with, from Orbit. Without it a bubble gets the worker's built-in test engine. */
        private readonly settings?: VoiceSettings
    ) {
        if (settings) this.beforeSpeaking = (spaceName) => this.prepareTurn(spaceName);
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
            case 'voiceModeChoice':
                if (this.fromAPerson(event, sender)) this.personChoseMode(event.spaceName, sender!, inner.voiceModeChoice.mode);
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
        if (!this.post({ type: 'lane.open', sessionId: bubble.sessionId, participantId: person.spaceUserId, epoch, mode: this.modeOf(spaceName, person.spaceUserId) })) {
            this.calls.delete(key);
            this.refuse(spaceName, person.spaceUserId);
            return;
        }
        this.stats.started++;
        this.tell(spaceName, person.spaceUserId, 'connecting');
    }

    /**
     * A person chose how they talk with bots. Only a person in this bot's space may (see fromAPerson), and only one
     * of the four modes: anything else is refused. It is kept for their later connections and sent to the worker for
     * the one they have now. Type and listen, and text only, mean the worker takes nothing from their microphone.
     */
    private personChoseMode(spaceName: string, person: SpaceUser, mode: string): void {
        if (!(PERSON_MODES as readonly string[]).includes(mode)) {
            this.stats.rejectedFromGame++;
            return;
        }
        const key = callKey(spaceName, person.spaceUserId);
        this.modes.set(key, mode as VoiceMode);
        this.setMode(spaceName, mode as VoiceMode, person.spaceUserId);
        // In a LiveKit room the worker is told by the list of people, which carries each person's mode
        const room = this.rooms.get(spaceName);
        if (room) this.sendPeople(room);
    }

    private modeOf(spaceName: string, personId: string): VoiceMode {
        return this.modes.get(callKey(spaceName, personId)) ?? DEFAULT_PERSON_MODE;
    }

    /** Tells one person where their audio stands, once per change. */
    private tell(spaceName: string, personId: string, status: VoiceStatus): void {
        const key = callKey(spaceName, personId);
        if (this.told.get(key) === status) return;
        this.told.set(key, status);
        this.game.sendStatus(spaceName, personId, status);
    }

    private tellEveryone(spaceName: string, status: VoiceStatus): void {
        for (const personId of this.roster.get(spaceName)?.keys() ?? []) this.tell(spaceName, personId, status);
    }

    private signalFromPerson(spaceName: string, person: SpaceUser, raw: string): void {
        const call = this.calls.get(callKey(spaceName, person.spaceUserId));
        const signal = call && parseSignal(raw);
        if (!call || !signal) {
            // No start came first (or it was ended), or this is not setup data
            this.stats.rejectedFromGame++;
            return;
        }
        const sent = this.post({ type: 'lane.signal', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, signal });
        if (!sent) this.drop(call, true);
    }

    private end(spaceName: string, personId: string, reason: 'left' | 'closed'): void {
        const call = this.calls.get(callKey(spaceName, personId));
        if (!call) return;
        this.calls.delete(callKey(spaceName, personId));
        this.post({ type: 'lane.close', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, reason });
    }

    /** The bot left a space: its connections there end with it. */
    spaceLeft(spaceName: string): void {
        for (const call of [...this.calls.values()]) if (call.spaceName === spaceName) this.end(spaceName, call.participantId, 'closed');
        const bubble = this.bubbles.get(spaceName);
        if (bubble) {
            this.bubbles.delete(spaceName);
            this.endSession(bubble.sessionId);
        }
        this.rooms.delete(spaceName);
        this.invitations.delete(spaceName);
        this.roster.delete(spaceName);
        for (const [key, lost] of this.lost) if (lost.spaceName === spaceName) this.lost.delete(key);
        for (const key of this.spoken.keys()) if (key.startsWith(`${spaceName}\n`)) this.spoken.delete(key);
        for (const [key, live] of this.live) if (live.spaceName === spaceName) this.live.delete(key);
        for (const key of this.joined.keys()) if (key.startsWith(`${spaceName}\n`)) this.joined.delete(key);
        for (const key of this.modes.keys()) if (key.startsWith(`${spaceName}\n`)) this.modes.delete(key);
        for (const key of this.told.keys()) if (key.startsWith(`${spaceName}\n`)) this.told.delete(key);
        this.talking.delete(spaceName);
        this.lastSpeechAt.delete(spaceName);
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
            this.tellEveryone(spaceName, 'paused');
            return;
        }
        // Everything older is replaced by the room: the worker closes the connections with people, and so does this side
        for (const call of [...this.calls.values()]) if (call.spaceName === spaceName) this.calls.delete(callKey(spaceName, call.participantId));
        for (const [key, lost] of this.lost) if (lost.spaceName === spaceName) this.lost.delete(key);
        const room: Room = { spaceName, sessionId: bubble.sessionId, epoch: ++this.epoch };
        if (!this.post({ type: 'room.join', sessionId: room.sessionId, epoch: room.epoch, serverUrl, token })) {
            this.log(`voice: no LiveKit audio in ${spaceName} (worker not available)`);
            this.tellEveryone(spaceName, 'paused');
            return;
        }
        this.rooms.set(spaceName, room);
        this.stats.roomsJoined++;
        this.sendPeople(room);
        this.tellEveryone(spaceName, 'connecting');
    }

    private leaveRoom(spaceName: string): void {
        this.invitations.delete(spaceName);
        const room = this.rooms.get(spaceName);
        if (!room) return;
        this.rooms.delete(spaceName);
        this.post({ type: 'room.leave', sessionId: room.sessionId, epoch: room.epoch });
        this.tellEveryone(spaceName, 'paused');
    }

    /** Tells the worker whose microphone it may take from the room: the people in the bubble, never a bot. */
    private sendPeople(room: Room): void {
        const people = [...(this.roster.get(room.spaceName)?.keys() ?? [])].slice(0, MAX_PEOPLE).map((participantId) => ({ participantId, mode: this.modeOf(room.spaceName, participantId) }));
        this.post({ type: 'room.people', sessionId: room.sessionId, epoch: room.epoch, people });
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
        // Someone who arrives while the bot is in the room is told where its audio stands
        const room = this.rooms.get(spaceName);
        if (room) this.tell(spaceName, user.spaceUserId, room.connected ? 'on' : 'connecting');
    }

    spaceUserLeft(spaceName: string, spaceUserId: string): void {
        this.talking.get(spaceName)?.delete(spaceUserId);
        this.joined.delete(callKey(spaceName, spaceUserId));
        this.lost.delete(callKey(spaceName, spaceUserId));
        this.live.delete(callKey(spaceName, spaceUserId));
        this.modes.delete(callKey(spaceName, spaceUserId));
        this.told.delete(callKey(spaceName, spaceUserId));
        if (this.roster.get(spaceName)?.delete(spaceUserId)) this.rosterChanged(spaceName);
    }

    private isPerson(spaceName: string, user: SpaceUser): boolean {
        return user.spaceUserId.length > 0 && user.spaceUserId.length <= MAX_ID_CHARS && !isBotUser(user) && user.spaceUserId !== this.game.botSpaceUserId(spaceName);
    }

    private bubbleFor(spaceName: string): Bubble | undefined {
        const known = this.bubbles.get(spaceName);
        if (known) return known;
        const bubble: Bubble = { sessionId: `${this.botId}.${++this.bubbleSeq}`.slice(0, MAX_ID_CHARS), spaceName };
        if (this.settings) {
            if (!this.link.isUp()) return undefined;
            // Orbit is asked who hears and speaks for this bot: the session opens when it has answered, and what is
            // sent for it meanwhile is held (see post)
            this.opening.set(bubble.sessionId, []);
            this.bubbles.set(spaceName, bubble);
            void this.openSession(bubble, this.settings);
            return bubble;
        }
        if (!this.openMessage(bubble)) return undefined;
        this.bubbles.set(spaceName, bubble);
        return bubble;
    }

    private openMessage(bubble: Bubble, settings: object = {}): boolean {
        return this.link.send({ type: 'session.open', sessionId: bubble.sessionId, bubbleId: bubble.spaceName.slice(0, MAX_ID_CHARS), botId: this.botId.slice(0, MAX_ID_CHARS), ...settings });
    }

    /**
     * Opens a bubble's session with what Orbit says the bot hears and speaks with. When the bot does not speak (voice
     * off, universe off, no profile, a provider or key that does not work), or Orbit cannot be asked, there is no session:
     * the people waiting are told to disconnect and the bot stays text-only, as when the worker is away.
     */
    private async openSession(bubble: Bubble, settings: VoiceSettings): Promise<void> {
        let setup: Awaited<ReturnType<VoiceSettings['sessionSettings']>> = null;
        let why = 'not available';
        let providers: Record<ProviderPart, PartProvider> | undefined;
        try {
            const active = await settings.active();
            if ('reason' in active) {
                why = active.reason;
            } else {
                providers = active.providers;
                bubble.signature = active.signature;
                setup = await settings.sessionSettings(active);
                why = 'a provider cannot be used';
            }
        } catch {
            // The settings never throw; if they do, the bot is text-only
        }
        // The bubble ended while Orbit was being asked (the bot left, or the worker went away): nothing to open
        if (this.bubbles.get(bubble.spaceName) !== bubble) return;
        const held = this.opening.get(bubble.sessionId) ?? [];
        this.opening.delete(bubble.sessionId);
        if (!setup || !providers) {
            this.evictBubble(bubble.sessionId, `the bot does not speak: ${why}`);
            return;
        }
        this.rememberSession(bubble.sessionId, providers);
        // setup holds the keys: it goes into this one message and nowhere else
        if (!this.openMessage(bubble, setup)) {
            this.evictBubble(bubble.sessionId, 'worker not available');
            return;
        }
        for (const message of held) this.link.send(message);
    }

    private rememberSession(sessionId: string, providers: Record<ProviderPart, PartProvider>): void {
        this.sessions.set(sessionId, providers);
        for (const oldest of this.sessions.keys()) {
            if (this.sessions.size <= MAX_SESSIONS) break;
            this.sessions.delete(oldest);
        }
    }

    /** Sends to the worker, or holds the message when the session it is for is still waiting for Orbit. */
    private post(message: ToWorker): boolean {
        const held = this.opening.get(message.sessionId);
        if (!held) return this.link.send(message);
        if (held.length >= MAX_HELD) return false;
        held.push(message);
        return true;
    }

    private endSession(sessionId: string): void {
        // A session that was never opened has nothing to end on the worker
        if (!this.opening.delete(sessionId)) this.link.send({ type: 'session.end', sessionId });
    }

    private refuse(spaceName: string, personId: string): void {
        this.stats.refusedStart++;
        this.log(`voice: no audio connection for ${personId} (worker not available)`);
        this.game.sendDisconnect(spaceName, personId);
        this.tell(spaceName, personId, 'paused');
    }

    /** Ends a call the worker can no longer carry, and tells the person's browser so it does not wait for it. */
    private drop(call: Call, closeOnWorker: boolean): void {
        this.calls.delete(callKey(call.spaceName, call.participantId));
        if (closeOnWorker) {
            this.post({ type: 'lane.close', sessionId: call.sessionId, participantId: call.participantId, epoch: call.epoch, reason: 'failed' });
        }
        this.game.sendDisconnect(call.spaceName, call.participantId);
        this.tell(call.spaceName, call.participantId, 'paused');
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
                this.joined.set(callKey(call.spaceName, call.participantId), call.epoch);
                this.tell(call.spaceName, call.participantId, 'on');
                this.onAudience?.(call.spaceName);
            } else if (message.type === 'participant.leave') {
                this.drop(call, false);
            }
        } else if (message.type === 'room.state') {
            const room = this.currentRoom(message.sessionId, message.epoch);
            if (!room) {
                this.stats.staleFromWorker++;
            } else if (message.state === 'connected') {
                this.stats.roomsConnected++;
                room.connected = true;
                this.tellEveryone(room.spaceName, 'on');
                this.onAudience?.(room.spaceName);
            } else {
                // The worker lost the bot's LiveKit connection, or never made it: the bot stays text-only until the game invites it again
                this.rooms.delete(room.spaceName);
                this.invitations.delete(room.spaceName);
                this.log(`voice: LiveKit audio in ${room.spaceName} ended (${message.state})`);
                this.tellEveryone(room.spaceName, 'paused');
            }
        } else if (message.type === 'user.speech_started' || message.type === 'user.partial' || message.type === 'user.turn') {
            this.handleSpeech(message);
        } else if (message.type === 'playback.progress') {
            this.handlePlayback(message);
        } else if (message.type === 'provider.ok' || message.type === 'provider.failed') {
            this.handleProvider(message);
        } else if (message.type === 'error') {
            this.handleWorkerError(message);
        }
    }

    /**
     * How a call to a provider went, told to Orbit for the provider that part of this session runs on. A server's own
     * provider has no health: Orbit says so and it is ignored there. A key a provider refused is fetched again for the
     * next turn, in case it was replaced. Nothing here waits for Orbit, and nothing here carries a key.
     */
    private handleProvider(message: Extract<FromWorker, { type: 'provider.ok' | 'provider.failed' }>): void {
        const provider = this.sessions.get(message.sessionId)?.[message.part];
        if (!this.settings || !provider) return;
        if (message.type === 'provider.failed' && message.rejected) {
            const bubble = [...this.bubbles.values()].find((b) => b.sessionId === message.sessionId);
            if (bubble) bubble.stale = true;
        }
        if (!provider.owner) return;
        if (message.type === 'provider.ok') {
            this.settings.report(provider.providerId, message.part, { ok: true });
        } else {
            this.settings.report(provider.providerId, message.part, {
                ok: false,
                ...(message.status !== undefined ? { status: message.status } : {}),
                ...(message.rejected ? { rejected: true } : {}),
            });
        }
    }

    /**
     * How a reply's audio went. Only one thing is shown to people: that the voice stopped part-way because someone spoke
     * over it. A reply cut before any of it was sent, and every other ending, shows nothing.
     */
    private handlePlayback(message: Extract<FromWorker, { type: 'playback.progress' }>): void {
        if (!message.finished || !message.interrupted || message.reason !== 'barge_in' || message.playedMs <= 0) return;
        const bubble = [...this.bubbles.values()].find((b) => b.sessionId === message.sessionId);
        if (!bubble) return;
        this.stats.stoppedBySpeech++;
        this.onStopped?.(bubble.spaceName, message.segmentId);
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
        // Someone is speaking to the bot: what it was about to say can wait, and what it is saying has been stopped by the worker
        if (current && message.type === 'user.speech_started') {
            this.lastSpeechAt.set(spaceName, performance.now());
            this.talkingIn(spaceName).add(to);
        } else if (message.type === 'user.turn') {
            this.talking.get(spaceName)?.delete(to);
        }
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
                this.tellEveryone(room.spaceName, 'paused');
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
    private evictBubble(sessionId: string, reason = 'worker refused it'): void {
        for (const [spaceName, bubble] of this.bubbles) {
            if (bubble.sessionId !== sessionId) continue;
            this.bubbles.delete(spaceName);
            this.opening.delete(sessionId);
            this.log(`voice: no audio session for ${spaceName} (${reason})`);
            for (const call of [...this.calls.values()]) if (call.sessionId === sessionId) this.drop(call, false);
            const room = this.rooms.get(spaceName);
            if (room?.sessionId === sessionId) {
                this.rooms.delete(spaceName);
                this.invitations.delete(spaceName);
                this.tellEveryone(spaceName, 'paused');
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
            this.tell(call.spaceName, call.participantId, 'paused');
        }
        for (const spaceName of [...this.rooms.keys()]) this.tellEveryone(spaceName, 'paused');
        this.calls.clear();
        this.bubbles.clear();
        this.opening.clear();
        this.joined.clear();
        this.talking.clear();
        // The invitations stay: they are the game's, and still say where the bubble is
        this.rooms.clear();
    }

    /**
     * The worker is back (or reached for the first time). It holds nothing from before, so what the game still says
     * should exist is built again: the people who were connected are asked for a new offer, and a bubble that is on
     * LiveKit gets the bot back in its room. Anyone who is gone by now is simply not asked.
     */
    linkUp(): void {
        this.restore();
    }

    /** Asks the people who lost their connection for a new offer, and puts the bot back in the room of a bubble that is on LiveKit. */
    private restore(onlySpace?: string): void {
        const lost = [...this.lost.values()].filter((l) => onlySpace === undefined || l.spaceName === onlySpace);
        for (const { spaceName, personId } of lost) {
            this.lost.delete(callKey(spaceName, personId));
            const person = this.roster.get(spaceName)?.get(personId);
            if (!person || this.invitations.has(spaceName) || this.game.botSpaceUserId(spaceName) === undefined) continue;
            this.start(spaceName, person);
            if (this.calls.has(callKey(spaceName, personId))) this.game.sendStart(spaceName, personId);
        }
        for (const [spaceName, invitation] of [...this.invitations]) {
            if (onlySpace !== undefined && spaceName !== onlySpace) continue;
            if (!this.rooms.has(spaceName) && this.game.botSpaceUserId(spaceName) !== undefined) this.joinRoom(spaceName, invitation.serverUrl, invitation.token);
        }
    }

    // ---- for what comes next (recognition, speaking): the controls of a bubble's audio ----

    /** Says committed text in the bot's voice, for at most `maxMs`. False when there is no audio session to say it in. */
    say(spaceName: string, segmentId: string, text: string, maxMs?: number): boolean {
        const bubble = this.bubbles.get(spaceName);
        const sent = !!bubble && this.post({ type: 'bot.say', sessionId: bubble.sessionId, segmentId, text, committed: true, ...(maxMs ? { maxMs } : {}) });
        if (sent) this.stats.spoken++;
        return sent;
    }

    /** Whether anyone's audio is connected in this bubble, so that what the bot says is heard. */
    hasAudience(spaceName: string): boolean {
        for (const call of this.calls.values()) {
            if (call.spaceName === spaceName && this.joined.get(callKey(spaceName, call.participantId)) === call.epoch) return true;
        }
        return this.rooms.get(spaceName)?.connected === true;
    }

    /** Whether someone is in the middle of speaking to the bot in this bubble. */
    someoneSpeaking(spaceName: string): boolean {
        return (this.talking.get(spaceName)?.size ?? 0) > 0;
    }

    /** When someone last started speaking to the bot in this bubble (performance.now time), or 0. */
    lastSpokenToAt(spaceName: string): number {
        return this.lastSpeechAt.get(spaceName) ?? 0;
    }

    private talkingIn(spaceName: string): Set<string> {
        let people = this.talking.get(spaceName);
        if (!people) this.talking.set(spaceName, (people = new Set()));
        return people;
    }

    /**
     * Asked just before a reply is said (see BotSpeech): Orbit is read again. A bot that does not speak now answers in
     * text for this turn and its session is left alone (its people can still talk to it, and the next turn asks again).
     * One whose settings changed gets its session closed and opened again, so the reply waits for the people to
     * reconnect. Orbit cannot be asked: text.
     */
    private async prepareTurn(spaceName: string): Promise<TurnDecision> {
        const bubble = this.bubbles.get(spaceName);
        if (!this.settings || !bubble || this.opening.has(bubble.sessionId)) return { action: 'text' };
        let active: ActiveVoice;
        try {
            active = await this.settings.active();
        } catch {
            return { action: 'text' };
        }
        if (this.bubbles.get(spaceName) !== bubble) return { action: 'text' };
        if ('reason' in active) {
            this.log(`voice: ${spaceName} answers in text this time (${active.reason})`);
            return { action: 'text' };
        }
        if (active.signature !== bubble.signature || bubble.stale) {
            this.reopen(bubble);
            return { action: 'wait' };
        }
        return { action: 'speak', limits: active.replyLimits };
    }

    /** Closes a bubble's session and opens it again with the settings Orbit has now: the people in it reconnect, as after the worker comes back. */
    private reopen(bubble: Bubble): void {
        const { spaceName } = bubble;
        const people = [...this.calls.values()].filter((call) => call.spaceName === spaceName);
        const inRoom = this.rooms.has(spaceName);
        this.bubbles.delete(spaceName);
        this.endSession(bubble.sessionId);
        this.rooms.delete(spaceName);
        // Whoever was mid-sentence gets their words back to decide on, as when the worker goes away
        for (const [key, live] of [...this.live]) {
            if (live.spaceName !== spaceName) continue;
            this.live.delete(key);
            this.remember(spaceName, live.personId, live.turnId, live.text);
            this.draft(spaceName, live.personId, { turnId: live.turnId, state: 'lost', text: live.text, reason: 'path' });
        }
        this.talking.delete(spaceName);
        for (const call of people) {
            const key = callKey(spaceName, call.participantId);
            this.calls.delete(key);
            this.joined.delete(key);
            this.lost.set(key, { spaceName, personId: call.participantId });
            this.game.sendDisconnect(spaceName, call.participantId);
            this.tell(spaceName, call.participantId, 'paused');
        }
        if (inRoom) this.tellEveryone(spaceName, 'paused');
        this.log(`voice: ${spaceName} reconnects with the bot's new voice settings`);
        this.restore(spaceName);
    }

    setMode(spaceName: string, mode: VoiceMode, personId?: string): boolean {
        const bubble = this.bubbles.get(spaceName);
        return !!bubble && this.post({ type: 'mode.set', sessionId: bubble.sessionId, mode, participantId: personId });
    }

    /** The bot leaves or is switched off: every connection ends. */
    shutdown(): void {
        for (const call of [...this.calls.values()]) this.game.sendDisconnect(call.spaceName, call.participantId);
        for (const bubble of this.bubbles.values()) this.endSession(bubble.sessionId);
        this.calls.clear();
        this.bubbles.clear();
        this.opening.clear();
        this.rooms.clear();
        this.invitations.clear();
        this.roster.clear();
        this.lost.clear();
        this.spoken.clear();
        this.live.clear();
        this.joined.clear();
        this.talking.clear();
        this.lastSpeechAt.clear();
        this.modes.clear();
        this.told.clear();
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
