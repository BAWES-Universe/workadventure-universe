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
    protected originalPosition: PositionInterface | null = null; // Position to return to after summon

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
                    if (shouldStopForPlayers) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    
                    this.facePosition(closestPos);
                    if (!wasEngaged) {
                        console.log(`[Behavior] Engaged with player ${closestId} - stopped and facing`);
                    } else {
                        console.log(`[Behavior] Facing player ${closestId}`);
                    }
                } else {
                    // Same player, but they might have moved - update facing
                    // For patrol bots, ensure we're still stopped
                    if (shouldStopForPlayers && this.bot.getState().isMoving()) {
                        if (this.bot.getIsFollowingPath()) {
                            this.bot.cancelPathfinding();
                        }
                        this.bot.stop();
                    }
                    this.facePosition(closestPos);
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

        this.isSummoned = true;
        this.summonedPlayerUuid = playerUuid;
        
        // Store original position (where bot was when summoned)
        const botPos = this.bot.getState().getPosition();
        this.originalPosition = { x: botPos.x, y: botPos.y };

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Behavior] Bot summoned to player ${playerUuid} at (${targetPosition.x}, ${targetPosition.y}), original position: (${this.originalPosition.x}, ${this.originalPosition.y})`);
        }
    }

    /**
     * Check if summoned player is still nearby
     * Returns true if player is still in proximity, false if they left
     */
    protected checkSummonedPlayerStillNearby(): boolean {
        if (!this.bot || !this.summonedPlayerUuid) return false;

        // Check if player is in nearbyPlayers or engagedWithUsers
        // We need to find the player by UUID - this requires checking all players
        const allPlayers = this.bot.getAllPlayers();
        for (const player of allPlayers) {
            // Note: We don't have UUID in PlayerInfo, so we'll check by proximity
            // If no players are nearby and we're not engaged, player likely left
            if (this.nearbyPlayers.size === 0 && this.engagedWithUsers.size === 0) {
                return false;
            }
        }

        // If we have nearby players or engaged users, assume summoned player might still be there
        return this.nearbyPlayers.size > 0 || this.engagedWithUsers.size > 0;
    }

    /**
     * End summon - return bot to original position
     */
    endSummon(): void {
        if (!this.bot || !this.isSummoned) return;

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[Behavior] Ending summon, returning to original position: (${this.originalPosition?.x}, ${this.originalPosition?.y})`);
        }

        // Return to original position if we have one
        if (this.originalPosition) {
            const botPos = this.bot.getState().getPosition();
            const dx = this.originalPosition.x - botPos.x;
            const dy = this.originalPosition.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // If not at original position, move back
            if (distance > 50) {
                // Determine direction
                let direction = PositionMessage_Direction.DOWN;
                if (Math.abs(dx) > Math.abs(dy)) {
                    direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
                } else {
                    direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
                }

                // Use pathfinding to return
                this.bot.moveToWithPathfinding(this.originalPosition.x, this.originalPosition.y, direction).catch((error) => {
                    console.error(`[Behavior] Error returning to original position:`, error);
                });
            }
        }

        // Clear summon state
        this.isSummoned = false;
        this.summonedPlayerUuid = null;
        this.originalPosition = null;
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
     */
    protected returnToAssignedSpace(): void {
        if (!this.bot || !this.config.assignedSpace) return;

        const assignedSpace = this.config.assignedSpace;
        const botPos = this.bot.getState().getPosition();
        const dx = assignedSpace.center.x - botPos.x;
        const dy = assignedSpace.center.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If outside assigned space, return to it
        if (distance > assignedSpace.radius) {
            // Move towards center of assigned space
            const angle = Math.atan2(dy, dx);
            const targetX = assignedSpace.center.x - Math.cos(angle) * (assignedSpace.radius * 0.8);
            const targetY = assignedSpace.center.y - Math.sin(angle) * (assignedSpace.radius * 0.8);
            
            // Determine direction
            let direction = PositionMessage_Direction.DOWN;
            if (Math.abs(dx) > Math.abs(dy)) {
                direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
            } else {
                direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
            }
            
            this.bot.moveTo(targetX, targetY, direction);
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

