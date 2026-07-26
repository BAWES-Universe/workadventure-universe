/**
 * BaseBehavior - Abstract base class for all bot behaviors
 */

import { BotClient } from '../client/BotClient';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import type { SpaceUser } from '@workadventure/messages';
import { PositionMessage_Direction } from '@workadventure/messages';
import type { AIService } from '../ai/AIService';
import type { AdminApiService } from '../server/AdminApiService';
import type { ConversationStorage } from '../memory/ConversationStorage';
import type { ConversationMemory } from '../memory/ConversationMemory';
import type { ResponseProcessor } from '../ai/ResponseProcessor';
import type { BotMetricsCollector } from '../metrics/BotMetricsCollector';

/**
 * Per-player conversation state for mid-stream interruption handling.
 * Active while a player is chatting with the bot — tracks generation status
 * and queued messages received while the bot was mid-response.
 */
export interface ConversationState {
    playerId: number;
    spaceName: string;
    startTime: number;
    lastMessageTime: number;
    /** True while the bot is streaming an AI response for this player */
    isGenerating: boolean;
    /** The last user message that started the current generation */
    currentTask: string;
    /** Messages received while the bot was generating, processed in FIFO order */
    messageQueue: QueuedMessage[];
    /** AbortController to cancel the current stream on update/cancel */
    abortController?: AbortController;
    /** Monotonically increasing generation counter — used by .finally() to detect stale calls */
    generation: number;
    /** LLM-generated answers for 'answer' classifications, drained after stream finishes */
    pendingAnswers: string[];
    /** LLM-generated acknowledgment for 'update', sent before new generation starts */
    pendingUpdateMessage?: string;
}

/**
 * A message received while the bot was mid-response, queued for later processing.
 */
export interface QueuedMessage {
    message: string;
    url?: string;
    mediaType?: string;
    mimeType?: string;
    timestamp: number;
    /** 'answer' | 'queue' — set when queued via interruption classification */
    classification?: string;
}

export interface BehaviorConfig {
    type: string;
    assignedSpace?: {
        center: PositionInterface;
        radius: number; // Maximum distance from center
    };
    [key: string]: any;
}

export abstract class BaseBehavior {
    protected bot: BotClient | null = null;
    protected config: BehaviorConfig;
    protected aiService: AIService | null = null;
    protected adminApiService: AdminApiService | null = null;
    protected conversationStorage: ConversationStorage | null = null;
    protected responseProcessor: ResponseProcessor | null = null;
    protected metricsCollector: BotMetricsCollector | null = null;
    protected conversationMemory: ConversationMemory | null = null;
    
    // Engagement tracking - when players are in conversation with the bot
    protected isEngaged = false;
    protected engagedWithUsers: Map<number, { spaceName: string; position?: PositionInterface }> = new Map();
    
    // Proximity tracking - players nearby (based on userMovedMessage)
    protected nearbyPlayers: Map<number, PositionInterface> = new Map();
    
    // UUID tracking - map userId (number) to UUID (string) for conversation storage
    protected userIdToUuid: Map<number, string> = new Map();
    // Authentication tracking - map userId (number) to isLogged (boolean)
    protected userIdToIsLogged: Map<number, boolean> = new Map();
    // Pending UUID tracking - map spaceUserId (string) to userId (number) for users we've seen but don't have UUID yet
    // This helps match addSpaceUserMessage when it arrives after a chat message
    protected pendingSpaceUserIdToUserId: Map<string, number> = new Map();
    protected readonly PROXIMITY_RADIUS = 64; // Pixels - react when player is inside bubble
    protected readonly DISENGAGE_RADIUS = 80; // Slightly larger to prevent flickering at edge
    protected closestPlayerId: number | null = null;
    
    // Track previous bot position (for position updates)
    private previousBotPosition: PositionInterface | null = null;

    // Summon state - track when bot is summoned to a player
    protected isSummoned = false;
    protected summonedPlayerUuid: string | null = null;
    protected originalPosition: PositionInterface | null = null; // Position to return to after summon (set on first summon only)
    protected spawnPosition: PositionInterface | null = null; // Bot's spawn/assigned position (set when bot is initialized)
    protected isReturning = false; // Track if bot is returning to original position (for speed matching)

    // Leading state - track when bot is leading people to a destination
    protected isLeading = false;
    protected leadingPersonUuid: string | null = null;
    protected leadingTarget: { type: 'person' | 'area'; name: string; position: PositionInterface } | null = null;
    protected leadingStartPosition: PositionInterface | null = null; // Position where leading started
    protected leadingSpaceName: string | null = null; // Space name that was active during leading (for goodbye message)
    protected isSendingGoodbye = false; // Track if we're currently sending goodbye message (prevent returnToAssignedSpace)
    protected justCompletedLeading: { targetPersonId: number | null; followerUuid: string | null } | null = null; // Track when we just completed leading to trigger special greeting
    // Track players who already received a leading-completion greeting (from onSpaceJoined).
    // Used to prevent a duplicate generic greeting from onMemoryReady when
    // spaceJoined and addSpaceUserMessage arrive in any order.
    protected leadingGreetedPlayers = new Set<number>();
    protected preparedGoodbyeMessage: string | null = null; // Message prepared in advance while still leading
    protected isPreparingGoodbye = false; // Track if we're currently preparing the goodbye message

    // Conversation interruption state — per-player tracking for mid-stream routing
    protected activeConversations: Map<number, ConversationState> = new Map();
    private readonly MAX_QUEUED_MESSAGES = 3;

    constructor(config: BehaviorConfig) {
        this.config = config;
    }

    /**
     * Set the bot instance this behavior controls
     */
    setBot(bot: BotClient): void {
        this.bot = bot;
        // Initialize bot position tracking
        const botPos = bot.getState().getPosition();
        this.previousBotPosition = { x: botPos.x, y: botPos.y };
        
        // Store spawn position from assignedSpace (bot's defined location)
        if (this.config.assignedSpace?.center) {
            this.spawnPosition = { 
                x: this.config.assignedSpace.center.x, 
                y: this.config.assignedSpace.center.y 
            };
        } else {
            // Fallback to current position if no assignedSpace
            this.spawnPosition = { x: botPos.x, y: botPos.y };
        }
    }

    /**
     * Set AI service, Admin API service, ConversationStorage, ResponseProcessor, and MetricsCollector (called by BotManager)
     */
    setServices(aiService: AIService, adminApiService: AdminApiService, conversationStorage?: ConversationStorage, responseProcessor?: ResponseProcessor | null, metricsCollector?: BotMetricsCollector | null): void {
        this.aiService = aiService;
        this.adminApiService = adminApiService;
        this.conversationStorage = conversationStorage || null;
        this.responseProcessor = responseProcessor || null;
        this.metricsCollector = metricsCollector || null;
    }

    /**
     * Resolve a player's display name for greetings, using a priority chain:
     * 1. Conversation memory (personalized name from past interactions)
     * 2. Player info from BotClient (room nickname, excluding 'Unknown' sentinel)
     * 3. 'Someone' (safe fallback)
     */
    protected resolvePlayerName(botId: string, playerId: number, conversationMemory: ConversationMemory | null): string | null {
        const playerInfo = this.bot?.getPlayerInfo(playerId);
        return conversationMemory?.getPersonalInfo(botId, playerId)?.name
            || (playerInfo && playerInfo.name !== 'Unknown' ? playerInfo.name : null);
    }

    /**
     * Set conversation memory (behaviors can override to use shared memory)
     */
    setConversationMemory(memory: ConversationMemory): void {
        this.conversationMemory = memory;
    }
    
    /**
     * Helper method to set user UUID in conversation memory (behaviors can override)
     * This is called when a user joins a space to ensure UUID tracking
     */
    protected setUserUuidInMemory?(botId: string, userId: number, userUuid: string, isLogged: boolean): void;

    /**
     * Called after memory is restored for a user joining the space.
     * This fires AFTER setUserUuidInMemory() so behaviors have access to restored memory.
     * Override this in behavior implementations to trigger greetings at the correct time.
     * @param spaceName Space name
     * @param user User that joined, with id field
     */
    protected onMemoryReady?(spaceName: string, user: SpaceUser & { id: number }): void;

    /**
     * Update behavior (called every frame/tick)
     * @param deltaTime Time since last update in milliseconds
     */
    abstract update(deltaTime: number): void;

    /**
     * Called when a player approaches the bot
     * @param playerId Player's user ID
     * @param distance Distance to player
     */
    onPlayerApproached(playerId: number, distance: number): void {
        // Default: do nothing
    }

    /**
     * Called when a player moves
     * @param playerId Player's user ID
     * @param position New position
     */
    onPlayerMoved(playerId: number, position: PositionInterface): void {
        if (!this.bot) return;
        
        // Ignore other bots - only react to real players
        if (this.bot.isOtherBot(playerId)) {
            return;
        }
        
        // If summoned, check if the summoned player moved far away (> 200px)
        if (this.isSummoned) {
            const playerPos = this.getSummonedPlayerPosition();
            if (!playerPos) {
                // Player not found - they likely left, end summon
                console.log(`[Behavior] Summoned player not found, ending summon and returning`);
                this.endSummon();
                return;
            }
            
            const botPos = this.bot.getState().getPosition();
            const dx = playerPos.x - botPos.x;
            const dy = playerPos.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // If player moved far away (> 200px) and we're not in a conversation, return
            if (distance > 200 && this.engagedWithUsers.size === 0) {
                console.log(`[Behavior] Summoned player moved far away (${Math.round(distance)}px), ending summon and returning`);
                this.endSummon();
                return;
            }
        }
        
        const behaviorType = (this.config as any).type;
        const respondToPlayers = (this.config as any).respondToPlayers;
        
        // For patrol bots with respondToPlayers=false, don't track players (ghost mode)
        if (behaviorType === 'patrol' && respondToPlayers === false) {
            return; // Skip all player tracking for ghost mode
        }
        
        const botPos = this.bot.getState().getPosition();
        const dx = position.x - botPos.x;
        const dy = position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const wasNearby = this.nearbyPlayers.has(playerId);
        
        // Use enter radius - 100px for patrol bots (respondToPlayers), 80px for others
        // This matches the original behavior where patrol bots detected players at 100px
        const enterRadius = (behaviorType === 'patrol' && respondToPlayers !== false) ? 100 : 80;
        const leaveRadius = this.DISENGAGE_RADIUS;
        
        // If already engaged with this player, use a much larger leave radius
        // This prevents disengagement due to bot movement before stopping
        const effectiveLeaveRadius = wasNearby && this.isEngaged ? leaveRadius * 2 : leaveRadius;
        
        if (!wasNearby && distance <= enterRadius) {
            // Player entered proximity
            this.nearbyPlayers.set(playerId, position);
            console.log(`[Behavior] Player ${playerId} entered proximity (${Math.round(distance)}px) - engaging`);
            this.updateProximityEngagement();
        } else if (wasNearby && distance > effectiveLeaveRadius) {
            // Player left proximity
            this.nearbyPlayers.delete(playerId);
            console.log(`[Behavior] Player ${playerId} left proximity (${Math.round(distance)}px)`);
            this.updateProximityEngagement();
        } else if (wasNearby) {
            // Player still nearby, update position for facing
            this.nearbyPlayers.set(playerId, position);
            this.updateProximityEngagement();
        }
        // Log current state for debugging
        if (this.nearbyPlayers.size > 0 || this.isEngaged) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] State: nearbyPlayers=${this.nearbyPlayers.size}, isEngaged=${this.isEngaged}`);
            }
        }
    }
    
    /**
     * Called every frame to update engagement state (for continuous facing updates)
     * This ensures bots face players even when players stop moving
     */
    updateEngagement(): void {
        if (this.isEngaged && this.nearbyPlayers.size > 0) {
            // Update engagement to refresh facing direction
            this.updateProximityEngagement();
        }
    }
    
    /**
     * Called when bot position updates - track bot movement to distinguish from player movement
     */
    onBotPositionUpdated(): void {
        if (!this.bot) return;
        const botPos = this.bot.getState().getPosition();
        this.previousBotPosition = { x: botPos.x, y: botPos.y };
    }
    
    /**
     * Update engagement state based on nearby players
     */
    protected updateProximityEngagement(): void {
        if (!this.bot) return;
        
        const wasEngaged = this.isEngaged;
        // Check both proximity-based and space-based engagement
        this.isEngaged = this.nearbyPlayers.size > 0 || this.engagedWithUsers.size > 0;
        
        // For patrol bots with respondToPlayers enabled, stop when players are nearby
        const behaviorType = (this.config as any).type;
        const respondToPlayers = (this.config as any).respondToPlayers;
        const shouldStopForPlayers = behaviorType === 'patrol' && respondToPlayers !== false;
        
        if (this.isEngaged) {
            // Find closest player (check both nearbyPlayers and engagedWithUsers)
            let closestDistance = Infinity;
            let closestId: number | null = null;
            let closestPos: PositionInterface | null = null;
            const botPos = this.bot.getState().getPosition();
            
            // Check nearby players first (proximity-based)
            for (const [playerId, playerPos] of this.nearbyPlayers) {
                const dx = playerPos.x - botPos.x;
                const dy = playerPos.y - botPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < closestDistance) {
                    closestDistance = dist;
                    closestId = playerId;
                    closestPos = playerPos;
                }
            }
            
            // Also check engaged users (space-based) if no nearby player found
            if (!closestPos) {
                for (const [userId, userData] of this.engagedWithUsers) {
                    if (userData.position) {
                        const dx = userData.position.x - botPos.x;
                        const dy = userData.position.y - botPos.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        
                        if (dist < closestDistance) {
                            closestDistance = dist;
                            closestId = userId;
                            closestPos = userData.position;
                        }
                    }
                }
            }
            
            // Face the closest player
            if (closestPos) {
                if (closestId !== this.closestPlayerId) {
                    // Different player or first time
                    this.closestPlayerId = closestId;
                    
                    // For patrol bots with respondToPlayers, stop and face
                    // BUT: Don't stop if bot is summoned AND still moving (needs to reach player first)
                    // If summoned but not moving, bot has reached target - allow stopping
                    const isSummonedAndMoving = this.isSummoned && this.bot.getState().isMoving();
                    if (shouldStopForPlayers && !isSummonedAndMoving) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    
                    // Face the player
                    // If summoned but not moving, bot has reached target - allow facing
                    // If not summoned, always face
                    if (!isSummonedAndMoving) {
                        this.facePosition(closestPos);
                    }
                    if (!wasEngaged) {
                        console.log(`[Behavior] Engaged with player ${closestId} - ${isSummonedAndMoving ? 'summoned, continuing' : 'stopped and facing'}`);
                    } else {
                        console.log(`[Behavior] Facing player ${closestId}`);
                    }
                } else {
                    // Same player, but they might have moved - update facing
                    // For patrol bots, ensure we're still stopped (unless summoned/leading and moving)
                    const isSummonedAndMoving = this.isSummoned && this.bot.getState().isMoving();
                    const isLeadingAndMoving = this.isLeading && this.bot.getState().isMoving();
                    // Don't stop if bot is leading or summoned and moving
                    if (shouldStopForPlayers && !isSummonedAndMoving && !isLeadingAndMoving && this.bot.getState().isMoving()) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    // Face the player (always face, unless summoned/leading and still moving)
                    if (!isSummonedAndMoving && !isLeadingAndMoving) {
                        this.facePosition(closestPos);
                    }
                }
            }
        } else {
            // No longer engaged
            const previousClosestPlayerId = this.closestPlayerId;
            this.closestPlayerId = null;
            
            if (wasEngaged) {
                console.log(`[Behavior] No longer engaged - all players left proximity/space`);
                
                // End conversation in storage if player left (with a small delay to ensure all messages are stored)
                if (previousClosestPlayerId && this.conversationStorage && this.bot) {
                    const botId = this.bot.getBotId();
                    // Delay to ensure any pending messages are stored
                    setTimeout(() => {
                        const userUuid = this.userIdToUuid.get(previousClosestPlayerId);
                        if (userUuid && this.conversationStorage) {
                            this.conversationStorage.endConversation(botId, userUuid, 'timeout').catch(error => {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.error(`[Behavior] Error ending conversation:`, error);
                                }
                            });
                        } else if (!userUuid) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[Behavior] Cannot end conversation: UUID not found for user ${previousClosestPlayerId}`);
                            }
                        }
                        
                        // Clear repetition tracking for this conversation
                        if (this.responseProcessor && previousClosestPlayerId) {
                            (this.responseProcessor as any).clearRecentResponses(botId, previousClosestPlayerId);
                        }
                    }, 2000); // 2 second delay to capture any final messages
                }
            }
        }
    }

    /**
     * Called when bot joins a group (conversation bubble)
     * @param groupId Group ID
     * @param userIds User IDs in the group
     */
    onGroupJoined(groupId: number, userIds: number[]): void {
        // Default: do nothing
    }

    /**
     * Called when bot joins a space (for chat/audio)
     * @param spaceName Space name
     */
    onSpaceJoined(spaceName: string): void {
        // If leading and space name not set yet, set it now (space was just created)
        if (this.isLeading && !this.leadingSpaceName) {
            this.leadingSpaceName = spaceName;
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Leading space name set to: ${spaceName}`);
            }
        }
    }

    /**
     * Called when bot leaves a space
     * @param spaceName Space name
     */
    onSpaceLeft(spaceName: string): void {
        // Clear justCompletedLeading flag if we left the space before greeting was sent
        // BUT: Don't clear it if we're still leading (we intentionally left to join target's space)
        if (!this.isLeading) {
            this.justCompletedLeading = null;
            this.leadingGreetedPlayers.clear();
        }
        
        // If we just finished leading (not currently leading but have leadingStartPosition), check if follower left
        if (!this.isLeading && this.leadingStartPosition) {
            // If we're sending goodbye, don't return yet - wait for message to complete
            if (this.isSendingGoodbye) {
                return;
            }
            // Check if any followers are still nearby
            const followersStillNearby = this.checkFollowerStillNearby();
            if (!followersStillNearby) {
                // All followers left, return to where we started leading
                this.returnAfterLeading();
                return;
            }
            // If followers still nearby, don't return yet - wait for them to leave
            return;
        }
        
        // If we're leading, don't return to assigned space - we're moving to a target
        if (this.isLeading) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Left space ${spaceName} while leading - not returning to assigned space`);
            }
            return;
        }
        
        // If we're sending goodbye message, don't return to assigned space yet
        if (this.isSendingGoodbye) {
            return;
        }
        
        // If summoned and player left, return to original position
        if (this.isSummoned && this.summonedPlayerUuid) {
            // Check if the summoned player is still nearby
            const playerStillNearby = this.checkSummonedPlayerStillNearby();
            if (!playerStillNearby) {
                this.endSummon();
            }
        } else {
            // Default: return to assigned space if configured
            this.returnToAssignedSpace();
        }
    }

    /**
     * Start summon - bot is being summoned to a player
     * @param playerUuid Player UUID being summoned to
     * @param targetPosition Target position to move to
     */
    startSummon(playerUuid: string, targetPosition: PositionInterface): void {
        if (!this.bot) return;

        // Always sync isEngaged with actual engagedWithUsers size FIRST to avoid stale state
        const actualEngagedCount = this.engagedWithUsers.size;
        this.isEngaged = actualEngagedCount > 0;

        // If bot was returning (from summon or leading), cancel the return and start new summon
        // Allow summoning even if engaged when returning (returning is a transitional state)
        if (this.isReturning) {
            console.log(`[Behavior] Bot was returning, canceling return and starting new summon`);
            this.isReturning = false;
            // If returning from leading, clear leadingStartPosition (summon will use originalPosition)
            if (this.leadingStartPosition) {
                this.leadingStartPosition = null;
            }
            // Cancel any ongoing return pathfinding
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            // Clear engagement state when returning (bot is transitioning)
            this.engagedWithUsers.clear();
            this.isEngaged = false;
        } else {
            // Check if bot is engaged with someone else - don't allow summon if busy (unless returning)
            // Only check the actual size, not the stale isEngaged flag
            if (actualEngagedCount > 0) {
                console.log(`[Behavior] Bot cannot be summoned - currently engaged with ${actualEngagedCount} user(s)`);
                throw new Error('Bot is currently engaged with another player and cannot be summoned');
            }
            // If we get here, bot is not engaged - ensure isEngaged is false
            this.isEngaged = false;
        }
        
        this.isSummoned = true;
        this.summonedPlayerUuid = playerUuid;
        
        // Only store original position on FIRST summon (don't overwrite on subsequent summons)
        // This ensures bot always returns to its spawn/assigned position, not the last summon position
        if (!this.originalPosition) {
            // Use spawn position if available, otherwise use current position
            if (this.spawnPosition) {
                this.originalPosition = { x: this.spawnPosition.x, y: this.spawnPosition.y };
            } else {
                const botPos = this.bot.getState().getPosition();
                this.originalPosition = { x: botPos.x, y: botPos.y };
            }
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Behavior] Bot summoned to player ${playerUuid} at (${targetPosition.x}, ${targetPosition.y}), will return to: (${this.originalPosition?.x}, ${this.originalPosition?.y})`);
        }
    }

    /**
     * Get the position of the summoned player (if available)
     */
    protected getSummonedPlayerPosition(): PositionInterface | null {
        if (!this.bot || !this.summonedPlayerUuid) return null;
        
        // Try to find the player by checking all players
        // Since we don't have UUID in PlayerInfo, we'll use the first nearby player
        // or check engaged users
        const allPlayers = this.bot.getAllPlayers();
        for (const player of allPlayers) {
            // Check if this player is nearby (within reasonable range)
            const botPos = this.bot.getState().getPosition();
            const dx = player.position.x - botPos.x;
            const dy = player.position.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // If player is within 200px, assume it might be the summoned player
            if (distance < 200) {
                return player.position;
            }
        }
        
        // If no nearby player found, return null (player might have left)
        return null;
    }

    /**
     * Check if summoned player is still nearby
     * Returns true if player is still in proximity, false if they left
     */
    protected checkSummonedPlayerStillNearby(): boolean {
        if (!this.bot || !this.summonedPlayerUuid) return false;

        // Check if we can find the player position
        const playerPos = this.getSummonedPlayerPosition();
        if (!playerPos) {
            return false; // Player not found, they likely left
        }

        // Check if player is still within reasonable range (200px)
        const botPos = this.bot.getState().getPosition();
        const dx = playerPos.x - botPos.x;
        const dy = playerPos.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < 200; // Player is still nearby
    }

    /**
     * Check if follower is still nearby
     * Returns true if any follower is still in proximity, false if they all left
     */
    protected checkFollowerStillNearby(): boolean {
        if (!this.bot) return false;

        const allPeople = this.bot.getAllPeople();
        const botPos = this.bot.getState().getPosition();
        
        // Find nearby non-bot people (followers)
        const nearbyPeople = allPeople.filter(p => {
            if (BotClient.isBot(p.userId)) return false;
            const dx = p.position.x - botPos.x;
            const dy = p.position.y - botPos.y;
            return Math.sqrt(dx * dx + dy * dy) < 200;
        });
        
        return nearbyPeople.length > 0;
    }

    /**
     * Return to position where leading started (similar to endSummon)
     */
    protected returnAfterLeading(): void {
        if (!this.bot || !this.leadingStartPosition) return;

        console.log(`[Behavior] Follower left after leading, returning to start position: (${this.leadingStartPosition.x}, ${this.leadingStartPosition.y})`);

        // Store return position but DON'T clear leadingStartPosition yet (similar to endSummon)
        // We need it to check when we've reached it, and to preserve it if interrupted
        const startPos = this.leadingStartPosition;
        this.leadingPersonUuid = null;
        this.leadingSpaceName = null; // Clear space name after return
        // Set returning flag so bot moves at 3x speed (matching summon/leading speed)
        this.isReturning = true;

        // Return to start position if we have one
        const botPos = this.bot.getState().getPosition();
        const dx = startPos.x - botPos.x;
        const dy = startPos.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If not at start position, move back using pathfinding
        if (distance > 50) {
            console.log(`[Behavior] Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), returning to (${Math.round(startPos.x)}, ${Math.round(startPos.y)}), distance: ${Math.round(distance)}px`);
            
            // Reset path end time so we can immediately start return path
            (this.bot as any).lastPathEndTime = 0;
            
            // Use pathfinding to return (will use 3x speed because isReturning is true)
            // Match endSummon behavior exactly - clear leadingStartPosition only when return completes
            this.bot.moveToWithPathfinding(startPos.x, startPos.y).then((success) => {
                if (success) {
                    console.log(`[Behavior] ✅ Return after leading pathfinding started to start position (3x speed)`);
                } else {
                    console.error(`[Behavior] ❌ Return after leading pathfinding failed, retrying pathfinding`);
                    // Don't clear isReturning or leadingStartPosition — retry on next attempt.
                    // Clear path end cooldown so retry isn't blocked.
                    (this.bot as any).lastPathEndTime = 0;
                    // Try pathfinding again with a small random delay. Check if pathfinding is available first.
                    setTimeout(() => {
                        if (this.isReturning && this.leadingStartPosition && this.bot) {
                            if ((this.bot as any).hasPathfinding?.()) {
                                this.bot.moveToWithPathfinding(startPos.x, startPos.y).then((success) => {
                                    if (!success) {
                                        console.error(`[Behavior] ❌ Return after leading retry pathfinding also failed, giving up`);
                                        this.isReturning = false;
                                        this.leadingStartPosition = null;
                                    }
                                }).catch(() => {
                                    console.error(`[Behavior] ❌ Return after leading retry rejected, giving up`);
                                    this.isReturning = false;
                                    this.leadingStartPosition = null;
                                });
                            } else {
                                // No pathfinding available after retry, give up
                                console.error(`[Behavior] ❌ Pathfinding still not available after retry, giving up`);
                                this.isReturning = false;
                                this.leadingStartPosition = null;
                            }
                        }
                    }, 500);
                }
            }).catch((error) => {
                console.error(`[Behavior] Error returning after leading:`, error);
                this.isReturning = false;
                this.leadingStartPosition = null; // Clear only on error
            });
        } else {
            console.log(`[Behavior] Bot already at start position, no need to move`);
            this.isReturning = false;
            this.leadingStartPosition = null; // Clear when already at destination
        }
    }

    /**
     * Start leading - bot is leading people to a destination
     * @param personUuid Person UUID (or 'group' for group leading)
     * @param target Target destination (person or area)
     */
    startLeading(personUuid: string, target: { type: 'person' | 'area'; name: string; position: PositionInterface }): void {
        if (!this.bot) return;

        // If bot was returning, cancel the return and start leading
        if (this.isReturning) {
            console.log(`[Behavior] Bot was returning, canceling return and starting to lead`);
            this.isReturning = false;
            // Cancel any ongoing return pathfinding
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
        }

        // If bot was summoned, cancel summon and start leading
        if (this.isSummoned) {
            console.log(`[Behavior] Bot was summoned, canceling summon and starting to lead`);
            this.isSummoned = false;
            this.summonedPlayerUuid = null;
            // Cancel any ongoing summon pathfinding
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
        }
        
        this.isLeading = true;
        this.leadingPersonUuid = personUuid;
        this.leadingTarget = target;
        
        // Store start position for return (only on first lead, similar to summon)
        // If bot is returning from a previous lead, preserve the original start position
        // This ensures bot always returns to spawn/assigned position, not the interrupted position
        if (!this.leadingStartPosition) {
            // Use spawn position if available (like summon does), otherwise use current position
            if (this.spawnPosition) {
                this.leadingStartPosition = { x: this.spawnPosition.x, y: this.spawnPosition.y };
            } else {
                const botPos = this.bot.getState().getPosition();
                this.leadingStartPosition = { x: botPos.x, y: botPos.y };
            }
        }
        // If leadingStartPosition already exists (from previous lead), keep it - don't overwrite
        
        // Store the current space name (the space we're in during follow)
        // If not in a space yet, we'll set it when the space is created (when follower joins)
        const currentSpaces = this.bot.getCurrentSpaces();
        if (currentSpaces.length > 0) {
            this.leadingSpaceName = currentSpaces[0];
        } else {
            // Not in a space yet - will be set when space is created
            // This happens when the bot sends follow request and the person follows
            this.leadingSpaceName = null;
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Behavior] Bot started leading to ${target.type} "${target.name}" at (${target.position.x}, ${target.position.y})`);
        }
    }

    /**
     * End leading - bot stops leading and can return to original position
     * @param targetPersonId Optional: ID of the person we led to (for special greeting)
     * @param followerUuid Optional: UUID of the person who was following (for special greeting)
     */
    endLeading(targetPersonId?: number, followerUuid?: string): void {
        if (!this.bot) return;

        // Send follow abort before clearing leading state
        if (this.bot && typeof (this.bot as any).sendFollowAbort === 'function') {
            (this.bot as any).sendFollowAbort();
        }

        // Store info about who we just led and to whom (for special greeting when bubble forms)
        if (targetPersonId !== undefined && followerUuid !== undefined) {
            this.justCompletedLeading = { targetPersonId, followerUuid };
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Bot completed leading - will send special greeting to person ${targetPersonId}`);
            }
        }

        this.isLeading = false;
        this.leadingPersonUuid = null;
        this.leadingTarget = null;
        // Don't clear leadingStartPosition or leadingSpaceName - keep them for potential return and message

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Behavior] Bot stopped leading`);
        }
    }

    /**
     * End summon - return bot to original position
     */
    endSummon(): void {
        if (!this.bot || !this.isSummoned) return;

        console.log(`[Behavior] Ending summon, returning to original position: (${this.originalPosition?.x}, ${this.originalPosition?.y})`);

        // Clear summon state but keep track of return position
        const originalPos = this.originalPosition;
        this.isSummoned = false;
        this.summonedPlayerUuid = null;
        // Don't clear originalPosition yet - we need it to check when we've reached it
        // Set returning flag so bot moves at 3x speed (matching summon speed)
        this.isReturning = true;

        // Return to original position if we have one
        if (originalPos) {
            const botPos = this.bot.getState().getPosition();
            const dx = originalPos.x - botPos.x;
            const dy = originalPos.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // If not at original position, move back using pathfinding
            if (distance > 50) {
                console.log(`[Behavior] Bot at (${Math.round(botPos.x)}, ${Math.round(botPos.y)}), returning to (${Math.round(originalPos.x)}, ${Math.round(originalPos.y)}), distance: ${Math.round(distance)}px`);
                
                // Reset path end time so we can immediately start return path
                (this.bot as any).lastPathEndTime = 0;
                
                // Use pathfinding to return (will use 3x speed because isReturning is true)
                this.bot.moveToWithPathfinding(originalPos.x, originalPos.y).then((success) => {
                    if (success) {
                        console.log(`[Behavior] ✅ Return pathfinding started to original position (3x speed)`);
                    } else {
                        console.error(`[Behavior] ❌ Return pathfinding failed, retrying pathfinding`);
                        // Don't clear isReturning or originalPosition — retry on next attempt.
                        // Clear path end cooldown so retry isn't blocked.
                        (this.bot as any).lastPathEndTime = 0;
                        // Try pathfinding again with a small random delay. Check if pathfinding is available first.
                        setTimeout(() => {
                            if (this.isReturning && this.originalPosition && this.bot) {
                                if ((this.bot as any).hasPathfinding?.()) {
                                    this.bot.moveToWithPathfinding(originalPos.x, originalPos.y).then((success) => {
                                        if (!success) {
                                            console.error(`[Behavior] ❌ Return pathfinding retry also failed, giving up`);
                                            this.isReturning = false;
                                            this.originalPosition = null;
                                        }
                                    }).catch(() => {
                                        console.error(`[Behavior] ❌ Return pathfinding retry rejected, giving up`);
                                        this.isReturning = false;
                                        this.originalPosition = null;
                                    });
                                } else {
                                    console.error(`[Behavior] ❌ Pathfinding still not available after retry, giving up`);
                                    this.isReturning = false;
                                    this.originalPosition = null;
                                }
                            }
                        }, 500);
                    }
                }).catch((error) => {
                    console.error(`[Behavior] Error returning to original position:`, error);
                    this.isReturning = false;
                    this.originalPosition = null;
                });
            } else {
                console.log(`[Behavior] Bot already at original position, no need to move`);
                this.isReturning = false;
                this.originalPosition = null;
            }
        } else {
            console.log(`[Behavior] No original position stored, bot will stay at current position`);
            this.isReturning = false;
        }
    }

    /**
     * Determine if the bot should join a proximity/bubble space
     * Override in subclasses to control chat participation
     * @param spaceName Space name
     * @returns true if bot should join, false to decline
     */
    shouldJoinProximitySpace(_spaceName: string): boolean {
        // Default: accept all proximity spaces (players can talk to bots)
        return true;
    }

    /**
     * Return bot to its assigned space/area
     * Uses pathfinding to walk back (not teleport)
     */
    protected returnToAssignedSpace(): void {
        if (!this.bot || !this.config.assignedSpace) return;

        const assignedSpace = this.config.assignedSpace;
        const botPos = this.bot.getState().getPosition();
        
        // Prefer spawn position if available, otherwise use center of assigned space
        let targetX: number;
        let targetY: number;
        
        if (this.spawnPosition) {
            // Return to spawn position (actual spawn point)
            targetX = this.spawnPosition.x;
            targetY = this.spawnPosition.y;
        } else {
            // Fallback to center of assigned space
            targetX = assignedSpace.center.x;
            targetY = assignedSpace.center.y;
        }
        
        const dx = targetX - botPos.x;
        const dy = targetY - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If outside assigned space or not at spawn, return to it using pathfinding
        const distanceToCenter = Math.sqrt(
            Math.pow(assignedSpace.center.x - botPos.x, 2) + 
            Math.pow(assignedSpace.center.y - botPos.y, 2)
        );
        
        if (distanceToCenter > assignedSpace.radius || distance > 50) {
            
            // Use pathfinding to return (walk back, don't teleport)
            if (this.bot.hasPathfinding() && !this.bot.getIsFollowingPath()) {
                // Reset path end time to allow immediate pathfinding
                (this.bot as any).lastPathEndTime = 0;
                
                this.bot.moveToWithPathfinding(targetX, targetY).then((success) => {
                    if (success) {
                        console.log(`[Behavior] ✅ Return to assigned space pathfinding started`);
                    } else {
                        console.warn(`[Behavior] ⚠️ Return to assigned space pathfinding failed, using direct movement`);
                        // Fallback to direct movement if pathfinding fails
                        let direction = PositionMessage_Direction.DOWN;
                        if (Math.abs(dx) > Math.abs(dy)) {
                            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                        } else {
                            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                        }
                        this.bot.moveTo(targetX, targetY, direction);
                    }
                }).catch((error) => {
                    console.error(`[Behavior] Error returning to assigned space:`, error);
                });
            } else {
                // Pathfinding not available or already following path - use direct movement as fallback
                let direction = PositionMessage_Direction.DOWN;
                if (Math.abs(dx) > Math.abs(dy)) {
                    direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                } else {
                    direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                }
                this.bot.moveTo(targetX, targetY, direction);
            }
        }
    }

    /**
     * Check if bot is within assigned space
     */
    protected isWithinAssignedSpace(): boolean {
        if (!this.bot || !this.config.assignedSpace) return true; // No restriction

        const assignedSpace = this.config.assignedSpace;
        const botPos = this.bot.getState().getPosition();
        const dx = assignedSpace.center.x - botPos.x;
        const dy = assignedSpace.center.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return distance <= assignedSpace.radius;
    }

    /**
     * Retry any pending media that was queued when the user previously left the space.
     * Re-uploads (CDN copies are fast) and re-sends. On success, injects an
     * autoDeliveredMedia fact so the greeting AI knows not to re-announce it.
     */
    protected async retryPendingMedia(spaceName: string, user: SpaceUser & { id: number }): Promise<void> {
        const botId = this.bot?.getBotId();
        const botClient = this.bot;
        if (!botId || !botClient || !this.conversationMemory) return;

        const memory = this.conversationMemory?.getMemory(botId, user.id) ?? null;
        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            const pm = memory?.pendingMedia ?? [];
            console.log(`[PM-TRACE] retryPendingMedia entry: pendingMediaLen=${pm.length} urls=[${pm.map(p => p.url.substring(0, 60)).join(', ')}]`);
        }
        if (!memory?.pendingMedia?.length) return;

        const now = Date.now();
        const MIN_RETRY_INTERVAL_MS = 10_000; // Must match AIService.ts

        for (const pending of memory.pendingMedia) {
            if (pending.retryCount >= 3) {
                if (process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Behavior] Dropping pending media after ${pending.retryCount} retries: ${pending.url.substring(0, 60)}`);
                }
                continue;
            }
            if (pending.lastRetryAt && (now - pending.lastRetryAt) < MIN_RETRY_INTERVAL_MS) {
                continue;
            }
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Queued pending ${pending.mediaType} for conversation-turn delivery to user ${user.id}`);
            }
        }
        // Remove exhausted items (retryCount >= 3) so they don't accumulate
        // indefinitely, generating log spam on every re-join and consuming
        // limited slots in the pendingMedia array.
        memory.pendingMedia = memory.pendingMedia.filter(p => p.retryCount < 3);
        // Keep ready items in pendingMedia — flushPendingMedia will send them
        // during the conversation turn (after "New discussion with..." appears).

        // Note: autoDeliveredMedia fact removed — getConversationContext now
        // reads pendingMedia directly, so the AI always knows about pending
        // items without needing a fact to be set beforehand.

        // Sync the snapshot so pendingMedia changes survive setUserUuid restoration
        // on the next re-entry. Without this, the stale snapshot (captured before
        // tool results queued items to pendingMedia) would overwrite the in-memory
        // state with empty pendingMedia.
        if (typeof (this.conversationMemory as any)?.syncSnapshot === 'function') {
            (this.conversationMemory as any).syncSnapshot(botId, user.id, memory);
            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                const pm = memory.pendingMedia ?? [];
                console.log(`[PM-TRACE] syncSnapshot called: pendingMediaLen=${pm.length} urls=[${pm.map(p => p.url.substring(0, 60)).join(', ')}]`);
            }
        }
    }

    /**
     * Called when a user joins the space
     * @param spaceName Space name
     * @param user User that joined
     */
    async onSpaceUserJoined(spaceName: string, user: SpaceUser & { id: number }): Promise<void> {
        // Skip if it's the bot itself
        if (user.id === this.bot?.getUserId()) {
            return;
        }

        // Track UUID for conversation storage (REQUIRED by Admin API)
        if (user.uuid) {
            this.userIdToUuid.set(user.id, user.uuid);
        }
        
        // Track authentication status (for isGuest determination)
        if (user.isLogged !== undefined) {
            this.userIdToIsLogged.set(user.id, user.isLogged);
        }
        
        // Check if this spaceUserId was pending (we saw a chat message before addSpaceUserMessage)
        if (user.spaceUserId && this.pendingSpaceUserIdToUserId.has(user.spaceUserId)) {
            const pendingUserId = this.pendingSpaceUserIdToUserId.get(user.spaceUserId);
            if (pendingUserId === user.id && user.uuid) {
                // This matches a pending user - UUID is now available
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[Behavior] ✅ Matched pending spaceUserId ${user.spaceUserId} to userId ${user.id} with UUID ${user.uuid}`);
                }
            }
            // Clean up pending entry
            this.pendingSpaceUserIdToUserId.delete(user.spaceUserId);
        }
        
        // Track this user as engaged IMMEDIATELY, before any async work.
        // This prevents a race with onSpaceUserLeft: if the user leaves
        // during retryPendingMedia, onSpaceUserLeft's engagedWithUsers.delete()
        // will correctly remove them. Without this ordering, the engagedWithUsers.set()
        // after the await would re-add the user after they'd already left.
        this.engagedWithUsers.set(user.id, { spaceName, position: undefined });
        this.isEngaged = this.engagedWithUsers.size > 0;
        
        // Also track UUID in PersistentMemory for memory/emotion persistence
        if (user.uuid) {
            const botId = this.bot?.getBotId();
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] onSpaceUserJoined: user.id=${user.id}, uuid=${user.uuid}, isLogged=${user.isLogged}, spaceName=${spaceName}, botId=${botId || 'unknown'}`);
            }
            if (botId && this.setUserUuidInMemory) {
                this.setUserUuidInMemory(botId, user.id, user.uuid, user.isLogged || false);
            }
            
            // Notify behavior that memory is restored and UUID is available
            // This is the correct time to generate greetings (after memory is ready)
            if (botId) {
                // Retry any pending media that was queued when the user left
                // Must complete before greeting so autoDeliveredMedia fact is set
                try {
                    await this.retryPendingMedia(spaceName, user);
                } catch (err) {
                    console.error(`[Behavior] Error retrying pending media:`, err);
                }
                // Only notify memory ready if the user is still engaged
                // (they may have left during the async retry)
                if (this.engagedWithUsers.has(user.id)) {
                    this.onMemoryReady?.(spaceName, user);
                }
            }
        }

        // If leading and space name not set yet, set it now (space was just created)
        if (this.isLeading && !this.leadingSpaceName) {
            this.leadingSpaceName = spaceName;
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Leading space name set to: ${spaceName}`);
            }
        }

        // Try to get player position from room data if available
        // Only if the user is still engaged (they may have left during async retryPendingMedia)
        if (this.bot && this.engagedWithUsers.has(user.id)) {
            const playerInfo = this.bot.getPlayerInfo(user.id);
            if (playerInfo?.position) {
                this.engagedWithUsers.set(user.id, { spaceName, position: playerInfo.position });
                this.facePosition(playerInfo.position);
            }
        }

        console.log(`[Behavior] User ${user.id} joined space ${spaceName}, now engaged with ${this.engagedWithUsers.size} users`);
    }
    
    /**
     * Register a pending spaceUserId -> userId mapping when we receive a chat message
     * but don't have the UUID yet. This helps match addSpaceUserMessage when it arrives.
     */
    protected registerPendingSpaceUserId(spaceUserId: string, userId: number): void {
        if (spaceUserId && userId > 0) {
            this.pendingSpaceUserIdToUserId.set(spaceUserId, userId);
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] 📝 Registered pending spaceUserId ${spaceUserId} -> userId ${userId} (waiting for UUID)`);
            }
        }
    }

    /**
     * Called when a user leaves the space
     * @param spaceName Space name
     * @param userId User ID that left
     */
    onSpaceUserLeft(spaceName: string, userId: number): void {
        // Remove from engaged users
        this.engagedWithUsers.delete(userId);
        this.isEngaged = this.engagedWithUsers.size > 0;
        
        // Clear the greeting-dedup slot so the player gets a fresh greeting on return
        this.leadingGreetedPlayers.delete(userId);
        
        // End conversation for this user when they leave the space
        const userUuid = this.userIdToUuid.get(userId);
        if (userUuid && this.conversationStorage && this.bot) {
            const botId = this.bot.getBotId();
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Ending conversation for user ${userId} (${userUuid}) who left space`);
            }
            this.conversationStorage.endConversation(botId, userUuid, 'user_left').catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error(`[Behavior] Error ending conversation on space leave:`, error);
                }
            });
        }
        
        // Clean up UUID mapping after conversation is ended
        this.userIdToUuid.delete(userId);
        this.userIdToIsLogged.delete(userId);

        // If summoned and no players left, end summon and return
        if (this.isSummoned && this.engagedWithUsers.size === 0 && this.nearbyPlayers.size === 0) {
            console.log(`[Behavior] Summoned player left space, ending summon and returning`);
            this.endSummon();
            return;
        }

        // If still engaged with others, face the first remaining user
        if (this.isEngaged) {
            const firstUser = this.engagedWithUsers.values().next().value;
            if (firstUser?.position) {
                this.facePosition(firstUser.position);
            }
        }

        console.log(`[Behavior] User ${userId} left space ${spaceName}, now engaged with ${this.engagedWithUsers.size} users`);
    }

    /**
     * Check if the bot is currently engaged in conversation
     */
    isInConversation(): boolean {
        return this.isEngaged;
    }

    /**
     * Face toward a specific position
     */
    protected facePosition(position: PositionInterface): void {
        if (!this.bot) return;

        const botPos = this.bot.getState().getPosition();
        const dx = position.x - botPos.x;
        const dy = position.y - botPos.y;

        // Determine the direction to face
        let direction: PositionMessage_Direction;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        const oldDirection = this.bot.getState().getDirection();
        // Only update if direction actually changed
        if (oldDirection !== direction) {
            this.bot.getState().setDirection(direction);
            // If bot is leading, don't stop - just update direction while continuing to move
            if (this.isLeading) {
                // Update direction but keep moving - send position update without stopping
                const currentPos = this.bot.getState().getPosition();
                const isMoving = this.bot.getState().isMoving();
                this.bot.sendPosition(currentPos, direction, isMoving);
            } else {
                // Not leading - stop and update (normal behavior)
                this.bot.getState().setMoving(false);
                this.bot.stopAndUpdate(); // Force immediate position/direction update to server
            }
        }
    }

    /**
     * Face toward a specific player by ID
     */
    protected facePlayer(playerId: number): void {
        if (!this.bot) return;

        const player = this.bot.getPlayerInfo(playerId);
        if (player?.position) {
            this.facePosition(player.position);
        }
    }

    /**
     * Called when a chat message is received
     * @param spaceName Space name
     * @param message Chat message
     * @param senderId Sender's user ID
     */
    onChatMessage(spaceName: string, message: string, senderId: number, url?: string, mediaType?: string, mimeType?: string, galleryUrls?: string[]): Promise<void> {
        // Default: do nothing
        return Promise.resolve();
    }

    /**
     * Get conversation memory for a player
     * Override in behaviors that use memory
     */
    getConversationMemory(playerId: number): any {
        return null;
    }

    /**
     * Get behavior configuration
     */
    getConfig(): BehaviorConfig {
        return this.config;
    }

    /**
     * Update behavior configuration
     */
    updateConfig(config: Partial<BehaviorConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Mark a player as currently having an active AI generation stream.
     * Increments the generation counter so stale .finally() calls from old
     * aborted streams are detected and ignored by finishGeneration().
     */
    protected startGeneration(senderId: number, spaceName: string, currentTask?: string): void {
        let state = this.activeConversations.get(senderId);
        if (!state) {
            state = {
                playerId: senderId,
                spaceName,
                startTime: Date.now(),
                lastMessageTime: Date.now(),
                isGenerating: false,
                currentTask: currentTask || '',
                messageQueue: [],
                generation: 0,
                pendingAnswers: [],
            };
            this.activeConversations.set(senderId, state);
        }
        state.isGenerating = true;
        state.lastMessageTime = Date.now();
        state.currentTask = currentTask || state.currentTask;
        state.generation = (state.generation || 0) + 1;
        state.abortController = new AbortController();
    }

    /**
     * Mark a player's generation as finished. Only acts if the generation
     * counter matches — stale calls from aborted streams' .finally() are ignored.
     * Flushes the message queue after normal completion.
     */
    protected finishGeneration(senderId: number, aborted = false, expectedGen?: number): void {
        const state = this.activeConversations.get(senderId);
        if (!state) return;

        // Stale call from an aborted stream's .finally() — the generation has moved on
        if (expectedGen !== undefined && state.generation !== expectedGen) return;

        state.isGenerating = false;
        state.abortController = undefined;

        if (!aborted) {
            // Drain LLM-generated answers first (one-shot, no new generation)
            while (state.pendingAnswers.length > 0) {
                const answer = state.pendingAnswers.shift()!;
                const answerId = `bot-answer-${senderId}-${crypto.randomUUID()}`;
                this.bot?.sendStreamMessage(state.spaceName, answerId, '', true, answer);
            }
            if (state.messageQueue.length > 0) {
                this.flushMessageQueue(senderId);
            }
        }
    }

    /**
     * Single entry point for interruption-safe generation. Every behavior calls
     * this instead of duplicating the interruption check + .catch/.finally pattern.
     *
     * @returns The action taken: 'generated' | 'queued' | 'cancelled'
     */
    protected async safeGenerateResponse(
        spaceName: string,
        senderId: number,
        originalMessage: string,
        augmentedMessage: string,
        botId: string,
        generator: () => Promise<void>,
        url?: string,
        mediaType?: string,
        mimeType?: string
    ): Promise<'generated' | 'queued' | 'cancelled'> {
        const action = await this.handleInterruption(senderId, originalMessage, augmentedMessage, url, mediaType, mimeType);
        if (action === 'queued' || action === 'cancelled') {
            if (action === 'cancelled') {
                this.bot?.stopTyping(spaceName);
            }
            return action;
        }

        // Send update acknowledgment before starting new generation
        const convState = this.activeConversations.get(senderId);
        if (convState?.pendingUpdateMessage) {
            this.sendStatusAck(spaceName, convState.pendingUpdateMessage);
            convState.pendingUpdateMessage = undefined;
        }

        this.startGeneration(senderId, spaceName, originalMessage);
        const capturedGen = this.activeConversations.get(senderId)?.generation ?? 0;

        try {
            await generator();
        } catch (error) {
            console.error(`[${this.constructor.name}] Error generating AI response:`, error);
            this.bot?.stopTyping(spaceName);
            const errId = `bot-${botId}-player-${senderId}-${crypto.randomUUID()}`;
            this.bot?.sendStreamMessage(spaceName, errId, "I'm having trouble processing that. Could you rephrase?", true, "I'm having trouble processing that. Could you rephrase?");
        } finally {
            this.finishGeneration(senderId, false, capturedGen);
        }
        return 'generated';
    }

    /**
     * Abort the current stream for a player.
     */
    protected abortCurrentStream(senderId: number, finalContent?: string): void {
        const state = this.activeConversations.get(senderId);
        if (!state) return;

        if (state.abortController) {
            state.abortController.abort();
        }
        if (this.bot && state.spaceName) {
            const botId = this.bot.getBotId();
            const errId = `bot-${botId}-player-${senderId}-abort-${crypto.randomUUID()}`;
            this.bot.sendStreamMessage(state.spaceName, errId, '', true, finalContent || '');
        }
    }

    /**
     * Process queued messages for a player in FIFO order.
     */
    protected flushMessageQueue(senderId: number): void {
        const state = this.activeConversations.get(senderId);
        if (!state || state.messageQueue.length === 0) return;

        const queued = state.messageQueue.shift();
        if (!queued) return;
        if (state.isGenerating) return;

        this.onChatMessage(state.spaceName, queued.message, senderId, queued.url, queued.mediaType, queued.mimeType);
    }

    /**
     * Handle a new chat message when the bot is already mid-stream for this player.
     * Returns 'proceed' | 'queued' | 'cancelled'.
     */
    protected async handleInterruption(
        senderId: number,
        originalMessage: string,
        augmentedMessage: string,
        url?: string,
        mediaType?: string,
        mimeType?: string
    ): Promise<'queued' | 'cancelled' | 'proceed'> {
        const state = this.activeConversations.get(senderId);
        if (!state || !state.isGenerating) return 'proceed';

        const interruptedGen = state.generation;
        const currentTask = state.currentTask || originalMessage;

        let result: { action: string; message: string };
        try {
            result = await this.classifyInterruption(currentTask, originalMessage);
        } catch {
            this.enqueueMessage(senderId, augmentedMessage, url, mediaType, mimeType);
            return 'queued';
        }

        // Guard against the generation advancing during the classifyInterruption await
        const currentState = this.activeConversations.get(senderId);
        if (!currentState || currentState.generation !== interruptedGen) {
            this.enqueueMessage(senderId, augmentedMessage, url, mediaType, mimeType);
            return 'queued';
        }

        switch (result.action) {
            case 'cancel': {
                this.abortCurrentStream(senderId);
                this.finishGeneration(senderId, true);
                currentState.messageQueue = [];
                currentState.pendingAnswers = [];
                if (result.message) {
                    this.sendStatusAck(currentState.spaceName, result.message);
                }
                return 'cancelled';
            }
            case 'update': {
                this.abortCurrentStream(senderId);
                this.finishGeneration(senderId, true);
                currentState.messageQueue = [];
                currentState.pendingAnswers = [];
                // Store acknowledgment to be sent before new generation starts
                currentState.pendingUpdateMessage = result.message;
                return 'proceed';
            }
            case 'answer': {
                // LLM generated the answer — store to send after current stream finishes
                currentState.pendingAnswers = currentState.pendingAnswers || [];
                if (result.message) {
                    currentState.pendingAnswers.push(result.message);
                }
                this.enqueueMessage(senderId, augmentedMessage, url, mediaType, mimeType, 'answer');
                return 'queued';
            }
            case 'queue':
            default: {
                // Send the LLM-generated acknowledgment immediately
                if (result.message) {
                    this.sendStatusAck(currentState.spaceName, result.message);
                }
                this.enqueueMessage(senderId, augmentedMessage, url, mediaType, mimeType, 'queue');
                return 'queued';
            }
        }
    }

    /**
     * Classify a mid-stream message using AIService.quickClassify().
     */
    private async classifyInterruption(currentTask: string, newMessage: string): Promise<{ action: string; message: string }> {
        if (!this.aiService || !('quickClassify' in this.aiService)) return { action: 'queue', message: '' };
        return (this.aiService as any).quickClassify(currentTask, newMessage);
    }

    private enqueueMessage(senderId: number, message: string, url?: string, mediaType?: string, mimeType?: string, classification?: string): void {
        const state = this.activeConversations.get(senderId);
        if (!state) return;

        if (state.messageQueue.length >= this.MAX_QUEUED_MESSAGES) {
            this.sendStatusAck(state.spaceName, 'I have a few messages from you — let me catch up.');
            return;
        }

        state.messageQueue.push({ message, url, mediaType, mimeType, classification, timestamp: Date.now() });
    }

    private sendStatusAck(spaceName: string, text: string): void {
        if (!this.bot) return;
        const botId = this.bot.getBotId();
        const statusId = `bot-${botId}-status-${crypto.randomUUID()}`;
        this.bot.sendStreamMessage(spaceName, statusId, '', true, text);
    }

    /**
     * Parse a file attachment using FileParser and format the result into
     * the message for AI context. Handles sanitization, undefined guards,
     * and error logging — shared by all behaviors to avoid duplication.
     *
     * @param message The original user message
     * @param url The attachment URL
     * @param mimeType The attachment MIME type
     * @param mediaType Optional media type label for fallback messaging
     * @returns Augmented message with parsed content (or fallback on error)
     */
    /**
     * Infer a MIME type from a URL's file extension.
     * Used to give each gallery file its own MIME type instead of using the
     * primary file's MIME type for all files.
     */
    private inferMimeFromUrl(url: string): string | undefined {
        const pathPart = url.split('?')[0];
        const ext = pathPart.split('.').pop()?.toLowerCase();
        if (!ext) return undefined;
        const mimeMap: Record<string, string> = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
            webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
            pdf: 'application/pdf',
            doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            csv: 'text/csv',
            ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4',
            mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
            txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html',
            zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
        };
        return mimeMap[ext];
    }

    protected async formatParsedAttachment(
        message: string,
        url: string,
        mimeType: string,
        mediaType?: string,
        galleryUrls?: string[]
    ): Promise<string> {
        const allUrls = [url, ...(galleryUrls || [])];
        let augmentedMessage = message;

        // Hoist dynamic import and load all files in parallel
        const { FileParser } = await import('../services/FileParser');
        const results = await Promise.allSettled(allUrls.map(async (fileUrl) => {
            const fileMime = this.inferMimeFromUrl(fileUrl) || mimeType || 'application/octet-stream';
            return FileParser.parseFile(fileUrl, fileMime);
        }));

        // Sanitize extracted text to neutralize embedded boundary markers
        // that an attacker could use for prompt injection
        const sanitize = (text: string) =>
            text.replace(/---\s*(BEGIN|END)\s+(FILE|DOCUMENT|WEB PAGE)\s+CONTENT\s*---/gi,
                match => match.replace(/-/g, '−')); // replace hyphens with minus signs

        for (let i = 0; i < allUrls.length; i++) {
            const fileUrl = allUrls[i];
            const settled = results[i];
            if (settled.status === 'rejected') {
                const mediaLabel = mediaType || 'file';
                augmentedMessage = `${augmentedMessage}\n[User also sent a ${mediaLabel}: ${fileUrl}]`;
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[BaseBehavior] FileParser failed for ${fileUrl}: ${settled.reason?.message || 'Unknown error'}, falling back to URL text`);
                }
                continue;
            }
            const parsed = settled.value;

            switch (parsed.type) {
                case 'text':
                    augmentedMessage = `${augmentedMessage}\n[User also sent a file]\n--- BEGIN FILE CONTENT ---\n${parsed.text ? sanitize(parsed.text) : '[No text content]'}\n--- END FILE CONTENT ---`;
                    break;
                case 'image':
                    augmentedMessage = `${augmentedMessage}\n[User also sent an image: ${fileUrl}]`;
                    break;
                case 'document':
                    augmentedMessage = `${augmentedMessage}\n[User sent a document]${parsed.text ? `\n--- BEGIN DOCUMENT CONTENT ---\n${sanitize(parsed.text)}\n--- END DOCUMENT CONTENT ---\n(Summary: ${parsed.summary})` : `\n(Summary: ${parsed.summary})`}`;
                    break;
                case 'webpage':
                    augmentedMessage = `${augmentedMessage}\n[User shared a web page]${parsed.text ? `\n--- BEGIN WEB PAGE CONTENT ---\n${sanitize(parsed.text)}\n--- END WEB PAGE CONTENT ---\n(Summary: ${parsed.summary})` : `\n(Summary: ${parsed.summary})`}`;
                    break;
                case 'audio':
                    augmentedMessage = `${augmentedMessage}\n[User sent an audio file — can't be played inline]`;
                    break;
                case 'video':
                    augmentedMessage = `${augmentedMessage}\n[User sent a video file — can't be played inline]`;
                    break;
                default:
                    augmentedMessage = `${augmentedMessage}\n[User sent a file (${parsed.mimeType || 'unknown'}) — content not extracted]`;
                    break;
            }
        }
        return augmentedMessage;
    }
}


