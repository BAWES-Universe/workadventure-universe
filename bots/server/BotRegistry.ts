/**
 * BotRegistry - Redis-based registry for horizontal scaling
 * 
 * Tracks bot instances across multiple bot server instances.
 * Uses Redis for shared state coordination.
 */

import { createClient, type RedisClientType, commandOptions } from 'redis';
import type { ForgetQueueRedis } from '../memory/ForgetQueue';
import type { EvidenceRedis } from './ComputerEvidenceStore';

/** How long a stop waits for Redis to answer before it cuts the connection off. */
const SHUTDOWN_WAIT_MS = 3_000;

/** Where bot servers tell each other that a Brick changed (#1996). */
const BRICK_CHANGED_CHANNEL = 'bots:brick-changed';

/**
 * Whether the connection can take a command now. `isOpen` stays true while node-redis reconnects, and a command sent then waits
 * in its queue (and so does whoever awaits it) until Redis is back, so only a connection that is ready counts as up.
 */
function isUp(redis: RedisClientType | null | undefined): redis is RedisClientType {
    return !!redis && redis.isOpen && redis.isReady !== false;
}

/** Waits for a promise for `ms` at most; false when the time ran out first. */
async function inTime(work: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([work.then(() => true), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms)))]);
    } finally {
        clearTimeout(timer);
    }
}

/** Closes a connection: a ready one says goodbye (for a moment), one that is not ready, or that does not answer, is cut off, so a stop never hangs on it. */
async function closeConnection(client: RedisClientType, ms: number): Promise<void> {
    if (client.isReady !== false) {
        const quit = client.quit().catch(() => undefined);
        if (await inTime(quit, ms)) return;
    }
    await client.disconnect().catch(() => undefined);
}

export interface BotServerInfo {
    serverId: string;
    capacity: number;
    currentBots: number;
    status: 'active' | 'inactive' | 'shutting_down';
    lastHeartbeat: number;
}

export interface ConversationState {
    botId: string;
    playerId: number;
    spaceName: string;
    startTime: number;
    lastMessageTime: number;
}

export interface BotAssignment {
    botId: string;
    serverId: string;
    assignedAt: number;
}

export class BotRegistry {
    private redis: RedisClientType | null = null;
    /**
     * Whether Redis was ever ready on this server: from then on other bot servers may be sharing it, and a connection
     * that drops is an outage, not a server on its own.
     */
    private sharedStoreSeen = false;
    /** Whether a shared store was named for this server (a host in its config or REDIS_HOST): one that is named and does not answer is an outage, not a server on its own. */
    private sharedStoreNamed = false;
    /** The connection that hears Brick changes from other bot servers (#1996), once listening. */
    private brickListener: RedisClientType | null = null;
    private serverId: string;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
    private readonly CONVERSATION_TTL = 300; // 5 minutes
    /** How long the first connection of the Brick-change listener may take before it is given up (the caller tries again later). */
    private brickListenerConnectMs = 10_000;

    constructor(
        serverId: string,
        redisConfig?: {
            host?: string;
            port?: number;
            password?: string;
            db?: number;
        }
    ) {
        this.serverId = serverId;
        this.sharedStoreNamed = !!(redisConfig?.host || process.env.REDIS_HOST);
        
        const host = redisConfig?.host || process.env.REDIS_HOST || 'redis';
        const port = redisConfig?.port || parseInt(process.env.REDIS_PORT || '6379');
        const password = redisConfig?.password || process.env.REDIS_PASSWORD;
        const db = redisConfig?.db || parseInt(process.env.REDIS_DB_NUMBER || '1'); // Default to DB 1 for bots

        if (host) {
            const config: any = {
                socket: {
                    host,
                    port,
                },
                // A command sent while the connection is down fails at once (callers treat that as the store being down), instead of
                // waiting in a queue, with the person's chat behind it, until Redis is back
                disableOfflineQueue: true,
            };

            if (password) {
                config.password = password;
            }

            this.redis = createClient(config);

            this.redis.on('error', (err) => {
                console.error('[BotRegistry] Redis error:', err);
            });

            this.redis.on('connect', () => {
                console.log('[BotRegistry] Connected to Redis');
            });

            this.redis.on('ready', async () => {
                this.sharedStoreSeen = true;
                // Select database
                try {
                    await this.redis!.select(db);
                    console.log(`[BotRegistry] Selected Redis database ${db}`);
                } catch (err) {
                    console.error(`[BotRegistry] Failed to select database ${db}:`, err);
                }
                
                // Start heartbeat
                this.startHeartbeat();
            });
        }
    }

    async connect(): Promise<void> {
        if (this.redis && !this.redis.isOpen) {
            await this.redis.connect();
        }
        // Connected: from now on a closed connection is an outage, whether or not 'ready' was heard yet. The bot server
        // starts taking requests only after this (BotManager.initialize), and does not start when it throws.
        if (this.redis?.isOpen) this.sharedStoreSeen = true;
    }

    async disconnect(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        const listener = this.brickListener;
        this.brickListener = null;
        if (listener?.isOpen) await closeConnection(listener, SHUTDOWN_WAIT_MS);

        if (this.redis?.isOpen) {
            if (isUp(this.redis)) {
                // Neither may hold the shutdown: a Redis that is ready but does not answer would keep either pending for ever, and the
                // connection below would never be closed. Each has the same bound as closing it.
                // Mark server as shutting down
                await inTime(this.markServerShuttingDown(), SHUTDOWN_WAIT_MS).catch(() => undefined);

                // Unassign all bots from this server
                await inTime(this.unassignAllBotsFromServer(), SHUTDOWN_WAIT_MS).catch(() => undefined);
            }
            // A connection that is not ready (Redis went away) is cut off: asking it to quit would wait for Redis
            await closeConnection(this.redis, SHUTDOWN_WAIT_MS);
        }
    }

    /**
     * Remember which bot a Matrix direct message room belongs to, so replies survive a restart.
     * Without Redis this is a no-op and the caller keeps its own in-process copy.
     */
    async rememberDmRoom(roomId: string, botId: string): Promise<void> {
        if (!isUp(this.redis)) {
            // A store that was in use and is down did not keep it: said, so the caller writes it again (no store at all is not a failure)
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        await this.redis.hSet('bots:matrix:dm-rooms', roomId, botId);
    }

    /**
     * The bot a Matrix direct message room belongs to, or null when unknown. Throws while a Redis that was in use is down: "unknown" would
     * read as a room nobody is in any more, and a message waiting for it would be thrown away; a caller that must be certain waits instead.
     */
    async getDmRoomBot(roomId: string): Promise<string | null> {
        if (!isUp(this.redis)) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return null;
        }
        return (await this.redis.hGet('bots:matrix:dm-rooms', roomId)) ?? null;
    }

    /**
     * Forget a Matrix direct message room once its bot has left it. Throws while a store that was in use is down: the purge of a room
     * drops this link strictly and tries again, and a silent return would leave the room linked to the Brick for good.
     */
    async forgetDmRoom(roomId: string): Promise<void> {
        if (!isUp(this.redis)) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        await this.redis.hDel('bots:matrix:dm-rooms', roomId);
    }

    /**
     * The direct message room of a bot and a person (#1993), so an answer made for them elsewhere can be kept there
     * without a message from them first. Without Redis this is a no-op and the caller keeps its own in-process copy.
     */
    async rememberDmRoomOf(botId: string, matrixUserId: string, roomId: string): Promise<void> {
        if (!isUp(this.redis)) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        await this.redis.hSet('bots:matrix:dm-room-of', `${botId}|${matrixUserId}`, roomId);
    }

    /**
     * The direct message room of a bot and a person, or null when unknown. Throws while a Redis that was in use is down:
     * "unknown" would be a guess then, and a caller that must be certain (a reminder that says it has no chat) waits instead.
     */
    async getDmRoomOf(botId: string, matrixUserId: string): Promise<string | null> {
        if (!isUp(this.redis)) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return null;
        }
        return (await this.redis.hGet('bots:matrix:dm-room-of', `${botId}|${matrixUserId}`)) ?? null;
    }

    /**
     * Forgets the direct chat of a bot and a person. With the room that was seen, only while the store still points at that
     * room: a newer chat that another device or bot server noted since is never forgotten with the old one.
     */
    async forgetDmRoomOf(botId: string, matrixUserId: string, roomId?: string): Promise<void> {
        if (!isUp(this.redis)) {
            // Throws while a store that was in use is down, as forgetDmRoom does: a purge drops this link strictly and tries again
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        const key = `${botId}|${matrixUserId}`;
        if (roomId === undefined) {
            await this.redis.hDel('bots:matrix:dm-room-of', key);
            return;
        }
        await this.redis.eval("if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('HDEL', KEYS[1], ARGV[1]) end return 0", {
            keys: ['bots:matrix:dm-room-of'],
            arguments: [key, roomId],
        });
    }

    /**
     * Every link this bot has to a person's chat, found by scanning for the bot's prefix rather than from the people a room still holds, so the
     * links of people who left earlier (before a restart, or on another bot server) go too. Throws while a store that was in use is down.
     */
    async forgetDmRoomsOfBot(botId: string): Promise<void> {
        if (!this.redis?.isOpen) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        const prefix = `${botId}|`;
        const fields: string[] = [];
        for await (const { field } of this.redis.hScanIterator('bots:matrix:dm-room-of', { COUNT: 500 })) {
            if (field.startsWith(prefix)) fields.push(field);
        }
        for (const field of fields) await this.redis.hDel('bots:matrix:dm-room-of', field);
    }

    /**
     * A room a purged Brick is about to leave and has yet to forget (register R29). Once it has left, the homeserver no longer lists the room for it,
     * so this is the only record that the forget is still owed; it survives a restart. Strict: throws while a store that was in use is down, so the
     * caller does not leave a room it could not write this down for. No store at all is a failure too: a record kept only in memory would be lost by a restart.
     */
    async rememberPendingForget(matrixUserId: string, roomId: string): Promise<void> {
        if (!this.redis?.isOpen) throw new Error(this.sharedStoreSeen ? 'The shared store is down' : 'There is no shared store to keep the owed forget in');
        await this.redis.hSet('bots:matrix:pending-forgets', `${matrixUserId}|${roomId}`, '1');
    }

    /** The rooms this user left and still has to forget. Throws while the store is down or missing: "none" would be a guess. */
    async pendingForgetsOf(matrixUserId: string): Promise<string[]> {
        if (!this.redis?.isOpen) throw new Error(this.sharedStoreSeen ? 'The shared store is down' : 'There is no shared store to read the owed forgets from');
        const prefix = `${matrixUserId}|`;
        return (await this.redis.hKeys('bots:matrix:pending-forgets')).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    }

    /** Every room owed a forget, for whichever Brick, so a retry never depends on a purge being asked for again. Throws while the store is down or missing. */
    async allPendingForgets(): Promise<Array<{ matrixUserId: string; roomId: string }>> {
        if (!this.redis?.isOpen) throw new Error(this.sharedStoreSeen ? 'The shared store is down' : 'There is no shared store to read the owed forgets from');
        return (await this.redis.hKeys('bots:matrix:pending-forgets')).flatMap((key) => {
            const cut = key.indexOf('|');
            return cut > 0 ? [{ matrixUserId: key.slice(0, cut), roomId: key.slice(cut + 1) }] : [];
        });
    }

    async clearPendingForget(matrixUserId: string, roomId: string): Promise<void> {
        if (!this.redis?.isOpen) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return;
        }
        await this.redis.hDel('bots:matrix:pending-forgets', `${matrixUserId}|${roomId}`);
    }

    /**
     * One device at a time makes the direct chat of a bot and a person (game #1995), across every bot server: true for
     * the first to ask, false for anyone who asks while that claim lasts. Null without Redis, and the caller keeps its
     * own in-process claim. Throws while a Redis that was in use is down: another server may hold the claim, so the
     * caller waits rather than claim on its own. With a token, the claim is held under it, so letting it go later lets
     * go of this claim only, never one another device took since.
     */
    async claimDirectChat(botId: string, matrixUserId: string, forMs: number, token?: string): Promise<boolean | null> {
        if (!isUp(this.redis)) {
            if (this.sharedStoreSeen) throw new Error('The shared store is down');
            return null;
        }
        return (await this.redis.set(`bots:matrix:dm-claim:${botId}|${matrixUserId}`, token ?? this.serverId, { NX: true, PX: forMs })) === 'OK';
    }

    /**
     * Holds that claim for a while longer: the bot is still taking a chat this person just made. The invite holds it
     * under its own token. The first hold takes the claim over from whoever had it (the device that made this chat).
     * A renewal keeps it only while it is still this invite's, or nobody's, so an invite that ran past the claim never
     * takes it back from a device that claimed it since. Without a token, it is held whoever has it.
     */
    async holdDirectChat(botId: string, matrixUserId: string, forMs: number, token?: string, takeOver = true): Promise<void> {
        if (!isUp(this.redis)) return;
        const key = `bots:matrix:dm-claim:${botId}|${matrixUserId}`;
        if (!token) {
            await this.redis.set(key, this.serverId, { PX: forMs });
            return;
        }
        await this.redis.eval(
            "local held = redis.call('GET', KEYS[1]) if ARGV[3] == '1' or not held or held == ARGV[1] then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end return 0",
            { keys: [key], arguments: [token, String(forMs), takeOver ? '1' : '0'] }
        );
    }

    /**
     * Lets the next device make the chat again: the bot has taken (or turned down) the one just made. With a token, only
     * a claim this invite still holds is let go, never one another device took since.
     */
    async releaseDirectChat(botId: string, matrixUserId: string, token?: string): Promise<void> {
        if (!isUp(this.redis)) return;
        const key = `bots:matrix:dm-claim:${botId}|${matrixUserId}`;
        if (!token) {
            await this.redis.del(key);
            return;
        }
        await this.redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", {
            keys: [key],
            arguments: [token],
        });
    }

    /**
     * Tell every other bot server that an owner's Brick changed (#1996), so each reads it again before its next message
     * instead of within the minute its cache lasts. Without Redis this is a no-op: this server is then the only one.
     */
    async tellBrickChanged(botId: string, ownerId: string): Promise<void> {
        if (!isUp(this.redis)) return;
        await this.redis.publish(BRICK_CHANGED_CHANNEL, JSON.stringify({ botId, ownerId, from: this.serverId }));
    }

    /**
     * Hear what other bot servers say about Bricks that changed. Messages come on a connection of their own, as Redis
     * asks of one that listens; this server's own messages are skipped, as it already acted on them. Without Redis
     * there is nothing to hear.
     */
    async onBrickChanged(heard: (botId: string, ownerId: string) => void): Promise<void> {
        if (!this.redis || this.brickListener) return;
        const listener = this.redis.duplicate();
        listener.on('error', (err) => console.error('[BotRegistry] Redis error (Brick changes):', err));
        this.brickListener = listener;
        const onMessage = (message: string) => {
            try {
                const said = JSON.parse(message) as { botId?: unknown; ownerId?: unknown; from?: unknown };
                if (said.from === this.serverId || typeof said.botId !== 'string' || typeof said.ownerId !== 'string') return;
                heard(said.botId, said.ownerId);
            } catch (err) {
                console.warn('[BotRegistry] Ignored a Brick change that could not be read:', err);
            }
        };
        try {
            // node-redis keeps trying to connect for as long as Redis is away, so an unbounded wait would hold up whoever starts this:
            // connecting and subscribing are held to one deadline (a SUBSCRIBE that is never answered would leave the listener set for good)
            if (!(await inTime(listener.connect().then(() => listener.subscribe(BRICK_CHANGED_CHANNEL, onMessage)), this.brickListenerConnectMs))) {
                throw new Error('Redis did not answer for the Brick changes in time');
            }
        } catch (err) {
            this.brickListener = null;
            // It has nothing to say goodbye to (it never subscribed): it is cut off, not asked to quit, which a silent connection would not answer
            await listener.disconnect().catch(() => undefined);
            throw err;
        }
    }

    /** A goal's saved step with no card (the card could not be shown and the step could not be closed): kept a while, for every bot server. */
    async markTaskCardUnshown(actionId: string): Promise<void> {
        // Not written is not marked: the caller keeps its own note until a store that answers can take it
        if (!isUp(this.redis)) throw new Error('shared store not connected');
        await this.redis.set(`bots:task-card-unshown:${actionId}`, '1', { EX: 3 * 24 * 60 * 60 });
    }

    async taskCardUnshown(actionId: string): Promise<boolean> {
        // A store that cannot answer is not an answer of "no card was missed"
        if (!isUp(this.redis)) throw new Error('shared store not connected');
        return (await this.redis.exists(`bots:task-card-unshown:${actionId}`)) > 0;
    }

    async clearTaskCardUnshown(actionId: string): Promise<void> {
        // Not cleared is not cleared: the caller knows the old marker may still be there
        if (!isUp(this.redis)) throw new Error('shared store not connected');
        await this.redis.del(`bots:task-card-unshown:${actionId}`);
    }

    /** Whether the shared store has ever been reached: on one machine without Redis it never is, and nothing is kept in it. */
    forgetQueueInUse(): boolean {
        return this.sharedStoreSeen || !!isUp(this.redis);
    }

    /** Whether a shared store is expected to hold things for this server: it was named for it, or it has been reached. A store that is expected and does not answer is down. */
    sharedStoreExpected(): boolean {
        return this.sharedStoreNamed || this.sharedStoreSeen;
    }

    /** The shared store's client while it is connected (and ready), null while it is not: where the forgets Orbit has not taken yet are kept for every bot server. */
    forgetQueueClient(): ForgetQueueRedis | null {
        return isUp(this.redis) ? (this.redis as unknown as ForgetQueueRedis) : null;
    }

    /** The shared store's client while it is connected (and ready), null while it is not: where the evidence of failed computer jobs waits for Orbit (it survives a restart). */
    evidenceClient(): EvidenceRedis | null {
        return isUp(this.redis) ? (this.redis as unknown as EvidenceRedis) : null;
    }

    /** Whether Redis is up, so messages waiting for a resting bot survive a restart and reach every bot server. */
    hasSharedStore(): boolean {
        return !!isUp(this.redis);
    }

    /**
     * Keep the last message someone left a resting bot in one room, for it to answer once it is back. One per room;
     * a newer message replaces the older one. Gone after a day.
     */
    async rememberWaitingDm(botId: string, roomId: string, message: string): Promise<void> {
        // Throws rather than drop the message, so the caller can keep it somewhere else.
        if (!isUp(this.redis)) throw new Error('Shared store is not connected');
        const key = `bots:matrix:dm-waiting:${botId}`;
        // One transaction, so a message is never stored without its bot being listed as waiting.
        await this.redis
            .multi()
            .hSet(key, roomId, message)
            .expire(key, 24 * 60 * 60)
            .sAdd('bots:matrix:dm-waiting', botId)
            .exec();
    }

    /** Bots that have messages waiting for them. A bot whose messages all expired is dropped from the list. */
    async waitingDmBots(): Promise<string[]> {
        if (!isUp(this.redis)) return [];
        const waiting: string[] = [];
        for (const botId of await this.redis.sMembers('bots:matrix:dm-waiting')) {
            if (await this.redis.exists(`bots:matrix:dm-waiting:${botId}`)) {
                waiting.push(botId);
            } else if (!(await this.unlistIfNothingWaits(botId))) {
                waiting.push(botId);
            }
        }
        return waiting;
    }

    /**
     * Drop a bot from the waiting list when it has nothing waiting. The check and the removal run as one script, so a
     * message stored in between keeps its bot listed. Returns whether the bot was dropped.
     */
    private async unlistIfNothingWaits(botId: string): Promise<boolean> {
        if (!isUp(this.redis)) return false;
        const dropped = await this.redis.eval(
            "if redis.call('HLEN', KEYS[1]) == 0 then return redis.call('SREM', KEYS[2], ARGV[1]) end return 0",
            { keys: [`bots:matrix:dm-waiting:${botId}`, 'bots:matrix:dm-waiting'], arguments: [botId] }
        );
        return Number(dropped) === 1;
    }

    async hasWaitingDms(botId: string): Promise<boolean> {
        if (!isUp(this.redis)) return false;
        return this.redis.sIsMember('bots:matrix:dm-waiting', botId);
    }

    /**
     * Take all of a bot's waiting messages. Reading, deleting and unlisting run as one script, so when several bot
     * servers drain at once every message is answered by one of them only, a message written meanwhile is never lost,
     * and a dropped connection can't leave some messages deleted but never handed back.
     */
    async takeWaitingDms(botId: string): Promise<string[]> {
        if (!isUp(this.redis)) return [];
        const taken = await this.redis.eval(
            "local all = redis.call('HVALS', KEYS[1]) redis.call('DEL', KEYS[1]) redis.call('SREM', KEYS[2], ARGV[1]) return all",
            { keys: [`bots:matrix:dm-waiting:${botId}`, 'bots:matrix:dm-waiting'], arguments: [botId] }
        );
        return Array.isArray(taken) ? taken.filter((message): message is string => typeof message === 'string') : [];
    }

    /**
     * Register this bot server with its capacity
     */
    async registerServer(capacity: number): Promise<void> {
        if (!isUp(this.redis)) {
            throw new Error('Redis not connected');
        }

        const serverInfo: BotServerInfo = {
            serverId: this.serverId,
            capacity,
            currentBots: 0,
            status: 'active',
            lastHeartbeat: Date.now(),
        };

        await this.redis.hSet(
            `bot:server:${this.serverId}`,
            {
                capacity: capacity.toString(),
                currentBots: '0',
                status: 'active',
                lastHeartbeat: Date.now().toString(),
            }
        );

        // Set expiration (if server doesn't heartbeat in 30 seconds, consider it dead)
        await this.redis.expire(`bot:server:${this.serverId}`, 30);
    }

    /**
     * Start heartbeat to keep server registration alive
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            return;
        }

        this.heartbeatInterval = setInterval(async () => {
            if (isUp(this.redis)) {
                try {
                    await this.redis.hSet(
                        `bot:server:${this.serverId}`,
                        'lastHeartbeat',
                        Date.now().toString()
                    );
                    await this.redis.expire(`bot:server:${this.serverId}`, 30);
                } catch (err) {
                    console.error('[BotRegistry] Heartbeat error:', err);
                }
            }
        }, this.HEARTBEAT_INTERVAL);
    }

    /**
     * Assign a bot to this server
     */
    async assignBot(botId: string): Promise<void> {
        if (!isUp(this.redis)) {
            throw new Error('Redis not connected');
        }

        // Store bot assignment
        await this.redis.set(
            `bot:assignment:${botId}`,
            this.serverId,
            { EX: 3600 } // Expire after 1 hour if not updated
        );

        // Increment bot count for this server
        await this.redis.hIncrBy(`bot:server:${this.serverId}`, 'currentBots', 1);
    }

    /**
     * Unassign a bot from this server
     */
    async unassignBot(botId: string): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        const serverId = await this.redis.get(`bot:assignment:${botId}`);
        
        if (serverId) {
            await this.redis.del(`bot:assignment:${botId}`);
            await this.redis.hIncrBy(`bot:server:${serverId}`, 'currentBots', -1);
        }
    }

    /**
     * Unassign all bots from this server (on shutdown)
     */
    private async unassignAllBotsFromServer(): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        // Find all bot assignments for this server
        const keys = await this.redis.keys('bot:assignment:*');
        
        for (const key of keys) {
            const serverId = await this.redis.get(key);
            if (serverId === this.serverId) {
                await this.redis.del(key);
            }
        }
    }

    /**
     * Mark server as shutting down
     */
    private async markServerShuttingDown(): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        await this.redis.hSet(`bot:server:${this.serverId}`, 'status', 'shutting_down');
    }

    /**
     * Find a server with available capacity
     */
    async findServerWithCapacity(): Promise<string | null> {
        if (!isUp(this.redis)) {
            return null;
        }

        const serverKeys = await this.redis.keys('bot:server:*');
        const now = Date.now();

        for (const serverKey of serverKeys) {
            const serverData = await this.redis.hGetAll(serverKey);
            
            if (!serverData || Object.keys(serverData).length === 0) {
                continue;
            }

            const status = serverData.status;
            const lastHeartbeat = parseInt(serverData.lastHeartbeat || '0');
            const capacity = parseInt(serverData.capacity || '0');
            const currentBots = parseInt(serverData.currentBots || '0');

            // Skip inactive or dead servers
            if (status !== 'active' || now - lastHeartbeat > 30000) {
                continue;
            }

            // Check if server has capacity
            if (currentBots < capacity) {
                const serverId = serverKey.replace('bot:server:', '');
                return serverId;
            }
        }

        return null;
    }

    /**
     * Get server info
     */
    async getServerInfo(serverId: string): Promise<BotServerInfo | null> {
        if (!isUp(this.redis)) {
            return null;
        }

        const serverData = await this.redis.hGetAll(`bot:server:${serverId}`);
        
        if (!serverData || Object.keys(serverData).length === 0) {
            return null;
        }

        return {
            serverId,
            capacity: parseInt(serverData.capacity || '0'),
            currentBots: parseInt(serverData.currentBots || '0'),
            status: (serverData.status || 'inactive') as BotServerInfo['status'],
            lastHeartbeat: parseInt(serverData.lastHeartbeat || '0'),
        };
    }

    /**
     * Get which server a bot is assigned to
     */
    async getBotServer(botId: string): Promise<string | null> {
        if (!isUp(this.redis)) {
            return null;
        }

        return await this.redis.get(`bot:assignment:${botId}`);
    }

    /**
     * Track an active conversation
     */
    async trackConversation(
        playerId: number,
        botId: string,
        spaceName: string
    ): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        const conversation: ConversationState = {
            botId,
            playerId,
            spaceName,
            startTime: Date.now(),
            lastMessageTime: Date.now(),
        };

        await this.redis.setEx(
            `bot:conversation:${playerId}`,
            this.CONVERSATION_TTL,
            JSON.stringify(conversation)
        );
    }

    /**
     * Update conversation last message time
     */
    async updateConversation(playerId: number): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        const conversationStr = await this.redis.get(`bot:conversation:${playerId}`);
        if (conversationStr) {
            const conversation: ConversationState = JSON.parse(conversationStr);
            conversation.lastMessageTime = Date.now();
            
            await this.redis.setEx(
                `bot:conversation:${playerId}`,
                this.CONVERSATION_TTL,
                JSON.stringify(conversation)
            );
        }
    }

    /**
     * End a conversation
     */
    async endConversation(playerId: number): Promise<void> {
        if (!isUp(this.redis)) {
            return;
        }

        await this.redis.del(`bot:conversation:${playerId}`);
    }

    /**
     * Check if a player is in a conversation
     */
    async isPlayerInConversation(playerId: number): Promise<boolean> {
        if (!isUp(this.redis)) {
            return false;
        }

        return (await this.redis.exists(`bot:conversation:${playerId}`)) === 1;
    }

    /**
     * Get conversation state for a player
     */
    async getConversation(playerId: number): Promise<ConversationState | null> {
        if (!isUp(this.redis)) {
            return null;
        }

        const conversationStr = await this.redis.get(`bot:conversation:${playerId}`);
        if (!conversationStr) {
            return null;
        }

        return JSON.parse(conversationStr) as ConversationState;
    }

    /**
     * Check if a bot can start a conversation with a player
     */
    async canBotStartConversation(botId: string, playerId: number): Promise<boolean> {
        if (!isUp(this.redis)) {
            return false;
        }

        // Check if player is already in a conversation
        const inConversation = await this.isPlayerInConversation(playerId);
        if (inConversation) {
            const conversation = await this.getConversation(playerId);
            // Allow if it's the same bot continuing the conversation
            return conversation?.botId === botId;
        }

        return true;
    }

    /**
     * Get all active servers
     */
    async getActiveServers(): Promise<BotServerInfo[]> {
        if (!isUp(this.redis)) {
            return [];
        }

        const serverKeys = await this.redis.keys('bot:server:*');
        const servers: BotServerInfo[] = [];
        const now = Date.now();

        for (const serverKey of serverKeys) {
            const serverData = await this.redis.hGetAll(serverKey);
            
            if (!serverData || Object.keys(serverData).length === 0) {
                continue;
            }

            const lastHeartbeat = parseInt(serverData.lastHeartbeat || '0');
            
            // Only include servers that have heartbeated in the last 30 seconds
            if (now - lastHeartbeat < 30000) {
                const serverId = serverKey.replace('bot:server:', '');
                servers.push({
                    serverId,
                    capacity: parseInt(serverData.capacity || '0'),
                    currentBots: parseInt(serverData.currentBots || '0'),
                    status: (serverData.status || 'inactive') as BotServerInfo['status'],
                    lastHeartbeat,
                });
            }
        }

        return servers;
    }

    /**
     * Get total bot count across all servers
     */
    async getTotalBotCount(): Promise<number> {
        if (!isUp(this.redis)) {
            return 0;
        }

        const servers = await this.getActiveServers();
        return servers.reduce((sum, server) => sum + server.currentBots, 0);
    }
}

