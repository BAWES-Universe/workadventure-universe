/**
 * BotAPI - REST API server for bot CRUD operations
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { BotManager } from './BotManager';
import { AdminApiService, BotConfigRefused } from './AdminApiService';
import { BotRegistry } from './BotRegistry';
import type { BotConfiguration } from './AdminApiService';
import { movementLogger } from '../utils/MovementLogger';
import { MCPConnector } from '../mcp/MCPConnector';
import { BotBusyError, BotCannotCallError, BotUnavailableError } from '../utils/summonErrors';
import { helloSourceOf, typedVoiceName, type HelloSource, type VoiceHello } from '../voice/VoiceHello';
import { buildVoiceHello } from '../voice/VoiceHelloWiring';
import { GuestBrickService, isGuestBrickId, readCarriedLines } from './GuestBrickService';
import type { GuestChatNote } from '../matrix/MatrixDmBridge';

/** The id the game makes for a guest at their first visit (a uuid): a member's token names an email or an account instead. */
const GUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BotAPIRequest extends Request {
    /** Who the game token says the caller is (its `identifier`): a guest's uuid, a member's email or id. */
    gameIdentifier?: string;
    userIdentifier?: string;
    /** The uuid of the person behind the Orbit session (what the game calls the player's uuid). */
    sessionUuid?: string;
    /** Orbit's own id of that person: the one a Brick's owner is named by. */
    sessionUserId?: string;
    isLogged?: boolean;
    sessionToken?: string;
    /** Set when the request carried an Orbit session the Admin API did not accept (expired or revoked). */
    sessionRejected?: boolean;
}

/**
 * Middleware to verify authentication token
 * Accepts only a v2 opaque Orbit session in the Authorization header.
 */
async function authenticateToken(
    req: BotAPIRequest,
    res: Response,
    next: NextFunction,
    adminApiService: AdminApiService
): Promise<void> {
    const path = req.path || req.originalUrl?.split('?')[0] || '';
    
    // Skip auth for movement endpoints (dev only) - safety check
    if (path.startsWith('/dev/movement/')) {
        const isDevMode = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';
        if (isDevMode) {
            next();
            return;
        }
    }
    
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (!/^orb_sess_v2_[0-9a-f]{64}$/.test(bearerToken)) {
        res.status(401).json({ error: 'Missing or invalid Orbit session' });
        return;
    }

    try {
        const userInfo = await adminApiService.validateSessionToken(bearerToken);
        if (!userInfo) {
            res.status(401).json({ error: 'Invalid or expired Orbit session' });
            return;
        }
        req.userIdentifier = userInfo.email || userInfo.uuid;
        req.isLogged = true;
        req.sessionToken = bearerToken;
        req.sessionUuid = userInfo.uuid;
        req.sessionUserId = userInfo.userId;
        next();
    } catch (error) {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.error('[BotAPI] Orbit session validation failed:', error);
        }
        res.status(401).json({ error: 'Orbit session validation failed' });
    }
}

/**
 * Middleware for routes that change a running bot. Runs after authenticateToken and lets the request through only
 * when the Admin API says the session's person may manage the bot named in the path or body.
 */
async function requireBotManager(
    req: BotAPIRequest,
    res: Response,
    next: NextFunction,
    adminApiService: AdminApiService
): Promise<void> {
    const botId = (req.params?.botId as string | undefined) || (req.body?.botId as string | undefined);
    if (!botId || typeof botId !== 'string') {
        res.status(400).json({ error: 'Missing botId' });
        return;
    }
    if (!req.sessionToken || !(await adminApiService.canSessionManageBot(req.sessionToken, botId))) {
        res.status(403).json({ error: 'You cannot manage this bot' });
        return;
    }
    next();
}

/**
 * Middleware for operator tools that act across every bot with the Admin API token (create, list, global cleanup,
 * improvement runs). No person's session is enough: the caller must also present BOT_SERVICE_TOKEN.
 */
function requireServiceOperator(req: BotAPIRequest, res: Response, next: NextFunction): void {
    const expected = process.env.BOT_SERVICE_TOKEN;
    const presented = req.headers['x-bot-service-token'];
    const a = Buffer.from(typeof presented === 'string' ? presented : '');
    const b = Buffer.from(expected || '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Operator access only' });
        return;
    }
    next();
}

/**
 * Reads the player's game token (X-WA-Auth), signed with the same SECRET_KEY the bots already use to join the game.
 * Returns the identifier it carries, or null when the token is missing or not valid.
 */
function readGameToken(req: BotAPIRequest): { identifier: string | undefined } | null {
    const secretKey = process.env.SECRET_KEY;
    const token = req.headers['x-wa-auth'];
    if (!secretKey || typeof token !== 'string' || !token) {
        return null;
    }
    try {
        const payload = jwt.verify(token, secretKey, { algorithms: ['HS256'] });
        return {
            identifier:
                typeof payload === 'object' && payload !== null && typeof payload.identifier === 'string'
                    ? payload.identifier
                    : undefined,
        };
    } catch {
        return null;
    }
}

/**
 * Middleware for routes every player in the game uses, guests included (bots spawning when a room opens, a bot's
 * feelings about you). It needs the player's game token in the X-WA-Auth header, signed with the same SECRET_KEY the
 * bots already use to join the game.
 */
function requireGameToken(req: BotAPIRequest, res: Response, next: NextFunction): void {
    if (!process.env.SECRET_KEY || typeof req.headers['x-wa-auth'] !== 'string' || !req.headers['x-wa-auth']) {
        res.status(401).json({ error: 'Missing game token' });
        return;
    }
    const game = readGameToken(req);
    if (!game) {
        res.status(401).json({ error: 'Invalid game token' });
        return;
    }
    // Keep who the token belongs to, so routes about one person can check it is that person asking.
    req.gameIdentifier = game.identifier;
    next();
}

/**
 * Middleware for routes any player may use, guests included, that act for the person asking (Summon). It works out
 * who is asking from what the request carries: the Orbit session of a signed-in player, and the game token, whose
 * identifier is a guest's uuid. The route then checks the one it needs against the person the request is about.
 */
async function identifyPlayer(
    req: BotAPIRequest,
    res: Response,
    next: NextFunction,
    adminApiService: AdminApiService
): Promise<void> {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (bearerToken) {
        try {
            const userInfo = /^orb_sess_v2_[0-9a-f]{64}$/.test(bearerToken)
                ? await adminApiService.validateSessionToken(bearerToken)
                : null;
            if (userInfo) {
                req.userIdentifier = userInfo.email || userInfo.uuid;
                req.isLogged = true;
                req.sessionToken = bearerToken;
                req.sessionUuid = userInfo.uuid;
                req.sessionUserId = userInfo.userId;
            } else {
                req.sessionRejected = true;
            }
        } catch {
            req.sessionRejected = true;
        }
    }

    const game = readGameToken(req);
    if (game) {
        req.gameIdentifier = game.identifier;
    }

    if (!req.sessionUuid && !game) {
        res.status(401).json({ error: 'Missing or invalid Orbit session or game token' });
        return;
    }
    next();
}

/**
 * Middleware for asking "may I?" about a bot, open to every player: a signed-in player's Orbit session names them;
 * without one, the game token still has to be valid (a guest has only that). A session that is present but not accepted
 * is refused, not quietly treated as a guest.
 */
async function identifyForAccessMiddleware(
    req: BotAPIRequest,
    res: Response,
    next: NextFunction,
    adminApiService: AdminApiService
): Promise<void> {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
    if (bearerToken) {
        try {
            const userInfo = /^orb_sess_v2_[0-9a-f]{64}$/.test(bearerToken)
                ? await adminApiService.validateSessionToken(bearerToken)
                : null;
            if (!userInfo) {
                res.status(401).json({ error: 'Invalid or expired Orbit session' });
                return;
            }
            req.userIdentifier = userInfo.email || userInfo.uuid;
            req.isLogged = true;
            req.sessionToken = bearerToken;
            req.sessionUuid = userInfo.uuid;
            req.sessionUserId = userInfo.userId;
        } catch {
            res.status(401).json({ error: 'Orbit session validation failed' });
            return;
        }
        next();
        return;
    }

    requireGameToken(req, res, next);
}

export interface BotAPIOptions {
    /** Each bot's state for direct messages (online, resting, unready, gone); only when Matrix DMs are on. */
    dmStatus?: (botIds: string[]) => Promise<Record<string, string>>;
    /** The room a bot lives in, for its profile in a direct message; only when Matrix DMs are on. */
    dmRoom?: (botId: string) => Promise<{ url: string; room: string; world: string; universe: string } | undefined>;
    /** Whether a bot hears voice notes, for the mic in its chat: the same hearing its voice calls use. Left out, no bot is said to hear. */
    noteHearing?: { canHear(botId: string): Promise<boolean> };
    /**
     * The one chat of a bot and a person (game #1995): the chat they have, or whether this device is the one to make it;
     * only when Matrix DMs are on. `chatId` is the person's chat address, already checked to be theirs.
     */
    directChat?: (botId: string, chatId: string) => Promise<{ roomId: string } | { create: true } | { wait: true }>;
    /**
     * Brings a guest's chat with the Brick for guests into the signed-in person's own Brick (game #1997): `chatId` is the
     * person's chat address, already checked to be theirs, and `botId` already checked to be their own Brick.
     */
    carryGuestChat?: (botId: string, chatId: string, carryId: string, lines: GuestChatNote[]) => Promise<'sent' | 'already' | 'wait' | 'not_brick'>;
    /**
     * A Brick was deleted or taken back with Undo (game #1996): its settings are read again before its next message.
     * Only when it is a Brick of `ownerId` (Orbit's id of the person); says whether it was.
     */
    brickChanged?: (botId: string, ownerId: string) => boolean;
    /** What answers a guest in their Brick (game #1997). Left out, it is built from the bot server's own parts the first time it is asked for; null: off. */
    guestBrick?: GuestBrickService | null;
    /** "Hear this voice say hello" on the bot page (#1852). Left out, it is built from the bot server's own parts the first time it is asked for; null: not available. */
    voiceHello?: VoiceHello | null;
}

/** Most bots one state lookup may ask about: a chat list's worth. */
const DM_STATUS_MAX_IDS = 50;

/** Whether two room addresses name the same room: the same /@/universe/world/room path, whatever the host or scheme. */
function sameRoomAddress(a: string, b: string): boolean {
    const pathOf = (address: string): string => {
        try {
            return new URL(address).pathname.replace(/\/+$/, '');
        } catch {
            return address.replace(/\/+$/, '');
        }
    };
    return pathOf(a) === pathOf(b);
}

/**
 * Whether a bot save puts the bot on a person's own AI key it isn't on yet (a ref starting "key-", #374). Orbit judges that by
 * who is saving (only the key's owner, who made the bot, in a universe the key is lent to), and the admin token is nobody,
 * so such a save goes with the person's own session. Every other save keeps the admin token, as before.
 */
export function putsBotOnPersonalKey(existing: BotConfiguration, updates: Partial<BotConfiguration>): boolean {
    const ref = updates.aiProviderRef;
    return typeof ref === 'string' && ref.startsWith('key-') && ref !== existing.aiProviderRef;
}

export class BotAPI {
    private app: express.Application;
    private botManager: BotManager;
    private adminApiService: AdminApiService;
    private botRegistry: BotRegistry;
    private server: any = null;
    private dmStatus: BotAPIOptions['dmStatus'];
    private noteHearing: BotAPIOptions['noteHearing'];
    private dmRoom: BotAPIOptions['dmRoom'];
    private directChat: BotAPIOptions['directChat'];
    private brickChanged: BotAPIOptions['brickChanged'];
    private carryGuestChat: BotAPIOptions['carryGuestChat'];
    /** Per person, how many Brick changes they told in the current minute. */
    private brickChangedCounts = new Map<string, { count: number; since: number }>();
    private voiceHelloOption: BotAPIOptions['voiceHello'];
    private guestBrickOption: BotAPIOptions['guestBrick'];

    constructor(
        botManager: BotManager,
        adminApiService: AdminApiService,
        botRegistry: BotRegistry,
        preRouters: express.Router[] = [],
        options: BotAPIOptions = {}
    ) {
        console.log('[BotAPI] Constructor called');
        this.app = express();
        this.botManager = botManager;
        this.adminApiService = adminApiService;
        this.botRegistry = botRegistry;
        this.dmStatus = options.dmStatus;
        this.noteHearing = options.noteHearing;
        this.dmRoom = options.dmRoom;
        this.directChat = options.directChat;
        this.brickChanged = options.brickChanged;
        this.carryGuestChat = options.carryGuestChat;
        this.voiceHelloOption = options.voiceHello;
        this.guestBrickOption = options.guestBrick;

        // Routers with their own auth and body limits (the Matrix application service) go before the shared parser.
        for (const router of preRouters) {
            this.app.use(router);
        }

        // Keep constructor simple - no route registration here
        this.setupMiddleware();
        this.setupRoutes();
    }

    private guestBrick(): GuestBrickService | null {
        if (this.guestBrickOption === undefined) this.guestBrickOption = new GuestBrickService(this.adminApiService);
        return this.guestBrickOption;
    }

    /** At most 30 Brick changes a minute for one person: far more than tapping Delete and Undo, too few to keep Orbit busy. */
    private brickChangedAllowed(userId: string, now = Date.now()): boolean {
        const seen = this.brickChangedCounts.get(userId);
        if (!seen || now - seen.since >= 60_000) {
            this.brickChangedCounts.delete(userId);
            this.brickChangedCounts.set(userId, { count: 1, since: now });
            if (this.brickChangedCounts.size > 10_000) this.brickChangedCounts.delete(this.brickChangedCounts.keys().next().value!);
            return true;
        }
        seen.count += 1;
        return seen.count <= 30;
    }

    private voiceHello(): VoiceHello | null {
        if (this.voiceHelloOption === undefined) this.voiceHelloOption = buildVoiceHello(this.adminApiService);
        return this.voiceHelloOption;
    }

    private async isAskingAboutThemselves(req: BotAPIRequest, userUuid: string): Promise<boolean> {
        if (req.gameIdentifier && req.gameIdentifier === userUuid) {
            return true;
        }
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
        if (!/^orb_sess_v2_[0-9a-f]{64}$/.test(bearerToken)) {
            return false;
        }
        try {
            const session = await this.adminApiService.validateSessionToken(bearerToken);
            return !!session && session.uuid === userUuid;
        } catch {
            return false;
        }
    }

    private setupMiddleware(): void {
        console.log('[BotAPI] setupMiddleware() called');
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // CORS (if needed)
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-WA-Auth');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });
        
    }

    private setupRoutes(): void {
        const requireSession = (req: BotAPIRequest, res: Response, next: NextFunction) =>
            authenticateToken(req, res, next, this.adminApiService);
        const requireManager = (req: BotAPIRequest, res: Response, next: NextFunction) =>
            requireBotManager(req, res, next, this.adminApiService);
        const identifyForAccess = (req: BotAPIRequest, res: Response, next: NextFunction) =>
            identifyForAccessMiddleware(req, res, next, this.adminApiService);
        const identifySummoner = (req: BotAPIRequest, res: Response, next: NextFunction) =>
            identifyPlayer(req, res, next, this.adminApiService);
        const requireOperator = (req: BotAPIRequest, res: Response, next: NextFunction) => requireServiceOperator(req, res, next);

        // Health check (no auth required)
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        
        // Debug endpoint to check environment variables
        this.app.get('/api/debug/env', (req, res) => {
            res.json({
                ENABLE_MOVEMENT_LOGGING: process.env.ENABLE_MOVEMENT_LOGGING,
                NODE_ENV: process.env.NODE_ENV,
                isDevMode: process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development',
            });
        });

        // Room enter/leave: any player in the game (guests too) with a game token
        this.app.post('/api/bots/room-enter', requireGameToken, async (req: Request, res: Response) => {
            try {
                const { roomId } = req.body;

                if (!roomId) {
                    res.status(400).json({ error: 'Missing roomId' });
                    return;
                }

                // Bots wake only for a room people are really in: the call comes from any player, so it must not
                // wake the bots of a room the caller is not in. The answer never says how many bots a room has.
                if (typeof roomId !== 'string' || !(await this.botManager.hasPlayersIn(roomId))) {
                    res.json({ roomId });
                    return;
                }

                // Handle player entering room (spawns bots)
                await this.botManager.handlePlayerEnterRoom(roomId);

                res.json({ roomId });
            } catch (error: any) {
                console.error('[BotAPI] Error handling room enter:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Room leave - handle player leaving (may despawn bots if room is empty)
        this.app.post('/api/bots/room-leave', requireGameToken, async (req: Request, res: Response) => {
            try {
                const { roomId } = req.body;

                if (!roomId) {
                    res.status(400).json({ error: 'Missing roomId' });
                    return;
                }

                // Handle player leaving (verification will despawn bots if room becomes empty)
                await this.botManager.handlePlayerLeaveRoom(roomId);

                res.json({ roomId });
            } catch (error: any) {
                console.error('[BotAPI] Error handling room leave:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // May I do this with this bot? The game asks before it shows a bot's Summon or Message button, so a person the
        // owner has refused never sees it. Signed-in players prove who they are with the Orbit session, everyone else with the
        // game token (a guest is asked about as a guest). Orbit decides; a no is a 200, and Orbit not answering with
        // nothing earlier to go on is a 503, which the game treats as "don't know" and shows the button.
        this.app.post('/api/bots/:botId/access', identifyForAccess, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const action = req.body?.action;
                if (action !== 'summon' && action !== 'chat' && action !== 'dm' && action !== 'call') {
                    res.status(400).json({ error: 'action must be "summon", "chat", "dm" or "call"' });
                    return;
                }

                // The game says who it is asking for. A signed-in member whose Orbit session did not come with the
                // request would otherwise be asked about as a guest (guest rules can differ from a member's): they
                // are told to sign in again, as Summon does, rather than shown an answer meant for someone else.
                const { playerUuid } = req.body ?? {};
                if (
                    typeof playerUuid === 'string' &&
                    playerUuid &&
                    req.sessionUuid !== playerUuid &&
                    req.gameIdentifier !== playerUuid
                ) {
                    res.status(403).json({ error: 'You can only ask for yourself', code: 'not_you' });
                    return;
                }

                const verdict = await this.botManager.getAccessGate().check(
                    botId,
                    action,
                    { signedIn: !!req.sessionUuid, identifier: req.sessionUuid },
                    this.botManager.getBot(botId)?.getName()
                );
                if (verdict.kind === 'allowed') {
                    // Calling is also a voice: the call button is drawn only for a bot that has one (the start still checks)
                    if (action === 'call' && !(await this.botManager.canTakeCall(botId))) {
                        res.json({ allowed: false, code: 'no_voice', reason: 'This bot has no voice.' });
                        return;
                    }
                    res.json({ allowed: true });
                    return;
                }
                if (verdict.kind === 'refused') {
                    res.json({ allowed: false, code: verdict.code, reason: verdict.line });
                    return;
                }
                res.status(503).json({ error: verdict.line, code: 'cannot_check' });
            } catch (error: any) {
                console.error('[BotAPI] Error checking bot access:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Summon bot to the player who asks. Any player may summon, guests included; it only moves the bot to them. Who
        // is asking comes from the Orbit session (signed in) or the game token (a guest's identifier is their uuid),
        // and where they stand comes from what the bot itself sees, so nobody can call a bot to another person or to
        // a spot of their choosing. Every refusal carries a `code` so the game can tell the player why.
        this.app.post('/api/bots/:botId/summon', identifySummoner, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const { playerUuid } = req.body;

                if (!playerUuid || typeof playerUuid !== 'string') {
                    res.status(400).json({ error: 'Missing required field: playerUuid' });
                    return;
                }

                const isThatPlayer = req.sessionUuid === playerUuid || req.gameIdentifier === playerUuid;
                if (!isThatPlayer) {
                    if (req.sessionRejected && !req.sessionUuid) {
                        // Their Orbit session ran out: the game asks for a fresh one and tries again.
                        res.status(401).json({ error: 'Invalid or expired Orbit session', code: 'session_expired' });
                        return;
                    }
                    res.status(403).json({ error: 'You can only summon a bot to yourself', code: 'not_you' });
                    return;
                }

                const bot = this.botManager.getBot(botId);
                if (!bot) {
                    res.status(404).json({ error: 'Bot not found or not spawned', code: 'not_here' });
                    return;
                }

                // The owner may limit who can call this bot over (Orbit decides). A refusal says so in a line the game
                // shows as it is. When Orbit cannot answer and there is no earlier answer for this person, the bot does
                // not come: nothing is known about the owner's rules, and chat fails the same way, so a bot that came
                // could not be talked to anyway. The gate has already reported Orbit not answering.
                const allowed = await this.botManager.getAccessGate().check(
                    botId,
                    'summon',
                    { signedIn: !!req.sessionUuid, identifier: req.sessionUuid },
                    bot.getName()
                );
                if (allowed.kind === 'refused') {
                    res.status(403).json({
                        summoned: false,
                        error: allowed.line,
                        reason: allowed.line,
                        code: 'not_allowed',
                    });
                    return;
                }
                if (allowed.kind === 'cannot_check') {
                    res.status(503).json({
                        summoned: false,
                        error: allowed.line,
                        reason: allowed.line,
                        code: 'cannot_check',
                    });
                    return;
                }

                // Summon the bot to where it sees the player standing
                const targetPosition = await this.botManager.summonBot(botId, { playerUuid });
                if (!targetPosition) {
                    res.status(409).json({
                        summoned: false,
                        reason: 'The bot cannot see you in its room',
                        code: 'cannot_see_you',
                    });
                    return;
                }

                res.json({
                    botId,
                    summoned: true,
                    targetPosition,
                });
            } catch (error: any) {
                if (error instanceof BotBusyError) {
                    res.status(409).json({
                        summoned: false,
                        reason: error.message,
                        code: error.withYou ? 'already_with_you' : 'busy',
                    });
                    return;
                }
                if (error instanceof BotUnavailableError) {
                    res.status(404).json({ error: error.message, code: 'not_here' });
                    return;
                }
                console.error('[BotAPI] Error summoning bot:', error);
                res.status(500).json({ error: error.message, code: 'failed' });
            }
        });

        // A person calls a bot (game #2004). Who is asking comes from the Orbit session or the game token, as for Summon, and
        // only they can call for themselves. Orbit's "Call" rule decides (it needs an account, so a guest hears "sign in");
        // the bot then opens a call-only connection and joins the call's private space, whose name comes back for the
        // caller to join. The bot does not have to be standing anywhere: it is not in the room for a call.
        this.app.post('/api/bots/:botId/call', identifySummoner, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const { playerUuid } = req.body ?? {};
                if (!playerUuid || typeof playerUuid !== 'string') {
                    res.status(400).json({ error: 'Missing required field: playerUuid' });
                    return;
                }
                if (req.sessionUuid !== playerUuid && req.gameIdentifier !== playerUuid) {
                    if (req.sessionRejected && !req.sessionUuid) {
                        res.status(401).json({ error: 'Invalid or expired Orbit session', code: 'session_expired' });
                        return;
                    }
                    res.status(403).json({ error: 'You can only call a bot for yourself', code: 'not_you' });
                    return;
                }

                // The call is held by the person's account, never by a guest's token: a guest is refused below by Orbit
                const verdict = await this.botManager.getAccessGate().check(
                    botId,
                    'call',
                    { signedIn: !!req.sessionUuid, identifier: req.sessionUuid },
                    this.botManager.getBot(botId)?.getName()
                );
                if (verdict.kind === 'refused') {
                    res.status(403).json({ started: false, error: verdict.line, reason: verdict.line, code: verdict.code ?? 'not_allowed' });
                    return;
                }
                if (verdict.kind === 'cannot_check') {
                    res.status(503).json({ started: false, error: verdict.line, reason: verdict.line, code: 'cannot_check' });
                    return;
                }

                const call = await this.botManager.startCall(botId, playerUuid);
                res.json({ botId, started: true, spaceName: call.spaceName });
            } catch (error: any) {
                if (error instanceof BotCannotCallError) {
                    res.status(409).json({ started: false, error: error.message, code: 'no_voice' });
                    return;
                }
                if (error instanceof BotUnavailableError) {
                    res.status(404).json({ started: false, error: error.message, code: 'not_here' });
                    return;
                }
                console.error('[BotAPI] Error starting a call:', error);
                res.status(500).json({ started: false, error: 'The call could not start', code: 'failed' });
            }
        });

        // The caller hangs up: the bot leaves the call and closes its connection. Only the person who called can end it.
        this.app.post('/api/bots/:botId/call/end', identifySummoner, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const { playerUuid } = req.body ?? {};
                if (!playerUuid || typeof playerUuid !== 'string') {
                    res.status(400).json({ error: 'Missing required field: playerUuid' });
                    return;
                }
                if (req.sessionUuid !== playerUuid && req.gameIdentifier !== playerUuid) {
                    res.status(403).json({ error: 'You can only end your own call', code: 'not_you' });
                    return;
                }
                res.json({ botId, ended: await this.botManager.endCall(botId, playerUuid) });
            } catch (error: any) {
                console.error('[BotAPI] Error ending a call:', error);
                res.status(500).json({ error: 'The call could not be ended', code: 'failed' });
            }
        });

        // Get bot emotions for a specific player, so players can see how a bot feels about them
        this.app.get('/api/bots/:botId/emotions/:userUuid', requireGameToken, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId, userUuid } = req.params;

                if (!botId || !userUuid) {
                    res.status(400).json({ error: 'Missing botId or userUuid' });
                    return;
                }

                // A bot's feelings about a person are for that person: a guest's game token carries their uuid, and
                // a member proves theirs with their Orbit session next to the game token.
                if (!(await this.isAskingAboutThemselves(req, userUuid))) {
                    res.status(403).json({ error: 'You can only see how a bot feels about you' });
                    return;
                }

                // Get bot instance
                const botInstance = this.botManager.getBotInstance(botId);
                if (!botInstance) {
                    // Bot not found - return default emotions
                    res.json({
                        botId,
                        userUuid,
                        emotions: {
                            botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                            personEmotion: { anger: 0, happiness: 50, trust: 50 },
                            lastEmotionUpdate: Date.now(),
                        },
                    });
                    return;
                }

                // Get conversation memory from bot
                const conversationMemory = botInstance.getConversationMemory?.();
                if (!conversationMemory) {
                    // Memory not available - return default emotions
                    res.json({
                        botId,
                        userUuid,
                        emotions: {
                            botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                            personEmotion: { anger: 0, happiness: 50, trust: 50 },
                            lastEmotionUpdate: Date.now(),
                        },
                    });
                    return;
                }

                // Find memory by userUuid - check both active and pre-loaded memories
                let emotions = null;

                // First try the optimized method that checks both active and pre-loaded memories
                if ('getMemoryByUserUuid' in conversationMemory && typeof (conversationMemory as any).getMemoryByUserUuid === 'function') {
                    const memory = (conversationMemory as any).getMemoryByUserUuid(botId, userUuid);
                    if (memory) {
                        emotions = memory.emotions;
                    }
                } else {
                    // Fallback: search active memories only - MUST filter by botId
                    const memories = conversationMemory.getAllMemories?.();
                    if (memories) {
                        for (const [key, memory] of memories.entries()) {
                            // CRITICAL: Check that this memory belongs to the correct bot
                            if (key.startsWith(`${botId}_`) && memory.userUuid === userUuid) {
                                emotions = memory.emotions;
                                break;
                            }
                        }
                    }
                }

                if (!emotions) {
                    // No memory exists yet - return default
                    emotions = {
                        botEmotion: { anger: 0, happiness: 50, trust: 50, familiarity: 0 },
                        personEmotion: { anger: 0, happiness: 50, trust: 50 },
                        lastEmotionUpdate: Date.now(),
                    };
                }

                res.json({ botId, userUuid, emotions });
            } catch (error: any) {
                console.error('[BotAPI] Error fetching emotions:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Spawn a specific bot immediately (called when bot is created in editor)
        this.app.post('/api/bots/spawn', requireSession, requireManager, async (req: Request, res: Response) => {
            try {
                const { botId } = req.body;
                let { roomId } = req.body;

                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                // The bot starts in its own room. A manager may name that room (the editor does), but never another one.
                const botConfig = await this.adminApiService.getBotConfiguration(botId);
                if (!botConfig) {
                    res.status(404).json({ error: 'Bot not found in Admin API' });
                    return;
                }
                if (!botConfig.roomUrl || (roomId && !sameRoomAddress(roomId, botConfig.roomUrl))) {
                    res.status(403).json({ error: 'That bot belongs to another room' });
                    return;
                }
                // The room the bot belongs to, written the way its configuration writes it
                roomId = botConfig.roomUrl;

                // Check if bot is already spawned
                if (this.botManager.getBot(botId)) {
                    res.json({
                        botId,
                        roomId,
                        spawned: true,
                        reason: 'Bot already spawned',
                    });
                    return;
                }

                // Get or create room state
                // If room state doesn't exist (e.g., last bot was despawned), create it
                // This assumes that if someone is using the UI to spawn bots, they must be in the room
                let roomState = this.botManager.getRoomState(roomId);
                if (!roomState) {
                    // Room state was deleted (likely because last bot was despawned)
                    // Recreate it since a player is using the UI (must be in the room)
                    console.log(`[BotAPI] Room state for ${roomId} doesn't exist, recreating it`);
                    await this.botManager.handlePlayerEnterRoom(roomId);
                    roomState = this.botManager.getRoomState(roomId);
                    if (!roomState) {
                        res.json({
                            botId,
                            roomId,
                            spawned: false,
                            reason: 'Failed to initialize room state',
                        });
                        return;
                    }
                }

                // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                MCPConnector.clearCache(botId);

                // Spawn the bot
                await this.botManager.spawnBot(botId, botConfig);
                roomState.botIds.add(botId);

                console.log(`[BotAPI] Spawned bot ${botId} for room ${roomId}`);
                res.json({
                    botId,
                    roomId,
                    spawned: true,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error spawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Despawn a specific bot immediately (called when bot is deleted in editor)
        this.app.post('/api/bots/despawn', requireSession, requireManager, async (req: Request, res: Response) => {
            try {
                const { botId, roomId } = req.body;

                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                // Check if bot exists
                if (!this.botManager.getBot(botId)) {
                    res.json({
                        botId,
                        despawned: false,
                        reason: 'Bot not currently spawned',
                    });
                    return;
                }

                // Despawn the bot
                await this.botManager.despawnBot(botId);

                // Remove from room tracking if roomId provided
                if (roomId) {
                    const roomState = this.botManager.getRoomState(roomId);
                    if (roomState) {
                        roomState.botIds.delete(botId);
                    }
                }

                console.log(`[BotAPI] Despawned bot ${botId}`);
                res.json({
                    botId,
                    despawned: true,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error despawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Update a running bot's config (live update)
        this.app.post('/api/bots/:botId/update', requireSession, requireManager, async (req: Request, res: Response) => {
            try {
                const { botId } = req.params;
                const { position, behaviorConfig, behaviorType, restartRoute } = req.body;

                console.log(`[BotAPI] Received update request for bot ${botId}:`, {
                    position,
                    behaviorType,
                    hasConfig: !!behaviorConfig,
                });

                const result = await this.botManager.updateBot(
                    botId,
                    {
                        position,
                        behaviorConfig,
                        behaviorType,
                    } as Partial<BotConfiguration>,
                    { restartRoute: restartRoute === true }
                );

                if (!result.updated) {
                    res.status(404).json({
                        botId,
                        updated: false,
                        reason: result.reason || 'Bot not found or not running',
                    });
                    return;
                }

                console.log(`[BotAPI] Updated bot ${botId}`);
                res.json({
                    botId,
                    updated: true,
                    changes: result.changes,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error updating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Bot states for the game's chat header and People list. Signed in only; it says nothing but the state of bots
        // the caller already names, never their names or rooms. A bot the caller may not message reads as unknown, so
        // someone refused never learns it is resting or not ready. Gone needs no check: there is no bot left to ask about.
        this.app.get('/api/bots/dm-status', requireSession, async (req: BotAPIRequest, res: Response) => {
            if (!this.dmStatus) {
                res.status(404).json({ error: 'Direct messages are off' });
                return;
            }
            const ids = [
                ...new Set(
                    String(req.query.ids ?? '')
                        .split(',')
                        .map((id) => id.trim())
                        .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id))
                ),
            ];
            if (ids.length === 0 || ids.length > DM_STATUS_MAX_IDS) {
                res.status(400).json({ error: `Send 1 to ${DM_STATUS_MAX_IDS} bot ids` });
                return;
            }
            try {
                const states = await this.dmStatus(ids);
                const gate = this.botManager.getAccessGate();
                const person = { signedIn: true, identifier: req.sessionUuid };
                await Promise.all(
                    ids.map(async (botId) => {
                        if (states[botId] === 'gone' || states[botId] === 'unknown') return;
                        if (!(await gate.check(botId, 'dm', person)).allowed) states[botId] = 'unknown';
                    })
                );
                res.json({ bots: states });
            } catch (error) {
                console.error('[BotAPI] Error reading bot states:', error);
                res.status(500).json({ error: 'Could not read bot states' });
            }
        });

        // The room a bot lives in, for the Visit button on its profile in a direct message. Only for someone who may
        // message it, the same people its replies' room cards reach, so nobody else learns where a bot is.
        this.app.get('/api/bots/:botId/dm-room', requireSession, async (req: BotAPIRequest, res: Response) => {
            if (!this.dmRoom) {
                res.status(404).json({ error: 'Direct messages are off' });
                return;
            }
            const { botId } = req.params;
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) {
                res.status(400).json({ error: 'Not a bot id' });
                return;
            }
            try {
                const person = { signedIn: true, identifier: req.sessionUuid };
                if (!(await this.botManager.getAccessGate().check(botId, 'dm', person)).allowed) {
                    res.json({ room: null });
                    return;
                }
                res.json({ room: (await this.dmRoom(botId)) ?? null });
            } catch (error) {
                console.error(`[BotAPI] Error reading the room of bot ${botId}:`, error);
                res.status(500).json({ error: 'Could not read the room' });
            }
        });

        // One chat for a person and a bot, however many of their devices open it at once (game #1995). A device that has
        // no chat with the bot asks here before it makes one, and is told the chat they already have, to make it (one
        // device at a time is), or to ask again in a moment. The person is the one the Orbit session names: the chat
        // address their device sends counts only when Orbit says it is that same person's and that they may message
        // the bot, so nobody learns of, or holds up, a chat that is not theirs.
        this.app.post('/api/bots/:botId/direct-chat', requireSession, async (req: BotAPIRequest, res: Response) => {
            if (!this.directChat) {
                res.status(404).json({ error: 'Direct messages are off' });
                return;
            }
            const { botId } = req.params;
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) {
                res.status(400).json({ error: 'Not a bot id' });
                return;
            }
            const chatId = req.body?.chatId;
            if (typeof chatId !== 'string' || !/^@[^\s:]{1,255}:[^\s]{1,255}$/.test(chatId) || chatId.length > 255) {
                res.status(400).json({ error: 'Not a chat address' });
                return;
            }
            try {
                const access = await this.adminApiService.checkDmAccess(botId, chatId);
                if (!access.allowed && (access.reason ?? '').startsWith('admin_api_')) {
                    res.status(503).json({ error: 'Could not check right now', code: 'cannot_check' });
                    return;
                }
                if (!access.allowed || !access.user || !req.sessionUuid || access.user.uuid !== req.sessionUuid) {
                    res.status(403).json({ error: 'You cannot message this bot', code: 'not_allowed' });
                    return;
                }
                res.json(await this.directChat(botId, chatId));
            } catch (error) {
                console.error(`[BotAPI] Error finding the direct chat of bot ${botId}:`, error);
                res.status(500).json({ error: 'Could not find the chat' });
            }
        });

        // The Brick for guests answers a guest who writes to it (game #1997). The guest is the one the game token names, never
        // one the request names, and only a guest's own id counts: a member has their own Brick. The chat lives on the
        // guest's device, which sends the lines it holds with each message; nothing of it is kept here.
        this.app.post('/api/guest-brick/reply', identifySummoner, async (req: BotAPIRequest, res: Response) => {
            const brick = this.guestBrick();
            if (!brick?.available()) {
                res.status(404).json({ error: 'Not available' });
                return;
            }
            const guestId = req.gameIdentifier;
            // A request that comes with a signed-in Orbit session is a member's, even when their game identifier looks like a guest's (a member without an email)
            if (req.isLogged || typeof guestId !== 'string' || !GUEST_ID.test(guestId)) {
                res.status(403).json({ error: 'Only for guests' });
                return;
            }
            const { turnId, roomUrl, message, history, saidNeedsAccount } = req.body ?? {};
            if (!isGuestBrickId(turnId) || typeof roomUrl !== 'string' || !roomUrl || roomUrl.length > 2000 || typeof message !== 'string' || !message.trim()) {
                res.status(400).json({ error: 'Not a message' });
                return;
            }
            try {
                const answer = await brick.reply({
                    guestId,
                    turnId,
                    roomUrl,
                    message,
                    history: Array.isArray(history) ? history : [],
                    saidNeedsAccount: saidNeedsAccount === true,
                });
                if (answer.kind === 'busy') res.status(429).json(answer);
                else if (answer.kind === 'failed') res.status(502).json(answer);
                else res.json(answer);
            } catch (error) {
                console.error('[BotAPI] Error answering a guest:', error instanceof Error ? error.message : error);
                res.status(502).json({ kind: 'failed' });
            }
        });

        // A guest signed in, and Orbit handed their chat with the Brick for guests to this account (game #1997). The device that held
        // the chat brings it here and the Brick says it, once, in the person's own chat with their Brick. The person is the one the
        // Orbit session names; the chat address counts only when Orbit says it is theirs, and the bot must be their own Brick, so
        // nobody can put words in another chat or in a host bot's.
        this.app.post('/api/bots/:botId/carried-chat', requireSession, async (req: BotAPIRequest, res: Response) => {
            if (!this.carryGuestChat) {
                res.status(404).json({ error: 'Direct messages are off' });
                return;
            }
            const { botId } = req.params;
            const { chatId, carryId, lines } = req.body ?? {};
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId) || typeof chatId !== 'string' || !/^@[^\s:]{1,255}:[^\s]{1,255}$/.test(chatId) || chatId.length > 255) {
                res.status(400).json({ error: 'Not a chat address' });
                return;
            }
            if (!isGuestBrickId(carryId) || !Array.isArray(lines)) {
                res.status(400).json({ error: 'Not a chat to bring' });
                return;
            }
            try {
                const access = await this.adminApiService.checkDmAccess(botId, chatId);
                // Orbit could not say: not a refusal, so the device keeps the chat and asks again
                if (!access.allowed && (access.reason ?? '').startsWith('admin_api_')) {
                    res.status(503).json({ error: 'Could not check right now', code: 'cannot_check' });
                    return;
                }
                if (!access.allowed || !access.user || !req.sessionUuid || access.user.uuid !== req.sessionUuid) {
                    res.status(403).json({ error: 'Not your chat', code: 'not_allowed' });
                    return;
                }
                const kept = readCarriedLines(lines);
                if (kept.length === 0) {
                    res.status(400).json({ error: 'Nothing to bring' });
                    return;
                }
                const result = await this.carryGuestChat(botId, chatId, carryId, kept);
                if (result === 'not_brick') {
                    res.status(403).json({ error: 'Not your Brick', code: 'not_allowed' });
                    return;
                }
                res.json({ result });
            } catch (error) {
                console.error(`[BotAPI] Error bringing a guest's chat into ${botId}:`, error instanceof Error ? error.message : error);
                res.status(500).json({ error: 'Could not bring the chat' });
            }
        });

        // A Brick was just deleted, or taken back with Undo, on the Bricks page (game #1996). Orbit already decided it; this
        // only has every bot server read the Brick again now instead of within the minute, so a deleted Brick stops at
        // once. Only the Brick's owner may say it, and only so often, so nobody can keep the bot server asking Orbit.
        this.app.post('/api/bots/:botId/brick-changed', requireSession, (req: BotAPIRequest, res: Response) => {
            const { botId } = req.params;
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId) || !req.sessionUserId) {
                res.status(400).json({ error: 'Not a bot id' });
                return;
            }
            if (!this.brickChangedAllowed(req.sessionUserId)) {
                res.status(429).json({ error: 'Too many changes, try again in a minute' });
                return;
            }
            this.brickChanged?.(botId, req.sessionUserId);
            res.status(204).end();
        });

        // "Not now" on a Brick's suggestion (game #1996). Orbit closed the topic when the card was shown; this keeps what
        // the person tapped. The person is the one the Orbit session names, and Orbit keeps it only for the Brick's owner.
        this.app.post('/api/bots/:botId/brick-offer', requireSession, async (req: BotAPIRequest, res: Response) => {
            const { botId } = req.params;
            const topic = req.body?.topic;
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId) || typeof topic !== 'string' || !topic.trim() || topic.length > 200 || !req.sessionUuid) {
                res.status(400).json({ error: 'Not a suggestion' });
                return;
            }
            try {
                if (await this.adminApiService.answerBrickOffer(botId, req.sessionUuid, topic, 'not_now')) res.status(204).end();
                else res.status(502).json({ error: 'Could not keep that' });
            } catch (error) {
                console.error(`[BotAPI] Error keeping "Not now" for bot ${botId}:`, error);
                res.status(502).json({ error: 'Could not keep that' });
            }
        });

        // Whether a bot hears voice notes, for the mic in its chat: shown only on a yes. Only for someone who may message it, the same
        // people the room route answers, so nobody else learns how a bot is set up.
        this.app.get('/api/bots/:botId/hears', requireSession, async (req: BotAPIRequest, res: Response) => {
            const { botId } = req.params;
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) {
                res.status(400).json({ error: 'Not a bot id' });
                return;
            }
            try {
                const person = { signedIn: true, identifier: req.sessionUuid };
                if (!this.noteHearing || !(await this.botManager.getAccessGate().check(botId, 'dm', person)).allowed) {
                    res.json({ hears: false });
                    return;
                }
                res.json({ hears: await this.noteHearing.canHear(botId) });
            } catch (error) {
                console.error(`[BotAPI] Error reading whether bot ${botId} hears:`, error);
                res.status(500).json({ error: 'Could not read whether the bot hears' });
            }
        });

        // Get available AI providers (for bot editor UI). Signed-in only; returns metadata, no credentials
        // "Hear this voice say hello" (#1852): the voice worker says one short fixed line with the bot's voice, for the people who
        // manage the bot. The first one counts as one of the maker's voice replies when Universe AI pays for the voice; the same voice
        // heard again soon is kept and free. Says why when it can't.
        this.app.post('/api/bots/:botId/voice/hello', requireSession, requireManager, async (req: BotAPIRequest, res: Response) => {
            const hello = this.voiceHello();
            if (!hello || !req.sessionUuid) {
                res.status(503).json({ error: 'unavailable' });
                return;
            }
            const locale = typeof req.body?.locale === 'string' ? req.body.locale.slice(0, 16) : undefined;
            // A voice name typed and not saved yet (#1874), heard from the person's own speech server only. One that is not a name is refused
            let voiceId: string | undefined;
            if (req.body?.voiceId !== undefined) {
                voiceId = typedVoiceName(req.body.voiceId);
                if (voiceId === undefined) {
                    res.status(400).json({ error: 'bad_voice_name' });
                    return;
                }
            }
            // Where it is heard from when voice is not on yet (the door): the speech server and its model. It needs the name to hear
            let source: HelloSource | undefined;
            if (req.body?.source !== undefined) {
                source = helloSourceOf(req.body.source);
                if (!source || voiceId === undefined) {
                    res.status(400).json({ error: 'bad_source' });
                    return;
                }
            }
            try {
                const result = await hello.say({
                    botId: req.params.botId as string,
                    personId: req.sessionUuid,
                    locale,
                    ...(voiceId !== undefined ? { voiceId } : {}),
                    ...(source ? { source } : {}),
                });
                if (result.ok === false) {
                    const body: Record<string, unknown> = { ...result };
                    delete body.ok;
                    delete body.status;
                    res.status(result.status).json(body);
                    return;
                }
                res.json({ text: result.text, mime: 'audio/wav', audio: result.wav.toString('base64'), ms: result.ms, ...(result.cached ? { cached: true } : {}) });
            } catch (error) {
                // What the error holds is never sent or logged: it could be about a key
                console.error('[BotAPI] Voice hello failed:', error instanceof Error ? error.constructor.name : 'error');
                res.status(500).json({ error: 'failed' });
            }
        });

        this.app.get('/api/bots/ai-providers', requireSession, async (req: Request, res: Response) => {
            try {
                const enabled = req.query.enabled === 'true' || req.query.enabled === undefined;
                const providers = await this.adminApiService.getAvailableAIProviders(enabled);
                res.json(providers);
            } catch (error: any) {
                console.error('[BotAPI] Error getting AI providers:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Apply authentication ONLY to /api/bots routes (NOT /api/debug, /dev/movement, etc.)
        // Movement endpoints are registered at /dev/movement/* to bypass any /api/* middleware
        // Use async wrapper since authenticateToken is now async and needs adminApiService
        this.app.use('/api/bots', async (req: BotAPIRequest, res: Response, next: NextFunction) => {
            await authenticateToken(req, res, next, this.adminApiService);
        });

        // List all bots for a room/world
        this.app.get('/api/bots', requireOperator, async (req: BotAPIRequest, res: Response) => {
            try {
                const roomUrl = req.query.roomUrl as string | undefined;
                const worldUrl = req.query.worldUrl as string | undefined;

                // TODO: Filter by roomUrl/worldUrl
                const instances = this.botManager.getAllBotInstances();
                const bots = instances.map(instance => ({
                    botId: instance.botId,
                    name: instance.config.name,
                    roomUrl: instance.config.roomUrl,
                    behaviorType: instance.config.behaviorType,
                    status: instance.status,
                }));

                res.json(bots);
            } catch (error: any) {
                console.error('[BotAPI] Error listing bots:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get bot configuration
        this.app.get('/api/bots/:botId', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const config = await this.adminApiService.getBotConfiguration(botId);
                if (!config) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                res.json(config);
            } catch (error: any) {
                console.error('[BotAPI] Error getting bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Create new bot
        this.app.post('/api/bots', requireOperator, async (req: BotAPIRequest, res: Response) => {
            try {
                const config: Partial<BotConfiguration> = req.body;

                // Validate required fields
                if (!config.roomUrl || !config.behaviorType) {
                    res.status(400).json({ error: 'Missing required fields: roomUrl, behaviorType' });
                    return;
                }

                // Generate bot ID
                const botId = `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Save configuration to Admin API
                const now = new Date();
                const fullConfig: BotConfiguration = {
                    botId,
                    name: config.name || `Bot ${botId}`,
                    roomUrl: config.roomUrl,
                    worldUrl: config.worldUrl || '',
                    universeUrl: config.universeUrl,
                    userId: req.userIdentifier,
                    behaviorType: config.behaviorType,
                    behaviorConfig: config.behaviorConfig || { type: config.behaviorType },
                    aiProviderRef: config.aiProviderRef,
                    chatInstructions: config.chatInstructions,
                    assignedSpace: config.assignedSpace,
                    createdAt: now,
                    updatedAt: now,
                };

                await this.adminApiService.saveBotConfiguration({
                    ...fullConfig,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                res.status(201).json({ botId, config: fullConfig });
            } catch (error: any) {
                console.error('[BotAPI] Error creating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Update bot configuration
        this.app.put('/api/bots/:botId', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const updates: Partial<BotConfiguration> = req.body;

                // ADD DEBUG LOGGING
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] PUT /api/bots/${botId} received:`, {
                        hasBehaviorType: 'behaviorType' in updates,
                        behaviorType: updates.behaviorType,
                        hasBehaviorConfig: 'behaviorConfig' in updates,
                        behaviorConfigKeys: updates.behaviorConfig ? Object.keys(updates.behaviorConfig) : [],
                        allUpdateKeys: Object.keys(updates),
                    });
                }

                // Get existing config
                const existingConfig = await this.adminApiService.getBotConfiguration(botId);
                if (!existingConfig) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                // ADD DEBUG LOGGING
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] Existing config for ${botId}:`, {
                        behaviorType: existingConfig.behaviorType,
                        behaviorConfigKeys: existingConfig.behaviorConfig ? Object.keys(existingConfig.behaviorConfig) : [],
                    });
                }

                // Merge updates - but only include fields that are actually provided (not undefined)
                // This prevents undefined values from overwriting existing correct values
                const updatesToApply: Partial<BotConfiguration> = {};
                for (const [key, value] of Object.entries(updates)) {
                    // Only include defined values (exclude undefined, but allow null if needed)
                    if (value !== undefined) {
                        (updatesToApply as any)[key] = value;
                    }
                }
                
                // Normalize characterTextureId → characterTextureIds for merge
                if ('characterTextureId' in updatesToApply && !('characterTextureIds' in updatesToApply)) {
                    (updatesToApply as any).characterTextureIds = updatesToApply.characterTextureId
                        ? [updatesToApply.characterTextureId]
                        : [];
                }

                const updatedConfig: BotConfiguration = {
                    ...existingConfig,
                    ...updatesToApply,  // Only defined values
                    botId, // Ensure botId doesn't change
                };

                // CRITICAL: Ensure behaviorType is always set (never undefined) for response
                // If updates didn't include behaviorType or it was undefined, preserve existing value
                if (!updatedConfig.behaviorType) {
                    console.warn(`[BotAPI] Bot ${botId} missing behaviorType after merge, preserving existing: ${existingConfig.behaviorType}`);
                    updatedConfig.behaviorType = existingConfig.behaviorType;
                }

                // CRITICAL FIX: Only save behaviorType to Admin API if it was explicitly provided in updates
                // This prevents stale Admin API data from overwriting the running bot's behavior
                // If behaviorType was not in updates, don't save it (preserve what's in Admin API without overwriting)
                const shouldSaveBehaviorType = 'behaviorType' in updates;
                
                // ADD DEBUG LOGGING BEFORE SAVE
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[BotAPI] Saving config for ${botId}:`, {
                        behaviorTypeInUpdates: 'behaviorType' in updates,
                        behaviorTypeValue: updates.behaviorType,
                        existingBehaviorType: existingConfig.behaviorType,
                        willSaveBehaviorType: shouldSaveBehaviorType,
                        updatedConfigBehaviorType: updatedConfig.behaviorType,
                    });
                }
                
                if (!shouldSaveBehaviorType) {
                    // behaviorType was not provided in updates - don't save it to Admin API
                    // This prevents accidental resets when other fields (like position) are updated
                    // The running bot keeps its current behavior, and Admin API keeps its stored value
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] behaviorType not in updates, skipping save to Admin API to prevent stale data overwrite`);
                    }
                }
                
                // Save to Admin API
                // Build config to save: merge existing with updates, but exclude behaviorType if it wasn't in updates
                const finalConfigToSave: BotConfiguration = {
                    ...existingConfig,
                    ...updatesToApply, // Only fields explicitly provided in updates
                    botId, // Ensure botId doesn't change
                };
                
                // CRITICAL: If behaviorType wasn't in updates, preserve existing Admin API value
                // This prevents stale Admin API data from being re-saved and potentially causing issues
                // The running bot's behavior is managed by BotManager, not by Admin API saves
                if (!shouldSaveBehaviorType) {
                    // Keep existing Admin API value - don't change it
                    finalConfigToSave.behaviorType = existingConfig.behaviorType;
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] Preserving existing behaviorType in Admin API: ${existingConfig.behaviorType} (not in updates)`);
                    }
                } else {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[BotAPI] Saving behaviorType to Admin API: ${finalConfigToSave.behaviorType} (was in updates)`);
                    }
                }
                
                const actingSession = putsBotOnPersonalKey(existingConfig, updatesToApply) ? req.sessionToken : undefined;
                try {
                    await this.adminApiService.saveBotConfiguration(finalConfigToSave, actingSession);
                } catch (error) {
                    // Orbit said why it refused (a key that isn't theirs or isn't lent here): pass it on instead of a bare 500
                    if (error instanceof BotConfigRefused) {
                        res.status(400).json({ error: error.message });
                        return;
                    }
                    throw error;
                }

                // Check if name or texture changed (require respawn)
                const nameChanged = 'name' in updates && updates.name !== existingConfig.name;
                const textureChanged = 'characterTextureIds' in updates && 
                    JSON.stringify(updates.characterTextureIds) !== JSON.stringify(existingConfig.characterTextureIds);
                // The companion joins the bot when it connects, so a new one needs a respawn too
                const companionChanged = 'companionTextureId' in updatesToApply &&
                    (updatesToApply.companionTextureId ?? null) !== (existingConfig.companionTextureId ?? null);

                // The voice tag is part of the bot's token, so turning voice on or off reconnects the bot too
                const voiceChanged = 'voiceEnabled' in updatesToApply &&
                    !!updatesToApply.voiceEnabled !== !!existingConfig.voiceEnabled;

                // If name, texture, companion or voice changed and bot is running, despawn and respawn immediately
                if ((nameChanged || textureChanged || companionChanged || voiceChanged) && this.botManager.getBot(botId)) {
                    console.log(`[BotAPI] Bot ${botId} name, texture or companion changed, respawning with new config`);
                    // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                    MCPConnector.clearCache(botId);
                    // Despawn first
                    await this.botManager.despawnBot(botId);
                    // Wait a brief moment
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // Respawn with updated config
                    await this.botManager.spawnBot(botId, updatedConfig);
                } else if (this.botManager.getBot(botId)) {
                    // Update running bot for other changes (AI config, behavior, etc.)
                    console.log(`[BotAPI] Updating running bot ${botId} with:`, {
                        hasAiProviderRef: 'aiProviderRef' in updates,
                        hasChatInstructions: 'chatInstructions' in updates,
                        chatInstructions: updates.chatInstructions?.substring(0, 100) || '(none)',
                        chatInstructionsLength: updates.chatInstructions?.length || 0,
                    });
                    await this.botManager.updateBot(botId, updates);
                } else {
                    console.log(`[BotAPI] Bot ${botId} is not running, skipping live update`);
                }

                res.json(updatedConfig);
            } catch (error: any) {
                console.error('[BotAPI] Error updating bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Delete bot
        this.app.delete('/api/bots/:botId', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                // Despawn if running
                if (this.botManager.getBot(botId)) {
                    await this.botManager.despawnBot(botId);
                }

                // Delete from Admin API
                await this.adminApiService.deleteBotConfiguration(botId);

                res.status(204).send();
            } catch (error: any) {
                console.error('[BotAPI] Error deleting bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Spawn bot instance
        this.app.post('/api/bots/:botId/spawn', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                // Check if already spawned
                if (this.botManager.getBot(botId)) {
                    res.status(400).json({ error: 'Bot already spawned' });
                    return;
                }

                // Load configuration
                const config = await this.adminApiService.getBotConfiguration(botId);
                if (!config) {
                    res.status(404).json({ error: 'Bot configuration not found' });
                    return;
                }

                // Clear cached MCP tools so fresh tool definitions are fetched on respawn
                MCPConnector.clearCache(botId);

                // Spawn bot
                await this.botManager.spawnBot(botId, config);

                res.json({ botId, status: 'spawned' });
            } catch (error: any) {
                console.error('[BotAPI] Error spawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Despawn bot instance
        this.app.post('/api/bots/:botId/despawn', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                await this.botManager.despawnBot(botId);

                res.json({ botId, status: 'despawned' });
            } catch (error: any) {
                console.error('[BotAPI] Error despawning bot:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get bot status
        this.app.get('/api/bots/:botId/status', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const status = this.botManager.getBotStatus(botId);
                const instance = this.botManager.getAllBotInstances().find(i => i.botId === botId);

                if (!status && !instance) {
                    res.status(404).json({ error: 'Bot not found' });
                    return;
                }

                res.json({
                    botId,
                    status: status || 'not_spawned',
                    lastHeartbeat: instance?.lastHeartbeat,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error getting bot status:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Read a tool server's whole list now and save it to Orbit with a suggested heading per tool (#1654): the game calls
        // it when a server is connected and on Test server. A suggestion is only that; a person confirms each tool in Orbit.
        this.app.post('/api/bots/:botId/mcp-servers/:serverId/refresh-tools', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId, serverId } = req.params;
                const admin = this.botManager.getAdminApiService();
                if (!admin.isConfigured()) {
                    res.status(503).json({ error: 'The admin API is not configured' });
                    return;
                }
                const config = await admin.getBotConfiguration(botId);
                const outcome = await this.botManager.getAIService().refreshServerTools(botId, serverId, config?.aiProviderRef, admin);
                if (!outcome) {
                    res.status(404).json({ error: 'No such tool server' });
                    return;
                }
                if (!outcome.read) {
                    res.status(502).json({ error: outcome.reason });
                    return;
                }
                res.json({ tools: outcome.tools, saved: outcome.saved.result });
            } catch (error: any) {
                console.error('[BotAPI] Error refreshing the tools of a server:', error);
                res.status(500).json({ error: 'Could not read the tools' });
            }
        });

        // Metrics endpoints
        // Get current metrics for a bot (from buffer)
        this.app.get('/api/bots/:botId/metrics/current', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const metricsCollector = this.botManager.getMetricsCollector();
                
                if (!metricsCollector) {
                    res.status(503).json({ error: 'Metrics collector not available' });
                    return;
                }

                const metrics = metricsCollector.getCurrentMetrics(botId);
                res.json({ botId, metrics, count: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting current metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get metrics with time range (from Admin API)
        this.app.get('/api/bots/:botId/metrics', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const metricType = req.query.metricType as string | undefined;
                const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
                const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;
                const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
                const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

                const metrics = await this.adminApiService.getBotMetrics(botId, {
                    metricType,
                    startTime,
                    endTime,
                    limit,
                    offset,
                });

                res.json({ botId, metrics, count: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Record metrics (internal endpoint, uses BOT_SERVICE_TOKEN)
        this.app.post('/api/bots/metrics', requireOperator, async (req: Request, res: Response) => {
            try {
                const { metrics } = req.body;

                if (!Array.isArray(metrics)) {
                    res.status(400).json({ error: 'Metrics must be an array' });
                    return;
                }

                await this.adminApiService.saveBotMetrics(metrics);
                res.json({ saved: metrics.length });
            } catch (error: any) {
                console.error('[BotAPI] Error recording metrics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Test endpoints
        // Run test suite
        this.app.post('/api/bots/test/run-suite', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { testSuite, botId } = req.body;

                if (!testSuite || !botId) {
                    res.status(400).json({ error: 'Missing testSuite or botId' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available' });
                    return;
                }

                const testRun = await testRunner.runTestSuite(testSuite, botId);
                res.json(testRun);
            } catch (error: any) {
                console.error('[BotAPI] Error running test suite:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get test results
        this.app.get('/api/bots/test/results/:testId', requireOperator, async (req: BotAPIRequest, res: Response) => {
            try {
                const { testId } = req.params;
                
                // This would fetch from Admin API in a real implementation
                // For now, return not implemented
                res.status(501).json({ error: 'Not implemented - test results stored in Admin API' });
            } catch (error: any) {
                console.error('[BotAPI] Error getting test results:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Replay conversation
        this.app.post('/api/bots/test/replay', requireOperator, async (req: BotAPIRequest, res: Response) => {
            try {
                const { conversationId, newChatInstructions } = req.body;

                if (!conversationId) {
                    res.status(400).json({ error: 'Missing conversationId' });
                    return;
                }

                const conversationReplay = this.botManager.getConversationReplay();
                if (!conversationReplay) {
                    res.status(503).json({ error: 'Conversation replay not available' });
                    return;
                }

                const result = await conversationReplay.replayConversation(conversationId, newChatInstructions);
                res.json(result);
            } catch (error: any) {
                console.error('[BotAPI] Error replaying conversation:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get conversation stats
        this.app.get('/api/bots/:botId/conversations/stats', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;

                const conversationStorage = this.botManager.getConversationStorage();
                if (!conversationStorage) {
                    res.status(503).json({ error: 'Conversation storage not available' });
                    return;
                }

                const stats = await conversationStorage.getConversationStats(botId);
                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error getting conversation stats:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Manual cleanup for specific bot (admin only)
        this.app.delete('/api/bots/:botId/conversations/cleanup', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const olderThanDays = req.query.olderThanDays ? parseInt(req.query.olderThanDays as string, 10) : undefined;
                const keepRecent = req.query.keepRecent ? parseInt(req.query.keepRecent as string, 10) : undefined;

                const conversationCleanup = this.botManager.getConversationCleanup();
                if (!conversationCleanup) {
                    res.status(503).json({ error: 'Conversation cleanup not available' });
                    return;
                }

                let stats;
                if (keepRecent !== undefined) {
                    stats = await conversationCleanup.cleanupByBot(botId, keepRecent);
                } else if (olderThanDays !== undefined) {
                    stats = await conversationCleanup.cleanupOldConversations(botId, olderThanDays);
                } else {
                    res.status(400).json({ error: 'Must provide olderThanDays or keepRecent' });
                    return;
                }

                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error cleaning up conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Manual cleanup for all bots (admin only)
        this.app.delete('/api/bots/conversations/cleanup', requireOperator, async (req: BotAPIRequest, res: Response) => {
            try {
                const olderThanDays = req.query.olderThanDays ? parseInt(req.query.olderThanDays as string, 10) : undefined;
                const maxPerBot = req.query.maxPerBot ? parseInt(req.query.maxPerBot as string, 10) : undefined;
                const maxTotal = req.query.maxTotal ? parseInt(req.query.maxTotal as string, 10) : undefined;

                const conversationCleanup = this.botManager.getConversationCleanup();
                if (!conversationCleanup) {
                    res.status(503).json({ error: 'Conversation cleanup not available' });
                    return;
                }

                const stats = await conversationCleanup.cleanupAll({
                    olderThanDays,
                    maxPerBot,
                    maxTotal,
                });

                res.json(stats);
            } catch (error: any) {
                console.error('[BotAPI] Error cleaning up all conversations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Improvement endpoints (DEVELOPMENT ONLY - disabled in production)
        // Get improvement recommendations
        this.app.get('/api/bots/improve/recommendations', requireOperator, async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                const botId = req.query.botId as string;
                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const autoImprovement = this.botManager.getAutoImprovement();
                if (!autoImprovement) {
                    res.status(503).json({ error: 'Auto-improvement not available (development mode required)' });
                    return;
                }

                const recommendations = await autoImprovement.analyzeAndRecommend(botId);
                res.json({ botId, recommendations, count: recommendations.length });
            } catch (error: any) {
                console.error('[BotAPI] Error getting improvement recommendations:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get pending improvement tasks (for AI analysis)
        this.app.get('/api/bots/improve/tasks', requireOperator, async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                // Tasks are stored as files - read from directory
                const tasksDir = process.env.IMPROVEMENT_TASKS_DIR || 
                    require('path').join(process.cwd(), 'bots', 'improvement-tasks');
                const fs = require('fs/promises');
                const path = require('path');
                
                try {
                    const files = await fs.readdir(tasksDir);
                    const taskFiles = files.filter((f: string) => f.endsWith('.json'));
                    
                    const tasks: any[] = [];
                    for (const file of taskFiles) {
                        try {
                            const content = await fs.readFile(path.join(tasksDir, file), 'utf-8');
                            const task = JSON.parse(content);
                            tasks.push(task);
                        } catch (error) {
                            // Skip invalid files
                        }
                    }
                    
                    // Sort by priority
                    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
                    tasks.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
                    
                    res.json({ tasks, count: tasks.length, directory: tasksDir });
                } catch (error: any) {
                    if (error.code === 'ENOENT') {
                        res.json({ tasks: [], count: 0, directory: tasksDir, message: 'Tasks directory does not exist yet' });
                    } else {
                        throw error;
                    }
                }
            } catch (error: any) {
                console.error('[BotAPI] Error getting improvement tasks:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Run improvement cycle
        this.app.post('/api/bots/improve/cycle', requireOperator, async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Improvement endpoints disabled in production' });
                return;
            }

            try {
                const { botId } = req.body;
                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const improvementLoop = this.botManager.getSelfImprovementLoop();
                if (!improvementLoop) {
                    res.status(503).json({ error: 'Self-improvement loop not available (development mode required)' });
                    return;
                }

                const cycle = await improvementLoop.runImprovementCycle(botId);
                res.json(cycle);
            } catch (error: any) {
                console.error('[BotAPI] Error running improvement cycle:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Improvement tasks endpoint
        this.app.get('/api/bots/improve/tasks', requireOperator, async (req: BotAPIRequest, res: Response) => {
            await authenticateToken(req, res, async () => {
                try {
                    const autoPilot = this.botManager.getAutoPilot();
                    if (!autoPilot) {
                        res.status(503).json({ error: 'AutoPilot not available' });
                        return;
                    }

                    const status = req.query.status as string | undefined;
                    const tasks = await autoPilot.getPendingTasks();

                    const filtered = status
                        ? tasks.filter(t => t.status === status)
                        : tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

                    res.json({ tasks: filtered, total: filtered.length });
                } catch (error: any) {
                    console.error('[BotAPI] Error getting improvement tasks:', error);
                    res.status(500).json({ error: error.message });
                }
            }, this.adminApiService);
        });

        // Analytics endpoints
        // Get conversation analytics
        this.app.get('/api/bots/:botId/analytics', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined;
                const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined;

                const analytics = (this.botManager as any).getConversationAnalytics?.();
                if (!analytics) {
                    res.status(503).json({ error: 'Conversation analytics not available' });
                    return;
                }

                const result = await analytics.getAnalytics(botId, startTime, endTime);
                res.json(result);
            } catch (error: any) {
                console.error('[BotAPI] Error getting analytics:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get purpose distribution
        this.app.get('/api/bots/:botId/purposes', requireManager, async (req: BotAPIRequest, res: Response) => {
            try {
                const { botId } = req.params;
                const analytics = (this.botManager as any).getConversationAnalytics?.();
                if (!analytics) {
                    res.status(503).json({ error: 'Conversation analytics not available' });
                    return;
                }

                const result = await analytics.getAnalytics(botId);
                res.json({ botId, purposeDistribution: result.purposeDistribution });
            } catch (error: any) {
                console.error('[BotAPI] Error getting purpose distribution:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // ========================================
        // ON-DEMAND TEST API (DEVELOPMENT ONLY)
        // These endpoints allow the AI assistant to run tests directly
        // ========================================

        // Run specific test cases on demand
        this.app.post('/api/test/run', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const { botId, testCases } = req.body;

                if (!botId) {
                    res.status(400).json({ error: 'Missing botId' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available (only in development mode)' });
                    return;
                }

                // If no test cases provided, run default tests
                const cases = testCases && testCases.length > 0 ? testCases : [
                    { id: 'greeting', input: 'Hello!', expectedBehavior: { shouldContain: ['hello', 'hi', 'hey', 'greetings'] } },
                    { id: 'location', input: 'Where are we?', expectedBehavior: { shouldContain: ['universe', 'world', 'room', 'area'] } },
                    { id: 'memory', input: "I'm hungry", expectedBehavior: { shouldNotContain: ['[', ']', '<', '>'] } },
                ];

                // Create test suite object
                const testSuiteId = `ondemand-${Date.now()}`;
                const testSuite = {
                    id: testSuiteId,
                    name: `On-demand Test Suite`,
                    testCases: cases,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };

                // Run the tests
                const results = await testRunner.runTestSuite(testSuite, botId);

                res.json({
                    botId,
                    testSuiteId: results.id,
                    status: results.status,
                    summary: results.summary,
                    results: results.results,
                    duration: results.duration,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error running tests:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Simulate a full conversation (multi-turn)
        this.app.post('/api/test/conversation', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const { botId, messages, userName = 'Test User' } = req.body;

                if (!botId || !messages || !Array.isArray(messages) || messages.length === 0) {
                    res.status(400).json({ error: 'Missing botId or messages array' });
                    return;
                }

                const testRunner = this.botManager.getTestRunner();
                if (!testRunner) {
                    res.status(503).json({ error: 'Test runner not available (only in development mode)' });
                    return;
                }

                // Convert messages to test cases with context preservation
                // Mark all conversation turns as preserveContext to maintain context across turns
                const testCases = messages.map((msg: string, index: number) => ({
                    id: `turn-${index + 1}`,
                    name: `Turn ${index + 1}`,
                    botId: botId as string,
                    chatInstructions: '',
                    input: msg,
                    expectedBehavior: {
                        shouldNotContain: ['[', ']', '<think>', '</think>', 'END_TOOL'],
                    },
                    metadata: {
                        preserveContext: true, // Don't clear memory between turns
                    },
                }));

                // Create test suite object
                const testSuiteId = `conversation-${Date.now()}`;
                const testSuite = {
                    id: testSuiteId,
                    name: `Conversation Test with ${userName}`,
                    testCases: testCases,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                };

                // Run as a single conversation (preserves context)
                const results = await testRunner.runTestSuite(testSuite, botId);

                // Extract the conversation flow
                // Safety: Remove emotion blocks in case they leaked through (handle both complete and incomplete blocks)
                const conversationFlow = results.results.map((r: any) => {
                    let botResponse = r.response || '';
                    // Remove complete emotion blocks
                    botResponse = botResponse.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*?\[\/EMOTION_UPDATE\]/gi, '');
                    // Remove incomplete emotion blocks (missing closing tag)
                    botResponse = botResponse.replace(/\[EMOTION_UPDATE\]\s*[\s\S]*$/gi, '');
                    botResponse = botResponse.trim();
                    return {
                        turn: r.testCaseId,
                        userMessage: r.input || testSuite.testCases.find((tc: any) => tc.id === r.testCaseId)?.input,
                        botResponse,
                        passed: r.passed,
                        responseTime: r.responseTime,
                        emotions: r.emotions, // Include emotions separately
                    };
                });

                res.json({
                    botId,
                    testSuiteId: results.id,
                    status: results.status,
                    summary: results.summary,
                    conversationFlow,
                    duration: results.duration,
                });
            } catch (error: any) {
                console.error('[BotAPI] Error running conversation test:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get test runner status and capabilities
        this.app.get('/api/test/status', async (req: BotAPIRequest, res: Response) => {
            // Block in production
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({ error: 'Test endpoints disabled in production' });
                return;
            }

            try {
                const testRunner = this.botManager.getTestRunner();
                const autoPilot = this.botManager.getAutoPilot();

                res.json({
                    testRunnerAvailable: !!testRunner,
                    autoPilotAvailable: !!autoPilot,
                    autoPilotRunning: autoPilot?.isRunning() ?? false,
                    environment: process.env.NODE_ENV,
                    capabilities: {
                        runTests: !!testRunner,
                        runConversation: !!testRunner,
                        replayConversation: !!this.botManager.getConversationReplay(),
                    },
                });
            } catch (error: any) {
                console.error('[BotAPI] Error getting test status:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }

    /**
     * Start the API server
     */
    start(port: number = 3001): void {
        const isDevMode = process.env.ENABLE_MOVEMENT_LOGGING === 'true' || process.env.NODE_ENV === 'development';
        
        if (isDevMode) {
            console.log('[BotAPI] Registering movement endpoints in start() (dev mode)');
            
            // Register movement endpoints - simple, no conditions
            this.app.get('/dev/movement/test', (req: Request, res: Response) => {
                res.json({ status: 'ok', message: 'Movement API is accessible', timestamp: new Date().toISOString() });
            });
            
            this.app.get('/dev/movement/logs', (req: Request, res: Response) => {
                try {
                    const botId = req.query.botId as string | undefined;
                    const count = parseInt(req.query.count as string || '100', 10);
                    if (botId) {
                        const events = movementLogger.getRecentEvents(botId, count);
                        res.json({ botId, events, count: events.length });
                    } else {
                        const allEvents = movementLogger.getAllEvents();
                        res.json({ events: allEvents.slice(-count), count: allEvents.length, total: allEvents.length });
                    }
                } catch (error: any) {
                    console.error('[BotAPI] Error getting movement logs:', error);
                    res.status(500).json({ error: error.message, events: [], count: 0 });
                }
            });
            
            this.app.get('/dev/movement/analyze/:botId', (req: Request, res: Response) => {
                try {
                    const { botId } = req.params;
                    const timeWindow = parseInt(req.query.timeWindow as string || '10000', 10);
                    const analysis = movementLogger.analyzeMovement(botId, timeWindow);
                    res.json({ botId, timeWindow, ...analysis });
                } catch (error: any) {
                    console.error('[BotAPI] Error analyzing movement:', error);
                    res.status(500).json({ error: error.message });
                }
            });
            
            this.app.get('/dev/movement/summary', (req: Request, res: Response) => {
                try {
                    const summary = movementLogger.getSummary();
                    res.json(summary);
                } catch (error: any) {
                    console.error('[BotAPI] Error getting movement summary:', error);
                    res.status(500).json({ error: error.message });
                }
            });
            
            console.log('[BotAPI] Movement endpoints registered at /dev/movement/*');
        }
        
        this.server = this.app.listen(port, () => {
            console.log(`[BotAPI] Server running on port ${port}`);
        });
    }
    
    /**
     * Stop the API server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('[BotAPI] Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get Express app (for testing or custom server setup)
     */
    getApp(): express.Application {
        return this.app;
    }
}
