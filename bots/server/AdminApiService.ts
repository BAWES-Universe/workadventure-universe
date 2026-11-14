/**
 * AdminApiService - Integration with WorkAdventure Admin API for bot tracking
 * 
 * This service tracks bot configuration and usage across rooms, worlds, and universes.
 */

import axios, { type AxiosResponse } from 'axios';
import * as Sentry from '@sentry/node';
import { parseForgetNotice, parseItemForgets, type ItemForgetHandler, type MemoryForgetHandler } from '../memory/ForgetNotice';
import { SOMEONE_UNKNOWN } from '../memory/Heard';
import type { WokaList } from '../matrix/wokaPicture';
import type { VoiceActiveAnswer, VoiceCredentialsAnswer, VoiceHealthReport, VoiceLimits } from '../voice/VoiceSettings';
import type { CleanupJob, CleanupOutcome, Lease, NoteHearingAnswer, Reservation, ReserveInput, TurnEvent, VoiceNoteCapabilities } from '../voice/VoiceNoteOrbit';
import { RUNNABLE_KINDS, dueRunOf, type DueRun, type RunCheck, type RunReport } from './BrickRunner';

// Optional Sentry integration (uncomment if @sentry/node is installed)
// import * as Sentry from '@sentry/node';

// Helper to safely capture exceptions (works with or without Sentry)
const captureException = (error: unknown) => {
    // Uncomment if Sentry is configured:
    // Sentry.captureException(error);
    console.error('AdminApiService error:', error);
};

/** Which reply limit stopped a reply (#1159): a person's Universe AI replies, a guest's, a bot's guests' pool, or the bot's own. */
export const REPLY_LIMIT_KINDS = ['universe-ai', 'guest', 'guests', 'bot'] as const;
export type ReplyLimitKind = (typeof REPLY_LIMIT_KINDS)[number];
/** Who reached it, so the card shows the one button that fits them: Sign in, Ask the maker, or Use my AI key. */
export const REPLY_ASKERS = ['guest', 'member', 'maker'] as const;
export type ReplyAsker = (typeof REPLY_ASKERS)[number];
export type ReplyAllowance = { allowed: true } | { allowed: false; limit: ReplyLimitKind; resetsAt: string; who: ReplyAsker };

export function resolveAdminApiEndpoint(adminApiUrl: string | URL, endpoint: string): string {
    const baseUrl = new URL(adminApiUrl.toString());
    if (!baseUrl.pathname.endsWith('/')) {
        baseUrl.pathname += '/';
    }
    baseUrl.search = '';
    baseUrl.hash = '';
    return new URL(endpoint.replace(/^\/+/, ''), baseUrl).toString();
}

let warnedInsecureAdminUrl = false;

/**
 * Whether an Orbit session may be sent to this Admin API URL. Production needs https. Outside production,
 * plain http is also allowed to hosts that only exist on a local or docker network (loopback, *.localhost,
 * single-label docker service names, host.docker.internal and private IPv4 ranges), never to public hosts.
 */
export function canSendSessionTo(adminApiUrl: URL, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
    if (adminApiUrl.protocol === 'https:') return true;
    if (adminApiUrl.protocol !== 'http:' || nodeEnv === 'production') return false;

    const hostname = adminApiUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]') return true;
    if (hostname === 'host.docker.internal' || hostname.endsWith('.internal')) return true;
    if (!hostname.includes('.')) return true; // docker compose service name, e.g. http://admin:3000

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// ---- Live artifacts (game #1422, Orbit #622) -----------------------------------------------------------------------

export type ArtifactKind = 'app' | 'page' | 'markdown' | 'svg';

/** A chat by the id the game uses for it: the bubble's space name, or the direct chat's Matrix room. */
export interface ArtifactChat {
    kind: 'nearby' | 'dm';
    ref: string;
}

/** Who asks. A guest has no account (nothing is kept for them beyond a day). */
export interface ArtifactPerson {
    signedIn: boolean;
    identifier?: string | null;
    name?: string | null;
}

/** Every artifact call names the bot, the person and the chat. */
export interface ArtifactCall {
    botId: string;
    person: ArtifactPerson;
    chat: ArtifactChat;
}

/**
 * Read and change also carry the artifacts the person pointed at (game #1781): the one way a bot opens another bot's work.
 * Only these two routes take it; the list and the search refuse a body with fields they do not know.
 */
export interface ArtifactReachCall extends ArtifactCall, ForEveryoneHere {
    referencedArtifactIds?: string[];
}

/**
 * A call for a reply that other people in the bubble or meeting room read too (game #1993). Orbit then answers with only
 * what all of them may see: of the artifacts what the chat shares, and of the files those every one of them was there for.
 * Only the routes that read, change, list and find take it; the ones that make or add refuse a body with it.
 */
export interface ForEveryoneHere {
    everyoneHere?: boolean;
}

/** For files, also everyone else who is there now, by who they are (their uuid): a file goes by who was there for it. */
export interface FileReachCall extends ArtifactCall, ForEveryoneHere {
    others?: string[];
}

/** What Orbit's file routes take as "everyone else who is there": at most this many people, each id at most this long. */
const MAX_OTHERS_NAMED = 200;
const MAX_PERSON_ID_CHARS = 320;

/** Only who and where, for the routes that take nothing else. */
function plainCall(call: ArtifactCall): ArtifactCall {
    return { botId: call.botId, person: call.person, chat: call.chat };
}

/**
 * Who reads a reply, as the file and artifact routes take it: nothing when the person is alone with the bot, and for a
 * reply other people read, that it is one and who else is there.
 */
export function reachFor(present: readonly string[] | undefined): { everyoneHere?: boolean; others?: string[] } {
    if (!present) return {};
    // More people, or a longer id, than Orbit takes in one call: then someone there cannot be named to it, and it uses
    // no file, as for anyone the bot cannot name
    const named = present.length <= MAX_OTHERS_NAMED && present.every((id) => id.length <= MAX_PERSON_ID_CHARS);
    return { everyoneHere: true, others: named ? [...present] : [SOMEONE_UNKNOWN] };
}

/** The answer of an Orbit from before a field in the body existed: its routes refuse a body they do not know. */
export function isUnknownField(error: unknown): boolean {
    return error instanceof ArtifactCallError && error.status === 400 && error.code === 'Invalid request data';
}

export interface ArtifactEdit {
    old: string;
    new: string;
    all?: boolean;
}

export interface ArtifactSummary {
    id: string;
    title: string;
    kind: ArtifactKind;
    makerName: string;
    version: number;
    /** Set when this artifact is a copy; a change to another bot's artifact answers with the bot's own copy (Orbit #800). */
    copiedFromId?: string | null;
}

export interface ArtifactVersionSummary {
    number: number;
    summary: string | null;
    /** The songs, images and videos it carries (#1510); missing from an Orbit before that. */
    media?: Array<{ name: string; contentType: string; sizeBytes: number }>;
}

/** A song, image or video sent with a make or a change (#1510), under the name the page uses. */
export interface ArtifactMediaUpload {
    name: string;
    contentType: string;
    body: Uint8Array;
}

/** Orbit said no, or could not be asked. `code` is Orbit's (edit_not_found, change_not_allowed, ...) or orbit_unavailable. */
export class ArtifactCallError extends Error {
    constructor(
        public readonly code: string,
        public readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'ArtifactCallError';
    }
}

/**
 * A make or a change takes a little longer than the access check: Orbit saves the file first. How long it may take is a
 * super admin's "Time to save" (Orbit #666), passed with the call; this is for a call without it (a read or a list).
 */
const ARTIFACT_TIMEOUT_MS = 30_000;
const BOT_FILE_TIMEOUT_MS = 15_000;

/** A file to add to the bot's list (Orbit's POST /api/bot-files, #1508). */
export interface BotFileAdd {
    source: 'person' | 'bot';
    kind: 'image' | 'audio' | 'video' | 'document' | 'other';
    name: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    store: { bucket: string; fileId: string } | { url: string };
    line?: string | null;
    madeWith?: string | null;
    madePrompt?: string | null;
    lengthSeconds?: number | null;
    pages?: number | null;
    /**
     * Everyone else who was in the bubble or meeting room when it was put in the chat (game #1993), by who they are. Orbit
     * keeps them with the person: a reply other people read uses the file only when all of them were there.
     */
    others?: string[];
}

/** A file in the bot's list as Orbit answers it. */
export interface BotFileSummary {
    ref: string;
    name: string;
    kind: string;
    source: string;
    mimeType: string | null;
    line: string | null;
    lengthSeconds: number | null;
    pages: number | null;
    mine: boolean;
    inThisChat: boolean;
    text: { state: string; chars: number };
    createdAt: string;
}

/** One file as Orbit's get and read answer it: where it is kept, and the whole prompt that made it. */
export interface BotFileView extends BotFileSummary {
    sizeBytes: number | null;
    made: { with: string; prompt: string | null } | null;
    store: { bucket: string; fileId: string } | { url: string };
}

/** A piece of a file's kept text (POST /api/bot-files/read), from `at` to `end`; `next` is null at the end. */
export interface BotFileRead {
    file: BotFileView;
    text: string;
    at: number;
    end: number;
    next: number | null;
    hidden: boolean;
}

/** One page of Orbit's search (POST /api/bot-files/find): files, and artifacts as their own kind of item. */
export interface BotFilesFound {
    items: (
        | ({
              type: 'file';
              made: { with: string; prompt: string | null; promptChars: number } | null;
              sizeBytes?: number | null;
              /** Where the words are in its text: a place to open from, and the text around it. */
              hit?: { at: number; snippet: string };
          } & BotFileSummary)
        | { type: 'artifact'; id: string; title: string; kind: string; makerName: string; version: number; mine: boolean; inThisChat: boolean; updatedAt: string }
    )[];
    total: number;
    page: number;
    pages: number;
    matched: 'all' | 'any' | null;
    hidden: boolean;
}

/**
 * What people do with a bot, as Orbit's check names it. `change` and `deleteOrSend` are the two permissions a bot's tool
 * needs to change things or to delete or send something (Orbit #737, game #1656).
 */
export type BotAccessAction = 'chat' | 'dm' | 'call' | 'summon' | 'change' | 'deleteOrSend';

/** Who is asking: a signed-in person is named by their uuid or email, a guest only by being a guest. */
export interface BotAccessPerson {
    signedIn: boolean;
    identifier?: string | null;
    /** For a direct message that reached the bot over chat: the sender's Matrix ID, which Orbit looks up instead. */
    chatId?: string | null;
}

/** Orbit's answer to "can this person do this with this bot?" (POST /api/bots/:id/access). */
export interface BotAccessAnswer {
    allowed: boolean;
    code: 'allowed' | 'sign_in_required' | 'not_allowed' | 'no_room_access' | 'unknown_person' | 'shared_chat_id' | 'banned';
    /** A line to show as it is. Null when allowed. */
    reason: string | null;
    /** The owner's own line for people who may not chat with the bot, only when the owner wrote one. */
    reply?: string;
    /** Whose chat account it is, when the person was named by `chatId` and Orbit found exactly one account. */
    person?: { uuid: string; name: string | null };
}

/** Orbit failing a direct message's access check is reported to Sentry at most this often, not once per message. */
const DM_ACCESS_REPORT_EVERY_MS = 60_000;
let lastDmAccessReportAt = 0;

/** How long a bot waits for Orbit's access answer before it counts as "could not check". */
const BOT_ACCESS_TIMEOUT_MS = 4_000;

export interface BotConfiguration {
    botId: string;
    name: string;
    // A Brick (#1995) lives in its owner's chats and stands in no room: both are empty for one.
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    // Set only for a Brick: whose it is, and whether it is the one every account gets. A config with it is answered in
    // direct messages only and is never put on a map.
    // `deleted` (#1996): its owner deleted it and Undo can still give it back. It answers nobody and keeps its chat.
    brick?: { ownerId: string; isDefault: boolean; deleted?: boolean };
    userId?: string; // User who created the bot
    behaviorType: 'idle' | 'patrol' | 'social';
    behaviorConfig: Record<string, any>;
    
    // AI Configuration (Sensitive - stored in Admin API only)
    aiProviderRef?: string; // Reference to AI provider (e.g., "lmstudio-local")
    
    // Chat Instructions (Sensitive - stored in Admin API only)
    chatInstructions?: string; // System prompt/instructions for AI behavior

    // How long the bot waits for a tool (MCP) call to answer, in seconds ("Patience").
    // Null or missing means the bot server's default (REQUEST_TIMEOUT, 90 s).
    toolTimeoutSeconds?: number | null;

    // The bot's own longest reply (tokens) and steps in one reply, lower than its key's (Orbit #666). Null follows the key.
    maxReplyTokens?: number | null;
    maxSteps?: number | null;
    
    // Assigned space defines where the bot operates (center + radius)
    // Required: All bots must have an assigned space
    // For idle bots: radius=0 means they won't move
    // For social/patrol bots: radius defines the operational area
    assignedSpace: {
        center: { x: number; y: number };
        radius: number;
    };
    enabled?: boolean; // Whether bot is active (defaults to true if not specified)
    // Whether the bot joins its bubble's audio: the owner's choice, off until the owner turns it on (Orbit #740 will
    // send it). Missing means off, and the bot stays text-only.
    voiceEnabled?: boolean;
    characterTextureIds?: string[]; // Character texture IDs for bot appearance
    // The companion (pet) that walks with the bot: a companion texture id from the room's companion list.
    // Null or missing means none.
    companionTextureId?: string | null;
    position?: { x: number; y: number }; // Teleport position (runtime-only, not persisted)
    createdAt: Date;
    updatedAt: Date;
}

/** Whose Brick a configuration from Orbit is (#1995), or null for a room bot and for anything that isn't shaped like one. */
function brickOf(data: unknown): { ownerId: string; isDefault: boolean; deleted?: boolean } | null {
    const brick = (data as { brick?: unknown } | null)?.brick;
    if (!brick || typeof brick !== 'object') return null;
    const { ownerId, isDefault, deleted } = brick as { ownerId?: unknown; isDefault?: unknown; deleted?: unknown };
    return typeof ownerId === 'string' && ownerId ? { ownerId, isDefault: isDefault === true, ...(deleted === true ? { deleted: true } : {}) } : null;
}

/** One App on Orbit's list as a Brick may offer it (game #2001): what a person sees of it, and where they stand with it. */
export interface OfferableApp {
    key: string;
    name: string;
    blurb: string;
    /** The person's own connection to it, when they have one. */
    connectionId: string | null;
    /** That connection is signed in and works. */
    connected: boolean;
    /** This Brick already has it. */
    usable: boolean;
}

/** A person's Brick as Orbit lists it (#1996): what the game needs to show it, nothing that steers it. */
export interface BrickCard {
    id: string;
    name: string;
    description: string | null;
    characterTextureId: string | null;
    enabled: boolean;
    isDefault: boolean;
    hello: string | null;
}

/** What a person's Brick says about a new Brick it makes for them (#1996). */
export interface NewBrickAsk {
    name: string;
    description?: string;
    chatInstructions?: string;
    hello?: string;
    /** They asked for a second one of a name they already have. */
    evenIfThere?: boolean;
}

/** What Orbit serves the bot server to run the Brick for guests in one room (game #1997). Universe AI's own credentials. */
export interface GuestBrickSetup {
    brick: { name: string; description: string; characterTextureId: string; chatInstructions: string };
    credentials: Record<string, any> & { maxTokens?: number; limits?: Partial<import('../ai/types').BotLimits> };
}

/** May a guest get one more reply from the Brick for guests: yes, or which allowance is used up and when it opens again. */
export type GuestBrickAllowance =
    /** `counted` is false when Orbit already counted this very try and it did not fail: it is answered or being answered, so no model runs again. Absent from an Orbit that does not say: treated as counted. */
    | { allowed: true; counted?: boolean }
    | { allowed: false; limit: 'guest' | 'universe'; resetsAt: string };

const BRICK_CALL_TIMEOUT_MS = 8_000;

function brickCardOf(data: unknown): BrickCard | null {
    const card = data as Partial<BrickCard> | null;
    if (!card || typeof card.id !== 'string' || typeof card.name !== 'string') return null;
    return {
        id: card.id,
        name: card.name,
        description: typeof card.description === 'string' ? card.description : null,
        characterTextureId: typeof card.characterTextureId === 'string' ? card.characterTextureId : null,
        enabled: card.enabled !== false,
        isDefault: card.isDefault === true,
        hello: typeof card.hello === 'string' ? card.hello : null,
    };
}

export interface BotUsageMetrics {
    botId: string;
    roomUrl: string;
    worldUrl: string;
    universeUrl?: string;
    userId?: string;
    totalConversations: number;
    totalMessages: number;
    totalActiveTime: number; // milliseconds
    lastActiveAt: Date;
    conversationsByDate: Array<{
        date: string;
        count: number;
    }>;
}

export interface BotUsageQuery {
    roomUrl?: string;
    worldUrl?: string;
    universeUrl?: string;
    userId?: string;
    botId?: string;
    startDate?: Date;
    endDate?: Date;
}

/** Orbit turned a bot save down and said why, in words meant for the person saving. */
export class BotConfigRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BotConfigRefused';
    }
}

/** The fields of one provider, as Orbit serves them. */
export interface AIProviderCredentials {
    providerId: string;
    name: string;
    type: string;
    enabled: boolean;
    endpoint: string;
    apiKeyEncrypted: string | null;
    model: string;
    temperature: number;
    maxTokens: number;
    supportsStreaming: boolean;
    supportsVision: boolean | null;
    visionModel: string | null;
    defaultVision: boolean;
    settings?: Record<string, any>;
    /** The bot's limits (Orbit #666); only on an answer for one bot, from an Orbit that has them. */
    limits?: unknown;
}

/**
 * Orbit's answer for a bot (#374): a provider and where it came from, or "resting". `own-key` is a person's own key
 * (`keyAddressTyped` says the person typed its address, so the address guard applies); `universe-ai` may stand in for
 * a key that is down (`standingInFor`); `resting` means the owner chose Stop replying: say the line, call nothing.
 */
export type BotAiCredentialsAnswer =
    | (AIProviderCredentials & {
          source: 'provider' | 'universe-ai' | 'own-key';
          keyOwnerId?: string;
          keyAddressTyped?: boolean;
          standingInFor?: string;
          movedFromKey?: string;
      })
    | { source: 'resting'; keyOwnerId: string; restingLine: string };

export class AdminApiService {
    private adminApiUrl: string;
    // Cache for room metadata (room URL -> metadata, cached for 5 minutes)
    private roomMetadataCache: Map<string, { data: { universeName: string; worldName: string; roomName: string }; cachedAt: number }> = new Map();
    private readonly ROOM_METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private adminApiToken: string;
    // Hide bot conversations (#1166): the answer per bot, asked of Orbit at most every 30 seconds
    private botPrivacyCache: Map<string, { hidden: boolean; cachedAt: number; notFoundInARow?: number }> = new Map();
    private botPrivacyRequests: Map<string, Promise<boolean>> = new Map();
    private readonly BOT_PRIVACY_CACHE_TTL = 30 * 1000;
    // "Not found" answers in a row (30 seconds apart) before a bot is taken as deleted
    private readonly BOT_GONE_AFTER = 3;
    private forgetHandler: MemoryForgetHandler | null = null;
    private itemForgetHandler: ItemForgetHandler | null = null;
    private privacySyncTimer: NodeJS.Timeout | null = null;

    constructor(adminApiUrl?: string, adminApiToken?: string) {
        this.adminApiUrl = adminApiUrl || process.env.ADMIN_API_URL || '';
        this.adminApiToken = adminApiToken || process.env.ADMIN_API_TOKEN || '';
    }

    /**
     * Check if admin API is configured
     */
    isConfigured(): boolean {
        return !!this.adminApiUrl && !!this.adminApiToken;
    }

    /**
     * Save bot configuration to admin API
     */
    async saveBotConfiguration(config: BotConfiguration, actingSession?: string): Promise<void> {
        if (!this.isConfigured()) {
            console.warn('[AdminApiService] Admin API not configured, skipping bot configuration save');
            return;
        }

        try {
            const payload = {
                ...config,
                createdAt: config.createdAt.toISOString(),
                updatedAt: config.updatedAt.toISOString(),
            };
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saving bot config for ${config.botId}:`, {
                    botId: payload.botId,
                    name: payload.name,
                    behaviorType: payload.behaviorType,
                    hasBehaviorConfig: !!payload.behaviorConfig,
                    hasAiProviderRef: !!payload.aiProviderRef,
                    aiProviderRef: payload.aiProviderRef,
                    hasChatInstructions: !!payload.chatInstructions,
                });
            }
            
            await axios.post(
                `${this.adminApiUrl}/api/bots/configuration`,
                payload,
                {
                    headers: {
                        // A change only a person may make (a bot on their own AI key) goes with their session, so Orbit can see whose it is
                        Authorization: `Bearer ${actingSession ?? this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Successfully saved bot config for ${config.botId}`);
            }
        } catch (error) {
            // Orbit turned the save down and said why: that is an answer for the person, not a crash
            if (axios.isAxiosError(error) && error.response?.status === 400 && typeof error.response.data?.error === 'string') {
                throw new BotConfigRefused(error.response.data.error);
            }
            console.error('[AdminApiService] Error saving bot configuration:', error);
            if ((process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') && axios.isAxiosError(error) && error.response) {
                console.error('[AdminApiService] Response status:', error.response.status);
                console.error('[AdminApiService] Response data:', error.response.data);
            }
            captureException(error);
            throw error;
        }
    }

    /**
     * Get bot configuration from admin API.
     *
     * `bricks` also takes a Brick (#1995), which Orbit answers only when asked for by name: a Brick has no room, so only
     * a caller that never puts the bot on a map (direct messages) may ask for one. Everyone else still gets "no such
     * bot" for a Brick's id.
     */
    async getBotConfiguration(botId: string, timeoutMs?: number, options: { bricks?: boolean } = {}): Promise<BotConfiguration | null> {
        if (!this.isConfigured()) {
            return null;
        }

        try {
            const response: AxiosResponse<BotConfiguration> = await axios.get(
                `${this.adminApiUrl}/api/bots/configuration/${encodeURIComponent(botId)}`,
                {
                    timeout: timeoutMs,
                    ...(options.bricks ? { params: { bricks: 1 } } : {}),
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                }
            );

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Fetched bot config for ${botId}:`, {
                    botId: response.data.botId,
                    name: response.data.name,
                    behaviorType: response.data.behaviorType,
                    hasBehaviorConfig: !!response.data.behaviorConfig,
                    hasAiProviderRef: !!response.data.aiProviderRef,
                    aiProviderRef: response.data.aiProviderRef,
                    hasChatInstructions: !!response.data.chatInstructions,
                });
            }

            const brick = brickOf(response.data);
            // A Brick that was not asked for is not a bot this caller can run: the same answer as a bot that isn't there
            if (brick && !options.bricks) return null;
            return {
                ...response.data,
                // Orbit sends no room for a Brick; the rest of the bot server reads "no room" as an empty address
                roomUrl: response.data.roomUrl || '',
                worldUrl: response.data.worldUrl || '',
                universeUrl: response.data.universeUrl || undefined,
                brick: brick ?? undefined,
                createdAt: new Date(response.data.createdAt),
                updatedAt: new Date(response.data.updatedAt),
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting bot configuration:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * The woka list the game uses for a bot in its room (the bot picker's list), to draw the bot's Woka. Null when
     * Orbit isn't set up; errors throw, so the caller tries again later.
     */
    async getBotWokaList(roomUrl: string, botId: string): Promise<WokaList | null> {
        if (!this.isConfigured()) return null;
        const response: AxiosResponse<WokaList> = await axios.get(`${this.adminApiUrl}/api/woka/list`, {
            params: { roomUrl, context: 'bot', botId },
            timeout: 10000,
            headers: { Authorization: `Bearer ${this.adminApiToken}` },
        });
        return response.data && typeof response.data === 'object' ? response.data : null;
    }

    /**
     * Get all bot configurations for a room/world/universe
     */
    async getBotConfigurations(query: {
        roomUrl?: string;
        worldUrl?: string;
        universeUrl?: string;
        userId?: string;
    }): Promise<BotConfiguration[]> {
        if (!this.isConfigured()) {
            return [];
        }

        try {
            const response: AxiosResponse<BotConfiguration[]> = await axios.get(
                `${this.adminApiUrl}/api/bots/configuration`,
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                    params: query,
                }
            );

            return response.data.map((config) => ({
                ...config,
                createdAt: new Date(config.createdAt),
                updatedAt: new Date(config.updatedAt),
            }));
        } catch (error) {
            console.error('[AdminApiService] Error getting bot configurations:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Delete bot configuration
     */
    async deleteBotConfiguration(botId: string): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.delete(`${this.adminApiUrl}/api/bots/configuration/${encodeURIComponent(botId)}`, {
                headers: {
                    Authorization: `Bearer ${this.adminApiToken}`,
                },
            });
        } catch (error) {
            console.error('[AdminApiService] Error deleting bot configuration:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Track bot usage metrics
     */
    async trackBotUsage(metrics: Partial<BotUsageMetrics>): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/usage`,
                {
                    ...metrics,
                    lastActiveAt: metrics.lastActiveAt?.toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            console.error('[AdminApiService] Error tracking bot usage:', error);
            captureException(error);
            // Don't throw - usage tracking shouldn't break bot functionality
        }
    }

    /**
     * Get bot usage metrics
     */
    async getBotUsage(query: BotUsageQuery): Promise<BotUsageMetrics[]> {
        if (!this.isConfigured()) {
            return [];
        }

        try {
            const params: Record<string, string> = {};
            if (query.roomUrl) params.roomUrl = query.roomUrl;
            if (query.worldUrl) params.worldUrl = query.worldUrl;
            if (query.universeUrl) params.universeUrl = query.universeUrl;
            if (query.userId) params.userId = query.userId;
            if (query.botId) params.botId = query.botId;
            if (query.startDate) params.startDate = query.startDate.toISOString();
            if (query.endDate) params.endDate = query.endDate.toISOString();

            const response: AxiosResponse<BotUsageMetrics[]> = await axios.get(
                `${this.adminApiUrl}/api/bots/usage`,
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                    },
                    params,
                }
            );

            return response.data.map((metrics) => ({
                ...metrics,
                lastActiveAt: new Date(metrics.lastActiveAt),
            }));
        } catch (error) {
            console.error('[AdminApiService] Error getting bot usage:', error);
            captureException(error);
            throw error;
        }
    }

    /**
     * Track bot conversation event
     */
    async trackConversation(botId: string, playerId: number, roomUrl: string, duration: number): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/conversations`,
                {
                    botId,
                    playerId,
                    roomUrl,
                    duration,
                    timestamp: new Date().toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error: any) {
            const msg = error?.response?.data?.message || error?.message || 'Unknown error';
            console.error(`[AdminApiService] Error tracking conversation: ${msg}`);
            // Don't throw - tracking shouldn't break functionality
        }
    }

    /**
     * Track bot message sent
     */
    async trackMessage(botId: string, roomUrl: string, messageLength: number): Promise<void> {
        if (!this.isConfigured()) {
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/messages`,
                {
                    botId,
                    roomUrl,
                    messageLength,
                    timestamp: new Date().toISOString(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.adminApiToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error: any) {
            const msg = error?.response?.data?.message || error?.message || 'Unknown error';
            console.error(`[AdminApiService] Error tracking message: ${msg}`);
            // Don't throw
        }
    }

    /**
     * Get AI provider credentials from Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     */
    async getAIProviderCredentials(providerId: string): Promise<{
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        endpoint: string;
        apiKeyEncrypted: string | null;
        model: string;
        temperature: number;
        maxTokens: number;
        supportsStreaming: boolean;
        supportsVision: boolean | null;
        visionModel: string | null;
        defaultVision: boolean;
        settings?: Record<string, any>;
    } | null> {
        if (!this.isConfigured()) {
            return null;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/ai-providers/${providerId}/credentials`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                }
            );

            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting AI provider credentials:', error);
            captureException(error as Error);
            throw error;
        }
    }

    /**
     * Ask Orbit whether the person behind a Matrix ID may message this bot directly: the same check the game asks
     * before it shows Message (roles, the bot's own rules, Private bot, room access, bans), with Orbit finding whose
     * chat account it is. Fails closed: anything that stops Orbit answering is a no whose reason starts `admin_api_`.
     *
     * `user` (the verified person) comes back only when Orbit allows the chat. A refusal carries Orbit's code as
     * `reason` and no identity.
     */
    async checkDmAccess(botId: string, chatId: string): Promise<{
        allowed: boolean;
        reason: string | null;
        user: { uuid: string; name: string | null; isGuest: boolean } | null;
    }> {
        const denied = (reason: string) => ({ allowed: false, reason, user: null });
        if (!this.isConfigured() || !process.env.BOT_SERVICE_TOKEN) {
            return denied('admin_api_not_configured');
        }
        let answer: BotAccessAnswer;
        try {
            answer = await this.checkBotAccess(botId, 'dm', { signedIn: true, chatId });
        } catch (error) {
            console.error('[AdminApiService] Error checking DM access:', error instanceof Error ? error.message : error);
            if (Date.now() - lastDmAccessReportAt >= DM_ACCESS_REPORT_EVERY_MS) {
                lastDmAccessReportAt = Date.now();
                Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
                    tags: { area: 'bot-dm-access' },
                });
            }
            return denied('admin_api_error');
        }
        if (!answer.allowed) {
            return denied(answer.code);
        }
        const person = answer.person;
        if (typeof person?.uuid !== 'string' || person.uuid === '') {
            // A yes without a verified person is not something to act on.
            return denied('admin_api_missing_user');
        }
        return {
            allowed: true,
            reason: null,
            user: { uuid: person.uuid, name: typeof person.name === 'string' ? person.name : null, isGuest: false },
        };
    }

    private brickCall<T>(method: 'get' | 'post' | 'put' | 'patch', path: string, body?: unknown, params?: Record<string, string>): Promise<AxiosResponse<T>> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!this.isConfigured() || !botServiceToken) throw new Error('Orbit is not set up for Bricks');
        return axios.request<T>({
            method,
            url: resolveAdminApiEndpoint(this.adminApiUrl, path),
            ...(body === undefined ? {} : { data: body }),
            ...(params ? { params } : {}),
            headers: { Authorization: `Bearer ${botServiceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            timeout: BRICK_CALL_TIMEOUT_MS,
        });
    }

    /**
     * A person asks their Brick for another Brick (#1996). Orbit makes it only for the owner of the Brick that asks
     * (`userId` is their game uuid), and answers the one they already have when its name is taken. Throws when Orbit
     * says no or cannot be reached: the caller tells the person it did not work.
     */
    async makeBrickFor(viaBotId: string, userId: string, ask: NewBrickAsk): Promise<{ made: boolean; brick: BrickCard }> {
        const response = await this.brickCall<{ made?: unknown; brick?: unknown }>('post', `api/bots/${encodeURIComponent(viaBotId)}/bricks`, { userId, ...ask });
        const brick = brickCardOf(response.data?.brick);
        if (!brick) throw new Error('Orbit answered without a Brick');
        return { made: response.data?.made === true, brick };
    }

    /** How often a job has to come back before a Brick is suggested for it, and every topic already suggested to this person (#1996). */
    async brickOffersFor(viaBotId: string, userId: string): Promise<{ after: number; topics: string[] }> {
        const response = await this.brickCall<{ after?: unknown; topics?: unknown }>('get', `api/bots/${encodeURIComponent(viaBotId)}/brick-offers`, undefined, { userId });
        const topics = Array.isArray(response.data?.topics) ? response.data.topics : [];
        return {
            after: typeof response.data?.after === 'number' && response.data.after >= 2 ? response.data.after : 3,
            topics: topics.map((one: unknown) => (one as { topic?: unknown } | null)?.topic).filter((topic: unknown): topic is string => typeof topic === 'string'),
        };
    }

    /** May the suggestion for this topic be shown now? Orbit says yes once per person and topic, on every device (#1996). */
    async claimBrickOffer(viaBotId: string, userId: string, topic: string): Promise<{ show: boolean; topic: string }> {
        const response = await this.brickCall<{ show?: unknown; topic?: unknown }>('post', `api/bots/${encodeURIComponent(viaBotId)}/brick-offers`, { userId, topic });
        return { show: response.data?.show === true, topic: typeof response.data?.topic === 'string' ? response.data.topic : topic };
    }

    /**
     * The Apps a Brick of this person could offer to connect (game #2001): the list a super admin keeps in Orbit, with the
     * person's own connection to each when they have one, whether it works, and whether this Brick may already use it. Orbit
     * answers only for the Brick's owner. Throws when Orbit says no or cannot be reached: the caller offers nothing then.
     */
    async appsOfferableFor(viaBotId: string, userId: string): Promise<OfferableApp[]> {
        const response = await this.brickCall<{ apps?: unknown }>('get', `api/bots/${encodeURIComponent(viaBotId)}/apps/offerable`, undefined, { userId });
        const apps = Array.isArray(response.data?.apps) ? response.data.apps : [];
        const out: OfferableApp[] = [];
        for (const one of apps) {
            const app = one as Record<string, unknown> | null;
            if (!app || typeof app.key !== 'string' || !app.key || typeof app.name !== 'string' || !app.name) continue;
            out.push({
                key: app.key,
                name: app.name,
                blurb: typeof app.blurb === 'string' ? app.blurb : '',
                connectionId: typeof app.connectionId === 'string' && app.connectionId ? app.connectionId : null,
                connected: app.connected === true,
                usable: app.usable === true,
            });
        }
        return out;
    }

    /** What the person tapped on the suggestion (#1996). Kept for the record; never throws, the topic is closed either way. */
    async answerBrickOffer(viaBotId: string, userId: string, topic: string, answer: 'made' | 'not_now'): Promise<boolean> {
        // Never throws, and says whether Orbit kept it: brickCall throws before it asks when Orbit is not set up for
        // Bricks, so that is caught here too
        try {
            await this.brickCall('put', `api/bots/${encodeURIComponent(viaBotId)}/brick-offers`, { userId, topic, answer });
            return true;
        } catch (error) {
            console.warn('[AdminApiService] Could not keep the answer to a Brick suggestion:', error instanceof Error ? error.message : error);
            return false;
        }
    }

    /**
     * The Brick for guests (game #1997) for the room a guest is in: what steers it, with the place added, and how it talks
     * to its AI (Universe AI's, never a host's). Throws when Orbit says it is not available or cannot be reached.
     */
    async getGuestBrick(roomUrl: string): Promise<GuestBrickSetup> {
        const response = await this.brickCall<Partial<GuestBrickSetup>>('get', 'api/guest-brick', undefined, { roomUrl });
        const brick = response.data?.brick;
        const credentials = response.data?.credentials;
        if (!brick || typeof brick.chatInstructions !== 'string' || !brick.chatInstructions || !credentials || typeof credentials !== 'object') {
            throw new Error('Orbit answered without the Brick for guests');
        }
        return { brick, credentials } as GuestBrickSetup;
    }

    /**
     * May this guest get one more reply from the Brick for guests now (game #1997)? Orbit counts it at once, against the guest's
     * own allowance and the universe's pool for guests, and never against a host's bot. Throws when it cannot say: no reply
     * is made without an answer, so nothing is spent that is not counted.
     */
    async claimGuestBrickReply(input: { guestId: string; turnId: string; roomUrl: string }): Promise<GuestBrickAllowance> {
        const body = (await this.brickCall<Partial<{ allowed: boolean; counted: boolean; limit: string; resetsAt: string }>>('post', 'api/guest-brick/replies', input)).data;
        if (body?.allowed === true) return body.counted === false ? { allowed: true, counted: false } : { allowed: true };
        const limit = body?.limit === 'guest' || body?.limit === 'universe' ? body.limit : null;
        if (body?.allowed === false && limit && typeof body.resetsAt === 'string' && !Number.isNaN(Date.parse(body.resetsAt))) {
            return { allowed: false, limit, resetsAt: body.resetsAt };
        }
        throw new Error('Orbit answered the guest allowance in a way that cannot be read');
    }

    /** Whether Orbit handed this guest's chat to the person with this uuid (plan v3: their uploads go with it). False when Orbit can't say. */
    async guestChatHandedTo(guestId: string, userUuid: string): Promise<boolean> {
        try {
            const body = (await this.brickCall<{ handed?: unknown }>('post', 'api/guest-brick/handover', { guestId, userUuid })).data;
            return body?.handed === true;
        } catch (error) {
            // Orbit said no (an Orbit from before has no such route): not handed. Anything else is "can't say now", and throws
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
            console.warn('[AdminApiService] Could not check a hand-over of a guest chat:', error instanceof Error ? error.message : error);
            throw error;
        }
    }

    /** Closes a counted turn: a reply that failed is given back, and what it took is kept as totals. Never throws. */
    async finishGuestBrickReply(turnId: string, result: { failed?: boolean; tokensUsed?: number; costMicros?: number | null }): Promise<void> {
        const body: Record<string, unknown> = {};
        if (result.failed) body.failed = true;
        if (typeof result.tokensUsed === 'number' && Number.isInteger(result.tokensUsed) && result.tokensUsed >= 0) body.tokensUsed = result.tokensUsed;
        if (typeof result.costMicros === 'number' && Number.isInteger(result.costMicros) && result.costMicros >= 0) body.costMicros = result.costMicros;
        await this.brickCall('patch', `api/guest-brick/replies/${encodeURIComponent(turnId)}`, body).catch((error) => {
            console.warn('[AdminApiService] Could not close a turn of the Brick for guests:', error instanceof Error ? error.message : error);
        });
    }

    /**
     * The goals and tasks that fell due (game #2002): one run for each due time, claimed in Orbit's database so two bot servers or a
     * retry never share one, and a run that was handed out and never reported, again with the same run id. Throws when Orbit cannot
     * be asked: nothing is lost, the runs are handed out again.
     */
    async claimDueItems(): Promise<DueRun[]> {
        const response = await this.brickCall<{ runs?: unknown }>('post', 'api/bricks/items/due', { kinds: RUNNABLE_KINDS });
        const runs = Array.isArray(response.data?.runs) ? response.data.runs : [];
        return runs.map(dueRunOf).filter((run): run is DueRun => run !== null);
    }

    /** May this run take its next step? No once its item was paused, finished, deleted or changed, or its Brick switched off or deleted. */
    async checkItemRun(runId: string, attempt: number): Promise<RunCheck> {
        try {
            const response = await this.brickCall<{ ok?: unknown; reason?: unknown }>('get', `api/bricks/items/runs/${encodeURIComponent(runId)}`, undefined, { attempt: String(attempt) });
            return response.data?.ok === true ? { ok: true } : { ok: false, reason: typeof response.data?.reason === 'string' ? response.data.reason : 'no' };
        } catch (error) {
            // A 404 or 409 answer says no; anything else says nothing, and the run goes on again when its lease is over
            const status = (error as { response?: { status?: number; data?: { reason?: unknown } } })?.response;
            if (status && (status.status === 404 || status.status === 409)) return { ok: false, reason: typeof status.data?.reason === 'string' ? status.data.reason : 'gone' };
            throw error;
        }
    }

    /** Keeps the chat event a run's message got. True when Orbit kept it (or already had this one). */
    async keepItemDelivered(runId: string, eventId: string): Promise<boolean> {
        try {
            await this.brickCall('post', `api/bricks/items/runs/${encodeURIComponent(runId)}/delivered`, { eventId });
            return true;
        } catch (error) {
            console.warn('[AdminApiService] Could not keep where a run spoke:', error instanceof Error ? error.message : error);
            return false;
        }
    }

    /** How a run went. True when Orbit recorded it. */
    async reportItemRun(runId: string, report: RunReport): Promise<boolean> {
        try {
            await this.brickCall('post', `api/bricks/items/runs/${encodeURIComponent(runId)}`, report);
            return true;
        } catch (error) {
            console.warn('[AdminApiService] Could not report a run:', error instanceof Error ? error.message : error);
            return false;
        }
    }

    /** Is this Brick's computer on for its owner (#2000)? Read only: it never makes or wakes anything. False when Orbit cannot be asked. */
    async computerIsOn(viaBotId: string, userId: string): Promise<boolean> {
        try {
            const response = await this.brickCall<{ on?: unknown; available?: unknown }>('get', `api/bots/${encodeURIComponent(viaBotId)}/computer-jobs`, undefined, { userId });
            return response.data?.available === true && response.data?.on === true;
        } catch (error) {
            console.warn("[AdminApiService] Could not read a Brick's computer:", error instanceof Error ? error.message : error);
            return false;
        }
    }

    /** Starts a job on the Brick's computer for its owner (#2000). Throws when Orbit cannot be reached. */
    async startComputerJob(
        viaBotId: string,
        userId: string,
        ask: { title: string; brief?: string; writes?: boolean }
    ): Promise<{ ok: true; job: { id: string; status: string; queuedFor: string | null }; restoredFrom: string | null } | { ok: false; reason: string }> {
        const response = await this.brickCall<{ ok?: unknown; reason?: unknown; job?: { id?: unknown; status?: unknown; queuedFor?: unknown }; restoredFrom?: unknown }>(
            'post',
            `api/bots/${encodeURIComponent(viaBotId)}/computer-jobs`,
            { userId, title: ask.title, ...(ask.brief ? { brief: ask.brief } : {}), ...(ask.writes === undefined ? {} : { writes: ask.writes }) }
        );
        const data = response.data;
        const job = data?.job;
        if (data?.ok === true && job && typeof job.id === 'string' && typeof job.status === 'string') {
            return {
                ok: true,
                job: { id: job.id, status: job.status, queuedFor: typeof job.queuedFor === 'string' ? job.queuedFor : null },
                restoredFrom: typeof data.restoredFrom === 'string' ? data.restoredFrom : null,
            };
        }
        return { ok: false, reason: typeof data?.reason === 'string' ? data.reason : 'unknown' };
    }

    /** A job as it stands (#2000), or null when it is not there. */
    async getComputerJob(viaBotId: string, jobId: string): Promise<{ id: string; status: string; control: string } | null> {
        try {
            const response = await this.brickCall<{ job?: { id?: unknown; status?: unknown; control?: unknown } }>('get', `api/bots/${encodeURIComponent(viaBotId)}/computer-jobs/${encodeURIComponent(jobId)}`);
            const job = response.data?.job;
            return job && typeof job.id === 'string' && typeof job.status === 'string' ? { id: job.id, status: job.status, control: typeof job.control === 'string' ? job.control : 'brick' } : null;
        } catch {
            return null;
        }
    }

    /** What a running job tells Orbit (#2000): steps, renewing its room, handing over, finishing. Throws when Orbit says no. */
    async computerJobAction(viaBotId: string, jobId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await this.brickCall<Record<string, unknown>>('post', `api/bots/${encodeURIComponent(viaBotId)}/computer-jobs/${encodeURIComponent(jobId)}`, body);
        return response.data ?? {};
    }

    /**
     * The three calls the model relay makes of Orbit about a computer's model call (identify the key, take room, settle). The relay
     * says what to do with each answer, so a status Orbit gives is passed on (a refused key is a 200 with ok: false). Throws when
     * Orbit cannot be reached or fails.
     */
    async computerRelayCall(step: 'identify' | 'authorize' | 'settle', body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
        const response = await this.brickCall<Record<string, unknown>>('post', `api/computer/llm/${step}`, body).catch((error: unknown) => {
            // A 404 from settle means "no such call" (nothing was written): an answer, not a failure
            if (axios.isAxiosError(error) && error.response && error.response.status < 500) return error.response as AxiosResponse<Record<string, unknown>>;
            throw error;
        });
        return { status: response.status, data: response.data ?? {} };
    }

    /** The jobs Brick is working on now, with the words for the agent (#2000). Throws when Orbit cannot be reached. */
    async computerRunningJobs(): Promise<Array<{ jobId: string; botId: string; title: string; brief: string | null; writes: boolean; hasTurn: boolean }>> {
        const response = await this.brickCall<{ jobs?: unknown }>('get', 'api/computer/jobs/running');
        const jobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
        return jobs.flatMap((job: Record<string, unknown>) =>
            typeof job?.jobId === 'string' && typeof job.botId === 'string' && typeof job.title === 'string'
                ? [{ jobId: job.jobId, botId: job.botId, title: job.title, brief: typeof job.brief === 'string' ? job.brief : null, writes: job.writes !== false, hasTurn: job.hasTurn === true }]
                : []
        );
    }

    /** One call to a computer's broker route in Orbit that answers with JSON (prepare, cancel): the status is passed on, never thrown for a 4xx or 5xx. */
    async computerBroker(jobId: string, step: 'prepare' | 'cancel', body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
        const response = await this.brickCall<Record<string, unknown>>('post', `api/computer/jobs/${encodeURIComponent(jobId)}/${step}`, body).catch((error: unknown) => {
            if (axios.isAxiosError(error) && error.response) return error.response as AxiosResponse<Record<string, unknown>>;
            throw error;
        });
        return { status: response.status, data: response.data ?? {} };
    }

    /**
     * Opens a computer's turn in Orbit as a stream: `turn` sends the agent a message, `stream` reconnects to the turn it is on. A 200 is
     * the events; any other answer is its JSON ({ reason, responseId? }). Throws when Orbit cannot be reached.
     */
    async computerOpenTurn(
        jobId: string,
        step: 'turn' | 'stream',
        input: string | null,
        signal: AbortSignal
    ): Promise<{ ok: true; body: ReadableStream<Uint8Array> } | { ok: false; status: number; reason: string; responseId?: string }> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!this.isConfigured() || !botServiceToken) throw new Error('Orbit is not set up for Bricks');
        const answer = await fetch(resolveAdminApiEndpoint(this.adminApiUrl, `api/computer/jobs/${encodeURIComponent(jobId)}/${step}`), {
            method: step === 'turn' ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${botServiceToken}`, 'Cache-Control': 'no-store', ...(step === 'turn' ? { 'Content-Type': 'application/json' } : {}), Accept: 'text/event-stream' },
            ...(step === 'turn' ? { body: JSON.stringify({ input }) } : {}),
            signal,
        });
        if (answer.ok && answer.body) return { ok: true, body: answer.body };
        const data = (await answer.json().catch(() => ({}))) as { reason?: unknown; responseId?: unknown };
        return { ok: false, status: answer.status, reason: typeof data.reason === 'string' ? data.reason : 'failed', ...(typeof data.responseId === 'string' ? { responseId: data.responseId } : {}) };
    }

    /** Has Orbit stop jobs that stopped renewing and try the ones in line again (#2000). Never throws. */
    async sweepComputers(): Promise<void> {
        try {
            await this.brickCall('post', 'api/computer/sweep', {});
        } catch (error) {
            console.warn('[AdminApiService] Could not sweep computers:', error instanceof Error ? error.message : error);
        }
    }

    /** Has Orbit remove every deleted Brick whose days are over (#1996), and names them. Empty when Orbit cannot be asked. */
    async sweepBricks(): Promise<string[]> {
        try {
            const response = await this.brickCall<{ removed?: unknown }>('post', 'api/bricks/sweep', {});
            return Array.isArray(response.data?.removed) ? response.data.removed.filter((id: unknown): id is string => typeof id === 'string') : [];
        } catch (error) {
            console.warn('[AdminApiService] Could not sweep deleted Bricks:', error instanceof Error ? error.message : error);
            return [];
        }
    }

    /**
     * How one bot talks to its AI, asked by bot id (#374). Needed for bots on Universe AI or on a person's own key:
     * Orbit decides, per bot, whether that key may run it now, and answers with the key, with Universe AI's provider,
     * or (when the owner chose "Stop replying" for a key that is down) with a resting line and no provider at all.
     * Returns null when Orbit does not know the bot or has no such route yet.
     */
    async getBotAiCredentials(botId: string): Promise<BotAiCredentialsAnswer | null> {
        if (!this.isConfigured()) {
            return null;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/ai-credentials`,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 15000 }
            );
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            }
            console.error('[AdminApiService] Error getting bot AI credentials:', error);
            captureException(error as Error);
            throw error;
        }
    }

    /**
     * Tells Orbit how a reply through a person's own key went (#374), so it can mark the key Down after two failed
     * replies in a row or a rejected key. `status` is the HTTP status the provider answered with, when it did: Orbit decides
     * which statuses count against the key (a 400 or a 429 says nothing about the key). Fire-and-forget: a report never
     * slows or breaks a reply.
     */
    async reportAiHealth(botId: string, outcome: { ok: true } | { ok: false; rejected: boolean; status?: number }): Promise<void> {
        if (!this.isConfigured()) return;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return;
        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/ai-health`,
                outcome,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 10000 }
            );
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.data?.message) || (error as Error)?.message || 'Unknown error';
            console.error(`[AdminApiService] Error reporting AI health: ${msg}`);
        }
    }

    // ---- Voice (Orbit #740, game #1746) ----------------------------------------------------------------------
    // These throw when Orbit cannot be asked, and the voice code answers in text then. An error here never carries the
    // key: a credentials answer holds only the encrypted key, and nothing from the request or the answer is put in a message.

    private voiceHeaders(): { Authorization: string } {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!this.isConfigured() || !botServiceToken) throw new Error('Orbit is not set up for voice');
        return { Authorization: `Bearer ${botServiceToken}` };
    }

    /** What a voice bot speaks with now. Null when Orbit does not know the bot. */
    async getVoiceActive(botId: string, timeoutMs: number): Promise<VoiceActiveAnswer | null> {
        try {
            const response: AxiosResponse<VoiceActiveAnswer> = await axios.get(resolveAdminApiEndpoint(this.adminApiUrl, `api/bots/${encodeURIComponent(botId)}/voice/active`), {
                headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' },
                timeout: timeoutMs,
            });
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) return null;
            throw error;
        }
    }

    /** One voice provider for one bot, the key still encrypted. Null when the bot may not use it (404, or 400). */
    async getVoiceCredentials(providerId: string, botId: string, timeoutMs: number, options: { hello?: boolean } = {}): Promise<VoiceCredentialsAnswer | null> {
        try {
            const response: AxiosResponse<VoiceCredentialsAnswer> = await axios.get(
                resolveAdminApiEndpoint(this.adminApiUrl, `api/voice/providers/${encodeURIComponent(providerId)}/credentials`),
                { headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' }, params: { botId, ...(options.hello ? { hello: 1 } : {}) }, timeout: timeoutMs }
            );
            return response.data;
        } catch (error) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            if (status === 404 || status === 400) return null;
            throw error;
        }
    }

    /** The server's voice limits (GET /api/voice/limits). */
    async getVoiceLimits(timeoutMs: number): Promise<Partial<VoiceLimits> | null> {
        const response: AxiosResponse<{ limits?: Partial<VoiceLimits> }> = await axios.get(resolveAdminApiEndpoint(this.adminApiUrl, 'api/voice/limits'), {
            headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' },
            timeout: timeoutMs,
        });
        return response.data?.limits ?? null;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Voice notes for every bot (Orbit /api/voice-notes/*): see voice/VoiceNoteOrbit.ts
    // -----------------------------------------------------------------------------------------------------------------

    /** Which parts of voice notes Orbit has. Null only for an Orbit from before (404); anything else that fails throws. */
    async voiceNoteCapabilities(timeoutMs: number): Promise<VoiceNoteCapabilities | null> {
        try {
            const response: AxiosResponse<{ voiceNotes?: VoiceNoteCapabilities }> = await axios.get(resolveAdminApiEndpoint(this.adminApiUrl, 'api/voice-notes/capabilities'), {
                headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' },
                timeout: timeoutMs,
            });
            return response.data?.voiceNotes ?? null;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) return null;
            throw error;
        }
    }

    /** What a bot hears voice notes with now, whatever its Voice switch says. Null when Orbit does not know the bot. */
    async noteHearing(botId: string, adapters: string[], timeoutMs: number): Promise<NoteHearingAnswer | null> {
        try {
            const response: AxiosResponse<NoteHearingAnswer> = await axios.get(resolveAdminApiEndpoint(this.adminApiUrl, `api/bots/${encodeURIComponent(botId)}/voice/hearing`), {
                headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' },
                params: { adapters: adapters.join(',') },
                timeout: timeoutMs,
            });
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) return null;
            throw error;
        }
    }

    /** What the Brick for guests hears a guest's voice notes with: Universe AI only. */
    async guestBrickHearing(adapters: string[], timeoutMs: number): Promise<NoteHearingAnswer> {
        const response: AxiosResponse<NoteHearingAnswer> = await axios.get(resolveAdminApiEndpoint(this.adminApiUrl, 'api/guest-brick/hearing'), {
            headers: { ...this.voiceHeaders(), 'Cache-Control': 'no-store' },
            params: { adapters: adapters.join(',') },
            timeout: timeoutMs,
        });
        return response.data;
    }

    /** Reserves one voice note before anything is paid. */
    async reserveVoiceNote(input: ReserveInput, timeoutMs: number): Promise<Reservation> {
        const response: AxiosResponse<Reservation> = await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, 'api/voice-notes/turns'), input, { headers: this.voiceHeaders(), timeout: timeoutMs });
        return response.data;
    }

    /** Asks to run a stage of a voice note turn. */
    async leaseVoiceNote(turnId: string, input: { stage: 'hearing' | 'answer'; adapters?: string[] }, timeoutMs: number): Promise<Lease> {
        const response: AxiosResponse<Lease> = await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, `api/voice-notes/turns/${encodeURIComponent(turnId)}/lease`), input, {
            headers: this.voiceHeaders(),
            timeout: timeoutMs,
        });
        return response.data;
    }

    /** Says what happened in the stage this server holds. Throws on a refusal (409: another server has it now). */
    async recordVoiceNote(turnId: string, event: TurnEvent, timeoutMs: number): Promise<void> {
        await axios.patch(resolveAdminApiEndpoint(this.adminApiUrl, `api/voice-notes/turns/${encodeURIComponent(turnId)}`), event, { headers: this.voiceHeaders(), timeout: timeoutMs });
    }

    /** Something a listening provider still holds after a note, to delete until it is gone. */
    async addVoiceNoteCleanup(job: { providerId: string; region?: string | null; kind: 'file' | 'transcription'; objectId: string }, timeoutMs: number): Promise<void> {
        await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, 'api/voice-notes/cleanups'), job, { headers: this.voiceHeaders(), timeout: timeoutMs });
    }

    /** The cleanups that are due, each held for this server for a moment. */
    async claimVoiceNoteCleanups(limit: number, timeoutMs: number): Promise<CleanupJob[]> {
        const response: AxiosResponse<{ jobs?: CleanupJob[] }> = await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, 'api/voice-notes/cleanups/claim'), { limit }, {
            headers: this.voiceHeaders(),
            timeout: timeoutMs,
        });
        return response.data?.jobs ?? [];
    }

    /** What the provider answered a delete with. Throws on a refusal (409: this server's hold ran out and another has the job). */
    async settleVoiceNoteCleanup(id: string, outcome: CleanupOutcome, timeoutMs: number): Promise<void> {
        await axios.patch(resolveAdminApiEndpoint(this.adminApiUrl, `api/voice-notes/cleanups/${encodeURIComponent(id)}`), outcome, { headers: this.voiceHeaders(), timeout: timeoutMs });
    }

    /** How a call to a voice provider went. A provider of the server's own has no health to keep: Orbit answers 404, which is fine. */
    async reportVoiceHealth(providerId: string, report: VoiceHealthReport, timeoutMs: number): Promise<void> {
        try {
            await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, `api/voice/providers/${encodeURIComponent(providerId)}/health`), report, {
                headers: this.voiceHeaders(),
                timeout: timeoutMs,
            });
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) return;
            throw error;
        }
    }

    /**
     * May this person get one more reply from this bot now (#1159)? Orbit counts their Universe AI replies (30 every 5
     * hours signed in, 10 for a guest, 200 shared by a bot's guests) and the bot's own limit per person. `source` is
     * what the reply would run on, from the bot's AI credentials. Never stops a reply because Orbit can't be asked:
     * anything but a clear "no" (not configured, an Orbit from before, a timeout, an error) lets the reply through.
     */
    async checkReplyAllowance(
        botId: string,
        input: { userId: string; isGuest?: boolean; source: 'universe-ai' | 'provider' | 'own-key'; greeting?: boolean }
    ): Promise<ReplyAllowance> {
        if (!this.isConfigured()) return { allowed: true };
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return { allowed: true };
        try {
            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/reply-allowance`,
                input,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 5000 }
            );
            const body = response.data as Partial<{ allowed: boolean; limit: string; resetsAt: string; who: string }>;
            if (body?.allowed !== false) return { allowed: true };
            const limit = REPLY_LIMIT_KINDS.find((kind) => kind === body.limit);
            const who = REPLY_ASKERS.find((asker) => asker === body.who);
            if (!limit || !who || typeof body.resetsAt !== 'string' || Number.isNaN(Date.parse(body.resetsAt))) return { allowed: true };
            return { allowed: false, limit, resetsAt: body.resetsAt, who };
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.status) || (error as Error)?.message || 'Unknown error';
            console.warn(`[AdminApiService] Reply limit check failed, letting the reply through: ${msg}`);
            return { allowed: true };
        }
    }

    /**
     * May this reply be spoken (game #1669, Orbit voice-allowance)? Counts it against the person's Universe AI window when it
     * is, under the reply's turn, so asking again never counts it twice. Null when Orbit can't be asked or doesn't know the
     * question: the caller keeps the reply in text, so nothing is spoken on Universe AI's account without an answer.
     */
    async checkVoiceAllowance(
        botId: string,
        input: { userId: string; isGuest: boolean; turnId: string }
    ): Promise<{ allowed: true; left?: number; resetsAt?: string } | { allowed: false; resetsAt: string } | null> {
        if (!this.isConfigured()) return null;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return null;
        try {
            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/voice-allowance`,
                input,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 5000 }
            );
            const body = response.data as Partial<{ allowed: boolean; resetsAt: string; left: number }>;
            if (body?.allowed === true) {
                // What is left comes with a yes from an Orbit that counts it; an Orbit from before sends only the yes
                const left = typeof body.left === 'number' && Number.isInteger(body.left) && body.left >= 0 ? body.left : undefined;
                const resetsAt = typeof body.resetsAt === 'string' && !Number.isNaN(Date.parse(body.resetsAt)) ? body.resetsAt : undefined;
                return left === undefined ? { allowed: true } : { allowed: true, left, resetsAt };
            }
            if (body?.allowed === false && typeof body.resetsAt === 'string' && !Number.isNaN(Date.parse(body.resetsAt))) return { allowed: false, resetsAt: body.resetsAt };
            return null;
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.status) || (error as Error)?.message || 'Unknown error';
            console.warn(`[AdminApiService] Voice allowance check failed, the reply stays in text: ${msg}`);
            return null;
        }
    }

    /**
     * How many spoken replies a person has left (#1669, Orbit voice-allowance/left), counting nothing and starting no window.
     * `left` is null when Orbit can't name the person; `resetsAt` is null while no window is running. Null when Orbit can't be
     * asked or is from before this existed: the Voice menu then says nothing about what is left.
     */
    async voiceRepliesLeft(botId: string, input: { userId: string; isGuest: boolean }): Promise<{ left: number | null; resetsAt: string | null } | null> {
        if (!this.isConfigured()) return null;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return null;
        try {
            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/voice-allowance/left`,
                input,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 5000 }
            );
            const body = response.data as Partial<{ left: number | null; resetsAt: string | null }>;
            // Anything but an answer in this shape is an Orbit that doesn't know the question
            if (!body || typeof body !== 'object') return null;
            const left = typeof body?.left === 'number' && Number.isInteger(body.left) && body.left >= 0 ? body.left : null;
            const resetsAt = typeof body?.resetsAt === 'string' && !Number.isNaN(Date.parse(body.resetsAt)) ? body.resetsAt : null;
            return { left, resetsAt };
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.status) || (error as Error)?.message || 'Unknown error';
            console.warn(`[AdminApiService] Asking what is left of the spoken replies failed: ${msg}`);
            return null;
        }
    }

    /**
     * Gives back a spoken reply that was counted and never heard (#1669). Safe to repeat: Orbit gives back at most once.
     * True: given back. False: nothing was counted under that turn. Null: it could not be done (Orbit down, or an Orbit
     * from before this existed); the caller carries on, the reply it belongs to is already settled.
     */
    async releaseVoiceReply(botId: string, input: { turnId: string }): Promise<boolean | null> {
        if (!this.isConfigured()) return null;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return null;
        try {
            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/voice-allowance/release`,
                input,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 5000 }
            );
            const released = (response.data as Partial<{ released: boolean }>)?.released;
            return typeof released === 'boolean' ? released : null;
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.status) || (error as Error)?.message || 'Unknown error';
            console.warn(`[AdminApiService] Giving back a voice reply failed: ${msg}`);
            return null;
        }
    }

    /**
     * Adds seconds of group listening to a bot's day and says whether the day's minutes are used (game #1859, Orbit voice-listening).
     * With no seconds (0) it only asks. Null when Orbit can't be asked or is from before this existed: the caller keeps listening, so
     * a bot is never stopped over an answer that did not come.
     */
    async reportVoiceListening(
        botId: string,
        input: { seconds: number }
    ): Promise<{ spent: boolean; usedSeconds: number; limitSeconds: number; resetsAt: string } | null> {
        if (!this.isConfigured()) return null;
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) return null;
        try {
            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/voice-listening`,
                input,
                { headers: { Authorization: `Bearer ${botServiceToken}` }, timeout: 5000 }
            );
            const body = response.data as Partial<{ spent: boolean; usedSeconds: number; limitSeconds: number; resetsAt: string }>;
            // Anything but an answer in this shape is an Orbit that doesn't know the question
            if (
                !body ||
                typeof body.spent !== 'boolean' ||
                typeof body.usedSeconds !== 'number' ||
                typeof body.limitSeconds !== 'number' ||
                typeof body.resetsAt !== 'string' ||
                Number.isNaN(Date.parse(body.resetsAt))
            ) {
                return null;
            }
            return { spent: body.spent, usedSeconds: body.usedSeconds, limitSeconds: body.limitSeconds, resetsAt: body.resetsAt };
        } catch (error) {
            const msg = (axios.isAxiosError(error) && error.response?.status) || (error as Error)?.message || 'Unknown error';
            console.warn(`[AdminApiService] Reporting the daily listening failed: ${msg}`);
            return null;
        }
    }

    /**
     * Get available AI providers
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     */
    async getAvailableAIProviders(enabled?: boolean): Promise<Array<{
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        model: string;
        supportsStreaming: boolean;
        supportsVision: boolean | null;
        visionModel: string | null;
        defaultVision: boolean;
    }>> {
        if (!this.isConfigured()) {
            return [];
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        try {
            const params: Record<string, any> = {};
            if (enabled !== undefined) {
                params.enabled = enabled;
            }

            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/ai-providers`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params,
                }
            );

            return response.data;
        } catch (error) {
            console.error('[AdminApiService] Error getting available AI providers:', error);
            captureException(error as Error);
            return [];
        }
    }

    /**
     * Does this bot hide its conversations (Orbit "Hide bot conversations", #435)? The universe default and the
     * bot's own choice are resolved by Orbit; this only asks. A private bot sends nothing to PostHog or Sentry
     * spans; chats, memory, usage counts and everything else work as always.
     *
     * Orbit is asked at most every 30 seconds per bot. A bot Orbit does not know, or an Orbit without the setting
     * yet, is "not private", as every bot was before this setting existed. If Orbit cannot answer (down, timeout,
     * refused), the last answer is kept, and with none yet the bot counts as private until Orbit answers. Never throws. `fresh` skips the 30 second wait (the bot server's own check).
     *
     * Orbit's answer also carries the people a manager asked the bot to forget; those go to the forget handler.
     */
    async isBotPrivate(botId: string, options: { fresh?: boolean } = {}): Promise<boolean> {
        const cached = this.botPrivacyCache.get(botId);
        if (!options.fresh && cached && Date.now() - cached.cachedAt < this.BOT_PRIVACY_CACHE_TTL) {
            return cached.hidden;
        }
        if (!this.isConfigured()) {
            return cached?.hidden ?? false;
        }
        const inFlight = this.botPrivacyRequests.get(botId);
        if (inFlight) return inFlight;

        const request = this.fetchBotPrivacy(botId, cached?.hidden).finally(() => {
            this.botPrivacyRequests.delete(botId);
        });
        this.botPrivacyRequests.set(botId, request);
        return request;
    }

    /**
     * Ask Orbit about each running bot every 30 seconds. The answer keeps the privacy setting fresh and carries the
     * people a manager asked the bot to forget, so a Forget lands even while nobody is talking to the bot.
     */
    startPrivacySync(getBotIds: () => Iterable<string>, onGone?: (botId: string) => void): void {
        if (this.privacySyncTimer || !this.isConfigured()) {
            return;
        }
        this.privacySyncTimer = setInterval(() => {
            for (const botId of getBotIds()) {
                void this.isBotPrivate(botId, { fresh: true }).then(() => {
                    // Orbit has said "not found" several times running (the bot was deleted, not a hiccup): stop asking,
                    // and let the caller stop tracking it
                    if ((this.botPrivacyCache.get(botId)?.notFoundInARow ?? 0) >= this.BOT_GONE_AFTER) {
                        this.botPrivacyCache.delete(botId);
                        onGone?.(botId);
                    }
                });
            }
        }, this.BOT_PRIVACY_CACHE_TTL);
        // Never keep the process alive for this
        this.privacySyncTimer.unref?.();
    }

    stopPrivacySync(): void {
        if (this.privacySyncTimer) {
            clearInterval(this.privacySyncTimer);
            this.privacySyncTimer = null;
        }
    }

    /** Called with the people Orbit asks the bot server to forget. */
    setForgetHandler(handler: MemoryForgetHandler | null): void {
        this.forgetHandler = handler;
    }

    /** Called with the things a person forgot through Orbit (#2003). */
    setItemForgetHandler(handler: ItemForgetHandler | null): void {
        this.itemForgetHandler = handler;
    }

    private applyItemForgets(botId: string, forgetItems: unknown): void {
        const items = parseItemForgets(forgetItems);
        if (!this.itemForgetHandler || items.length === 0) return;
        try {
            this.itemForgetHandler(botId, items);
        } catch (error) {
            console.error('[AdminApiService] Could not drop forgotten things:', error);
        }
    }

    private applyForgetNotice(botId: string, forget: unknown): void {
        const notice = parseForgetNotice(forget);
        if (!this.forgetHandler || !notice) return;
        try {
            this.forgetHandler(botId, notice);
        } catch (error) {
            console.error('[AdminApiService] Could not drop forgotten memories:', error);
        }
    }

    private async fetchBotPrivacy(botId: string, lastKnown: boolean | undefined): Promise<boolean> {
        // BOT_SERVICE_TOKEN is preferred, the admin token is the fallback. Memory itself takes only BOT_SERVICE_TOKEN (#444).
        const token = process.env.BOT_SERVICE_TOKEN || this.adminApiToken;
        try {
            const response: AxiosResponse = await axios.get(
                `${this.adminApiUrl}/api/bots/${encodeURIComponent(botId)}/privacy`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 5000,
                }
            );
            const hidden = response.data?.hidden === true;
            this.botPrivacyCache.set(botId, { hidden, cachedAt: Date.now() });
            this.applyForgetNotice(botId, response.data?.forget);
            this.applyItemForgets(botId, response.data?.forgetItems);
            return hidden;
        } catch (error) {
            // Not found (or an Orbit without the setting yet) is a plain "not private", except for a bot last known as
            // private: its proxy can answer "not found" while Orbit restarts, so it stays private until Orbit has said
            // it BOT_GONE_AFTER times running, the same rule that decides the bot is gone. Anything else keeps what we knew.
            // With nothing known yet (a bot server that just started, while Orbit restarts too), the bot counts as
            // private until Orbit answers: a hidden bot must never send its text out because Orbit was slow to say so.
            // Only telemetry waits; replies, memory and saved chats are the same either way.
            const notFound = axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405);
            const notFoundInARow = notFound ? (this.botPrivacyCache.get(botId)?.notFoundInARow ?? 0) + 1 : 0;
            const hidden = notFound ? lastKnown === true && notFoundInARow < this.BOT_GONE_AFTER : lastKnown ?? true;
            // Retry soon, not after the full 30 seconds, when Orbit could not answer
            this.botPrivacyCache.set(botId, { hidden, cachedAt: notFound ? Date.now() : Date.now() - this.BOT_PRIVACY_CACHE_TTL + 5000, ...(notFoundInARow ? { notFoundInARow } : {}) });
            if (!notFound) {
                console.warn('[AdminApiService] Could not read the bot privacy setting, keeping the last answer:', axios.isAxiosError(error) ? error.message : 'unknown error');
            }
            return hidden;
        }
    }

    /**
     * Validate an opaque Orbit session with the Admin API, which owns the
     * server-side session record. The bot server never decodes credentials.
     */
    async validateSessionToken(sessionToken: string): Promise<{
        userId: string;
        uuid: string;
        email: string | null;
        name: string | null;
        tags: string[];
    } | null> {
        if (!this.adminApiUrl || !/^orb_sess_v2_[0-9a-f]{64}$/.test(sessionToken)) {
            return null;
        }

        let adminApiUrl: URL;
        try {
            adminApiUrl = new URL(this.adminApiUrl);
        } catch {
            return null;
        }
        if (!canSendSessionTo(adminApiUrl)) {
            if (!warnedInsecureAdminUrl) {
                warnedInsecureAdminUrl = true;
                console.warn(
                    `[AdminApiService] Not validating Orbit sessions against ${adminApiUrl.origin}: ` +
                        'ADMIN_API_URL must be https, or http to a local or private host outside production'
                );
            }
            return null;
        }

        try {
            const response: AxiosResponse = await axios.get(resolveAdminApiEndpoint(adminApiUrl, 'api/auth/me'), {
                headers: {
                    Authorization: `Bearer ${sessionToken}`,
                    'Cache-Control': 'no-store',
                },
                timeout: 5_000,
            });
            const user = response.data?.user;
            if (!user?.id || !user?.uuid) return null;
            return {
                userId: user.id,
                uuid: user.uuid,
                email: user.email || null,
                name: user.name || null,
                tags: Array.isArray(user.tags) ? user.tags : [],
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AdminApiService] Admin API rejected Orbit session');
            }
            return null;
        }
    }

    /**
     * Ask the Admin API whether the person behind an Orbit session may manage a bot. The Admin API answers a bot's
     * configuration only to people who can manage bots in that bot's room (or super admins), so a 200 means yes and
     * anything else means no. Fails closed.
     */
    async canSessionManageBot(sessionToken: string, botId: string): Promise<boolean> {
        if (!this.adminApiUrl || !/^orb_sess_v2_[0-9a-f]{64}$/.test(sessionToken) || !botId) {
            return false;
        }

        let adminApiUrl: URL;
        try {
            adminApiUrl = new URL(this.adminApiUrl);
        } catch {
            return false;
        }
        if (!canSendSessionTo(adminApiUrl)) {
            return false;
        }

        try {
            const response: AxiosResponse = await axios.get(
                resolveAdminApiEndpoint(adminApiUrl, `api/bots/configuration/${encodeURIComponent(botId)}`),
                {
                    headers: {
                        Authorization: `Bearer ${sessionToken}`,
                        'Cache-Control': 'no-store',
                    },
                    timeout: 5_000,
                    validateStatus: () => true,
                }
            );
            return response.status === 200;
        } catch (error) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.error('[AdminApiService] Bot permission check failed');
            }
            return false;
        }
    }

    /**
     * Ask Orbit whether a person may do something with a bot (Orbit #426/#427): chat in its bubble, message it, or
     * summon it. A no is an answer ({ allowed: false }); anything that stops Orbit answering throws, so the caller
     * can tell "no" from "could not check". Uses BOT_SERVICE_TOKEN.
     */
    async checkBotAccess(
        botId: string,
        action: BotAccessAction,
        person: BotAccessPerson
    ): Promise<BotAccessAnswer> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }

        const response: AxiosResponse<BotAccessAnswer> = await axios.post(
            resolveAdminApiEndpoint(this.adminApiUrl, `api/bots/${encodeURIComponent(botId)}/access`),
            {
                action,
                person: {
                    signedIn: person.signedIn,
                    ...(person.identifier ? { identifier: person.identifier } : {}),
                    ...(person.chatId ? { chatId: person.chatId } : {}),
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${botServiceToken}`,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
                timeout: BOT_ACCESS_TIMEOUT_MS,
            }
        );
        const answer = response.data;
        if (!answer || typeof answer.allowed !== 'boolean') {
            throw new Error('Orbit answered the bot access check with something unexpected');
        }
        return answer;
    }

    /**
     * Whether this person may manage the bot's tools (Manage bots for it). Such a person may try a tool that is not
     * confirmed yet, with a card every time (game #1656). A guest or an unknown person is not one. Throws when Orbit
     * can't answer, so the caller can tell "no" from "could not check". Uses BOT_SERVICE_TOKEN.
     */
    async canManageBotTools(botId: string, identifier: string): Promise<boolean> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            throw new Error('BOT_SERVICE_TOKEN environment variable is not set');
        }
        const response: AxiosResponse<{ canManage?: unknown }> = await axios.post(
            resolveAdminApiEndpoint(this.adminApiUrl, `api/bots/${encodeURIComponent(botId)}/tool-manager`),
            { identifier },
            {
                headers: {
                    Authorization: `Bearer ${botServiceToken}`,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
                timeout: BOT_ACCESS_TIMEOUT_MS,
            }
        );
        if (typeof response.data?.canManage !== 'boolean') {
            throw new Error('Orbit answered the tool manager check with something unexpected');
        }
        return response.data.canManage;
    }

    /**
     * One call to Orbit's artifact routes with the bot service token. A refusal comes back as an ArtifactCallError with
     * Orbit's own code and line (no content is ever logged); anything that stops Orbit answering is `orbit_unavailable`.
     */
    private async artifactCall<T>(path: string, body: object, timeoutMs = ARTIFACT_TIMEOUT_MS, media: ArtifactMediaUpload[] = []): Promise<T> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!this.isConfigured() || !botServiceToken) {
            throw new ArtifactCallError('orbit_unavailable', 503, 'Orbit is not set up for artifacts.');
        }
        // With songs, images or videos (#1510) the same JSON goes as a form's "request" part, one "media" part per file
        let payload: object | FormData = body;
        if (media.length > 0) {
            const form = new FormData();
            form.append('request', JSON.stringify(body));
            for (const file of media) form.append('media', new Blob([file.body], { type: file.contentType }), file.name);
            payload = form;
        }
        try {
            const response: AxiosResponse<T> = await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, path), payload, {
                headers: {
                    Authorization: `Bearer ${botServiceToken}`,
                    ...(media.length > 0 ? {} : { 'Content-Type': 'application/json' }),
                    'Cache-Control': 'no-store',
                },
                // 0 would mean no time limit at all to axios
                timeout: timeoutMs > 0 ? timeoutMs : ARTIFACT_TIMEOUT_MS,
                maxBodyLength: Infinity,
            });
            return response.data;
        } catch (error) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            const data = axios.isAxiosError(error) ? error.response?.data : undefined;
            if (status && status < 500 && data && typeof data.error === 'string') {
                throw new ArtifactCallError(data.error, status, typeof data.message === 'string' ? data.message : data.error);
            }
            if (status === 503 && data?.error === 'storage_not_configured') {
                throw new ArtifactCallError('storage_not_configured', 503, 'Artifact storage is not set up.');
            }
            // Only where it broke: the request holds the person's file
            Sentry.captureException(new Error(`Artifact call ${path} failed (${status ?? 'no answer'})`), { tags: { area: 'bot-artifacts' } });
            throw new ArtifactCallError('orbit_unavailable', status ?? 503, 'Orbit could not be reached.');
        }
    }

    /** Make an artifact for the person who asked, in the chat they asked in. */
    makeArtifact(
        call: ArtifactCall,
        artifact: { title: string; kind: ArtifactKind; content: string; summary?: string | null },
        timeoutMs?: number,
        media: ArtifactMediaUpload[] = []
    ): Promise<{ artifact: ArtifactSummary; version: ArtifactVersionSummary; hidden: boolean }> {
        return this.artifactCall('api/artifacts', { ...plainCall(call), ...artifact }, timeoutMs, media);
    }

    /** Change one with small edits (or the whole new file). Every change is a new version. */
    changeArtifact(
        id: string,
        call: ArtifactReachCall,
        change: { edits?: ArtifactEdit[]; content?: string; summary?: string | null; title?: string | null; baseVersion?: number | null; dropMedia?: string[] },
        timeoutMs?: number,
        media: ArtifactMediaUpload[] = []
    ): Promise<{ artifact: ArtifactSummary; version: ArtifactVersionSummary; hidden: boolean }> {
        return this.artifactCall(`api/artifacts/${encodeURIComponent(id)}/change`, { ...call, ...change }, timeoutMs, media);
    }

    /** Read one version of an artifact, with its text. */
    readArtifact(
        id: string,
        call: ArtifactReachCall,
        version?: number | null
    ): Promise<{ artifact: ArtifactSummary; version: ArtifactVersionSummary; content: string; hidden: boolean }> {
        return this.artifactCall(`api/artifacts/${encodeURIComponent(id)}/read`, { ...call, ...(version ? { version } : {}) });
    }

    /**
     * The artifacts made in this chat that the person may open, plus the ones this bot made for them in other chats, the
     * most recently changed first. For a reply other people read (`everyoneHere`), only this chat's that all of them may open.
     */
    listArtifactsInChat(call: ArtifactCall & ForEveryoneHere): Promise<{ artifacts: ArtifactSummary[]; hidden: boolean }> {
        return this.artifactCall('api/artifacts/in-chat', { ...plainCall(call), ...(call.everyoneHere ? { everyoneHere: true } : {}) });
    }

    /**
     * One call to Orbit's routes for files in bot chats (#1508), with the bot service token. A refusal comes back as an
     * ArtifactCallError with Orbit's own code and line; anything that stops Orbit answering is `orbit_unavailable`. No
     * file name or text is ever logged. `report` false keeps a call made before every reply out of Sentry, so a slow
     * Orbit doesn't send one event per reply.
     */
    private async botFileCall<T>(path: string, body: object, timeoutMs: number, report = true): Promise<T> {
        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!this.isConfigured() || !botServiceToken) {
            throw new ArtifactCallError('orbit_unavailable', 503, 'Orbit is not set up for files.');
        }
        try {
            const response: AxiosResponse<T> = await axios.post(resolveAdminApiEndpoint(this.adminApiUrl, path), body, {
                headers: { Authorization: `Bearer ${botServiceToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                timeout: timeoutMs,
                maxBodyLength: Infinity,
            });
            return response.data;
        } catch (error) {
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            const data = axios.isAxiosError(error) ? error.response?.data : undefined;
            if (status && status < 500 && data && typeof data.error === 'string') {
                throw new ArtifactCallError(data.error, status, typeof data.message === 'string' ? data.message : data.error);
            }
            // An Orbit without the routes yet (it ships first, but a bot server can talk to an older one)
            if (status === 404) throw new ArtifactCallError('not_available', 404, 'Orbit does not keep chat files yet.');
            if (report) Sentry.captureException(new Error(`Bot file call ${path} failed (${status ?? 'no answer'})`), { tags: { area: 'bot-files' } });
            throw new ArtifactCallError('orbit_unavailable', status ?? 503, 'Orbit could not be reached.');
        }
    }

    /**
     * Add a file someone sent the bot, or the bot sent them. Orbit gives it its short id. An Orbit from before it kept
     * who was there (game #1993) refuses the body: the file is then added without them, and so stays with its person.
     */
    async addBotFile(call: ArtifactCall, file: BotFileAdd, timeoutMs = BOT_FILE_TIMEOUT_MS): Promise<{ file: BotFileSummary; hidden: boolean }> {
        const { others, ...rest } = file;
        if (!others || others.length === 0) return this.botFileCall('api/bot-files', { ...plainCall(call), ...rest }, timeoutMs);
        try {
            return await this.botFileCall('api/bot-files', { ...plainCall(call), ...rest, others }, timeoutMs);
        } catch (error) {
            if (!isUnknownField(error)) throw error;
            return this.botFileCall('api/bot-files', { ...plainCall(call), ...rest }, timeoutMs);
        }
    }

    /** Keep one piece of a file's text (or that it could not be read). Pieces go in order, each from where the last ended. */
    keepBotFileText(
        call: ArtifactCall,
        ref: string,
        piece: { text: string; from: number; last: boolean } | { failed: true },
        timeoutMs = BOT_FILE_TIMEOUT_MS
    ): Promise<{ file: BotFileSummary; hidden: boolean }> {
        return this.botFileCall('api/bot-files/text', { ...plainCall(call), ref, ...piece }, timeoutMs);
    }

    /** One file by its short id, if this person may use it here (and, for a reply other people read, all of them were there for it). */
    getBotFile(call: FileReachCall, ref: string, timeoutMs = BOT_FILE_TIMEOUT_MS): Promise<{ file: BotFileView; hidden: boolean }> {
        return this.botFileCall('api/bot-files/get', { ...call, ref }, timeoutMs);
    }

    /** A piece of a file's kept text, `chars` long from `at` (a search hit's place, or the last read's `next`). */
    readBotFile(call: FileReachCall, read: { ref: string; at?: number | null; chars: number }, timeoutMs = BOT_FILE_TIMEOUT_MS): Promise<BotFileRead> {
        return this.botFileCall('api/bot-files/read', { ...call, ...read }, timeoutMs);
    }

    /** Files and artifacts this person may use with the bot, newest first (or those that match `words`). */
    findBotFiles(
        call: FileReachCall,
        find: {
            limit: number;
            words?: string | null;
            kinds?: string[] | null;
            source?: 'person' | 'bot' | null;
            since?: string | null;
            until?: string | null;
            page?: number | null;
        },
        timeoutMs = BOT_FILE_TIMEOUT_MS,
        report = true
    ): Promise<BotFilesFound> {
        return this.botFileCall('api/bot-files/find', { ...call, ...find }, timeoutMs, report);
    }

    /**
     * Track AI usage
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async trackAIUsage(usage: {
        botId: string;
        providerId: string;
        tokensUsed?: number;
        promptTokens?: number;
        completionTokens?: number;
        /** Part of the input read from / written to the provider's cache (inside the input, not on top of it) */
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        apiCalls?: number;
        durationSeconds?: number | null;
        /** Dollars, the old estimate. Orbit keeps it as one only when no `price` comes with it. */
        cost?: number;
        /** What the reply cost and how that was worked out (#1173). */
        price?: {
            inputTokens: number;
            cachedTokens: number;
            cacheWriteTokens: number;
            outputTokens: number;
            reasoningTokens: number;
            /** Millionths of a dollar; null when the price is unknown. */
            costMicros: number | null;
            costBasis: string;
            priceSource: string | null;
            priceVersion: string | null;
        };
        latency?: number;
        error?: boolean;
        timestamp?: string;
        /** Where the reply was given: direct messages or nearby chat (Orbit #491). */
        channel?: "dm" | "nearby";
        /** Who it was for, as the bot knows them (WorkAdventure uuid or email); Orbit matches it to their account. */
        userId?: string;
        isGuest?: boolean;
        /** A greeting the bot made on its own (greetings cooldown): free for the person, still the payer's usage. */
        greeting?: boolean;
    }): Promise<void> {
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping AI usage tracking');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping AI usage tracking');
            return;
        }

        try {
            const payload = {
                botId: usage.botId,
                providerId: usage.providerId,
                tokensUsed: usage.tokensUsed || 0,
                // Orbit ignores what it doesn't store yet; its usage table takes these with the cost rework (#1173)
                ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}),
                ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
                apiCalls: usage.apiCalls || 1,
                durationSeconds: usage.durationSeconds ?? null,
                cost: usage.price ? null : usage.cost ?? null,
                ...(usage.price ?? {}),
                latency: usage.latency ?? null,
                error: usage.error || false,
                timestamp: usage.timestamp || new Date().toISOString(),
                ...(usage.channel ? { channel: usage.channel } : {}),
                ...(usage.userId ? { userId: usage.userId } : {}),
                ...(typeof usage.isGuest === "boolean" ? { isGuest: usage.isGuest } : {}),
                // A greeting the bot made on its own: the payer's usage, never counted against the person it greeted
                ...(usage.greeting ? { greeting: true } : {}),
            };

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Sending usage tracking:`, JSON.stringify(payload, null, 2));
            }

            const response = await axios.post(
                `${this.adminApiUrl}/api/bots/ai-usage`,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Usage tracking response:`, response.status, JSON.stringify(response.data, null, 2));
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error tracking AI usage:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            } else if (error.message) {
                console.error('[AdminApiService] Error message:', error.message);
            }
        }
    }

    /**
     * Save bot metrics to Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async saveBotMetrics(metrics: Array<{
        botId: string;
        timestamp: number;
        metrics: {
            responseTime?: number;
            tokenUsage?: {
                prompt: number;
                completion: number;
                total: number;
            };
            repetitionScore?: number;
            systemPromptLeakage?: boolean;
            personalityCompliance?: number;
            conversationQuality?: number;
            errorCount?: number;
        };
        metadata?: Record<string, any>;
    }>): Promise<void> {
        if (!this.isConfigured()) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API not configured, skipping metrics save');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping metrics save');
            return;
        }

        try {
            // Filter out test metrics one more time (defense in depth)
            const realMetrics = metrics.filter(metric => {
                const playerId = metric.metadata?.playerId;
                return playerId !== 999999 && playerId !== '999999';
            });

            if (realMetrics.length === 0) {
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[AdminApiService] Skipped saving ${metrics.length} test metrics`);
                }
                return; // No real metrics to save
            }

            await axios.post(
                `${this.adminApiUrl}/api/bots/metrics`,
                { metrics: realMetrics },
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                const filteredCount = metrics.length - realMetrics.length;
                if (filteredCount > 0) {
                    console.log(`[AdminApiService] Saved ${realMetrics.length} metrics (filtered ${filteredCount} test metrics)`);
                } else {
                    console.log(`[AdminApiService] Saved ${realMetrics.length} metrics`);
                }
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error saving bot metrics:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            }
        }
    }

    /**
     * Save test results to Admin API
     * Uses BOT_SERVICE_TOKEN (separate from ADMIN_API_TOKEN)
     * Fire-and-forget (doesn't throw errors)
     */
    async saveTestResults(testResult: {
        testId: string;
        botId: string;
        testSuite: string;
        results: any;
        passed: boolean;
        summary?: {
            total: number;
            passed: number;
            failed: number;
            skipped: number;
        };
        startedAt?: number;
        completedAt?: number;
        duration?: number;
    }): Promise<void> {
        // Check only adminApiUrl (not adminApiToken - test results use BOT_SERVICE_TOKEN)
        if (!this.adminApiUrl) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] Admin API URL not configured, skipping test results save');
            }
            return;
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, skipping test results save');
            }
            return;
        }

        try {
            await axios.post(
                `${this.adminApiUrl}/api/bots/test/results`,
                testResult,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Saved test result: ${testResult.testId}`);
            }
        } catch (error: any) {
            // Fire-and-forget: don't throw, just log
            console.error('[AdminApiService] Error saving test results:', error);
            if (error.response) {
                console.error('[AdminApiService] Error response status:', error.response.status);
                console.error('[AdminApiService] Error response data:', error.response.data);
            }
        }
    }

    /**
     * @deprecated This method is no longer used - improvements endpoint was removed
     * Task files in bots/improvement-tasks/ are now the source of truth
     * This method is kept for backward compatibility but does nothing
     */
    async saveImprovement(improvement: {
        botId: string;
        improvementType: string;
        changes: any;
        metricsBefore?: any;
        metricsAfter?: any;
        deployed?: boolean;
        recommendations?: any[];
        testRunId?: string;
    }): Promise<void> {
        // No-op: Improvements endpoint was removed, task files are now the source of truth
        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[AdminApiService] saveImprovement called but ignored (endpoint removed, using task files instead)`);
        }
        return;
    }

    /**
     * Get bot metrics from Admin API
     */
    async getBotMetrics(botId: string, query?: {
        metricType?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
        offset?: number;
    }): Promise<Array<{
        botId: string;
        timestamp: number;
        metrics: Record<string, any>;
        metadata?: Record<string, any>;
    }>> {
        if (!this.isConfigured()) {
            return [];
        }

        const botServiceToken = process.env.BOT_SERVICE_TOKEN;
        if (!botServiceToken) {
            console.warn('[AdminApiService] BOT_SERVICE_TOKEN not set, cannot get metrics');
            return [];
        }

        try {
            const params: Record<string, any> = { botId };
            if (query) {
                if (query.metricType) params.metricType = query.metricType;
                if (query.startTime) params.startTime = query.startTime;
                if (query.endTime) params.endTime = query.endTime;
                if (query.limit) params.limit = query.limit;
                if (query.offset) params.offset = query.offset;
            }

            const response = await axios.get(
                `${this.adminApiUrl}/api/bots/${botId}/metrics`,
                {
                    headers: {
                        Authorization: `Bearer ${botServiceToken}`,
                    },
                    params,
                }
            );

            return response.data || [];
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return [];
            }
            console.error('[AdminApiService] Error getting bot metrics:', error);
            return [];
        }
    }

    /**
     * Get room metadata (universe, world, room names)
     * Calls the Admin API's /api/room/info endpoint or extracts from URL
     * Results are cached for 5 minutes to improve performance
     */
    async getRoomMetadata(roomUrl: string): Promise<{ universeName: string; worldName: string; roomName: string } | null> {
        // Check cache first
        const cached = this.roomMetadataCache.get(roomUrl);
        const cacheAge = cached ? Date.now() - cached.cachedAt : Infinity;
        
        if (cached && cacheAge < this.ROOM_METADATA_CACHE_TTL) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Using cached room metadata for ${roomUrl} (cached ${Math.round(cacheAge / 1000)}s ago):`, cached.data);
            }
            return cached.data;
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            if (cached) {
                console.log(`[AdminApiService] Cache expired for ${roomUrl} (age: ${Math.round(cacheAge / 1000)}s, TTL: ${this.ROOM_METADATA_CACHE_TTL / 1000}s), fetching fresh data`);
            } else {
                console.log(`[AdminApiService] No cache for ${roomUrl}, fetching fresh data`);
            }
        }

        let result: { universeName: string; worldName: string; roomName: string } | null = null;

        try {
            // Extract slug from roomUrl: "https://universe.bawes.net/@/bawes/bawes/headquarters" -> "bawes/bawes/headquarters"
            const urlObj = new URL(roomUrl);
            const pathMatch = /^\/@\/(.+)/.exec(urlObj.pathname);
            
            if (pathMatch) {
                const slug = pathMatch[1]; // "bawes/bawes/headquarters"
                
                // Call Admin API's /api/room/info endpoint (public, no auth required)
                const adminApiUrl = this.adminApiUrl || process.env.ADMIN_API_URL;
                if (adminApiUrl) {
                    const infoUrl = `${adminApiUrl}/api/room/info?slug=${encodeURIComponent(slug)}`;
                    
                    const response = await axios.get(infoUrl, {
                        timeout: 10000,
                    });

                    if (response.data && response.data.roomName && response.data.worldName && response.data.universeName) {
                        result = {
                            universeName: response.data.universeName,
                            worldName: response.data.worldName,
                            roomName: response.data.roomName,
                        };
                    }
                }
            }
        } catch (error) {
            console.warn(`[AdminApiService] Failed to get room metadata from Admin API for ${roomUrl}, using URL fallback:`, error);
        }

        // Fallback: extract from URL if API call failed
        if (!result) {
            try {
                const urlObj = new URL(roomUrl);
                const pathMatch = /^\/@\/(.+)/.exec(urlObj.pathname);
                if (pathMatch) {
                    const parts = pathMatch[1].split('/').filter(p => p);
                    if (parts.length >= 3) {
                        result = {
                            universeName: parts[0] || '',
                            worldName: parts[1] || '',
                            roomName: parts[2] || '',
                        };
                    }
                }
            } catch (error) {
                console.error(`[AdminApiService] Failed to parse room URL: ${roomUrl}`, error);
            }
        }

        // Cache the result (even if null, to avoid repeated failed lookups)
        if (result) {
            this.roomMetadataCache.set(roomUrl, {
                data: result,
                cachedAt: Date.now(),
            });
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[AdminApiService] Cached room metadata for ${roomUrl}: ${result.universeName}/${result.worldName}/${result.roomName}`);
            }
        } else {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[AdminApiService] Failed to get room metadata for ${roomUrl}, result is null`);
            }
        }

        return result;
    }
}

// Singleton instance
export const adminApiService = new AdminApiService();
