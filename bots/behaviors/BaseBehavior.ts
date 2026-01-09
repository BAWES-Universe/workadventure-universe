/**
 * BaseBehavior - Abstract base class for all bot behaviors
 */

import type { BotClient } from '../client/BotClient';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import type { SpaceUser } from '@workadventure/messages';
import { PositionMessage_Direction } from '@workadventure/messages';

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
    
    // Engagement tracking - when players are in conversation with the bot
    protected isEngaged = false;
    protected engagedWithUsers: Map<number, { spaceName: string; position?: PositionInterface }> = new Map();
    
    // Proximity tracking - players nearby (based on userMovedMessage)
    protected nearbyPlayers: Map<number, PositionInterface> = new Map();
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
            console.log(`[Behavior] State: nearbyPlayers=${this.nearbyPlayers.size}, isEngaged=${this.isEngaged}`);
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
                    // For patrol bots, ensure we're still stopped (unless summoned and moving)
                    const isSummonedAndMoving = this.isSummoned && this.bot.getState().isMoving();
                    if (shouldStopForPlayers && !isSummonedAndMoving && this.bot.getState().isMoving()) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    // Face the player (always face, unless summoned and still moving)
                    if (!isSummonedAndMoving) {
                        this.facePosition(closestPos);
                    }
                }
            }
        } else {
            // No longer engaged
            this.closestPlayerId = null;
            
            if (wasEngaged) {
                console.log(`[Behavior] No longer engaged - all players left proximity/space`);
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
        // Default: do nothing
    }

    /**
     * Called when bot leaves a space
     * @param spaceName Space name
     */
    onSpaceLeft(spaceName: string): void {
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

        // Check if bot is engaged with someone else - don't allow summon if busy
        if (this.engagedWithUsers.size > 0 || this.isEngaged) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[Behavior] Bot cannot be summoned - currently engaged with ${this.engagedWithUsers.size} user(s)`);
            }
            throw new Error('Bot is currently engaged with another player and cannot be summoned');
        }

        // If bot was returning, cancel the return and start new summon
        if (this.isReturning) {
            console.log(`[Behavior] Bot was returning, canceling return and starting new summon`);
            this.isReturning = false;
            // Cancel any ongoing return pathfinding
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
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
                        console.error(`[Behavior] ❌ Return pathfinding failed, bot will stay at current position`);
                        this.isReturning = false;
                        this.originalPosition = null;
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
        const dx = assignedSpace.center.x - botPos.x;
        const dy = assignedSpace.center.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If outside assigned space, return to it using pathfinding
        if (distance > assignedSpace.radius) {
            // Calculate target position inside the assigned space (80% of radius from center)
            const angle = Math.atan2(dy, dx);
            const targetX = assignedSpace.center.x - Math.cos(angle) * (assignedSpace.radius * 0.8);
            const targetY = assignedSpace.center.y - Math.sin(angle) * (assignedSpace.radius * 0.8);
            
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
     * Called when a user joins the space
     * @param spaceName Space name
     * @param user User that joined
     */
    onSpaceUserJoined(spaceName: string, user: SpaceUser): void {
        // Skip if it's the bot itself
        if (user.id === this.bot?.getUserId()) {
            return;
        }

        // Track this user as engaged
        const userPosition = user.characterPosition ? {
            x: user.characterPosition.x,
            y: user.characterPosition.y,
        } : undefined;
        
        this.engagedWithUsers.set(user.id, { spaceName, position: userPosition });
        this.isEngaged = this.engagedWithUsers.size > 0;

        // Face the player who just joined
        if (userPosition) {
            this.facePosition(userPosition);
        }

        console.log(`[Behavior] User ${user.id} joined space ${spaceName}, now engaged with ${this.engagedWithUsers.size} users`);
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
            this.bot.getState().setMoving(false);
            this.bot.stopAndUpdate(); // Force immediate position/direction update to server
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
    onChatMessage(spaceName: string, message: string, senderId: number): void {
        // Default: do nothing
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
}

