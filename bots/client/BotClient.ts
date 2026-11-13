/**
 * BotClient - Headless WebSocket client for WorkAdventure bots
 * 
 * This client connects to WorkAdventure using the same protocol as browser clients,
 * allowing bots to fully participate in the game world.
 */

import WebSocket from 'ws';
import { activeMatrixConfig, botMatrixId } from '../matrix/MatrixConfig';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
    ClientToServerMessage,
    ServerToClientMessage,
    UserMovesMessage,
    PositionMessage_Direction,
    JoinSpaceRequestMessage,
    LeaveSpaceRequestMessage,
    FilterType,
    UpdateSpaceUserMessage,
    SpaceUser,
    apiVersionHash,
    FollowRequestMessage,
    FollowAbortMessage,
    PrivateSpaceEvent,
    AvailabilityStatus,
    SetPlayerDetailsMessage,
} from '@workadventure/messages';
import type { PositionInterface, ViewportInterface } from '../../play/src/front/Connection/ConnexionModels';
import { BotState } from './BotState';
import type { BaseBehavior } from '../behaviors/BaseBehavior';
import { BotPathfindingManager } from '../utils/BotPathfindingManager';
import { PathSmoother } from '../utils/PathSmoother';
import { movementLogger } from '../utils/MovementLogger';
import { adminApiService, type BotConfiguration } from '../server/AdminApiService';
import { CANNOT_CHECK_CHAT_LINE, type BotAccessGate, type BotAccessVerdict } from '../server/BotAccessGate';
import { FileParser } from '../services/FileParser';
import type { ChatUpload, SentMedia } from '../services/ChatFiles';
import { extractChatLinks } from '../utils/chatLinks';
import { resolve4, resolve6 } from 'dns/promises';
import * as Sentry from '@sentry/node';
import { VoiceCalls } from '../voice/VoiceCalls';
import { WorkerLink } from '../voice/VoiceLink';
import { VOICE_BOT_TAG } from '../voice/VoiceBotTag';
import { MeetingPresence, type MeetingArea } from '../voice/MeetingAreas';
import { voiceOrbitSettings, voiceReplyLimits, voiceWorkerSettings } from '../voice/settings';
import { BotVoiceSettings } from '../voice/VoiceSettings';
import { BotSpeech } from '../voice/BotSpeech';
import { OrbitTurnGate, pausedLine } from '../voice/VoiceAllowance';
import { ListeningBudget } from '../voice/VoiceListening';
import { sharedNoteHearing } from '../voice/NoteHearingWiring';
import { tidyTranscript } from '../voice/NoteHearing';
import { pausedAtCapacityEvent } from '../voice/VoiceLoad';
import { captureServerEvent } from '../ai/PostHogClient';
import { BotAttention, followUpSeconds } from './BotAttention';
import { SpaceAudience } from './SpaceAudience';
import type { Heard } from '../memory/Heard';
import { isBotSpaceUser, type BotAsksPort } from '../mcp/NearbyAsks';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { audioFileNameFor } from '../utils/audioFileName';
import { isGreetingReply } from './GreetingReply';
import { ReplyReaders } from './ReplyReaders';

// Get the secret key from environment - must match pusher's SECRET_KEY
const SECRET_KEY = process.env.SECRET_KEY || 'default-secret-key';

export interface BotConfig {
    botId: string;
    name: string;
    roomUrl: string;
    pusherUrl: string;
    /**
     * Optional public URL used for the game WebSocket. Defaults to pusherUrl when not set, which lets
     * deployments keep the socket on a different host than the pusher (e.g. off a CDN proxy).
     */
    wsUrl?: string;
    position: PositionInterface;
    viewport: ViewportInterface;
    characterTextureIds: string[];
    companionTextureId?: string;
    token?: string;
    uploaderUrl?: string;
}

/** Uploads remembered for matching a sent file with the tool that made it. */
const MAX_UPLOADED_FROM = 500;
/** How many people's chat addresses a bot keeps at once: more than are ever in a world with it. */
const MAX_CHAT_IDS = 2000;
/** The space everyone in the world is in. */
const WORLD_SPACE = 'allWorldUser';

export class BotClient {
    // Static set of all bot user IDs - shared across all bot instances
    private static botUserIds: Set<number> = new Set();
    /** Max URLs extracted from a single chat message (bounds downstream classification/sniffing). */
    private static readonly MAX_CHAT_URLS = 10;
    
    private ws: WebSocket | null = null;
    private state: BotState;
    private behavior: BaseBehavior | null = null;
    /** Where each uploaded file came from, so a sent file is matched with the tool that made it. */
    private uploadedFrom = new Map<string, string>();
    /** Links to files already kept in storage (a file sent again, #1508): sent as they are, never uploaded again. */
    private storedLinks = new Set<string>();
    /** Asks Orbit whether someone may chat with this bot, before their words reach the AI. Null: nobody is asked. */
    private accessGate: BotAccessGate | null = null;
    /** When each person was told that the bot's owner limits who can chat with it: once per visit (see mayChat). */
    private readonly toldNoChat = new Map<number, number>();
    /** How long a first message waits for the game to say who sent it, and how often it looks again (see mayChat) */
    private static readonly PERSON_WAIT_MS = 3000;
    private static readonly PERSON_RETRY_MS = 100;
    /** How many times each chat message has been put off for that */
    private chatIdentityTries = new WeakMap<object, number>();
    /** A person who stays this long without leaving the room hears the line again. */
    private static readonly TOLD_NO_CHAT_FOR_MS = 10 * 60 * 1000;
    private userId: number | null = null;
    private connected: boolean = false;
    /**
     * Set once the server confirms the join (roomJoinedMessage). The socket opens before that: the back is still
     * joining the room, and any message it gets meanwhile makes it drop the connection ("The first message sent
     * MUST be of type JoinRoomMessage"), so nothing is sent until then.
     */
    private joined: boolean = false;
    /** What the bot tried to send before the join finished, in order (only the latest position), sent once joined. */
    private pendingMessages: ClientToServerMessage[] = [];
    private static readonly MAX_PENDING_MESSAGES = 100;
    private spaces: Map<string, SpaceUser['spaceUserId']> = new Map();
    /** Everyone else in each space the bot is in, people, guests and bots alike (#1993): who would read a reply there. */
    private readonly audience = new SpaceAudience();
    /** Who each reply is delivered to: one written for someone alone with the bot reaches nobody who walks up meanwhile (#1993). */
    private readonly readers = new ReplyReaders();
    /**
     * By player: their chat address, as the game's server vouches for it (a browser cannot claim someone else's). It is
     * where the one copy of an answer only they saw is kept, in their direct messages with this bot (#1993).
     */
    private readonly chatIds = new Map<number, string>();
    /** Audio connections with people, for a voice bot only (see isVoiceBot). Null for every other bot. */
    private voice: VoiceCalls | null = null;
    /** What a voice bot says out loud of the replies it writes (see voice/BotSpeech.ts). Null for every other bot. */
    private speech: BotSpeech | null = null;
    /** Which meeting room the bot stands in, for a voice bot only (see voice/MeetingAreas.ts). */
    private meeting: MeetingPresence | null = null;
    private meetingAreas: { areas: MeetingArea[]; roomUrl: string } = { areas: [], roomUrl: '' };
    private players: Map<number, PlayerInfo> = new Map();
    /** Cards in nearby chat and voice (#1658). Set by the bot manager; without it a bubble never gets a card. */
    private asks: BotAsksPort | undefined;
    // Conversation bubbles the bot can see: groupId -> user ids in that bubble
    private bubbles: Map<number, number[]> = new Map();
    private queryId: number = 0;
    private pendingQueries: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
    private lastSentDirection: PositionMessage_Direction = PositionMessage_Direction.DOWN;
    private lastSentMoving: boolean = false;
    private lastSentPosition: PositionInterface | null = null;
    private lastSentTime: number = 0;
    private readonly POSITION_UPDATE_THROTTLE = 200; // Match WorkAdventure's 200ms update interval
    private readonly POSITION_UPDATE_THRESHOLD = 5; // Only send if moved >5 pixels

    // Pathfinding support
    private pathfindingManager?: BotPathfindingManager;
    private currentPath: PositionInterface[] = [];
    private pathIndex: number = 0;
    private isFollowingPath: boolean = false;
    
    // Advanced movement system
    private pathSmoother: PathSmoother = new PathSmoother();
    private lastPathRecalcTime: number = 0;
    private lastPathEndTime: number = 0; // Track when path ended to prevent immediate recalculation
    private readonly PATH_RECALC_COOLDOWN = 500; // Minimum 500ms between recalculations
    private readonly PATH_END_COOLDOWN = 1000; // Minimum 1 second before creating new path after one ends/cancels
    // Bumped by every path request and every cancel, so a path computed for a superseded or
    // cancelled request is dropped instead of being followed
    private pathRequestId = 0;
    private stuckDetectionTime: number = 0;
    private lastPosition: PositionInterface | null = null;
    private readonly STUCK_THRESHOLD = 10; // Pixels - increased to account for slow movement
    private readonly STUCK_TIME = 4000; // 4 seconds - give bots more time to start moving
    private debugFrameCount: number = 0; // For debug logging
    
    // Full bot configuration (stored at spawn to avoid HTTP requests)
    private fullConfig: BotConfiguration | null = null;

    // Callback invoked when WebSocket unexpectedly disconnects (not during initial connection)
    public onDisconnect?: () => void;

    /**
     * Who the bot listens to when others are in the bubble (#1220): the person who says its name, who summoned it, or
     * who it answered a moment ago. With one person it listens to them as always.
     */
    private readonly attention: BotAttention;

    constructor(private config: BotConfig) {
        this.state = new BotState(config.position);
        this.attention = new BotAttention(
            config.name,
            followUpSeconds(),
            (userId) => this.behavior?.isSummonedBy?.(userId) ?? false,
            (userId) => (this.behavior?.isBusyWith?.(userId) ?? false) || (this.speech?.isSpeakingTo(userId) ?? false)
        );
    }

    /**
     * Counts someone toward the people in the bubble (#1220), unless it is this bot or another bot. Bots are told apart
     * by who they are (the bot tag or a bot uuid, as the voice relay does), not by their number: numbers repeat from
     * room to room, and a person must never be taken for a bot because of one.
     */
    private rememberPerson(spaceName: string, userId: number, user: { tags?: string[]; uuid?: string }): void {
        if (userId === this.userId || user.tags?.includes('bot') || user.uuid?.startsWith('bot-')) return;
        this.attention.personJoined(spaceName, userId);
    }

    /**
     * Who is in a meeting room. The behaviour is not told about a meeting room, but who is in it still decides whose words are
     * the bot's: with more than one person there, only what is said to the bot (its name, or inside a conversation with it) is
     * for it, as in a bubble. Without this every meeting would look like one person alone with the bot.
     */
    private rememberMeetingPerson(spaceName: string, user: { spaceUserId?: string; tags?: string[]; uuid?: string }): void {
        const userId = BotClient.playerIdOf(user.spaceUserId);
        if (userId) this.rememberPerson(spaceName, userId, user);
    }

    /** The numeric player id in a space user id ("roomID_userID"), or 0. */
    private static playerIdOf(spaceUserId: string | undefined): number {
        const at = spaceUserId?.lastIndexOf('_') ?? -1;
        const id = at === -1 ? NaN : Number.parseInt(spaceUserId!.substring(at + 1), 10);
        return Number.isNaN(id) ? 0 : id;
    }
    
    /**
     * Check if a user ID belongs to a bot
     */
    static isBot(userId: number): boolean {
        return BotClient.botUserIds.has(userId);
    }
    
    /**
     * Get all bot user IDs (for debugging)
     */
    static getBotUserIds(): number[] {
        return Array.from(BotClient.botUserIds);
    }

    /**
     * Generate a JWT token for this bot
     */
    private generateBotToken(): string {
        // Generate a unique identifier for this bot
        const botIdentifier = `bot-${this.config.botId}`;
        
        // Create a JWT token matching the AuthTokenData schema
        const tokenData = {
            identifier: botIdentifier,
            username: this.config.name,
            // A voice bot is the only kind of bot the game opens an audio connection with
            tags: this.isVoiceBot() ? ['bot', VOICE_BOT_TAG] : ['bot'],
        };
        
        return jwt.sign(tokenData, SECRET_KEY, { expiresIn: '30d' });
    }

    /**
     * Connect to WorkAdventure server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL('ws/room', this.config.wsUrl || this.config.pusherUrl);
            url.protocol = url.protocol.replace('http', 'ws');

            const params = url.searchParams;
            params.set('roomId', this.config.roomUrl);
            params.set('name', this.config.name);
            for (const textureId of this.config.characterTextureIds) {
                params.append('characterTextureIds', textureId);
            }
            params.set('x', Math.floor(this.config.position.x).toString());
            params.set('y', Math.floor(this.config.position.y).toString());
            // Viewport should be centered on bot position with large radius to see all nearby players
            const viewportRadius = 2000; // Large radius to see players even when they move around
            const botX = this.config.position.x;
            const botY = this.config.position.y;
            params.set('top', Math.floor(Math.max(0, botY - viewportRadius)).toString());
            params.set('bottom', Math.floor(botY + viewportRadius).toString());
            params.set('left', Math.floor(Math.max(0, botX - viewportRadius)).toString());
            params.set('right', Math.floor(botX + viewportRadius).toString());
            if (this.config.companionTextureId) {
                params.set('companionTextureId', this.config.companionTextureId);
            }
            // ONLINE (1). This used to send 0, which is UNCHANGED: people saw the bot as offline in the People list
            params.set('availabilityStatus', '1');
            params.set('version', apiVersionHash); // Imported from @workadventure/messages
            // With Matrix direct messages on, the bot shows its Matrix ID so people get the Message button for it.
            const matrixConfig = activeMatrixConfig();
            params.set('chatID', (matrixConfig && botMatrixId(matrixConfig.domain, this.config.botId)) || '');
            params.set('roomName', '');
            params.set('cameraState', 'false');
            params.set('microphoneState', 'false');
            params.set('screenSharingState', 'false');

            // Generate bot token for authentication
            const token = this.config.token || this.generateBotToken();
            const subProtocols = [token];

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Connecting to: ${url.toString()}`);
                console.log(`[Bot ${this.config.botId}] Using token: ${token.substring(0, 50)}...`);
            }
            this.ws = new WebSocket(url.toString(), subProtocols);
            this.ws.binaryType = 'arraybuffer';

            this.ws.on('open', () => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Connected successfully`);
                }
                this.connected = true;
                resolve();
            });

            this.ws.on('error', (error) => {
                console.error(`[Bot ${this.config.botId}] WebSocket error:`, error);
                reject(error);
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                const reasonStr = reason ? reason.toString() : 'No reason provided';
                // Always log disconnections in debug mode, or if it's an error code
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] 🔌 WebSocket closed - Code: ${code}, Reason: ${reasonStr}, wasConnected: ${this.connected}`);
                } else if (code !== 1000) {
                    // In production, only log non-normal closes
                    console.warn(`[Bot ${this.config.botId}] Disconnected - Code: ${code}, Reason: ${reasonStr}`);
                }
                // Notify on unexpected disconnect (was previously connected, not during initial handshake)
                if (this.connected) {
                    this.onDisconnect?.();
                }
                this.connected = false;
                this.stopVoice();
                this.resetJoin();
            });

            this.ws.on('message', (data: ArrayBuffer) => {
                this.handleMessage(data);
            });

            // Handle ping/pong for keepalive
            this.ws.on('ping', (data: Buffer) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.pong(data);
                }
            });
        });
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        this.stopVoice();
        // Gone from every space: who is in them is no longer known
        this.audience.reset();
        this.readers.reset();
        this.chatIds.clear();
        // Unregister this bot's userId
        if (this.userId !== null) {
            BotClient.botUserIds.delete(this.userId);
        }
        
        if (this.ws) {
            // Send proper close frame with code 1000 (normal closure)
            // This prevents code 1005 (No Status Received) when the connection closes
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Normal closure');
            } else {
                // Already closing or closed, just clean up
                this.ws = null;
            }
        }
        this.connected = false;
    }
    
    /**
     * Check if a player ID is another bot (instance method for convenience)
     */
    isOtherBot(playerId: number): boolean {
        // It's another bot if it's in the bot set AND it's not ourselves
        return playerId !== this.userId && BotClient.isBot(playerId);
    }

    /**
     * The behavior running this bot, if any
     */
    getBehavior(): BaseBehavior | null {
        return this.behavior ?? null;
    }

    /** Who may chat with this bot nearby is decided by Orbit; the bot server wires the gate that asks it. */
    setAccessGate(gate: BotAccessGate | null): void {
        this.accessGate = gate;
    }

    /**
     * Whether what this person just said may reach the bot's AI: Chat nearby, as Orbit answers it for them. Everything
     * a chat leads to (leading, files, media) is part of it, so this runs before any of it starts. A person who is
     * refused hears the owner's line once per visit (until they leave the room, or ten minutes pass) and their words
     * go no further; when Orbit cannot answer and the bot has no earlier answer for them, they are told so each time.
     * Never throws.
     */
    private async mayChat(spaceName: string, senderId: number, message: object): Promise<boolean> {
        // A meeting room's chat is not the bot's to answer: there the bot only takes part in the audio
        if (this.isMeetingSpace(spaceName)) return false;
        const gate = this.accessGate;
        if (!gate || !this.behavior) return true;
        // Someone's first words can arrive just before the game says who they are: asking Orbit now would take a
        // signed-in member for a guest. Their join may be right behind it in the same batch, so the message is not
        // waited for here (that would hold the join back too): it is handled again a moment later, and after a few
        // seconds the person is asked about as the guest they look like.
        if (!this.behavior.isPersonKnown(senderId)) {
            const tries = this.chatIdentityTries.get(message) ?? 0;
            if (tries * BotClient.PERSON_RETRY_MS < BotClient.PERSON_WAIT_MS) {
                this.chatIdentityTries.set(message, tries + 1);
                setTimeout(() => {
                    this.handleSubMessage(message).catch((error) => {
                        Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
                    });
                }, BotClient.PERSON_RETRY_MS);
                return false;
            }
        }
        return this.chatAllowed(gate, spaceName, senderId);
    }

    /** Orbit's answer for this person, with the owner's line said once per visit when it is a no. */
    private async chatAllowed(gate: BotAccessGate, spaceName: string, personId: number): Promise<boolean> {
        const verdict = await this.chatVerdict(gate, this.behavior!.getPersonForAccess(personId));
        if (verdict.kind === 'allowed') {
            this.toldNoChat.delete(personId);
            return true;
        }
        if (verdict.kind === 'refused') {
            const toldAt = this.toldNoChat.get(personId);
            if (toldAt !== undefined && Date.now() - toldAt < BotClient.TOLD_NO_CHAT_FOR_MS) return false;
            this.toldNoChat.set(personId, Date.now());
        }
        this.sendChatMessage(spaceName, verdict.line);
        return false;
    }

    /** Orbit's answer to "may this person chat with the bot?". A failed check never lets anyone through. */
    private async chatVerdict(
        gate: BotAccessGate,
        person: Parameters<BotAccessGate['check']>[2]
    ): Promise<BotAccessVerdict> {
        try {
            return await gate.check(this.config.botId, 'chat', person, this.config.name);
        } catch (error) {
            // The gate does not throw; if that ever changes, a failed check must not let a chat through
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
            return { allowed: false, kind: 'cannot_check', line: CANNOT_CHECK_CHAT_LINE };
        }
    }

    /**
     * Whether the bot may greet this person with its AI: the same answer as for chatting with it nearby, asked before
     * anything is generated. A person who is refused hears the owner's line once per visit (shared with mayChat, so a
     * greeting and a message do not both say it) and gets no greeting. When Orbit cannot answer and nothing is
     * remembered there is no greeting; their first words get the "can't check" line. A greeting is free for the person and text
     * only (see GreetingReply), so a person who may chat is greeted each time they come, whatever replies they have left. Never throws.
     */
    async mayGreet(spaceName: string, personId: number): Promise<boolean> {
        const gate = this.accessGate;
        if (!gate || !this.behavior) return true;
        const verdict = await this.chatVerdict(gate, this.behavior.getPersonForAccess(personId));
        // A greeting is free for the person (it is never counted against their replies), so it is not held back by them
        if (verdict.kind === 'allowed') return true;
        if (verdict.kind === 'refused') {
            const toldAt = this.toldNoChat.get(personId);
            if (toldAt === undefined || Date.now() - toldAt >= BotClient.TOLD_NO_CHAT_FOR_MS) {
                this.toldNoChat.set(personId, Date.now());
                this.sendChatMessage(spaceName, verdict.line);
            }
        }
        return false;
    }

    /**
     * Set behavior for this bot
     */
    setBehavior(behavior: BaseBehavior): void {
        // A bot that stays put can be set to face a direction (the editor's "Default facing direction")
        const facing = behavior.getConfiguredFacing();
        if (this.behavior && this.behavior.constructor !== behavior.constructor) {
            // Switching to another kind of behavior (e.g. from the bot editor). The old behavior may have
            // left the bot mid-walk: idle never moves, so it never calls stop(), and players would keep seeing
            // it walking in place. Drop the old path and stand still, facing down (or the way it is set to
            // face), before the new one starts.
            // A config change rebuilds the same kind of behavior; that one keeps walking where it was going.
            // End any leading too: the old behavior's followers would otherwise keep following a bot that stopped
            this.cancelPathfinding(true);
            this.state.setDirection(facing ?? PositionMessage_Direction.DOWN);
            this.sendStoppedPosition();
        } else if (facing !== null) {
            if (!this.behavior) {
                // First spawn: the first update loop tick tells players where the bot stands and which way it faces
                this.state.setDirection(facing);
            } else if (
                !this.isFollowingPath &&
                !this.state.isMoving() &&
                this.state.getDirection() !== facing &&
                this.getNearbyPlayers(behavior.LOOK_AWAY_RADIUS).length === 0
            ) {
                // A config change rebuilt the behavior: turn right away, unless the bot is mid-walk or someone is
                // in sight (it may be looking at or talking to them; it turns back once they've gone)
                this.state.setDirection(facing);
                this.sendStoppedPosition();
            }
        }
        if (this.behavior) {
            // Whoever is around stays known, whether the config changed or the kind of behavior did
            behavior.carryPeopleFrom(this.behavior);
            if (this.behavior.constructor === behavior.constructor) behavior.carryLookFrom(this.behavior);
        }
        this.behavior = behavior;
        behavior.setBot(this);
        // Who the bot has just answered can go on without its name for a while (#1220)
        behavior.onAnswerFinished = (userId, spaceName) => this.attention.answered(spaceName, userId);
    }

    /**
     * Stop moving and tell players right away, recording what was sent so the update loop
     * doesn't follow up with a stale "moving" update for the same spot.
     */
    private sendStoppedPosition(): void {
        this.state.setMoving(false);
        const position = this.state.getPosition();
        const direction = this.state.getDirection();
        this.sendPosition(position, direction, false);
        this.config.position = { ...position };
        this.lastSentPosition = { ...position };
        this.lastSentDirection = direction;
        this.lastSentMoving = false;
        this.lastSentTime = Date.now();
    }

    /**
     * Update bot (called every frame/tick)
     */
    update(deltaTime: number): void {
        if (!this.connected || !this.behavior) {
            return;
        }

        // CRITICAL: Call behavior.update FIRST (like original bots branch)
        // The behavior checks nearbyPlayers.size and calls stop() if needed
        // Bots should "ghost through" idle players (nearbyPlayers.size === 0)
        this.behavior.update(deltaTime);
        // Keep looking at people standing nearby, and turn back once they leave (even by leaving the room)
        this.behavior.lookAtPassersBy();

        // If bot is summoned, always allow movement (override normal stopping logic)
        const isSummoned = (this.behavior as any)?.isSummoned || false;

        // Update path following if active (this handles movement)
        // CRITICAL: Only do this if bot is actually moving (not stopped)
        // If stop() was called, isMoving() will be false - respect that!
        // Ghost mode: bot continues moving even if players are nearby
        // BUT: For patrol bots, default to responding unless explicitly disabled
        const behaviorType = (this.behavior as any)?.config?.type;
        const respondToPlayers = (this.behavior as any)?.config?.respondToPlayers;
        // Default to true for patrol bots unless explicitly set to false
        const shouldRespond = behaviorType === 'patrol' && respondToPlayers !== false;
        
        // Check if bot is in a conversation space (not just nearby players)
        // This allows ghost mode: continue moving if players are idle nearby
        const isInSpace = (this.behavior as any)?.currentSpaceName || (this.behavior as any)?.engagedWithUsers?.size > 0;
        
        if (this.isFollowingPath) {
            const isMoving = this.state.isMoving();
            
            // If summoned, always allow movement (don't stop for spaces)
            if (isSummoned) {
                if (isMoving) {
                    this.updatePathFollowing(deltaTime);
                } else {
                    // Summoned but not moving - ensure we start moving
                    this.state.setMoving(true);
                    this.updatePathFollowing(deltaTime);
                }
            } else if (shouldRespond && isInSpace) {
                // For patrol bots that should respond, only stop if in a conversation space
                // Don't stop just because players are nearby (ghost mode for idle players)
                // BUT: Don't stop if bot is leading - it needs to continue to destination
                const isLeading = this.behavior && (this.behavior as any).isLeading;
                if (!isLeading) {
                    if (isMoving) {
                        // Bot should be stopped but is still moving - force stop
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] 🛑 Patrol bot in space - stopping and canceling pathfinding`);
                        }
                        this.stop();
                        this.cancelPathfinding();
                    } else {
                        // Already stopped - just cancel pathfinding
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] 🛑 Patrol bot in space and stopped - canceling pathfinding`);
                        }
                        this.cancelPathfinding();
                    }
                } else {
                    // Bot is leading - allow movement to continue
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] ✅ Patrol bot in space but leading - allowing movement to continue`);
                    }
                    if (isMoving) {
                        this.updatePathFollowing(deltaTime);
                    }
                }
            } else if (isMoving) {
                this.updatePathFollowing(deltaTime);
            } else {
                // Path following is active but bot is stopped - cancel pathfinding
                // BUT: If bot is leading, don't cancel - let it continue to target
                const isLeading = this.behavior && (this.behavior as any).isLeading;
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🔍 Path following active but bot stopped - isLeading=${isLeading}, behavior=${!!this.behavior}`);
                }
                if (!isLeading) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🛑 Path following active but bot stopped - canceling pathfinding`);
                }
                this.cancelPathfinding();
                } else {
                    // Bot is leading but stopped - keep path active and re-enable movement
                    // This handles cases where stop() was called temporarily but we should continue
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] ⚠️ Path following active but bot stopped while leading - re-enabling movement`);
                    }
                    // Re-enable movement to continue following the path
                    this.state.setMoving(true);
                    // Continue with path following
                    this.updatePathFollowing(deltaTime);
                }
            }
        }

        // Update position/direction if changed (with throttling)
        const newPosition = this.state.getPosition();
        const newDirection = this.state.getDirection();
        const newMoving = this.state.isMoving();
        const now = Date.now();
        if (this.joined) this.meeting?.update(newPosition);
        
        // Calculate position change distance
        const positionChanged = this.lastSentPosition 
            ? Math.sqrt(
                Math.pow(newPosition.x - this.lastSentPosition.x, 2) + 
                Math.pow(newPosition.y - this.lastSentPosition.y, 2)
              ) > this.POSITION_UPDATE_THRESHOLD
            : true; // Always send first update
        
        const directionChanged = this.lastSentDirection !== newDirection;
        const movingChanged = this.lastSentMoving !== newMoving;
        const timeSinceLastUpdate = now - this.lastSentTime;
        
        // Send update if:
        // - Position changed significantly (>5 pixels)
        // - Direction changed
        // - Moving state changed
        // - Enough time has passed (throttle to 200ms)
        if ((positionChanged || directionChanged || movingChanged) && 
            timeSinceLastUpdate >= this.POSITION_UPDATE_THROTTLE) {
            this.sendPosition(newPosition, newDirection, newMoving);
            this.config.position = newPosition;
            this.lastSentPosition = { ...newPosition };
            this.lastSentDirection = newDirection;
            this.lastSentMoving = newMoving;
            this.lastSentTime = now;
        }
    }

    /**
     * Move bot to position
     */
    moveTo(x: number, y: number, direction: PositionMessage_Direction = PositionMessage_Direction.DOWN): void {
        // If bot is summoned or leading, always allow movement (override normal blocking logic)
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // CRITICAL: For patrol bots, only block movement if in a conversation space
        // This allows ghost mode: continue moving if players are idle nearby
        if (this.behavior && !isSummoned && !isLeading) {
            const behaviorType = (this.behavior as any)?.config?.type;
            const respondToPlayers = (this.behavior as any)?.config?.respondToPlayers;
            
            // Check if bot is in a conversation space (not just nearby players)
            // This allows ghost mode: continue moving if players are idle nearby
            const isInSpace = (this.behavior as any)?.currentSpaceName || (this.behavior as any)?.engagedWithUsers?.size > 0;
            
            // For patrol bots: only block movement if in a conversation space
            // Don't block just because players are nearby (ghost mode for idle players)
            if (behaviorType === 'patrol' && isInSpace && respondToPlayers !== false) {
                // Patrol bot is in a conversation space - don't move
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] 🛑 moveTo() BLOCKED - patrol bot is in space (respondToPlayers=${respondToPlayers}, isInSpace=${isInSpace})`);
                }
                return;
            }
        }
        
        const wasMoving = this.state.isMoving();
        this.state.setPosition({ x, y });
        this.state.setDirection(direction);
        this.state.setMoving(true);
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📍 moveTo() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, pos=(${Math.round(x)}, ${Math.round(y)})${isSummoned ? ' (SUMMONED)' : ''}`);
        }
    }

    /**
     * Stop moving
     */
    stop(): void {
        const wasMoving = this.state.isMoving();
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // Only log in development to avoid spam in production
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            const nearbyPlayers = this.getNearbyPlayers(100);
            if (nearbyPlayers.length > 0 && !isLeading) {
                console.warn(`[Bot ${this.config.botId}] ⚠️ Stopping with ${nearbyPlayers.length} players nearby`);
            }
        }
        if (wasMoving) {
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'stop',
                position: this.state.getPosition(),
            });
        }
        this.state.setMoving(false);
        
        // If bot was leading and we're stopping, abort the follow
        // BUT: Don't end leading if bot is summoned (summoning is not leading)
        // This handles cases where stop() is called directly (not through cancelPathfinding)
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        if (isLeading && this.isFollowingPath && !isSummoned) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 STOP() called while leading, canceling pathfinding and aborting follow`);
            }
            this.cancelPathfinding(true); // End leading when explicitly stopped
        }
        
        // Only log in development
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 STOP() called - wasMoving=${wasMoving}, now isMoving=${this.state.isMoving()}, isFollowingPath=${this.isFollowingPath}, isLeading=${isLeading}`);
        }
    }

    /**
     * Smooth direction changes to avoid instant 180-degree turns
     */
    private smoothDirectionChange(
        current: PositionMessage_Direction,
        target: PositionMessage_Direction
    ): PositionMessage_Direction {
        // If same direction, return immediately
        if (current === target) {
            return target;
        }

        // Check if it's a 180-degree turn (opposite directions)
        const isOpposite = 
            (current === PositionMessage_Direction.UP && target === PositionMessage_Direction.DOWN) ||
            (current === PositionMessage_Direction.DOWN && target === PositionMessage_Direction.UP) ||
            (current === PositionMessage_Direction.LEFT && target === PositionMessage_Direction.RIGHT) ||
            (current === PositionMessage_Direction.RIGHT && target === PositionMessage_Direction.LEFT);

        if (isOpposite) {
            // For 180-degree turns, allow immediate change (velocity controller handles smooth deceleration)
            return target;
        }

        // For other direction changes, allow immediate change
        // The velocity controller's acceleration will make it smooth
        return target;
    }
    
    /**
     * Stop immediately and send position update (for when engaged with players)
     */
    stopAndUpdate(): void {
        const isLeading = (this.behavior as any)?.isLeading || false;
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        
        // If bot was leading, abort the follow when stopping
        // BUT: Don't end leading if bot is summoned (summoning is not leading)
        if (isLeading && this.isFollowingPath && !isSummoned) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 stopAndUpdate() called while leading, canceling pathfinding and aborting follow`);
            }
            this.cancelPathfinding(true); // End leading when explicitly stopped
        }
        
        this.state.setMoving(false);
        const position = this.state.getPosition();
        const direction = this.state.getDirection();
        this.sendPosition(position, direction, false);
        this.config.position = position;
        this.lastSentDirection = direction;
        this.lastSentMoving = false;
    }

    /**
     * Initialize pathfinding with collision grid
     */
    initializePathfinding(collisionGrid: number[][], tileDimensions: { width: number; height: number }): void {
        this.pathfindingManager = new BotPathfindingManager(collisionGrid, tileDimensions);
        // Using simple movement matching original speed calculation
    }

    /**
     * Check if pathfinding is available
     */
    hasPathfinding(): boolean {
        return this.pathfindingManager !== undefined;
    }

    /**
     * Check if a position is walkable (no obstacles)
     */
    isWalkable(position: PositionInterface): boolean {
        if (!this.pathfindingManager) {
            return true; // Can't check without pathfinding, assume walkable
        }
        return this.pathfindingManager.isWalkable(position);
    }

    /**
     * Check if bot is currently following a path
     */
    getIsFollowingPath(): boolean {
        return this.isFollowingPath;
    }

    private lastPathTarget: { x: number; y: number } | null = null;
    private readonly PATH_RECALC_THRESHOLD = 200; // Only recalculate if target moved >200 pixels (reduced recalculations to prevent glitching)

    /**
     * Move to position using pathfinding
     * Returns true if pathfinding was used, false if fallback to direct movement
     */
    async moveToWithPathfinding(x: number, y: number): Promise<boolean> {
        if (!this.pathfindingManager) {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: No pathfindingManager`);
            return false;
        }

        const now = Date.now();
        
        // CRITICAL: If bot is summoned or leading, bypass ALL cooldown checks to allow immediate pathfinding
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        const isReturning = (this.behavior as any)?.isReturning || false;
        const bypassCooldowns = isSummoned || isLeading || isReturning; // Allow immediate pathfinding when summoned, leading, or returning
        const bypassCloseCheck = isSummoned || isLeading; // Also bypass close target check when summoned or leading

        // Cooldown check - don't recalculate too frequently
        // BUT: Skip this check if bot is summoned (needs immediate response)
        if (!bypassCooldowns && now - this.lastPathRecalcTime < this.PATH_RECALC_COOLDOWN && this.isFollowingPath) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Cooldown active (${now - this.lastPathRecalcTime}ms < ${this.PATH_RECALC_COOLDOWN}ms), keeping current path`);
            }
            return true; // Keep following current path
        }
        
        // Don't create new path too soon after previous path ended/canceled (prevents glitching)
        // BUT: Skip this check if bot is summoned (needs immediate response)
        if (!bypassCooldowns && !this.isFollowingPath && this.lastPathEndTime > 0) {
            const timeSincePathEnd = now - this.lastPathEndTime;
            if (timeSincePathEnd < this.PATH_END_COOLDOWN) {
                // Too soon after path ended, skip pathfinding - let behavior use direct movement
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Path end cooldown active (${timeSincePathEnd}ms < ${this.PATH_END_COOLDOWN}ms), skipping pathfinding`);
                }
                return false;
            }
        }

        // Don't recalculate if we're already following a path to a similar target
        // BUT: If summoned, always recalculate to new target (even if similar)
        if (!isSummoned && this.isFollowingPath && this.lastPathTarget) {
            const targetDx = x - this.lastPathTarget.x;
            const targetDy = y - this.lastPathTarget.y;
            const targetDistance = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
            
            if (targetDistance < this.PATH_RECALC_THRESHOLD) {
                // Target hasn't moved much, keep following current path
                return true;
            }
        }

        const botPos = this.state.getPosition();
        
        // Check if we're already close to the target
        const dx = x - botPos.x;
        const dy = y - botPos.y;
        const distanceToTarget = Math.sqrt(dx * dx + dy * dy);
        
        // For very close targets (< 50px), skip pathfinding to avoid tiny paths that cause glitching
        // BUT: If summoned or leading, always use pathfinding even for close targets (player might have moved or we need to lead)
        if (!bypassCloseCheck && distanceToTarget < 50) {
            // Already close enough, no need for pathfinding - use direct movement instead
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ⏸️ moveToWithPathfinding: Target too close (${distanceToTarget.toFixed(1)}px < 50px), skipping pathfinding`);
            }
            return false;
        }
        
        // If summoned or leading and target is close, log but still use pathfinding
        if (bypassCloseCheck && distanceToTarget < 50) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🎯 moveToWithPathfinding: Target close (${distanceToTarget.toFixed(1)}px) but ${isSummoned ? 'summoned' : 'leading'} - using pathfinding anyway`);
        }
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] 🔍 moveToWithPathfinding: Finding path from (${Math.round(botPos.x)}, ${Math.round(botPos.y)}) to (${Math.round(x)}, ${Math.round(y)})...`);
        }
        const requestId = ++this.pathRequestId;
        const rawPath = await this.pathfindingManager.findPath(botPos, { x, y }, true);
        if (requestId !== this.pathRequestId) {
            // Cancelled or superseded while the path was being computed: don't follow a stale path
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] ⏹️ moveToWithPathfinding: request superseded or cancelled, dropping path`);
            }
            return false;
        }
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] 🔍 moveToWithPathfinding: Pathfinding returned ${rawPath.length} waypoints`);
        }

        if (rawPath.length === 0) {
            // No path found, fall back to direct movement
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: No path found from pathfinding algorithm`);
            }
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'path_fail',
                position: botPos,
                targetPosition: { x, y },
                metadata: { reason: 'no_path_found' },
            });
            return false;
        }
        
        // Log path start
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.config.botId,
            eventType: 'path_start',
            position: botPos,
            targetPosition: { x, y },
            pathLength: rawPath.length,
            metadata: { rawPathLength: rawPath.length },
        });

        // Only update path if we have a valid path with at least 2 waypoints
        if (rawPath.length < 2) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: Path too short (${rawPath.length} waypoints < 2)`);
            }
            return false;
        }

        // CRITICAL: Validate path doesn't go through obstacles before using it
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] ✅ moveToWithPathfinding: Validating path with ${rawPath.length} waypoints...`);
        }
        if (!this.validatePath(rawPath)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.warn(`[Bot ${this.config.botId}] ❌ moveToWithPathfinding: Path validation failed - path goes through obstacles! Rejecting path.`);
            }
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'path_fail',
                position: botPos,
                targetPosition: { x, y },
                metadata: { reason: 'path_validation_failed', pathLength: rawPath.length },
            });
            return false;
        }
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
        console.log(`[Bot ${this.config.botId}] ✅ moveToWithPathfinding: Path validation passed`);
        }
        
        // Use raw path from pathfinding - it already avoids obstacles
        // Path smoothing was causing issues with obstacle avoidance
        // The pathfinding algorithm (EasyStar) already provides smooth paths
        if (rawPath.length >= 2) {
            this.currentPath = rawPath;
        } else {
            return false;
        }

        this.pathIndex = 0;
        this.isFollowingPath = true;
        this.lastPathTarget = { x, y };
        this.lastPathRecalcTime = now;
        
        // CRITICAL: Set bot to moving state when pathfinding starts
        // Otherwise updatePathFollowing() will immediately stop because isMoving() is false
        this.state.setMoving(true);
        
        return true;
    }

    /**
     * Cancel current pathfinding
     * @param endLeading If true, also end the leading state and abort follow (default: false to allow path recalculation while leading)
     */
    cancelPathfinding(endLeading: boolean = false): void {
        // If bot was leading and we're explicitly ending leading, abort the follow
        if (endLeading && this.behavior && (this.behavior as any).isLeading) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Path canceled while leading, aborting follow and ending leading`);
            }
            this.sendFollowAbort();
            if ((this.behavior as any).endLeading) {
                (this.behavior as any).endLeading();
            }
        } else if (this.behavior && (this.behavior as any).isLeading) {
            // Bot is leading but we're just canceling pathfinding (not ending leading)
            // This allows path recalculation while leading
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🔄 Path canceled while leading (keeping leading state for recalculation)`);
            }
        }
        
        this.pathRequestId++;
        this.isFollowingPath = false;
        this.currentPath = [];
        this.pathIndex = 0;
        this.lastPathTarget = null;
        this.lastPathEndTime = Date.now(); // Track when path was canceled
        this.stuckDetectionTime = 0; // Reset stuck detection
        this.lastPosition = null; // Reset position tracking
    }

    /**
     * Validate that a path doesn't go through obstacles
     * Checks intermediate points along path segments
     */
    private validatePath(path: PositionInterface[]): boolean {
        if (!this.pathfindingManager || path.length < 2) {
            return true; // Can't validate without pathfinding manager
        }

        // Check each segment of the path
        for (let i = 0; i < path.length - 1; i++) {
            const start = path[i];
            const end = path[i + 1];
            
            // Sample points along the segment to check for collisions
            const segmentLength = Math.sqrt(
                Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
            );
            // Sample every 16 pixels for tighter validation (was 32)
            const samples = Math.max(3, Math.floor(segmentLength / 16));
            
            for (let j = 0; j <= samples; j++) {
                const t = j / samples;
                const samplePoint = {
                    x: start.x + (end.x - start.x) * t,
                    y: start.y + (end.y - start.y) * t,
                };
                
                // Check if this point is walkable
                if (!this.pathfindingManager.isWalkable(samplePoint)) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.warn(`[Bot ${this.config.botId}] ⚠️ Path validation failed: segment ${i}->${i+1} goes through obstacle at (${samplePoint.x.toFixed(1)}, ${samplePoint.y.toFixed(1)})`);
                    }
                    return false; // Path goes through obstacle
                }
            }
        }
        
        return true; // Path is valid
    }

    /**
     * Update path following (call in update loop)
     * Uses simple movement matching original speed calculation
     */
    updatePathFollowing(deltaTime: number): void {
        if (!this.isFollowingPath || this.currentPath.length === 0) {
            return;
        }

        // CRITICAL: Ghost mode - bot should continue moving even if in a space
        // Only stop when actually interacted with (chat message), not just proximity
        // Don't check for spaces here - let the bot continue moving

        // CRITICAL: Check if bot should be stopped (either by stop() call)
        // If stop() was called, isMoving() will be false - respect that!
        // BUT: If bot is leading, don't cancel the path - let it continue to target
        if (!this.state.isMoving()) {
            const isLeading = this.behavior && (this.behavior as any).isLeading;
            if (!isLeading) {
            // Bot was stopped (likely by behavior.update() detecting we're in a space)
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Path following stopped - bot is not moving`);
            }
            this.cancelPathfinding();
            return;
            } else {
                // Bot is leading but stopped - keep path active and re-enable movement
                // This handles cases where stop() was called temporarily but we should continue
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] ⚠️ Path following: bot stopped while leading - re-enabling movement`);
                }
                // Re-enable movement to continue following the path
                this.state.setMoving(true);
                // Don't return - continue with path following
            }
        }

        const botPos = this.state.getPosition();
        
        // Stuck detection - DISABLED for now to allow movement to work
        // We'll re-enable with better logic once movement is confirmed working
        // Just initialize lastPosition if needed
        if (!this.lastPosition) {
            this.lastPosition = { ...botPos };
        }

        // Make sure we have a valid path index
        if (this.pathIndex >= this.currentPath.length) {
            this.isFollowingPath = false;
            this.currentPath = [];
            this.pathIndex = 0;
            this.lastPathTarget = null;
            this.lastPathEndTime = Date.now(); // Track when path ended
            
            // If bot is summoned and path ended, check if we're close to target
            // If close enough, stop and let bubble initiate (not ghost)
            const isSummoned = (this.behavior as any)?.isSummoned || false;
            if (isSummoned && this.lastPathTarget) {
                const botPos = this.state.getPosition();
                const dx = this.lastPathTarget.x - botPos.x;
                const dy = this.lastPathTarget.y - botPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If we're close to target (< 80px), stop and wait for bubble
                if (distance < 80) {
                    console.log(`[Bot ${this.config.botId}] ✅ Reached summon target (${distance.toFixed(1)}px away), stopping to initiate bubble`);
                    this.stop();
                    return;
                }
            }
            
            // GHOST MODE: Don't stop when path ends - let behavior handle it
            // Only stop if behavior explicitly wants to pause (and no players nearby)
            // this.stop(); // REMOVED - let behavior decide
            return;
        }

        // Get current waypoint
        const currentWaypoint = this.currentPath[this.pathIndex];
        
        // Calculate distance to current waypoint
        const dx = currentWaypoint.x - botPos.x;
        const dy = currentWaypoint.y - botPos.y;
        const distanceToWaypoint = Math.sqrt(dx * dx + dy * dy);

        // Waypoint advancement - strict threshold to prevent premature advancement
        // Based on debug data: 35+ waypoints were advanced at 29px (threshold violation)
        const waypointThreshold = 20; // Advance when within 20px
        
        // CRITICAL: Only advance if we're actually within threshold
        // Debug data showed 35+ waypoints advanced at 29px - the "closer to next" logic was the cause
        // For complex paths with tight spaces, we must strictly adhere to the threshold
        // Pathfinding already provides waypoints at appropriate distances
        const shouldAdvance = distanceToWaypoint < waypointThreshold;
        
        // REMOVED: "closer to next" fallback logic - it was causing premature advancement
        // If we overshoot slightly, the next frame will catch it when we're actually within threshold
        
        if (shouldAdvance) {
            const oldIndex = this.pathIndex;
            this.pathIndex++;
            
            // Log waypoint advancement with warning if distance exceeds threshold
            if (distanceToWaypoint > waypointThreshold) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] ⚠️ Waypoint advanced at ${distanceToWaypoint.toFixed(1)}px (threshold: ${waypointThreshold}px)`);
                }
            }
            
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.config.botId,
                eventType: 'waypoint_advance',
                position: botPos,
                targetPosition: currentWaypoint,
                waypointIndex: this.pathIndex,
                pathLength: this.currentPath.length,
                distanceToTarget: distanceToWaypoint,
                metadata: {
                    threshold: waypointThreshold,
                    exceeded: distanceToWaypoint > waypointThreshold,
                },
            });
            
            if (this.pathIndex >= this.currentPath.length) {
                // All path waypoints reached - check if we're close to final target
                if (this.lastPathTarget) {
                    const finalDx = this.lastPathTarget.x - botPos.x;
                    const finalDy = this.lastPathTarget.y - botPos.y;
                    const finalDistance = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
                    
                    // If summoned, get closer (15px threshold), otherwise use 30px
                    const isSummoned = (this.behavior as any)?.isSummoned || false;
                    const isReturning = (this.behavior as any)?.isReturning || false;
                    const stopThreshold = isSummoned ? 15 : 30;
                    
                    // If we're close enough to target, consider path complete
                    // Otherwise, continue with direct movement to reach exact position
                    if (finalDistance < stopThreshold) {
                        movementLogger.log({
                            timestamp: Date.now(),
                            botId: this.config.botId,
                            eventType: 'path_end',
                            position: botPos,
                            targetPosition: { x: this.lastPathTarget.x, y: this.lastPathTarget.y },
                        });
                        
                        this.isFollowingPath = false;
                        this.currentPath = [];
                        this.pathIndex = 0;
                        this.lastPathTarget = null;
                        this.lastPathEndTime = Date.now();
                        
                        // If returning and reached original/start position, clear returning flag
                        if (isReturning) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached return position (${finalDistance.toFixed(1)}px away), clearing returning flag`);
                            if (this.behavior) {
                                (this.behavior as any).isReturning = false;
                                // Clear originalPosition (for summon return) or leadingStartPosition (for leading return)
                                if ((this.behavior as any).originalPosition) {
                                    (this.behavior as any).originalPosition = null;
                                }
                                if ((this.behavior as any).leadingStartPosition) {
                                    (this.behavior as any).leadingStartPosition = null;
                                }
                            }
                            this.stop();
                            return;
                        }
                        
                        // If summoned and close to target, stop to initiate bubble (not ghost)
                        if (isSummoned) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached summon target (${finalDistance.toFixed(1)}px away), stopping to initiate bubble`);
                            this.stop();
                        }
                        
                        // If leading and close to target, stop leading and send follow abort
                        if (this.behavior && (this.behavior as any).isLeading) {
                            console.log(`[Bot ${this.config.botId}] ✅ Reached destination while leading (${finalDistance.toFixed(1)}px away), stopping leading`);
                            this.cancelPathfinding(true); // End leading when destination is reached
                            this.stop();
                        }
                        
                        // GHOST MODE: Don't stop when path ends - let behavior handle it
                        // Behavior will check for nearby players and decide whether to pause
                        // this.stop(); // REMOVED - let behavior decide
                        return;
                    } else {
                        // Not close enough - continue with direct movement to exact target
                        // Add final target as last waypoint to continue movement
                        this.currentPath.push({ x: this.lastPathTarget.x, y: this.lastPathTarget.y });
                        // Continue path following with final target
                    }
                } else {
                    // No target - path complete
                    movementLogger.log({
                        timestamp: Date.now(),
                        botId: this.config.botId,
                        eventType: 'path_end',
                        position: botPos,
                    });
                    
                    // Check if bot was leading - if so, stop leading and send follow abort
                    if (this.behavior && (this.behavior as any).isLeading) {
                        console.log(`[Bot ${this.config.botId}] ✅ Reached destination while leading, stopping leading`);
                        this.cancelPathfinding(true); // End leading when destination is reached
                    }
                    
                    this.isFollowingPath = false;
                    this.currentPath = [];
                    this.pathIndex = 0;
                    this.lastPathTarget = null;
                    this.lastPathEndTime = Date.now();
                    // GHOST MODE: Don't stop when path ends - let behavior handle it
                    // Behavior will check for nearby players and decide whether to pause
                    // this.stop(); // REMOVED - let behavior decide
                    return;
                }
            }
        }

        // Get target waypoint (may have advanced)
        if (this.pathIndex >= this.currentPath.length) {
            return; // Path complete, will be handled above
        }

        const targetWaypoint = this.currentPath[this.pathIndex];
        
        // Calculate direction to target
        const targetDx = targetWaypoint.x - botPos.x;
        const targetDy = targetWaypoint.y - botPos.y;
        const distanceToTarget = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

        // Get speed from config
        const behaviorSpeed = (this.behavior as any)?.config?.speed || 
                            (this.behavior as any)?.config?.wanderSpeed || 50;
        
        // Check if bot is summoned, returning, or leading - apply different speed multipliers
        const isSummoned = (this.behavior as any)?.isSummoned || false;
        const isReturning = (this.behavior as any)?.isReturning || false;
        const isLeading = (this.behavior as any)?.isLeading || false;
        
        // CRITICAL FIX: Config has speed=100, but original bots branch used speed=50
        // Original: 50 * 0.016 = 0.8 pixels per frame
        // Current: 100 * 0.016 = 1.6 pixels per frame (2x faster!)
        // Solution: If speed > 75, halve it to match original behavior
        let effectiveSpeed = behaviorSpeed > 75 ? behaviorSpeed * 0.5 : behaviorSpeed;
        
        // Apply speed multipliers: summon = 3x, leading = 3x, return = 2x
        if (isSummoned) {
            effectiveSpeed = effectiveSpeed * 3; // Fast when summoned
        } else if (isLeading) {
            effectiveSpeed = effectiveSpeed * 5; // Fast when leading people (same as summon)
        } else if (isReturning) {
            effectiveSpeed = effectiveSpeed * 2; // Medium speed when returning
        }
        
        const angle = Math.atan2(targetDy, targetDx);
        const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
        const cappedDistance = Math.min(moveDistance, distanceToTarget);
        
        const newX = botPos.x + Math.cos(angle) * cappedDistance;
        const newY = botPos.y + Math.sin(angle) * cappedDistance;
        
        // CRITICAL: Validate new position is walkable before moving
        // Also check intermediate points for long movements to prevent cutting through walls
        const newPos = { x: newX, y: newY };
        if (this.pathfindingManager) {
            // Check the destination
            if (!this.pathfindingManager.isWalkable(newPos)) {
                // New position is in a wall - don't move, cancel pathfinding
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] 🚫 BLOCKED movement to non-walkable tile: (${newX.toFixed(1)}, ${newY.toFixed(1)}) from (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)})`);
                }
                movementLogger.log({
                    timestamp: Date.now(),
                    botId: this.config.botId,
                    eventType: 'path_fail',
                    position: botPos,
                    targetPosition: targetWaypoint,
                    metadata: { reason: 'target_tile_not_walkable', attemptedPosition: newPos },
                });
                this.cancelPathfinding();
                return;
            }
            
            // For longer movements, check intermediate points to prevent cutting through walls
            if (cappedDistance > 10) {
                const steps = Math.ceil(cappedDistance / 10); // Check every 10 pixels
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const intermediateX = botPos.x + (newX - botPos.x) * t;
                    const intermediateY = botPos.y + (newY - botPos.y) * t;
                    const intermediatePos = { x: intermediateX, y: intermediateY };
                    
                    if (!this.pathfindingManager.isWalkable(intermediatePos)) {
                        // Intermediate point is in a wall - reduce movement distance
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[Bot ${this.config.botId}] ⚠️ Intermediate point blocked at (${intermediateX.toFixed(1)}, ${intermediateY.toFixed(1)}) - reducing movement`);
                        }
                        // Move only to the last safe position
                        const safeT = (i - 1) / steps;
                        const safeX = botPos.x + (newX - botPos.x) * safeT;
                        const safeY = botPos.y + (newY - botPos.y) * safeT;
                        // Determine direction for safe movement
                        const safeDx = safeX - botPos.x;
                        const safeDy = safeY - botPos.y;
                        let safeDirection = PositionMessage_Direction.DOWN;
                        if (Math.abs(safeDx) > Math.abs(safeDy)) {
                            safeDirection = safeDx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                        } else {
                            safeDirection = safeDy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                        }
                        this.moveTo(safeX, safeY, safeDirection);
                        return;
                    }
                }
            }
        }
        
        // Log movement for analysis
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.config.botId,
            eventType: 'move',
            position: { x: newX, y: newY },
            targetPosition: targetWaypoint,
            speed: behaviorSpeed,
            effectiveSpeed: effectiveSpeed,
            moveDistance: cappedDistance,
            deltaTime: deltaTime,
            waypointIndex: this.pathIndex,
            pathLength: this.currentPath.length,
            distanceToTarget: distanceToTarget,
            metadata: {
                angle: angle.toFixed(2),
                capped: cappedDistance < moveDistance,
                isWalkable: this.pathfindingManager ? this.pathfindingManager.isWalkable(newPos) : true,
            },
        });

        // CRITICAL: Check again if bot should be stopped before moving
        // This prevents moveTo() from overriding stop() calls from behavior
        if (!this.state.isMoving()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Movement blocked - bot is stopped`);
            }
            this.cancelPathfinding();
            return;
        }

        // Determine direction based on movement
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(targetDx) > Math.abs(targetDy)) {
            direction = targetDx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = targetDy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        // CRITICAL: Check one more time before calling moveTo() - behavior might have called stop() in the same frame
        if (!this.state.isMoving()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 🛑 Movement blocked at moveTo() call - bot is stopped`);
            }
            this.cancelPathfinding();
            return;
        }

        this.moveTo(newX, newY, direction);
    }

    /**
     * Get all spaces the bot is currently in
     */
    getCurrentSpaces(): string[] {
        return Array.from(this.spaces.keys());
    }

    /**
     * Check if the bot is currently registered in the given space.
     * Used by flushPendingMedia to distinguish "not in space" (transient —
     * bot left or hasn't joined yet) from real send failures.
     */
    isInSpace(spaceName: string): boolean {
        return this.spaces.has(spaceName);
    }

    /**
     * Leave a conversation space
     */
    async leaveSpace(spaceName: string): Promise<void> {
        if (!this.spaces.has(spaceName)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Not in space ${spaceName}, nothing to leave`);
            }
            return;
        }

        try {
            this.voice?.spaceLeft(spaceName);
            this.speech?.spaceLeft(spaceName);
            this.attention.spaceLeft(spaceName);
            this.audience.spaceLeft(spaceName);
            this.readers.spaceLeft(spaceName);
            const wasMeeting = this.isMeetingSpace(spaceName);
            await this.emitLeaveSpace(spaceName);
            this.spaces.delete(spaceName);
            this.afterSpaceLeft(spaceName, wasMeeting);
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Left space: ${spaceName}`);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space ${spaceName}:`, error);
        }
    }

    /**
     * Leave all current conversation spaces
     */
    async leaveAllSpaces(): Promise<void> {
        const spacesToLeave = Array.from(this.spaces.keys());
        for (const spaceName of spacesToLeave) {
            await this.leaveSpace(spaceName);
        }
    }

    /**
     * Send chat message to space. `only`: the one person it is for (see `toOnly`); left out, everyone in the space.
     */
    sendChatMessage(spaceName: string, message: string, only?: number): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName} (available spaces: ${Array.from(this.spaces.keys()).join(', ')})`);
            }
            return;
        }
        const to = this.toOnly(spaceName, only);
        if (!to) return;

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Sending chat message to space ${spaceName}: "${message}"`);
        }

        // Chat messages are sent via PublicEvent with spaceMessage, not updateSpaceUserMessage
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessage',
                            spaceMessage: {
                                message,
                                characterTextures: [],
                                name: this.config.name,
                                galleryUrls: [],
                                fileNames: [],
                                voiceWaveform: [],
                                ...to,
                            },
                        },
                    },
                },
            },
        });
    }

    /** Return true when `ip` is a private/reserved address (both IPv4 and IPv6). */
    private isPrivateIp(ip: string): boolean {
        // IPv4 ranges
        if (/^127\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (ip === '0.0.0.0' || ip === '::1' || /^::$/.test(ip)) return true;
        if (/^10\.\d+\.\d+\.\d+$/.test(ip)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip)) return true;
        if (/^192\.168\.\d+\.\d+$/.test(ip)) return true;
        if (/^169\.254\.\d+\.\d+$/.test(ip) && ip !== '169.254.169.254') return true;
        // AWS metadata endpoint — still private
        if (ip === '169.254.169.254') return true;
        // IPv6 unique-local / link-local
        if (/^f[cd][0-9a-f]{0,3}:/i.test(ip)) return true;
        if (/^fe[89a-b][0-9a-f]:/i.test(ip)) return true;
        // IPv6-mapped IPv4 — handle both dot-decimal and hex forms
        if (/^::ffff:/i.test(ip)) {
            const embedded = ip.replace(/^::ffff:/i, '');
            // Dot-decimal: ::ffff:127.0.0.1
            if (/^\d+\.\d+\.\d+\.\d+$/.test(embedded) && this.isPrivateIp(embedded)) return true;
            // Hex form: ::ffff:7f00:1 — parse and recurse
            const parts = embedded.split(':');
            if (parts.length === 2) {
                const hexStr = parts.map(p => p.padStart(4, '0')).join('');
                const val = parseInt(hexStr, 16);
                if (!isNaN(val)) {
                    const decoded = [
                        (val >>> 24) & 0xff,
                        (val >>> 16) & 0xff,
                        (val >>> 8) & 0xff,
                        val & 0xff,
                    ].join('.');
                    if (this.isPrivateIp(decoded)) return true;
                }
            }
        }
        return false;
    }

    /**
     * Resolve a hostname via DNS and validate none of the resolved addresses
     * are private. Returns true when all resolved IPs are external.
     * Skips DNS for literal IP addresses (already validated by isPrivateHost).
     */
    private async resolveIsExternal(hostname: string): Promise<boolean> {
        if (/^[\d.]+$/.test(hostname) || (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) || hostname.startsWith('[')) {
            return true;
        }
        let safe = true;
        let resolved = false;
        try {
            const v4 = await resolve4(hostname);
            resolved = true;
            if (v4.some(ip => this.isPrivateIp(ip))) safe = false;
        } catch { /* no A record — not a problem */ }
        try {
            const v6 = await resolve6(hostname);
            resolved = true;
            if (v6.some(ip => this.isPrivateIp(ip))) safe = false;
        } catch { /* no AAAA record — not a problem */ }
        // Fail-closed: if neither A nor AAAA resolved, we can't verify safety
        return resolved ? safe : false;
    }

    /** Follow HTTP redirects with SSRF validation on each hop (max 5 hops). */
    private async fetchWithRedirectFollow(
        url: string,
        init: RequestInit & { signal: AbortSignal },
        redirectCount = 0,
    ): Promise<Response> {
        if (redirectCount > 5) {
            throw new Error(`[BotClient] Too many redirects fetching: ${url}`);
        }

        // Validate each hop's hostname
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`[BotClient] Invalid redirect URL: ${url}`);
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`[BotClient] Unsupported redirect scheme: ${parsedUrl.protocol}`);
        }
        if (this.isPrivateHost(parsedUrl.hostname)) {
            throw new Error(`[BotClient] Redirect target is a private or reserved address: ${parsedUrl.hostname}`);
        }
        // DNS-level SSRF guard: resolve hostname and verify resolved IPs are not private
        const hostnameSafe = await this.resolveIsExternal(parsedUrl.hostname);
        if (!hostnameSafe) {
            throw new Error(`[BotClient] URL hostname '${parsedUrl.hostname}' resolves to a private/internal IP address`);
        }

        const response = await fetch(url, { ...init, redirect: 'manual' });

        // 3xx — manually follow with SSRF check on the redirect target
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
                throw new Error(`[BotClient] Redirect ${response.status} with no Location header: ${url}`);
            }
            // Resolve relative redirects against the current URL
            const redirectTarget = new URL(location, url).href;
            return this.fetchWithRedirectFollow(redirectTarget, init, redirectCount + 1);
        }

        return response;
    }

    /** Fetch a URL's body as a buffer with SSRF-safe redirect following, timeout, and size cap. */
    private async fetchMediaBuffer(url: string, mimeType?: string): Promise<{ buffer: Buffer; contentType: string }> {
        // Validate URL before fetching — SSRF prevention
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            throw new Error(`[BotClient] Invalid URL: ${url}`);
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(`[BotClient] Unsupported URL scheme: ${parsedUrl.protocol}`);
        }
        const hostname = parsedUrl.hostname;
        if (this.isPrivateHost(hostname)) {
            throw new Error(`[BotClient] URL points to a private or reserved address: ${hostname}`);
        }

        // Fetch with timeout, size limit, and SSRF-safe redirect following
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s timeout

        const MAX_SIZE = 25 * 1024 * 1024;

        try {
            const response = await this.fetchWithRedirectFollow(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`[BotClient] Failed to fetch media from ${url}: ${response.status} ${response.statusText}`);
            }

            // Stream the response body with a size cap (25 MB)
            // Timeout remains active throughout streaming to prevent hung connections
            const contentType = mimeType || response.headers.get('content-type') || 'application/octet-stream';
            const chunks: Buffer[] = [];
            let totalSize = 0;

            if (!response.body) {
                throw new Error('[BotClient] Response has no body stream');
            }
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    totalSize += value.length;
                    if (totalSize > MAX_SIZE) {
                        reader.cancel();
                        throw new Error(`[BotClient] Media exceeds maximum size of ${MAX_SIZE / 1024 / 1024} MB`);
                    }
                    chunks.push(Buffer.from(value));
                }
            } finally {
                reader.cancel().catch(() => {}); // Release the stream reader
            }
            const buffer = Buffer.concat(chunks);

            return { buffer, contentType };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Upload a file from a URL to the uploader service using bot service auth.
     * Fetches the content from the provided URL (e.g. MCP tool output) and POSTs it
     * to the uploader's /upload-file endpoint with the BOT_SERVICE_TOKEN header.
     * Returns the CDN location and inferred media type.
     */
    /**
     * Asked once the file is uploaded and before it goes into the space (#1993): a file for everyone here is not sent
     * when someone has walked up while it was uploaded. The error says so (`_heldBack`), and nothing was sent.
     */
    private static heldBack(mayGo: (() => boolean) | undefined): void {
        if (!mayGo || mayGo()) return;
        const err = new Error('Someone joined before the file could be sent');
        (err as any)._heldBack = true;
        throw err;
    }

    private async uploadMedia(url: string, mimeType?: string): Promise<{ location: string; mediaType: string; mimeType: string }> {
        const uploaderUrl = this.config.uploaderUrl || process.env.UPLOADER_URL;
        if (!uploaderUrl) {
            throw new Error('[BotClient] UPLOADER_URL not configured — cannot upload media');
        }

        // If the URL is already on our uploader/CDN, no need to re-upload
        if (url.startsWith(uploaderUrl) || url.includes('/upload-file/') || this.storedLinks.has(url)) {
            // Infer media type from URL or mimeType
            const mediaType = this.inferMediaTypeFromUrl(url, mimeType);
            return { location: url, mediaType, mimeType: mimeType || 'application/octet-stream' };
        }
        // Fetch media content with SSRF-safe redirect following, timeout, and size limit
        const { buffer, contentType } = await this.fetchMediaBuffer(url, mimeType);

        // Extract filename from URL for the upload
        const urlPath = new URL(url).pathname;
        const filename = urlPath.split('/').pop() || `bot-media-${Date.now()}`;

        // Build multipart form data
        const formData = new FormData();
        const blob = new Blob([buffer], { type: contentType });
        formData.append('file', blob, filename);

        // Upload to uploader with bot service token
        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), 30_000);
        let uploadResponse: Response | undefined;
        try {
            uploadResponse = await fetch(`${uploaderUrl}/upload-file`, {
                method: 'POST',
                headers: {
                    'x-bot-service-token': process.env.BOT_SERVICE_TOKEN || '',
                },
                body: formData,
                signal: uploadController.signal,
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                throw new Error(`[BotClient] Upload failed: ${uploadResponse.status} — ${errorText}`);
            }
        } finally {
            clearTimeout(uploadTimeoutId);
        }

        const result = await uploadResponse!.json();
        if (!Array.isArray(result) || result.length === 0) {
            throw new Error('[BotClient] Upload response missing file data');
        }

        const uploadedFile = result[0];
        const location = uploadedFile.location || uploadedFile.url;
        const mediaType = this.inferMediaTypeFromUrl(location, contentType);
        this.uploadedFrom.delete(location);
        this.uploadedFrom.set(location, url);
        if (this.uploadedFrom.size > MAX_UPLOADED_FROM) this.uploadedFrom.delete(this.uploadedFrom.keys().next().value!);

        return { location, mediaType, mimeType: contentType };
    }

    /**
     * Infer media type from URL extension or mime type
     */
    private inferMediaTypeFromUrl(url: string, mimeType?: string): string {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
        const mime = mimeType?.toLowerCase() || '';

        // Check mime type first
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('text/') || mime === 'application/pdf') return 'file';

        // Fallback to extension
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
        const videoExts = ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv'];

        if (imageExts.includes(ext)) return 'image';
        if (audioExts.includes(ext)) return 'audio';
        if (videoExts.includes(ext)) return 'video';
        return 'file';
    }

    /**
     * Send an image to a space.
     * Uploads the image from the provided URL to the CDN (if needed) and sends it to the chat.
     */
    async sendImage(spaceName: string, url: string, alt?: string, asker?: number, mimeType?: string, only?: number, mayGo?: () => boolean): Promise<string> {
        const mimeHint = mimeType || this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            BotClient.heldBack(mayGo);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType, alt || '', undefined, asker, only)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send image`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent image to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send a file to a space.
     */
    async sendFile(spaceName: string, url: string, filename?: string, asker?: number, mimeType?: string, only?: number, mayGo?: () => boolean): Promise<string> {
        const mimeHint = mimeType || this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            BotClient.heldBack(mayGo);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType, '', filename, asker, only)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send file`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent file to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send audio to a space.
     */
    async sendAudio(spaceName: string, url: string, asker?: number, mimeType?: string, only?: number, mayGo?: () => boolean): Promise<string> {
        const mimeHint = mimeType || this.inferMimeFromExt(url);
        try {
            const { location, mimeType: uploadedType } = await this.uploadMedia(url, mimeHint);
            BotClient.heldBack(mayGo);
            // A song with no usable name would show as a plain player: give it one that ends as audio.
            // When nothing says which audio type it is (a stored link is a bare id, with no type), mp3 is the common one,
            // and the message still goes out as audio, not as a file the card would not play.
            const audioType = [mimeHint, uploadedType].find((one) => one?.startsWith('audio/')) ?? 'audio/mpeg';
            const fileName = audioFileNameFor(location, audioType);
            const sentType = uploadedType.startsWith('audio/') ? uploadedType : audioType;
            if (!this.sendMediaMessage(spaceName, location, 'audio', sentType, undefined, fileName, asker, only)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send audio`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = 'audio';
                (err as any)._mimeType = sentType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent audio to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Send video to a space.
     */
    async sendVideo(spaceName: string, url: string, asker?: number, mimeType?: string, only?: number, mayGo?: () => boolean): Promise<string> {
        const mimeHint = mimeType || this.inferMimeFromExt(url);
        try {
            const { location, mediaType, mimeType } = await this.uploadMedia(url, mimeHint);
            BotClient.heldBack(mayGo);
            if (!this.sendMediaMessage(spaceName, location, mediaType, mimeType, undefined, undefined, asker, only)) {
                const err = new Error(`Bot is not in space ${spaceName} — cannot send video`);
                (err as any)._cdnUrl = location;
                (err as any)._mediaType = mediaType;
                (err as any)._mimeType = mimeType;
                throw err;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Sent video to ${spaceName}: ${location}`);
            }
            return location;
        } catch (err: any) {
            if (!err._mimeType) {
                (err as any)._mimeType = mimeHint;
            }
            throw err;
        }
    }

    /**
     * Upload a media file to the CDN and return the CDN URL.
     * Public wrapper around the private uploadMedia method.
     * Useful for callers that need the CDN URL before deciding to send.
     */
    async uploadToCDN(url: string, mimeType?: string): Promise<{ location: string; mediaType: string; mimeType: string }> {
        return this.uploadMedia(url, mimeType);
    }

    /**
     * Check if a hostname resolves to a private or link-local address.
     * Prevents SSRF attacks by rejecting internal network targets.
     */
    private isPrivateHost(hostname: string): boolean {
        // Strip brackets from IPv6 literals (Node.js URL normalizes [::ffff:127.0.0.1] to [::ffff:7f00:1])
        const raw = hostname.replace(/^\[|\]$/g, '');

        // Localhost / loopback (entire 127.0.0.0/8 range)
        if (raw === 'localhost' || raw === '::1' || /^127\.\d+\.\d+\.\d+$/.test(raw)) {
            return true;
        }
        // IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) — SSRF bypass vector
        if (/^::ffff:/i.test(raw)) {
            const embedded = raw.replace(/^::ffff:/i, '');
            // Dot-decimal form (unusual with brackets stripped, but handle it)
            if (/^\d+\.\d+\.\d+\.\d+$/.test(embedded)) {
                if (this.isPrivateIp(embedded)) return true;
            } else {
                // Hex form: "7f00:1", "a00:1", "c0a8:101" — normalize to dotted decimal
                const parts = embedded.split(':');
                if (parts.length === 2) {
                    const hexStr = parts.map(p => p.padStart(4, '0')).join('');
                    const val = parseInt(hexStr, 16);
                    if (!isNaN(val)) {
                        const ip = [
                            (val >>> 24) & 0xff,
                            (val >>> 16) & 0xff,
                            (val >>> 8) & 0xff,
                            val & 0xff,
                        ].join('.');
                        if (this.isPrivateIp(ip)) return true;
                    }
                }
            }
        }
        // IPv4 private ranges
        if (/^10\./.test(raw)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(raw)) return true;
        if (/^192\.168\./.test(raw)) return true;
        // IPv4 link-local
        if (/^169\.254\./.test(raw)) return true;
        // Reserved / zero address
        if (raw === '0.0.0.0') return true;
        // IPv6 documentation / private / unique-local
        if (raw === '::') return true;
        if (/^fc00:/i.test(raw) || /^fd00:/i.test(raw)) return true;
        if (/^fe80:/i.test(raw)) return true;
        // host.docker.internal or similar Docker/Kubernetes internal names
        if (raw.endsWith('.internal') || raw === 'host.docker.internal') return true;
        // Cloud metadata services
        if (raw === 'metadata.google.internal' || raw === 'metadata.internal') return true;
        // mDNS / link-local hostnames
        if (raw.endsWith('.local')) return true;
        return false;
    }

    /**
     * Send a media message to a space via publicEvent spaceMessage. `only`: the one person it is for (see `toOnly`);
     * left out, everyone in the space.
     */
    public sendMediaMessage(spaceName: string, url: string, mediaType: string, mimeType: string, caption?: string, fileName?: string, asker?: number, only?: number): boolean {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName} — cannot send media`);
            }
            return false;
        }
        const to = this.toOnly(spaceName, only);
        if (!to) return false;

        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessage',
                            spaceMessage: {
                                message: caption || '',
                                characterTextures: [],
                                name: this.config.name,
                                url,
                                mediaType,
                                mimeType,
                                galleryUrls: [],
                                fileNames: [],
                                fileName,
                                voiceWaveform: [],
                                ...to,
                            },
                        },
                    },
                },
            },
        });
        this.mediaSent(spaceName, asker, [{ url, mediaType, mimeType, caption, fileName }], only !== undefined);
        return true;
    }

    /**
     * Send a gallery of images as a single message with a grid layout.
     * The first image goes in the `url` field (backwards compatible), and
     * additional images go in `galleryUrls`. The caption appears below the grid.
     */
    public sendMediaGallery(spaceName: string, urls: string[], caption?: string, fileNames?: string[], asker?: number, only?: number): boolean {
        if (urls.length === 0) return false;

        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName} — cannot send gallery`);
            }
            return false;
        }
        const to = this.toOnly(spaceName, only);
        if (!to) return false;

        const firstUrl = urls[0];
        const extraUrls = urls.slice(1);
        const mimeType = this.inferMimeFromExt(firstUrl);

        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessage',
                            spaceMessage: {
                                message: caption || '',
                                characterTextures: [],
                                name: this.config.name,
                                url: firstUrl,
                                mediaType: 'gallery',
                                mimeType,
                                galleryUrls: extraUrls,
                                fileNames: fileNames ?? [],
                                voiceWaveform: [],
                                ...to,
                            },
                        },
                    },
                },
            },
        });
        this.mediaSent(spaceName, asker, urls.map((one, i) => ({ url: one, mediaType: 'image', mimeType: this.inferMimeFromExt(one), caption: i === 0 ? caption : undefined, fileName: fileNames?.[i] })), only !== undefined);
        return true;
    }

    /** This link is to a file already in storage (a file sent again): it is sent as it is, not uploaded again. */
    markStored(url: string): void {
        this.storedLinks.delete(url);
        this.storedLinks.add(url);
        if (this.storedLinks.size > MAX_UPLOADED_FROM) this.storedLinks.delete(this.storedLinks.values().next().value!);
    }

    /** The link a file was uploaded from, for a link the uploader gave back. */
    uploadedFromOf(location: string): string | undefined {
        return this.uploadedFrom.get(location);
    }

    /**
     * Files the bot sent, for the list of files (#1508): theirs, for `asker`, the person whose reply sent them. Every
     * reply passes its own, so two replies at once never swap files; a send with no asker (not from a reply) isn't kept.
     * `toThemAlone`: nobody else was sent them (#1993), whoever is in the space.
     */
    private mediaSent(spaceName: string, asker: number | undefined, items: SentMedia[], toThemAlone = false): void {
        if (asker === undefined || !this.behavior) return;
        try {
            if (toThemAlone) this.behavior.onBotMediaSent(spaceName, asker, items, true);
            else this.behavior.onBotMediaSent(spaceName, asker, items);
        } catch (error) {
            // Keeping the file never stops it being sent
            console.warn(`[Bot ${this.config.botId}] Could not keep a sent file:`, (error as Error)?.message ?? error);
        }
    }

    /**
     * Infer mime type from file extension
     */
    private inferMimeFromExt(url: string): string {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
            mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
            mp4: 'video/mp4', webm: 'video/webm',
            pdf: 'application/pdf', txt: 'text/plain',
            json: 'application/json', csv: 'text/csv',
        };
        return mimeMap[ext] || '';
    }

    /**
     * Send a streaming response chunk to the space.
     * Used by bot behaviors to stream AI-generated text token-by-token
     * to the frontend instead of waiting for the complete response.
     */
    sendStreamMessage(
        spaceName: string,
        responseId: string,
        token: string,
        isFinal: boolean,
        finalContent?: string,
        isError?: boolean,
        errorMessage?: string,
        reset?: boolean,
        steps?: string,
        mood?: string
    ): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Sending stream chunk to space ${spaceName}: token="${token.substring(0, 30)}", isFinal=${isFinal}`);
        }

        // A reply written for someone alone with the bot is delivered to them and nobody else, to its last piece (#1993)
        const onlyFor = this.readerOf(spaceName, responseId);
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceStreamMessage',
                            spaceStreamMessage: {
                                responseId,
                                token,
                                isFinal,
                                finalContent,
                                isError: isError ?? false,
                                errorMessage,
                                reset: reset ?? false,
                                ...(steps !== undefined ? { steps } : {}),
                                ...(mood ? { mood } : {}),
                                ...(onlyFor ? { onlyFor } : {}),
                            },
                        },
                    },
                },
            },
        });
        // A greeting the bot made on its own is never a voice reply: it stays in the chat, so it is not spoken and never counts as a
        // spoken reply
        if (isGreetingReply(responseId)) return;
        // A voice bot says what it has written once it is final: after the chat has it, and never the steps line or an error.
        // A reply written for one person is said to that person and nobody else, also when someone else is here by now:
        // the voice is handed their name with it, and does not say it at all when it cannot keep it to them (#1993)
        if (this.speech && steps === undefined && !isError) {
            if (isFinal) {
                if (finalContent) {
                    if (onlyFor === undefined) this.speech.final(spaceName, responseId, finalContent);
                    else this.speech.final(spaceName, responseId, finalContent, onlyFor);
                }
            } else if (token) {
                this.speech.begin(responseId);
            }
        }
    }

    /**
     * A reply for this person starts (#1993). `alone` is the answer the reply was built on: with nobody else in the space,
     * every piece of it goes to that person and nobody else, also when someone walks up while it is being written.
     */
    replyStarts(spaceName: string, playerId: number, alone: boolean): void {
        this.readers.starts(spaceName, playerId, alone);
    }

    /** Whether this person is alone with the bot in this space right now. Not when the bot cannot tell. */
    private aloneWith(spaceName: string, playerId: number | undefined): boolean {
        return playerId !== undefined && this.othersWith(spaceName, playerId)?.length === 0;
    }

    /** The one reader a reply is delivered to (their space user id), or undefined when it is for everyone in the space. */
    private readerOf(spaceName: string, responseId: string): string | undefined {
        return this.readers.readerOf(spaceName, responseId, {
            alone: (playerId) => this.aloneWith(spaceName, playerId),
            spaceUserIdOf: (playerId) => this.spaceUserIdOf(spaceName, playerId),
        });
    }

    /** A person's id in this space, from the bot's own id there. Undefined when the bot is not in the space. */
    private spaceUserIdOf(spaceName: string, playerId: number): string | undefined {
        const mine = this.spaces.get(spaceName);
        const cut = mine?.lastIndexOf('_') ?? -1;
        return mine && cut >= 0 ? `${mine.slice(0, cut)}_${playerId}` : undefined;
    }

    /**
     * Who a message the bot sends with a reply is delivered to (#1993): a picture, a file, a card. `only` is the person
     * the reply was written for when they were alone with the bot as it started. The game server then delivers the
     * message to them and nobody else, so someone who walks up meanwhile is not sent it. Left out: everyone in the
     * space. Null when that person cannot be named, and the message is then not sent at all.
     */
    private toOnly(spaceName: string, only: number | undefined): { onlyFor?: string } | null {
        if (only === undefined) return {};
        const onlyFor = this.spaceUserIdOf(spaceName, only);
        return onlyFor ? { onlyFor } : null;
    }

    private onlyForOf(spaceName: string, responseId: string): { onlyFor?: string } {
        const onlyFor = this.readerOf(spaceName, responseId);
        return onlyFor ? { onlyFor } : {};
    }

    /**
     * Someone came into the space (#1993). A reply written for one person alone goes on being said to that person: the
     * voice sends it to them and nobody else, so the newcomer is sent none of it. Only a voice that speaks to the whole
     * bubble (a worker from before) stops what it is saying of such a reply, because the newcomer would hear it. The
     * reply stays whole in that person's chat, with a line that says why the voice stopped.
     */
    private hushRepliesForOne(spaceName: string, newcomer: string | undefined): void {
        if (!this.speech || !newcomer || newcomer === this.spaces.get(spaceName)) return;
        if (this.voice?.keepsToOne(spaceName) !== false) return;
        for (const responseId of this.readers.forOneReaderIn(spaceName)) {
            if (this.readerOf(spaceName, responseId) === newcomer) continue;
            const how = this.speech.hush(spaceName, responseId);
            if (how) this.sendKeptQuiet(spaceName, responseId, how);
        }
    }

    /**
     * Tells the one person a reply was written for that it was not said out loud (`unsaid`), or that its voice stopped
     * part-way (`stopped`), so that nobody else hears it (#1993). The reply is in their chat in full; this is the one
     * line under it. Sent to that person and nobody else, like the reply.
     */
    private sendKeptQuiet(spaceName: string, responseId: string, keptQuiet: 'unsaid' | 'stopped'): void {
        const to = this.onlyForOf(spaceName, responseId);
        if (!to.onlyFor) return;
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceStreamMessage',
                            spaceStreamMessage: { responseId, token: '', isFinal: true, isError: false, reset: false, keptQuiet, ...to },
                        },
                    },
                },
            },
        });
    }

    /** Says a voice bot's reply was cut off by someone speaking: the message in everyone's chat is marked (#1665). */
    private sendSpeechStopped(spaceName: string, responseId: string): void {
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceStreamMessage',
                            spaceStreamMessage: { responseId, token: '', isFinal: true, isError: false, reset: false, stoppedBySpeech: true, ...this.onlyForOf(spaceName, responseId) },
                        },
                    },
                },
            },
        });
    }

    /** Says a voice bot's reply began to be heard, or is over (round 8): the reply in everyone's chat shows Stop speaking meanwhile. */
    private sendSpeaking(spaceName: string, responseId: string, speaking: boolean): void {
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceStreamMessage',
                            spaceStreamMessage: { responseId, token: '', isFinal: true, isError: false, reset: false, speaking, ...this.onlyForOf(spaceName, responseId) },
                        },
                    },
                },
            },
        });
    }

    /** A tool round or a retry of this person's reply is under way: what finishes meanwhile is not spoken (see BotSpeech). */
    holdSpeech(spaceName: string, playerId: number): void {
        this.speech?.hold(spaceName, playerId);
    }

    /** This person's reply has been checked: what finishes next may be spoken. */
    releaseSpeech(spaceName: string, playerId: number): void {
        this.speech?.release(spaceName, playerId);
    }

    /**
     * Whether this bot should tell, by its own judgement, that this person is done talking with it (#1670): a voice bot
     * with other people in the bubble, and not on a summon to this person (a summon makes everything they say its own).
     */
    mayEndFollowUp(spaceName: string, playerId: number): boolean {
        return this.isVoiceBot() && this.attention.endable(spaceName, playerId);
    }

    /**
     * The bot has judged that this person is done talking with it (#1670). Only their follow-up window ends: the bot
     * stops speaking to them, they need its name again, and a private line says so. Nobody else's window is touched, and
     * nothing the bot is working on is cancelled. False when it does not apply (the caller then answers as usual).
     */
    endFollowUp(spaceName: string, playerId: number): boolean {
        if (!this.mayEndFollowUp(spaceName, playerId)) return false;
        this.attention.ended(spaceName, playerId);
        this.speech?.endFor(spaceName, playerId);
        this.sendVoiceDone(spaceName, playerId);
        return true;
    }

    /**
     * Whether a line this person said is for the bot now: after they said they are done only their name counts, and saying it brings them
     * back. A line already waiting for its turn is asked this once the stop is settled, so a call by name that came in meanwhile is kept.
     */
    isForBot(spaceName: string, playerId: number, text: string): boolean {
        return this.attention.hears(spaceName, playerId, text);
    }

    /** Tells one person, and only them, that the bot stopped listening to them without its name (#1670). */
    private sendVoiceDone(spaceName: string, playerId: number): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) return;
        const cut = spaceUserId.lastIndexOf('_');
        if (cut < 0) return;
        this.send({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName,
                    receiverUserId: `${spaceUserId.slice(0, cut)}_${playerId}`,
                    spaceEvent: {
                        event: {
                            $case: 'botVoiceDone',
                            botVoiceDone: { botId: this.config.botId, botName: this.config.name },
                        },
                    },
                },
            },
        });
    }

    /**
     * Show one person, and only them, the fixed card for a reply limit they reached (#1159). Sent as a private event
     * to that person in the bot's nearby chat; the pusher passes it on only when a bot sends it.
     */
    sendReplyLimitCard(spaceName: string, playerId: number, card: { limit: string; resetsAt: string; who: string }): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) return;
        // A space user id is "<room>_<user id>": the person's is the bot's with their own user id at the end
        const cut = spaceUserId.lastIndexOf('_');
        if (cut < 0) return;
        const receiverUserId = `${spaceUserId.slice(0, cut)}_${playerId}`;
        this.send({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName,
                    receiverUserId,
                    spaceEvent: {
                        event: {
                            $case: 'botReplyLimit',
                            botReplyLimit: { ...card, botId: this.config.botId, botName: this.config.name },
                        },
                    },
                },
            },
        });
    }

    /**
     * The card this bot needs one answer with, or a reply only one person needs, to that person and nobody else
     * (#1658). Sent as a private event; the pusher passes it on only when a bot sends it about itself. False when the
     * bot is not in that space, so nothing was sent.
     */
    sendAskEvent(spaceName: string, playerId: number, event: { kind: 'card' | 'reply'; id: string; revision: number; body: string }): boolean {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) return false;
        const cut = spaceUserId.lastIndexOf('_');
        if (cut < 0) return false;
        this.sendPrivateEvent(spaceName, `${spaceUserId.slice(0, cut)}_${playerId}`, {
            $case: 'botAsk',
            botAsk: { botId: this.config.botId, botName: this.config.name, ...event },
        });
        return true;
    }

    /**
     * One plain line everyone in the bubble reads, and hears from a voice bot (#1658): a message of its own, finished at
     * once, so a voice bot says it as it says any reply.
     */
    sayToBubble(spaceName: string, line: string): boolean {
        if (!this.spaces.has(spaceName) || !line.trim()) return false;
        const responseId = `bot-${this.config.botId}-say-${uuidv4()}`;
        this.sendStreamMessage(spaceName, responseId, line, false);
        this.sendStreamMessage(spaceName, responseId, '', true, line);
        return true;
    }

    /** Where cards in nearby chat and voice are shown, and their taps come from (#1658). */
    setAsks(asks: BotAsksPort | undefined): void {
        this.asks = asks;
    }

    /** When each person last said something out loud to this voice bot, so what reaches the AI next can be told from something typed (#1661). */
    private readonly lastSpoken = new Map<string, number>();
    /** A spoken line reaches the AI within moments; one older than this was followed by something typed. */
    private static readonly SPOKEN_FRESH_MS = 20_000;

    /** Remembers that this person just said something out loud (not typed). */
    private noteSpoken(spaceName: string, playerId: number): void {
        const key = `${spaceName}|${playerId}`;
        this.lastSpoken.delete(key);
        this.lastSpoken.set(key, Date.now());
        if (this.lastSpoken.size > 500) this.lastSpoken.delete(this.lastSpoken.keys().next().value!);
    }

    /**
     * Whether the last line from this person to reach the bot was said out loud and not typed, without using up the
     * answer `takeSpoken` gives: a typed line forgets the spoken one before it, so this is false for anything typed.
     */
    saidOutLoud(spaceName: string, playerId: number): boolean {
        const at = this.lastSpoken.get(`${spaceName}|${playerId}`);
        return at !== undefined && Date.now() - at <= BotClient.SPOKEN_FRESH_MS;
    }

    /** When the line the bot is answering for this person right now reached it (see BaseBehavior.lineHeardAt). */
    lineHeardAt(playerId: number): number | undefined {
        return this.behavior?.lineHeardAt(playerId);
    }

    /** Whether the line that just reached the AI from this person was said out loud and not typed. Asked once per line. */
    takeSpoken(spaceName: string, playerId: number): boolean {
        const key = `${spaceName}|${playerId}`;
        const at = this.lastSpoken.get(key);
        if (at === undefined) return false;
        this.lastSpoken.delete(key);
        return Date.now() - at <= BotClient.SPOKEN_FRESH_MS;
    }

    /**
     * What a person picked on a card the bot showed them, handed to the bot as what they said (#1661): the bot carries on
     * with it as it would with any message from them. Only a person in the bubble gets here, and Orbit's chat answer for
     * them is asked again, as for a message.
     */
    async answerFromCard(spaceName: string, playerId: number, text: string): Promise<boolean> {
        if (!this.behavior || !this.spaces.has(spaceName) || !this.inBubble(playerId)) return false;
        // The owner may have limited who can chat with the bot since the card was shown: a tap is held to it like a message
        if (this.isMeetingSpace(spaceName)) return false;
        if (this.accessGate && !(await this.chatAllowed(this.accessGate, spaceName, playerId))) return false;
        this.behavior.onChatMessage(spaceName, text, playerId).catch((error) => {
            console.error(`[Bot ${this.config.botId}] onChatMessage error for a card answer:`, error);
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
        return true;
    }

    /** Whether this person is in a bubble the bot sees: a card is for people in one, and nobody else. */
    inBubble(playerId: number): boolean {
        return this.getBubbleUserIds(playerId) !== undefined;
    }

    /**
     * Everyone else who is in this space with the bot and this person right now, by who they are (#1993): people, guests
     * and other bots alike, and nobody when the person is alone with the bot. Room membership only, never distance.
     * Undefined when the bot is not in the space or was told nothing about it: it cannot say who would read a reply
     * there, and the caller takes that as other people being there.
     */
    othersWith(spaceName: string, playerId: number): string[] | undefined {
        const mine = this.spaces.get(spaceName);
        if (!mine) return undefined;
        return this.audience.others(spaceName, (spaceUserId) => spaceUserId === mine || BotClient.playerIdOf(spaceUserId) === playerId);
    }

    /** Where a line said in this space right now is heard, and by whom, for what the bot remembers (#1993). */
    heardIn(spaceName: string, playerId: number): Heard | undefined {
        const others = this.othersWith(spaceName, playerId);
        return others ? { place: 'nearby', with: others } : undefined;
    }

    /**
     * Where what the bot itself just said to this person is heard (#1993). A reply that went to them alone was read by
     * nobody else, whoever has walked up while it was written, so it is remembered as said with nobody else there.
     */
    saidIn(spaceName: string, playerId: number): Heard | undefined {
        if (this.readers.wentToThemAlone(spaceName, playerId)) return this.spaces.has(spaceName) ? { place: 'nearby', with: [] } : undefined;
        return this.heardIn(spaceName, playerId);
    }

    /**
     * A tap on a card, from one person in the bubble (#1658): the event must come to this bot from a person (never a bot)
     * in a space it is in. Who they are is the game's word, never the event's.
     */
    private onAskEvent(event: PrivateEventPusherToFront): void {
        const inner = event.spaceEvent?.event;
        if (!inner || inner.$case !== 'botAskAnswer' || !this.asks) return;
        const sender = event.sender;
        const me = this.spaces.get(event.spaceName);
        if (!sender || !me || event.receiverUserId !== me || sender.spaceUserId === me || isBotSpaceUser(sender)) return;
        const playerId = BotClient.playerIdOf(sender.spaceUserId);
        if (!playerId) return;
        this.noteChatId(event.spaceName, sender, false);
        this.asks.tap(this, event.spaceName, playerId, inner.botAskAnswer);
    }

    /**
     * What the game says a person's chat address is. `joined`: they just came into this space, or were listed in it. In
     * the space the whole world is in, that is someone new under this number, so one without an address has none.
     */
    private noteChatId(spaceName: string, user: { spaceUserId?: string; chatID?: string } | undefined, joined: boolean): void {
        const playerId = BotClient.playerIdOf(user?.spaceUserId);
        if (!playerId || playerId === this.userId) return;
        const chatId = user?.chatID?.trim();
        if (chatId) {
            this.chatIds.delete(playerId);
            this.chatIds.set(playerId, chatId);
            if (this.chatIds.size > MAX_CHAT_IDS) this.chatIds.delete(this.chatIds.keys().next().value as number);
        } else if (joined && spaceName === WORLD_SPACE) {
            // A number the game gave to someone new: never the address of whoever had it before
            this.chatIds.delete(playerId);
        }
    }

    /** This person's chat address, or undefined for a guest and for someone the game has not vouched for yet. */
    chatIdOf(playerId: number): string | undefined {
        return this.chatIds.get(playerId);
    }

    /**
     * Start typing indicator in space (shows bot is typing)
     */
    startTyping(spaceName: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Starting typing indicator in space ${spaceName}`);
        }

        // Send typing indicator via PublicEvent with SpaceIsTyping
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceIsTyping',
                            spaceIsTyping: {
                                isTyping: true,
                                characterTextures: [],
                            },
                        },
                    },
                },
            },
        });
    }

    /**
     * Stop typing indicator in space
     */
    stopTyping(spaceName: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            return;
        }

        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Stopping typing indicator in space ${spaceName}`);
        }

        // Send stop typing indicator via PublicEvent with SpaceIsTyping
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceIsTyping',
                            spaceIsTyping: {
                                isTyping: false,
                                characterTextures: [],
                            },
                        },
                    },
                },
            },
        });
    }

    /**
     * Get player information
     */
    getPlayerInfo(playerId: number): PlayerInfo | undefined {
        return this.players.get(playerId);
    }

    /**
     * User ids of the conversation bubble a player is in, if the bot can see one
     */
    getBubbleUserIds(playerId: number): number[] | undefined {
        for (const userIds of this.bubbles.values()) {
            if (userIds.includes(playerId)) {
                return userIds;
            }
        }
        return undefined;
    }

    /**
     * Where this bot sees the player with this uuid, or undefined when that player is not in the bot's room (or the
     * bot has no position for them yet). Bots are never returned.
     */
    getPlayerPositionByUuid(uuid: string): PositionInterface | undefined {
        // Anybody in the room, whether or not they have come close enough to the bot to be in one of its spaces.
        const seenInRoom = [...this.players.values()].find((candidate) => candidate.uuid === uuid);
        const userId = seenInRoom?.userId ?? this.behavior?.getUserIdForUuid(uuid);
        if (userId === undefined || BotClient.isBot(userId)) {
            return undefined;
        }
        const player = this.players.get(userId);
        if (!player || (player.position.x === 0 && player.position.y === 0)) {
            return undefined;
        }
        return { x: player.position.x, y: player.position.y };
    }

    /**
     * Get all nearby players
     */
    getNearbyPlayers(radius: number): PlayerInfo[] {
        const botPos = this.state.getPosition();
        const result: PlayerInfo[] = [];

        for (const player of this.players.values()) {
            // Skip bots
            if (BotClient.isBot(player.userId)) {
                continue;
            }
            // Skip players at (0, 0) - likely invalid position data
            if (player.position.x === 0 && player.position.y === 0) {
                continue;
            }
            
            const dx = player.position.x - botPos.x;
            const dy = player.position.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= radius) {
                result.push(player);
            }
        }
        
        // Debug: log when players are found (always log for debugging)
        if (result.length > 0) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] getNearbyPlayers: found ${result.length} player(s) within ${radius}px (checked ${this.players.size} total), bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)})`);
                }
                for (const player of result) {
                    const dx = player.position.x - botPos.x;
                    const dy = player.position.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    console.log(`[Bot ${this.config.botId}]   Player ${player.userId} at (${Math.round(player.position.x)}, ${Math.round(player.position.y)}) - distance: ${Math.round(distance)}px`);
                }
            }
        }
        
        return result;
    }
    
    /**
     * Get all players in the room (for debugging)
     * @deprecated Use getAllPeople() instead
     */
    getAllPlayers(): PlayerInfo[] {
        return Array.from(this.players.values());
    }

    /**
     * Get all people on the map (includes both players and bots)
     */
    getAllPeople(): PlayerInfo[] {
        return Array.from(this.players.values());
    }

    /**
     * Who is asking, for the artifact tools: the same person Orbit's access check sees (signed in, and by which
     * identifier), and the name they go by here.
     */
    getPersonForArtifacts(playerId: number): { signedIn: boolean; identifier: string | null; name: string | null } {
        const access = this.behavior?.getPersonForAccess(playerId) ?? { signedIn: false, identifier: null };
        const name = this.players.get(playerId)?.name ?? null;
        return { signedIn: access.signedIn, identifier: access.identifier, name };
    }

    /** A recorded voice note, as the game names it: an audio file called "Voice message". */
    static isVoiceNote(spaceMessage: { mediaType?: string; fileName?: string }): boolean {
        return spaceMessage.mediaType === 'audio' && /^voice message\.[a-z0-9]{1,5}$/i.test((spaceMessage.fileName ?? '').trim());
    }

    /**
     * Whether a voice note in nearby chat is for this bot and the bot can hear it: sent to it (alone with it, as a reply to its own
     * message, or from the person it is summoned to) and its hearing is set up. When not, the note is handled as it always was.
     */
    private async noteIsForMe(
        spaceName: string,
        senderId: number,
        spaceMessage: { id?: string; url?: string; mediaType?: string; fileName?: string; replyTo?: { senderUserId?: string } }
    ): Promise<boolean> {
        if (!BotClient.isVoiceNote(spaceMessage) || !spaceMessage.url || !spaceMessage.id) return false;
        const hearing = sharedNoteHearing(adminApiService);
        if (!hearing) return false;
        const mine = this.spaces.get(spaceName);
        const repliesToMe = mine !== undefined && spaceMessage.replyTo?.senderUserId === mine;
        if (!this.attention.noteIsForBot(spaceName, senderId, repliesToMe)) return false;
        return hearing.canHear(this.config.botId);
    }

    /**
     * Hears a voice note and tells everyone who got it, so each shows "Listening…" and then the words under the note (or that it could
     * not be heard). Returns the words for the bot, '' when the person's replies are used up (the note goes on as before and the reply path shows the limit card), or 'unheard' when there are none to give: the bot then does not answer a file it
     * cannot read.
     */
    private async hearNearbyNote(
        spaceName: string,
        senderUserId: string,
        spaceMessage: { id?: string; url?: string; fileName?: string; voiceDurationMs?: number },
        sender: { userId?: string; isGuest?: boolean } = {}
    ): Promise<string> {
        const hearing = sharedNoteHearing(adminApiService);
        const id = spaceMessage.id;
        // The sender chooses the id, so a note is known by who sent it as well: the words go under that person's note only,
        // and are saved for them only
        if (!hearing || !id || !senderUserId || !spaceMessage.url) return 'unheard';
        const note = { messageId: id, senderUserId };
        const heard = await hearing.hear(
            this.config.botId,
            `${spaceName}|${senderUserId}|${id}`,
            {
                url: spaceMessage.url,
                filename: spaceMessage.fileName ?? 'Voice message',
                ...(spaceMessage.voiceDurationMs ? { seconds: spaceMessage.voiceDurationMs / 1000 } : {}),
            },
            sender,
            // "Listening…" once the note is on its way to be heard; never for a note refused before that
            () => this.sendTranscript(spaceName, note, 'listening')
        );
        // The person's replies are used up: the note is read as before, and the reply path shows the usual limit card
        if ('reason' in heard && heard.reason === 'reply-limit') return '';
        const words = 'text' in heard ? tidyTranscript(heard.text, hearing.limits.maxChars) : '';
        if (!words) {
            this.sendTranscript(spaceName, note, 'failed');
            return 'unheard';
        }
        this.sendTranscript(spaceName, note, 'heard', words);
        return `[Voice note] ${words}`;
    }

    /** What the bot heard in a note, for everyone in the space: the newest state of the note wins. */
    private sendTranscript(
        spaceName: string,
        note: { messageId: string; senderUserId: string },
        state: 'listening' | 'heard' | 'failed',
        text?: string
    ): void {
        if (!this.spaces.get(spaceName)) return;
        this.send({
            message: {
                $case: 'publicEvent',
                publicEvent: {
                    spaceName,
                    spaceEvent: {
                        event: {
                            $case: 'spaceMessageTranscript',
                            spaceMessageTranscript: { ...note, state, ...(text ? { text } : {}) },
                        },
                    },
                },
            },
        });
    }

    /**
     * The files someone uploaded with a nearby chat message (#1508), with the names they were sent with: the upload and
     * the rest of its gallery, never the links typed in the text.
     */
    static uploadsOf(
        spaceMessage: { url?: string; mediaType?: string; galleryUrls?: string[]; fileName?: string; fileNames?: string[] },
        mimeType?: string | null
    ): ChatUpload[] | undefined {
        if (!spaceMessage.url) return undefined;
        const urls = [spaceMessage.url, ...(spaceMessage.galleryUrls ?? [])];
        return urls.map((url, i) => ({
            url,
            name: spaceMessage.fileNames?.[i] || (i === 0 ? spaceMessage.fileName : undefined) || url.split('?')[0].split('/').pop() || 'file',
            // The type is known for the message's own upload; the rest of a gallery goes by its name
            mimeType: i === 0 ? mimeType ?? null : null,
            mediaType: i === 0 ? spaceMessage.mediaType ?? null : null,
        }));
    }

    /**
     * Get the room URL this bot is connected to
     */
    getRoomUrl(): string {
        return this.config.roomUrl;
    }

    /**
     * Teleport bot to a new position instantly
     */
    teleportTo(x: number, y: number): void {
        // A path from the old spot no longer applies, and a bot still marked as moving makes players'
        // clients extrapolate past the new spot (the bot overshoots where it was dropped).
        this.cancelPathfinding();
        this.state.setPosition({ x, y });
        this.sendStoppedPosition();
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Teleported to (${x}, ${y})`);
        }
    }

    /**
     * Update bot configuration (position, behavior config, etc.)
     */
    updateConfig(updates: {
        position?: { x: number; y: number };
        behaviorConfig?: Record<string, unknown>;
    }): void {
        if (updates.position) {
            this.teleportTo(updates.position.x, updates.position.y);
        }

        // Behavior config updates are handled by BotManager which creates new behavior
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] Config updated`);
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get bot ID
     */
    getBotId(): string {
        return this.config.botId;
    }

    /** The name people know this bot by */
    getName(): string {
        return this.config.name;
    }

    /**
     * A voice bot is one whose configuration says voice is on (the owner's choice, Orbit #740). Every other bot is
     * text-only and never touches the voice code.
     */
    isVoiceBot(): boolean {
        return this.fullConfig?.voiceEnabled === true;
    }

    /** Opens the bot's side of its audio connections. The socket to the voice worker is only used by this bot. */
    private startVoice(): void {
        if (!this.isVoiceBot() || this.voice) return;
        const settings = voiceWorkerSettings();
        this.voice = new VoiceCalls(
            this.config.botId,
            {
                botSpaceUserId: (spaceName) => this.spaces.get(spaceName),
                sendSignal: (spaceName, receiverUserId, signal) =>
                    this.sendPrivateEvent(spaceName, receiverUserId, { $case: 'webRtcSignal', webRtcSignal: { signal } }),
                sendDisconnect: (spaceName, receiverUserId) =>
                    this.sendPrivateEvent(spaceName, receiverUserId, {
                        $case: 'webRtcDisconnectMessage',
                        webRtcDisconnectMessage: { userId: this.spaces.get(spaceName) ?? '' },
                    }),
                sendStart: (spaceName, receiverUserId) =>
                    this.sendPrivateEvent(spaceName, receiverUserId, {
                        $case: 'webRtcStartMessage',
                        webRtcStartMessage: { userId: this.spaces.get(spaceName) ?? '', initiator: true },
                    }),
                sendDraft: (spaceName, receiverUserId, draft) =>
                    this.sendPrivateEvent(spaceName, receiverUserId, {
                        $case: 'botVoiceDraft',
                        botVoiceDraft: {
                            botId: this.config.botId,
                            botName: this.config.name,
                            turnId: draft.turnId,
                            state: draft.state,
                            text: draft.text,
                            reason: draft.reason ?? '',
                        },
                    }),
                sendStatus: (spaceName, receiverUserId, status, left, listen) =>
                    this.sendPrivateEvent(spaceName, receiverUserId, {
                        $case: 'botVoiceStatus',
                        botVoiceStatus: {
                            botId: this.config.botId,
                            botName: this.config.name,
                            state: status,
                            // How long, after answering someone, the bot goes on listening to them without its name
                            followUpSeconds: this.attention.followUpSeconds,
                            // The spoken replies this person has left, when Orbit said (#1669)
                            repliesLeft: left?.count,
                            repliesResetAt: left?.resetsAt ?? '',
                            // Whether it takes their microphone in a group, and why not (round 8)
                            listening: listen?.state ?? '',
                            listeningReason: listen?.reason ?? '',
                        },
                    }),
            },
            (handlers) => {
                const link = new WorkerLink({ url: settings.url, botId: this.config.botId, secret: settings.secret, ...handlers });
                link.start();
                return link;
            },
            (message) => console.warn(`[Bot ${this.config.botId}] ${message}`),
            // Who hears and speaks for this bot is its maker's choice in Orbit. Without Orbit (a local setup) the worker's test engine is used.
            adminApiService.isConfigured() && process.env.BOT_SERVICE_TOKEN
                ? new BotVoiceSettings(this.config.botId, adminApiService, voiceOrbitSettings(), (message) => console.warn(`[Bot ${this.config.botId}] ${message}`))
                : undefined,
            // A reply Universe AI pays for comes out of the person's allowance (#1669)
            adminApiService.isConfigured() && process.env.BOT_SERVICE_TOKEN
                ? new OrbitTurnGate(
                      this.config.botId,
                      adminApiService,
                      (playerId) => this.behavior?.getTalker(playerId) ?? null,
                      (message) => console.warn(`[Bot ${this.config.botId}] ${message}`)
                  )
                : undefined,
            // What it hears of group chatter comes out of its daily listening, set in Orbit (#1859)
            adminApiService.isConfigured() && process.env.BOT_SERVICE_TOKEN
                ? new ListeningBudget(
                      this.config.botId,
                      adminApiService,
                      () => this.voice?.listeningChanged(),
                      (message) => console.warn(`[Bot ${this.config.botId}] ${message}`)
                  )
                : undefined
        );
        // People call the bot by this name, so the hearing is told to expect it (#1864)
        this.voice.botName = this.config.name;
        // In a group, the bot takes someone's microphone only after they ask it to keep listening (round 8); the confirmed ask counts as its name
        this.voice.groupGate = true;
        this.voice.onListenGranted = (spaceName, personId) => this.attention.listenGranted(spaceName, BotClient.playerIdOf(personId));
        // Voice paused for someone (the allowance, or a key that isn't working): the one fixed line, in the chat the reply is in
        this.voice.onPaused = (spaceName) => this.sendChatMessage(spaceName, pausedLine(this.config.name));
        this.speech = new BotSpeech(this.voice, voiceReplyLimits());
        // With others in the bubble, a spoken turn is the bot's only when it was said to the bot (#1220)
        this.voice.hears = (spaceName, personId, text) => this.attention.hears(spaceName, BotClient.playerIdOf(personId), text);
        this.voice.playerIdOf = (personId) => BotClient.playerIdOf(personId);
        this.voice.onAudience = (spaceName) => this.speech?.audience(spaceName);
        // A reply for one person alone that others would have heard is not said, and that person is told why (#1993)
        this.voice.aloneWith = (spaceName, personId) => this.aloneWith(spaceName, BotClient.playerIdOf(personId));
        this.voice.onKeptQuiet = (spaceName, segmentId, heard) => {
            const responseId = this.speech?.stopped(spaceName, segmentId);
            if (responseId) this.sendKeptQuiet(spaceName, responseId, heard ? 'stopped' : 'unsaid');
        };
        this.speech.onKeptQuiet = (spaceName, responseId) => this.sendKeptQuiet(spaceName, responseId, 'unsaid');
        this.voice.onUnplayed = (spaceName, segmentId) => this.speech?.unplayed(spaceName, segmentId);
        this.voice.onHeard = (spaceName, segmentId) => this.speech?.heard(spaceName, segmentId);
        // Orbit's follow-up window (its voice limits) is the one the bot uses, in voice and in nearby chat alike
        this.voice.onFollowUpSeconds = (seconds) => this.attention.useFollowUpSeconds(seconds);
        this.voice.onSessionEnded = (spaceName) => this.speech?.sessionEnded(spaceName);
        this.voice.onPlayed = (_spaceName, segmentId) => this.speech?.played(segmentId);
        // A spoken answer is over: the person can go on without the bot's name from now (#1220)
        this.speech.onOver = (spaceName, personId) => this.attention.answered(spaceName, personId);
        this.voice.onCrowded =(spaceName) => this.speech?.crowded(spaceName);
        // A reply being heard shows Stop speaking in everyone's chat, and a tap on it stops it for the bubble as speaking over it would (round 8)
        this.speech.onSpeaking = (spaceName, responseId, speaking) => this.sendSpeaking(spaceName, responseId, speaking);
        this.voice.onStopSpeaking = (spaceName, responseId) => {
            if (this.speech?.stopReply(spaceName, responseId)) this.sendSpeechStopped(spaceName, responseId);
        };
        this.voice.onStopped = (spaceName, segmentId) => {
            const responseId = this.speech?.stopped(spaceName, segmentId);
            if (responseId) this.sendSpeechStopped(spaceName, responseId);
        };
        this.voice.onTurnedAway = (_spaceName, what) =>
            captureServerEvent(`bot:${this.config.botId}`, 'voice_paused_at_capacity', pausedAtCapacityEvent(this.config.botId, this.config.roomUrl, what));
        this.meeting = new MeetingPresence({
            join: (spaceName) => this.joinMeetingSpace(spaceName),
            leave: (spaceName) => this.leaveMeetingSpace(spaceName),
        });
        this.meeting.setAreas(this.meetingAreas.areas, this.meetingAreas.roomUrl);
    }

    private stopVoice(): void {
        this.speech?.shutdown();
        this.voice?.shutdown();
        this.voice = null;
        this.speech = null;
        this.meeting?.reset();
        this.meeting = null;
    }

    /** The meeting rooms of the map (areas with a LiveKit room setting). Only a voice bot ever uses them. */
    setMeetingAreas(areas: MeetingArea[], roomUrl: string): void {
        this.meetingAreas = { areas, roomUrl };
        this.meeting?.setAreas(areas, roomUrl);
    }

    private isMeetingSpace(spaceName: string): boolean {
        return this.meeting?.owns(spaceName) === true;
    }

    /**
     * The bot stands in a meeting room: it joins the room's space like a player does, so the voice code treats it as
     * any other space. It takes part in the audio only: the bot's behaviour (its conversations, greetings, chat) is
     * not told about the room, and the bot shows as being in a meeting, as a player does, so that no bubble forms
     * around it meanwhile.
     */
    private async joinMeetingSpace(spaceName: string): Promise<boolean> {
        try {
            const spaceUserId = await this.emitJoinSpace(spaceName, FilterType.ALL_USERS, ['cameraState', 'microphoneState', 'screenShareState']);
            this.spaces.set(spaceName, spaceUserId);
            this.emitAddSpaceFilter(spaceName);
            this.sendSpaceUserUpdate(spaceName, { cameraState: false, microphoneState: false, screenSharingState: false });
            this.sendAvailability(AvailabilityStatus.LIVEKIT);
            return true;
        } catch (error) {
            console.warn(`[Bot ${this.config.botId}] Could not join meeting room ${spaceName}: ${error instanceof Error ? error.message : error}`);
            return false;
        }
    }

    private async leaveMeetingSpace(spaceName: string): Promise<void> {
        try {
            this.emitRemoveSpaceFilter(spaceName);
            this.voice?.spaceLeft(spaceName);
            this.speech?.spaceLeft(spaceName);
            this.attention.spaceLeft(spaceName);
            this.audience.spaceLeft(spaceName);
            this.readers.spaceLeft(spaceName);
            await this.emitLeaveSpace(spaceName);
        } catch (error) {
            console.warn(`[Bot ${this.config.botId}] Could not leave meeting room ${spaceName}:`, error);
        }
        this.spaces.delete(spaceName);
        this.sendAvailability(AvailabilityStatus.ONLINE);
    }

    private sendAvailability(availabilityStatus: AvailabilityStatus): void {
        this.send({ message: { $case: 'setPlayerDetailsMessage', setPlayerDetailsMessage: SetPlayerDetailsMessage.fromPartial({ availabilityStatus }) } });
    }

    /** A private event to one person in a space the bot is in. */
    private sendPrivateEvent(spaceName: string, receiverUserId: string, event: NonNullable<PrivateSpaceEvent['event']>): void {
        if (!this.spaces.has(spaceName)) return;
        this.send({
            message: {
                $case: 'privateEvent',
                privateEvent: { spaceName, receiverUserId, spaceEvent: { event } },
            },
        });
    }

    /**
     * Set full bot configuration (called by BotManager on spawn)
     * This avoids HTTP requests to fetch config during conversations
     */
    setFullConfig(config: BotConfiguration): void {
        this.fullConfig = config;
    }

    /**
     * Get full bot configuration
     * Returns null if not set (should only happen if bot wasn't spawned via BotManager)
     */
    getFullConfig(): BotConfiguration | null {
        return this.fullConfig;
    }

    /**
     * Summon bot to a player's position
     * The bot will pathfind to the player, stop at their position, and initiate a bubble
     * When the player leaves, the bot will return to its original position
     * @param playerUuid Player UUID being summoned to
     * @param targetPosition Target position to move to
     */
    async summonToPlayer(playerUuid: string, targetPosition: PositionInterface): Promise<void> {
        console.log(`[Bot ${this.config.botId}] 🎯 SUMMON START - player ${playerUuid} at (${targetPosition.x}, ${targetPosition.y})`);
        
        if (!this.behavior) {
            console.error(`[Bot ${this.config.botId}] ❌ No behavior assigned`);
            throw new Error('Bot has no behavior assigned');
        }

        // Start summon in behavior (tracks original position)
        // This will throw an error if bot is engaged with someone else
        try {
            this.behavior.startSummon(playerUuid, targetPosition);
            console.log(`[Bot ${this.config.botId}] ✅ Behavior.startSummon() completed`);
        } catch (error: any) {
            console.error(`[Bot ${this.config.botId}] ❌ Behavior.startSummon() failed:`, error.message);
            // Re-throw the error so BotManager can handle it
            throw error;
        }

        // Cancel any existing pathfinding
        this.cancelPathfinding();
        // CRITICAL: Reset ALL pathfinding cooldowns so we can immediately start new pathfinding for summon
        // Otherwise the cooldown checks in moveToWithPathfinding() will block us
        this.lastPathEndTime = 0;
        this.lastPathRecalcTime = 0; // Reset recalculation cooldown too
        console.log(`[Bot ${this.config.botId}] ✅ Canceled existing pathfinding and reset all cooldowns`);

        // Check if pathfinding is available
        if (!this.hasPathfinding()) {
            console.error(`[Bot ${this.config.botId}] ❌ Cannot summon - pathfinding not initialized`);
            throw new Error('Pathfinding not initialized for bot');
        }
        console.log(`[Bot ${this.config.botId}] ✅ Pathfinding is available`);

        // Get bot position for logging
        const botPos = this.state.getPosition();
        const dx = targetPosition.x - botPos.x;
        const dy = targetPosition.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        console.log(`[Bot ${this.config.botId}] 📍 Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), target at (${Math.round(targetPosition.x)}, ${Math.round(targetPosition.y)}), distance: ${Math.round(distance)}px`);

        // Use pathfinding to move to target position
        // The bot will stop automatically when it reaches the position (within threshold)
        // The bubble will initiate automatically when the bot gets close enough
        console.log(`[Bot ${this.config.botId}] 🚀 Calling moveToWithPathfinding()...`);
        const pathfindingResult = await this.moveToWithPathfinding(targetPosition.x, targetPosition.y);

        console.log(`[Bot ${this.config.botId}] ✅ Summon pathfinding ${pathfindingResult ? 'STARTED' : 'FAILED'} to (${targetPosition.x}, ${targetPosition.y})`);
        console.log(`[Bot ${this.config.botId}] 📊 State: isFollowingPath=${this.isFollowingPath}, isMoving=${this.state.isMoving()}, pathLength=${this.currentPath.length}, pathIndex=${this.pathIndex}`);

        if (!pathfindingResult) {
            console.error(`[Bot ${this.config.botId}] ❌ Summon pathfinding failed - bot may be too close to target (<50px) or pathfinding unavailable`);
        }
    }

    /**
     * Send a follow request to make people follow the bot
     * @param forceFollow If true, automatically makes them follow without confirmation
     */
    sendFollowRequest(forceFollow: boolean = true): void {
        if (!this.userId) {
            console.error(`[Bot ${this.config.botId}] Cannot send follow request - not connected`);
            return;
        }

        this.send({
            message: {
                $case: 'followRequestMessage',
                followRequestMessage: {
                    leader: this.userId,
                    forceFollow,
                },
            },
        });

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📢 Sent follow request (forceFollow=${forceFollow})`);
        }
    }

    /**
     * Stop leading (send follow abort message)
     */
    sendFollowAbort(): void {
        if (!this.userId) {
            return;
        }

        this.send({
            message: {
                $case: 'followAbortMessage',
                followAbortMessage: {
                    leader: this.userId,
                    follower: 0, // 0 means all followers
                },
            },
        });

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🛑 Sent follow abort`);
        }
    }

    /**
     * Lead a person (or group) to a target location
     * Sends follow request, then navigates to the destination
     * @param personUuid Person UUID (or 'group' for group leading)
     * @param target Target destination (person or area)
     */
    async leadPersonToTarget(
        personUuid: string,
        target: { type: 'person' | 'area'; name: string; position: PositionInterface }
    ): Promise<void> {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🎯 LEAD START - leading to ${target.type} "${target.name}" at (${target.position.x}, ${target.position.y})`);
        }

        if (!this.behavior) {
            console.error(`[Bot ${this.config.botId}] ❌ No behavior assigned`);
            throw new Error('Bot has no behavior assigned');
        }

        // Start leading in behavior
        try {
            this.behavior.startLeading(personUuid, target);
            console.log(`[Bot ${this.config.botId}] ✅ Behavior.startLeading() completed`);
        } catch (error: any) {
            console.error(`[Bot ${this.config.botId}] ❌ Behavior.startLeading() failed:`, error.message);
            throw error;
        }

        // Send follow request with forceFollow=true (makes people automatically follow)
        this.sendFollowRequest(true);

        // Cancel any existing pathfinding
        this.cancelPathfinding();
        // Reset pathfinding cooldowns
        this.lastPathEndTime = 0;
        this.lastPathRecalcTime = 0;
        console.log(`[Bot ${this.config.botId}] ✅ Canceled existing pathfinding and reset all cooldowns`);

        // Check if pathfinding is available
        if (!this.hasPathfinding()) {
            console.error(`[Bot ${this.config.botId}] ❌ Cannot lead - pathfinding not initialized`);
            throw new Error('Pathfinding not initialized for bot');
        }
        console.log(`[Bot ${this.config.botId}] ✅ Pathfinding is available`);

        // Get bot position for logging
        const botPos = this.state.getPosition();
        const dx = target.position.x - botPos.x;
        const dy = target.position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        console.log(`[Bot ${this.config.botId}] 📍 Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), target at (${Math.round(target.position.x)}, ${Math.round(target.position.y)}), distance: ${Math.round(distance)}px`);

        // Use pathfinding to move to target position
        console.log(`[Bot ${this.config.botId}] 🚀 Calling moveToWithPathfinding()...`);
        const pathfindingResult = await this.moveToWithPathfinding(target.position.x, target.position.y);

        console.log(`[Bot ${this.config.botId}] ✅ Lead pathfinding ${pathfindingResult ? 'STARTED' : 'FAILED'} to (${target.position.x}, ${target.position.y})`);
        console.log(`[Bot ${this.config.botId}] 📊 State: isFollowingPath=${this.isFollowingPath}, isMoving=${this.state.isMoving()}, pathLength=${this.currentPath.length}, pathIndex=${this.pathIndex}`);

        if (!pathfindingResult) {
            const errorMsg = `Lead pathfinding failed - bot may be too close to target (<50px) or pathfinding unavailable`;
            console.error(`[Bot ${this.config.botId}] ❌ ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    /**
     * Get user ID (assigned by server)
     */
    getUserId(): number | null {
        return this.userId;
    }

    /**
     * Get bot state
     */
    getState(): BotState {
        return this.state;
    }

    /**
     * Handle incoming WebSocket message
     */
    private async handleMessage(data: ArrayBuffer): Promise<void> {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📨 Received message, size: ${data.byteLength} bytes`);
        }
        
        try {
            const message = ServerToClientMessage.decode(new Uint8Array(data));
            const msg = message.message;
            if (!msg) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[Bot ${this.config.botId}] ⚠️ Message has no content`);
                }
                return;
            }

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] 📬 Message type: ${msg.$case}`);
            }

            switch (msg.$case) {
                case 'batchMessage':
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📦 Batch message with ${msg.batchMessage.payload.length} sub-messages`);
                    }
                    for (const subMessage of msg.batchMessage.payload) {
                        await this.handleSubMessage(subMessage.message);
                    }
                    break;
                default:
                    await this.handleSubMessage(msg);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] ❌ Error handling message:`, error);
        }
    }

    private async handleSubMessage(message: any): Promise<void> {
        if (!message) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] ⚠️ handleSubMessage called with null/undefined message`);
            }
            return;
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 🔍 Processing sub-message type: ${message.$case}`);
        }

        switch (message.$case) {
            case 'roomJoinedMessage':
                this.userId = message.roomJoinedMessage.currentUserId;
                // Register this bot's userId so other bots can ignore it
                BotClient.botUserIds.add(this.userId);
                this.markJoined();
                this.startVoice();
                for (const variable of message.roomJoinedMessage.areaPropertyVariable ?? []) {
                    this.meeting?.setLive(variable.areaId, variable.propertyId, variable.key, variable.value);
                }
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] ✅ Joined room, userId: ${this.userId}`);
                }
                
                // Automatically join the world space (allWorldUser) so bots appear in user list
                // This matches what regular users do in GameScene.ts
                const worldSpaceName = WORLD_SPACE;
                this.emitJoinSpace(worldSpaceName, FilterType.ALL_USERS, ["availabilityStatus", "chatID"])
                    .then((spaceUserId) => {
                        this.spaces.set(worldSpaceName, spaceUserId);
                        // The bot is already ONLINE from its room join (availabilityStatus=1 above). A space update may
                        // not change it: the pusher refuses the field and reports an error on every join (#1403).
                        this.sendSpaceUserUpdate(worldSpaceName, {
                            cameraState: false,
                            microphoneState: false,
                            screenSharingState: false,
                        });
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Joined world space: ${worldSpaceName}`);
                        }
                    })
                    .catch((error) => {
                        console.error(`[Bot ${this.config.botId}] Failed to join world space:`, error);
                    });
                break;

            case 'userJoinedMessage':
                {
                    const userId = message.userJoinedMessage.userId;
                    const isBot = BotClient.isBot(userId);
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 userJoinedMessage received - userId=${userId}, isBot=${isBot}`);
                    }
                    if (!isBot) {
                        const playerPos = {
                            x: message.userJoinedMessage.position?.x ?? 0,
                            y: message.userJoinedMessage.position?.y ?? 0,
                        };
                        // Calculate distance for logging
                        const botPos = this.state.getPosition();
                        const dx = playerPos.x - botPos.x;
                        const dy = playerPos.y - botPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] ✅ Player ${userId} joined at (${Math.round(playerPos.x)}, ${Math.round(playerPos.y)}), distance: ${Math.round(distance)}px (now ${this.players.size + 1} players)`);
                        }
                        this.players.set(userId, {
                            userId: userId,
                            uuid: message.userJoinedMessage.userUuid || undefined,
                            name: message.userJoinedMessage.name,
                            position: playerPos,
                            availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                        });
                        // CRITICAL: Notify behavior about the player so it can check if they're nearby
                        if (this.behavior && playerPos.x > 0 && playerPos.y > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[Bot ${this.config.botId}] 📤 Calling onPlayerMoved for joined player ${userId}`);
                            }
                            this.behavior.onPlayerMoved(userId, playerPos);
                        }
                    } else {
                        this.players.set(userId, {
                            userId: userId,
                            name: message.userJoinedMessage.name,
                            position: {
                                x: message.userJoinedMessage.position?.x ?? 0,
                                y: message.userJoinedMessage.position?.y ?? 0,
                            },
                            availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                        });
                    }
                }
                break;

            case 'userMovedMessage':
                {
                    const userId = message.userMovedMessage.userId;
                    const isBot = BotClient.isBot(userId);
                    const movedPlayer = this.players.get(userId);
                    if (movedPlayer && message.userMovedMessage.position) {
                        movedPlayer.position = {
                            x: message.userMovedMessage.position.x,
                            y: message.userMovedMessage.position.y,
                        };
                        if (this.behavior && !isBot) {
                            // Calculate distance for logging
                            const botPos = this.state.getPosition();
                            const dx = movedPlayer.position.x - botPos.x;
                            const dy = movedPlayer.position.y - botPos.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            if (distance < 150) { // Only log if within 150px
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] 📍 Player ${userId} moved to (${Math.round(movedPlayer.position.x)}, ${Math.round(movedPlayer.position.y)}), distance: ${Math.round(distance)}px`);
                                }
                            }
                            this.behavior.onPlayerMoved(userId, movedPlayer.position);
                        }
                    } else if (!movedPlayer && message.userMovedMessage.position && !isBot) {
                        // Player not in our list yet, add them
                        const botPos = this.state.getPosition();
                        const dx = message.userMovedMessage.position.x - botPos.x;
                        const dy = message.userMovedMessage.position.y - botPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] ✅ Player ${userId} moved (new) - adding to players map (now ${this.players.size + 1} players), distance: ${Math.round(distance)}px`);
                        }
                        this.players.set(userId, {
                            userId: userId,
                            name: 'Unknown',
                            position: {
                                x: message.userMovedMessage.position.x,
                                y: message.userMovedMessage.position.y,
                            },
                            availabilityStatus: 0,
                        });
                        if (this.behavior) {
                            this.behavior.onPlayerMoved(userId, {
                                x: message.userMovedMessage.position.x,
                                y: message.userMovedMessage.position.y,
                            });
                        }
                    }
                }
                break;

            case 'userLeftMessage':
                this.toldNoChat.delete(message.userLeftMessage.userId);
                this.players.delete(message.userLeftMessage.userId);
                this.behavior?.onPlayerLeft(message.userLeftMessage.userId);
                break;

            case 'groupUpdateMessage':
                this.bubbles.set(message.groupUpdateMessage.groupId, message.groupUpdateMessage.userIds);
                if (this.behavior) {
                    this.behavior.onGroupJoined(message.groupUpdateMessage.groupId, message.groupUpdateMessage.userIds);
                }
                break;

            case 'groupDeleteMessage':
                this.bubbles.delete(message.groupDeleteMessage.groupId);
                break;

            case 'playerDetailsUpdatedMessage':
                {
                    // Keep availability current (away, busy, do not disturb...) so behaviors can respect it.
                    // UNCHANGED (0) means this update didn't touch the status.
                    const status = message.playerDetailsUpdatedMessage.details?.availabilityStatus;
                    const player = this.players.get(message.playerDetailsUpdatedMessage.userId);
                    if (player && status) {
                        player.availabilityStatus = status;
                    }
                }
                break;

            case 'joinSpaceRequestMessage':
                this.handleJoinSpaceRequest(message.joinSpaceRequestMessage);
                break;

            case 'leaveSpaceRequestMessage':
                this.handleLeaveSpaceRequest(message.leaveSpaceRequestMessage);
                break;

            case 'initSpaceUsersMessage':
                this.audience.seen(message.initSpaceUsersMessage.spaceName, message.initSpaceUsersMessage.users ?? []);
                for (const user of message.initSpaceUsersMessage.users ?? []) this.noteChatId(message.initSpaceUsersMessage.spaceName, user, true);
                this.voice?.spaceUsers(message.initSpaceUsersMessage.spaceName, message.initSpaceUsersMessage.users ?? []);
                if (this.isMeetingSpace(message.initSpaceUsersMessage.spaceName)) {
                    for (const user of message.initSpaceUsersMessage.users ?? []) this.rememberMeetingPerson(message.initSpaceUsersMessage.spaceName, user);
                }
                // When bot joins a space, backend sends all existing users with their UUIDs
                // This ensures we have UUID tracking before any chat messages arrive
                if (this.behavior && message.initSpaceUsersMessage && !this.isMeetingSpace(message.initSpaceUsersMessage.spaceName)) {
                    const spaceName = message.initSpaceUsersMessage.spaceName;
                    const spaceUsers = message.initSpaceUsersMessage.users || [];
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 initSpaceUsersMessage: ${spaceUsers.length} users in space ${spaceName}`);
                    }
                    
                    // Process each user to populate UUID tracking immediately
                    for (const spaceUser of spaceUsers) {
                        // Extract numeric userId from spaceUserId (format: "roomID_userID")
                        // The last part after the underscore is the numeric userId
                        let numericUserId: number | null = null;
                        if (spaceUser.spaceUserId) {
                            const lastUnderscoreIndex = spaceUser.spaceUserId.lastIndexOf('_');
                            if (lastUnderscoreIndex !== -1) {
                                const userIdStr = spaceUser.spaceUserId.substring(lastUnderscoreIndex + 1);
                                numericUserId = parseInt(userIdStr, 10);
                                if (isNaN(numericUserId)) {
                                    numericUserId = null;
                                }
                            }
                        }
                        
                        if (numericUserId) {
                            // Skip the bot itself
                            if (numericUserId === this.userId) {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] Skipping bot itself (userId: ${numericUserId})`);
                                }
                                continue;
                            }
                            
                            // Create a SpaceUser-like object with id field for onSpaceUserJoined
                            const userWithId = {
                                ...spaceUser,
                                id: numericUserId,
                            } as any;
                            
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[Bot ${this.config.botId}] 📝 Tracking UUID for user ${numericUserId} (${spaceUser.name}): ${spaceUser.uuid || 'NO UUID'}, isLogged: ${spaceUser.isLogged || false}`);
                            }
                            
                            // Call onSpaceUserJoined to track UUIDs and auth status
                            this.rememberPerson(spaceName, numericUserId, spaceUser);
                            await this.behavior.onSpaceUserJoined(spaceName, userWithId);
                        } else {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[Bot ${this.config.botId}] Could not extract numeric userId from SpaceUser "${spaceUser.name}" (spaceUserId: ${spaceUser.spaceUserId || 'unknown'}, UUID: ${spaceUser.uuid || 'unknown'})`);
                            }
                        }
                    }
                }
                break;

            case 'addSpaceUserMessage':
                // First of all: from here on a reply in this space is read by them too (#1993)
                if (message.addSpaceUserMessage.user) this.audience.joined(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user);
                this.noteChatId(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user, true);
                // And what the bot is saying out loud to someone who was alone with it stops: they would hear it
                if (message.addSpaceUserMessage.user) this.hushRepliesForOne(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user.spaceUserId);
                if (message.addSpaceUserMessage.user) this.voice?.spaceUserJoined(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user);
                // A person who came back (a reload, or walking back to the bubble) gets their cards and replies again (#1658)
                if (message.addSpaceUserMessage.user && this.asks && !isBotSpaceUser(message.addSpaceUserMessage.user)) {
                    const joined = BotClient.playerIdOf(message.addSpaceUserMessage.user.spaceUserId);
                    if (joined) this.asks.personBack(this, message.addSpaceUserMessage.spaceName, joined);
                }
                if (message.addSpaceUserMessage?.user && this.isMeetingSpace(message.addSpaceUserMessage.spaceName)) {
                    this.rememberMeetingPerson(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user);
                }
                // When a user joins a space, we get their SpaceUser info
                // Extract numeric userId from spaceUserId to avoid name collisions
                if (this.behavior && message.addSpaceUserMessage && !this.isMeetingSpace(message.addSpaceUserMessage.spaceName)) {
                    const spaceName = message.addSpaceUserMessage.spaceName;
                    const spaceUser = message.addSpaceUserMessage.user;
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📥 addSpaceUserMessage: ${spaceUser.name} (spaceUserId: ${spaceUser.spaceUserId}, UUID: ${spaceUser.uuid || 'NO UUID'}) in space ${spaceName}`);
                    }
                    
                    // Extract numeric userId from spaceUserId (format: "roomID_userID" or full URL)
                    let numericUserId: number | null = null;
                    if (spaceUser.spaceUserId) {
                        const lastUnderscoreIndex = spaceUser.spaceUserId.lastIndexOf('_');
                        if (lastUnderscoreIndex !== -1) {
                            const userIdStr = spaceUser.spaceUserId.substring(lastUnderscoreIndex + 1);
                            numericUserId = parseInt(userIdStr, 10);
                            if (isNaN(numericUserId)) {
                                numericUserId = null;
                            }
                        }
                    }
                    
                    if (!numericUserId) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[Bot ${this.config.botId}] Could not extract numeric userId from SpaceUser "${spaceUser.name}" (spaceUserId: ${spaceUser.spaceUserId || 'unknown'}, UUID: ${spaceUser.uuid || 'unknown'}) in space ${spaceName}`);
                        }
                        break;
                    }
                    
                    // Create a SpaceUser-like object with id field
                    const userWithId = {
                        ...spaceUser,
                        id: numericUserId,
                    } as any;
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] 📝 Tracking UUID from addSpaceUserMessage for user ${numericUserId} (${spaceUser.name}): ${spaceUser.uuid || 'NO UUID'}, isLogged: ${spaceUser.isLogged || false}`);
                    }
                    
                    this.rememberPerson(spaceName, numericUserId, spaceUser);
                    await this.behavior.onSpaceUserJoined(spaceName, userWithId);
                }
                break;

            case 'updateSpaceUserMessage':
                // Their browser proved its chat login a moment after they joined
                this.noteChatId(message.updateSpaceUserMessage.spaceName, message.updateSpaceUserMessage.user, false);
                if (message.updateSpaceUserMessage.message) {
                    const chatMessage = message.updateSpaceUserMessage.message.message;
                    // When the line reached the bot, before anything is asked about it: a card shown after is not answered by it (#1661)
                    const heardAt = Date.now();
                    if (chatMessage && this.behavior) {
                        console.log(`[Bot ${this.config.botId}] Received chat via updateSpaceUserMessage: "${chatMessage}" from user ${message.updateSpaceUserMessage.userId}`);
                        // With others in the bubble, only what is said to the bot reaches it (#1220)
                        if (!this.attention.hears(message.updateSpaceUserMessage.spaceName, message.updateSpaceUserMessage.userId ?? 0, chatMessage)) {
                            break;
                        }
                        if (!(await this.mayChat(message.updateSpaceUserMessage.spaceName, message.updateSpaceUserMessage.userId ?? 0, message))) {
                            break;
                        }
                        // Extract ALL URLs (not just the first) so multi-link
                        // messages get each link parsed as an attachment.
                        const textUrls = this.extractUrlsFromText(chatMessage);
                        const detectedUrl = textUrls[0] || undefined;
                        const detectedMime = detectedUrl ? await this.inferMimeTypeFromUrl(detectedUrl) : undefined;
                        this.behavior.onChatMessage(
                            message.updateSpaceUserMessage.spaceName,
                            chatMessage,
                            message.updateSpaceUserMessage.userId ?? 0,
                            detectedUrl,
                            undefined,
                            detectedMime,
                            textUrls.length > 1 ? textUrls.slice(1) : undefined,
                            undefined,
                            heardAt
                        ).catch(error => {
                            console.error(`[Bot ${this.config.botId}] onChatMessage error:`, error);
                            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
                        });
                    }
                }
                break;

            case 'publicEvent':
                // Handle incoming chat messages from players (sent via publicEvent with spaceMessage)
                if (message.publicEvent.spaceEvent?.event?.$case === 'spaceMessage') {
                    const spaceMessage = message.publicEvent.spaceEvent.event.spaceMessage;
                    const spaceName = message.publicEvent.spaceName;
                    // When the line reached the bot, before its note is heard or anything is asked about it: a card shown
                    // after this was not there when it was written, so the line does not answer it (#1661)
                    const heardAt = Date.now();
                    const senderName = spaceMessage.name;
                    const senderUserId = message.publicEvent.senderUserId; // spaceUserId format: "roomID_userID"
                    
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] publicEvent spaceMessage: "${spaceMessage.message}" from ${senderName}, senderUserId: ${senderUserId}, players map size: ${this.players.size}`);
                    }
                    
                    // Extract numeric userId from senderUserId (format: "roomID_userID")
                    // This is more reliable than matching by name and avoids name collisions
                    let senderId = 0;
                    if (senderUserId) {
                        const lastUnderscoreIndex = senderUserId.lastIndexOf('_');
                        if (lastUnderscoreIndex !== -1) {
                            const userIdStr = senderUserId.substring(lastUnderscoreIndex + 1);
                            senderId = parseInt(userIdStr, 10);
                            if (isNaN(senderId)) {
                                senderId = 0;
                            }
                        }
                    }
                    
                    // Fallback: if extraction failed, try to find by name
                    if (senderId === 0) {
                        for (const [userId, player] of this.players.entries()) {
                            if (player.name === senderName) {
                                senderId = userId;
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[Bot ${this.config.botId}] Found player ${senderName} with userId ${userId} (fallback by name)`);
                                }
                                break;
                            }
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Extracted userId ${senderId} from senderUserId ${senderUserId}`);
                        }
                    }
                    
                    if (senderId === 0) {
                        console.warn(`[Bot ${this.config.botId}] Could not find userId for a player (senderUserId: ${senderUserId}). Known players: ${this.players.size}`);
                    }
                    
                    // If we have senderId but no UUID tracked yet, register it as pending
                    // This helps match addSpaceUserMessage when it arrives
                    if (senderId > 0 && this.behavior && senderUserId) {
                        const userUuid = (this.behavior as any).userIdToUuid?.get(senderId);
                        if (!userUuid) {
                            // Register pending spaceUserId -> userId mapping
                            if ((this.behavior as any).registerPendingSpaceUserId) {
                                (this.behavior as any).registerPendingSpaceUserId(senderUserId, senderId);
                            }
                            
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[Bot ${this.config.botId}] UUID not tracked for userId ${senderId} (senderUserId: ${senderUserId}). Registered as pending, waiting for addSpaceUserMessage...`);
                                const uuidMap = (this.behavior as any).userIdToUuid;
                                if (uuidMap) {
                                    console.log(`[Bot ${this.config.botId}] Current UUID tracking map (${uuidMap.size} entries):`, Array.from(uuidMap.entries()).map(([id, uuid]) => `${id} -> ${uuid}`));
                                } else {
                                    console.warn(`[Bot ${this.config.botId}] UUID tracking map is not available on behavior`);
                                }
                            }
                        }
                    }
                    
                    // Ignore messages from bots (including ourselves)
                    if (senderId > 0 && !BotClient.isBot(senderId)) {
                        if (!this.behavior) {
                            console.warn(`[Bot ${this.config.botId}] Behavior is null, cannot handle chat message`);
                            break;
                        }
                        // A line made from what someone said to a voice bot is for that bot alone: any other bot in
                        // the bubble (text-only, or another voice bot) shows it but does not take it for a new
                        // request, and the bot it is for answers it once, however many times it arrives
                        if (spaceMessage.spoken) {
                            if (spaceMessage.spoken.botId !== this.config.botId) break;
                            if (this.voice?.acceptSpoken(spaceName, senderUserId, spaceMessage.spoken.turnId, spaceMessage.message) === 'duplicate') break;
                        } else {
                            // Typed: whatever was said out loud before is not what this answers (#1661)
                            this.lastSpoken.delete(`${spaceName}|${senderId}`);
                        }
                        // With others in the bubble, a line not meant for the bot goes no further: it is not read, saved or
                        // answered, and the person is not even asked about (#1220). Before anything else is done with it.
                        // A voice note is for the bot only when it was sent to it (alone with it, or as a reply to its message): only then
                        // is its clip ever sent to a hearing provider. A follow-up window alone never is (the note is then read as before).
                        const noteForBot = await this.noteIsForMe(spaceName, senderId, spaceMessage);
                        if (!noteForBot && !this.attention.hears(spaceName, senderId, spaceMessage.message)) {
                            break;
                        }
                        // Before anything is done with the message (links looked up, files read, the AI asked)
                        if (!(await this.mayChat(spaceName, senderId, message))) {
                            break;
                        }
                        // Heard once, here; the people who got the note see what was heard under it
                        let lineText = spaceMessage.message;
                        if (noteForBot) {
                            // Counted on the person as Orbit knows them (their uuid), like their replies; unknown yet: not heard
                            const talker = this.behavior?.getTalker(senderId) ?? null;
                            const heard = await this.hearNearbyNote(spaceName, senderUserId, spaceMessage, talker ?? {});
                            if (heard === 'unheard') break;
                            if (heard) lineText = lineText ? `${lineText}\n${heard}` : heard;
                        }
                        // Said out loud, not typed, to this bot and let through: a card waiting for an answer says so (#1661)
                        if (spaceMessage.spoken) this.noteSpoken(spaceName, senderId);
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[Bot ${this.config.botId}] Calling behavior.onChatMessage: "${spaceMessage.message}" from ${senderName} (userId: ${senderId})`);
                        }
                        // Detect URL from message text independently of uploads —
                        // previously `url || extractUrlFromText` short-circuited,
                        // so text links were never extracted when an image/file was
                        // attached. The UPLOAD stays the primary attachment (its
                        // mediaType matches it); extra text links go to the gallery
                        // where each is classified per-type (image → vision, page →
                        // Readability, file → FileParser).
                        const textUrls = this.extractUrlsFromText(spaceMessage.message);
                        const textUrl = textUrls[0] || null;
                        const detectedUrl = spaceMessage.url || textUrl || undefined;
                        const galleryUrls = spaceMessage.url
                            ? [...(spaceMessage.galleryUrls || []), ...textUrls]
                            : [
                                  ...(spaceMessage.galleryUrls || []),
                                  ...(textUrls.length > 1 ? textUrls.slice(1) : []),
                              ];
                        const detectedMime: string | null | undefined = detectedUrl && !spaceMessage.mimeType
                            ? await this.inferMimeTypeFromUrl(detectedUrl)
                            : spaceMessage.mimeType;
                        this.behavior.onChatMessage(
                            spaceName,
                            lineText,
                            senderId,
                            detectedUrl,
                            spaceMessage.mediaType,
                            detectedMime,
                            galleryUrls.length > 0 ? galleryUrls : undefined,
                            BotClient.uploadsOf(spaceMessage, detectedMime),
                            heardAt
                        ).catch(error => {
                            console.error(`[Bot ${this.config.botId}] onChatMessage error:`, error);
                            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
                        });
                    } else {
                        if (senderId === 0) {
                            console.warn(`[Bot ${this.config.botId}] Skipping chat message: senderId is 0`);
                        } else if (BotClient.isBot(senderId) && (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true')) {
                            console.log(`[Bot ${this.config.botId}] Skipping chat message: sender is a bot (userId: ${senderId})`);
                        }
                    }
                }
                break;

            case 'removeSpaceUserMessage':
                this.audience.left(message.removeSpaceUserMessage.spaceName, message.removeSpaceUserMessage.spaceUserId);
                // Gone from the world: their number may be given to someone else
                if (message.removeSpaceUserMessage.spaceName === WORLD_SPACE) this.chatIds.delete(BotClient.playerIdOf(message.removeSpaceUserMessage.spaceUserId));
                this.readers.personLeft(message.removeSpaceUserMessage.spaceName, BotClient.playerIdOf(message.removeSpaceUserMessage.spaceUserId));
                this.voice?.spaceUserLeft(message.removeSpaceUserMessage.spaceName, message.removeSpaceUserMessage.spaceUserId);
                if (this.isMeetingSpace(message.removeSpaceUserMessage.spaceName)) {
                    this.attention.personLeft(
                        message.removeSpaceUserMessage.spaceName,
                        BotClient.playerIdOf(message.removeSpaceUserMessage.spaceUserId) || (message.removeSpaceUserMessage.userId ?? 0)
                    );
                }
                if (this.behavior && !this.isMeetingSpace(message.removeSpaceUserMessage.spaceName)) {
                    // The message names the person by their space user id only, so the number comes from that
                    const leftPlayerId =
                        BotClient.playerIdOf(message.removeSpaceUserMessage.spaceUserId) || (message.removeSpaceUserMessage.userId ?? 0);
                    this.attention.personLeft(message.removeSpaceUserMessage.spaceName, leftPlayerId);
                    this.behavior.onSpaceUserLeft(message.removeSpaceUserMessage.spaceName, leftPlayerId);
                }
                break;

            case 'areaPropertyVariableMessage':
                // How many people are inside a room and whether it is locked: a voice bot waits at the door of a closed one
                this.meeting?.setLive(
                    message.areaPropertyVariableMessage.areaId,
                    message.areaPropertyVariableMessage.propertyId,
                    message.areaPropertyVariableMessage.key,
                    message.areaPropertyVariableMessage.value
                );
                break;

            case 'privateEvent':
                // Only a voice bot has audio connections; for every other bot a private event changes nothing
                this.voice?.handlePrivateEvent(message.privateEvent);
                // A tap on a card this bot showed in nearby chat (#1658)
                this.onAskEvent(message.privateEvent);
                break;

            case 'errorMessage':
                console.error(`[Bot ${this.config.botId}] Server error:`, message.errorMessage.message);
                break;

            case 'errorScreenMessage':
                console.error(`[Bot ${this.config.botId}] Server error screen:`, JSON.stringify(message.errorScreenMessage, null, 2));
                break;

            case 'answerMessage':
                this.handleAnswer(message.answerMessage);
                break;

            case 'pingMessage':
                // Respond to server ping to keep connection alive
                this.sendPong();
                break;
            default:
                // Unhandled message types — bots only process what they need
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Unhandled message type: ${message.$case}`);
                }
                break;
        }
    }

    /**
     * Send pong response to server ping
     */
    private sendPong(): void {
        this.send({
            message: {
                $case: 'pingMessage',
                pingMessage: {},
            },
        });
    }

    private async handleJoinSpaceRequest(request: JoinSpaceRequestMessage): Promise<void> {
        // Skip Jitsi spaces - bots don't do video conferences
        if (request.spaceName.includes('jitsi')) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Skipping jitsi space: ${request.spaceName}`);
            }
            return;
        }

        // Check with behavior if we should join this proximity space
        // This allows behaviors to decline bubbles (e.g., patrol bot walking over idle player)
        if (this.behavior && !this.behavior.shouldJoinProximitySpace(request.spaceName)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Behavior declined space: ${request.spaceName}`);
            }
            return;
        }

        try {
            // Default filterType to ALL_USERS (0) — field removed from protobuf
            const filterType = FilterType.ALL_USERS;
            const propertiesToSync = request.propertiesToSync || [];
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joining space: ${request.spaceName}`);
            }
            
            const spaceUserId = await this.emitJoinSpace(request.spaceName, filterType, propertiesToSync);
            this.spaces.set(request.spaceName, spaceUserId);
            
            // Register as a space watcher to receive initSpaceUsersMessage with user UUIDs
            // This is required for the pusher to send us the list of existing users in the space
            // (matches frontend behavior in Space.ts registerSpaceFilter)
            this.emitAddSpaceFilter(request.spaceName);
            
            // Immediately tell others we have NO camera/mic/screenshare
            // This prevents the "loading" indicator for our video
            this.sendSpaceUserUpdate(request.spaceName, {
                cameraState: false,
                microphoneState: false,
                screenSharingState: false,
            });
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Bot ${this.config.botId}] Joined space: ${request.spaceName}, registered filter, sent media state: off`);
            }
            
            if (this.behavior) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] Calling behavior.onSpaceJoined with spaceName=${request.spaceName}, behavior type=${this.behavior.constructor.name}`);
                }
                try {
                    this.behavior.onSpaceJoined(request.spaceName);
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[Bot ${this.config.botId}] behavior.onSpaceJoined completed successfully`);
                    }
                } catch (error) {
                    console.error(`[Bot ${this.config.botId}] ERROR in behavior.onSpaceJoined:`, error);
                }
            } else {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Bot ${this.config.botId}] No behavior to call onSpaceJoined on!`);
                }
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error joining space:`, error);
        }
    }
    
    /**
     * Send an update about this bot's user state in a space
     */
    private sendSpaceUserUpdate(spaceName: string, updates: Partial<{
        cameraState: boolean;
        microphoneState: boolean;
        screenSharingState: boolean;
        megaphoneState: boolean;
    }>): void {
        // Build the updateMask paths based on what we're updating
        const paths: string[] = [];
        if ('cameraState' in updates) paths.push('cameraState');
        if ('microphoneState' in updates) paths.push('microphoneState');
        if ('screenSharingState' in updates) paths.push('screenSharingState');
        if ('megaphoneState' in updates) paths.push('megaphoneState');
        
        // Get our spaceUserId for this space
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[Bot ${this.config.botId}] Cannot update space user - not in space: ${spaceName}`);
            }
            return;
        }
        
        this.send({
            message: {
                $case: 'updateSpaceUserMessage',
                updateSpaceUserMessage: {
                    spaceName,
                    user: {
                        spaceUserId: spaceUserId,
                        name: this.config.name,
                        playUri: this.config.roomUrl,
                        color: '',
                        characterTextures: [],
                        isLogged: false,
                        availabilityStatus: 1, // ONLINE; not in the update mask, so the pusher ignores it
                        roomName: undefined,
                        visitCardUrl: undefined,
                        tags: ['bot'],
                        cameraState: updates.cameraState ?? false,
                        microphoneState: updates.microphoneState ?? false,
                        screenSharingState: updates.screenSharingState ?? false,
                        megaphoneState: updates.megaphoneState ?? false,
                        jitsiParticipantId: undefined,
                        uuid: this.config.botId,
                        chatID: undefined,
                        showVoiceIndicator: false,
                    },
                    updateMask: paths,
                },
            },
        });
    }

    /**
     * What follows a space that is left, whoever ended it (the bot, or the game with a leave request). A meeting room was
     * never the behaviour's, and the bot showed as in a meeting while it stood there: it is plainly online again, or no
     * bubble could form around it until it entered and left another meeting room.
     */
    private afterSpaceLeft(spaceName: string, wasMeeting: boolean): void {
        if (!wasMeeting) {
            this.behavior?.onSpaceLeft(spaceName);
            return;
        }
        this.meeting?.spaceLeft(spaceName);
        this.sendAvailability(AvailabilityStatus.ONLINE);
    }

    private async handleLeaveSpaceRequest(request: LeaveSpaceRequestMessage): Promise<void> {
        try {
            // Unregister as a space watcher before leaving
            // This matches frontend behavior and ensures proper cleanup
            this.emitRemoveSpaceFilter(request.spaceName);
            
            this.voice?.spaceLeft(request.spaceName);
            this.speech?.spaceLeft(request.spaceName);
            this.attention.spaceLeft(request.spaceName);
            this.audience.spaceLeft(request.spaceName);
            this.readers.spaceLeft(request.spaceName);
            const wasMeeting = this.isMeetingSpace(request.spaceName);
            await this.emitLeaveSpace(request.spaceName);
            this.spaces.delete(request.spaceName);
            this.afterSpaceLeft(request.spaceName, wasMeeting);
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space:`, error);
        }
    }
    
    /**
     * Register as a watcher for a space to receive user information (including UUIDs)
     * This triggers the pusher to send initSpaceUsersMessage with all existing users
     */
    private emitAddSpaceFilter(spaceName: string): void {
        this.send({
            message: {
                $case: 'addSpaceFilterMessage',
                addSpaceFilterMessage: {
                    spaceFilterMessage: {
                        spaceName,
                    },
                },
            },
        });
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📋 Sent AddSpaceFilterMessage for space: ${spaceName}`);
        }
    }
    
    /**
     * Unregister as a watcher for a space (cleanup before leaving)
     */
    private emitRemoveSpaceFilter(spaceName: string): void {
        this.send({
            message: {
                $case: 'removeSpaceFilterMessage',
                removeSpaceFilterMessage: {
                    spaceFilterMessage: {
                        spaceName,
                    },
                },
            },
        });
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Bot ${this.config.botId}] 📋 Sent RemoveSpaceFilterMessage for space: ${spaceName}`);
        }
    }

    private async emitJoinSpace(spaceName: string, filterType: FilterType, propertiesToSync: string[]): Promise<SpaceUser['spaceUserId']> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'joinSpaceQuery',
                            joinSpaceQuery: {
                                spaceName,
                                filterType,
                                propertiesToSync,
                            },
                        },
                    },
                },
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Join space timeout'));
                }
            }, 10000);
        });
    }

    private async emitLeaveSpace(spaceName: string): Promise<void> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'leaveSpaceQuery',
                            leaveSpaceQuery: {
                                spaceName,
                            },
                        },
                    },
                },
            });

            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Leave space timeout'));
                }
            }, 10000);
        });
    }

    private handleAnswer(answer: any): void {
        const query = this.pendingQueries.get(answer.id);
        if (query) {
            this.pendingQueries.delete(answer.id);
            if (answer.answer?.$case === 'joinSpaceAnswer') {
                query.resolve(answer.answer.joinSpaceAnswer.spaceUserId);
            } else if (answer.answer?.$case === 'leaveSpaceAnswer') {
                query.resolve(undefined);
            } else {
                query.reject(new Error('Unexpected answer type'));
            }
        }
    }

    public sendPosition(position: PositionInterface, direction: PositionMessage_Direction, moving: boolean): void {
        // Safety checks for undefined values
        const x = position?.x ?? 0;
        const y = position?.y ?? 0;
        // Update viewport to be centered on current position with large radius
        const viewportRadius = 2000;
        const top = Math.max(0, y - viewportRadius);
        const bottom = y + viewportRadius;
        const left = Math.max(0, x - viewportRadius);
        const right = x + viewportRadius;
        
        // Ensure direction is a valid enum value
        const safeDirection = typeof direction === 'number' ? direction : PositionMessage_Direction.DOWN;

        // Check for NaN values
        if (isNaN(x) || isNaN(y)) {
            // Keep this as error-level warning - invalid positions are serious
            console.warn(`[Bot ${this.config.botId}] Invalid position: x=${x}, y=${y}`);
            return;
        }

        this.send({
            message: {
                $case: 'userMovesMessage',
                userMovesMessage: {
                    position: {
                        x: Math.floor(x),
                        y: Math.floor(y),
                        direction: safeDirection,
                        moving: !!moving,
                    },
                    viewport: {
                        top: Math.floor(top),
                        bottom: Math.floor(bottom),
                        left: Math.floor(left),
                        right: Math.floor(right),
                    },
                },
            },
        });
    }

    /**
     * Extract ALL URLs from plain text content (deduped, in order).
     * Returns an empty array if no URLs are found.
     *
     * Capped at MAX_CHAT_URLS: every extracted URL is classified downstream and
     * may trigger outbound requests (HEAD sniff for extension-less URLs,
     * download for non-images), so an unbounded list would let a single chat
     * message drive arbitrary resource consumption.
     */
    private extractUrlsFromText(text: string): string[] {
        // Full URLs and bare site names ("check out bawes.net"); see utils/chatLinks.
        return extractChatLinks(text, BotClient.MAX_CHAT_URLS);
    }

    /**
     * Extract the first URL from plain text content.
     * Returns the URL string or null if no URL is found.
     */
    private extractUrlFromText(text: string): string | null {
        const urls = this.extractUrlsFromText(text);
        return urls.length > 0 ? urls[0] : null;
    }

    /**
     * Infer a MIME type from a URL's file extension.
     * For URLs without a recognized extension (Unsplash, signed S3 URLs, etc.),
     * sniff the content-type via a HEAD request so images are not misrouted to
     * web-page extraction. Defaults to 'text/html' when nothing can be determined.
     */
    private async inferMimeTypeFromUrl(url: string): Promise<string> {
        let ext: string;
        try {
            const pathname = new URL(url).pathname;
            ext = pathname.split('.').pop()?.toLowerCase() || '';
        } catch {
            return 'text/html';
        }

        const mimeMap: Record<string, string> = {
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'html': 'text/html',
            'htm': 'text/html',
            'txt': 'text/plain',
            'json': 'application/json',
            'xml': 'application/xml',
            'csv': 'text/csv',
            'md': 'text/markdown',
            'ts': 'text/plain',
            'js': 'text/javascript',
            'py': 'text/plain',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'ico': 'image/x-icon',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mov': 'video/quicktime',
        };

        if (ext && mimeMap[ext]) {
            return mimeMap[ext];
        }

        // Extension-less URL — sniff content-type (SSRF-validated) so image URLs
        // like Unsplash or signed S3 links are routed to image handling, not web pages.
        const sniffed = await FileParser.sniffContentType(url);
        if (sniffed) {
            return sniffed;
        }

        return 'text/html';
    }

    /** The socket is gone: a new one starts joining from nothing, and what the old one held is dropped. */
    private resetJoin(): void {
        this.joined = false;
        this.pendingMessages = [];
    }

    /** The server confirmed the join: messages can flow, starting with the position the bot is at now. */
    private markJoined(): void {
        this.joined = true;
        const pending = this.pendingMessages;
        this.pendingMessages = [];
        for (const message of pending) this.send(message);
    }

    private send(message: ClientToServerMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Still joining: hold messages until the server confirms the join (a ping is always allowed). The join
        // itself is in the connection URL, so nothing needs to go out first.
        if (!this.joined && message.message?.$case !== 'pingMessage') {
            if (message.message?.$case === 'userMovesMessage') {
                // Only where the bot is now matters, and it is always kept: it replaces the one held before, so
                // the cap never costs the bot its position.
                this.pendingMessages = this.pendingMessages.filter((m) => m.message?.$case !== 'userMovesMessage');
                this.pendingMessages.push(message);
                return;
            }
            const held = this.pendingMessages.filter((m) => m.message?.$case !== 'userMovesMessage').length;
            if (held < BotClient.MAX_PENDING_MESSAGES) {
                this.pendingMessages.push(message);
            } else {
                console.warn(
                    `[Bot ${this.config.botId}] Join still pending: dropped a ${message.message?.$case ?? 'message'} (queue full)`
                );
            }
            return;
        }

        try {
            const encoded = ClientToServerMessage.encode(message).finish();
            this.ws.send(encoded);
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error sending message:`, error);
        }
    }
}

interface PlayerInfo {
    userId: number;
    /** The player's uuid, as the room told the bot when they joined. */
    uuid?: string;
    name: string;
    position: PositionInterface;
    availabilityStatus: number;
}

