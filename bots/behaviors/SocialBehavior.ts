/**
 * SocialBehavior - Bot actively seeks conversations with players
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';
import { ConversationMemory, type BotPlayerMemory } from '../memory/ConversationMemory';
import { movementLogger } from '../utils/MovementLogger';

export interface SocialBehaviorConfig extends BehaviorConfig {
    type: 'social';
    conversationRadius: number; // Distance to detect players
    minTimeBetweenConversations: number; // Cooldown in milliseconds
    maxConversationDuration: number; // Max chat time in milliseconds
    conversationHistorySize: number; // Remember last N players
    respectPlayerStatus: boolean; // Check player availability
    maxConcurrentConversations: number; // Limit active chats
    conversationTopics: string[]; // Topics to discuss
    wanderRadius: number; // Area to wander in
    wanderCenter: { x: number; y: number };
    wanderSpeed: number; // Movement speed
    approachDistance: number; // How close to get before starting conversation
}

interface ConversationState {
    playerId: number;
    spaceName: string;
    startTime: number;
    lastMessageTime: number;
}

export class SocialBehavior extends BaseBehavior {
    private conversationHistory: Map<number, number> = new Map(); // playerId -> last conversation time
    private activeConversations: Map<number, ConversationState> = new Map(); // playerId -> conversation state
    private targetPlayerId: number | null = null;
    private wanderTarget: PositionInterface | null = null;
    private lastWanderUpdate: number = 0;
    private lastConversationCheck: number = 0;
    private lastWanderFailure: number = 0; // Track when pathfinding failed
    private wanderInProgress: boolean = false; // Prevent multiple concurrent calls
    private readonly WANDER_FAILURE_COOLDOWN = 2000; // 2 seconds before retrying after failure
    private conversationMemory: ConversationMemory;

    constructor(config: SocialBehaviorConfig) {
        super(config);
        this.conversationMemory = new ConversationMemory(
            config.conversationHistorySize || 50,
            1000 // Max 1000 player memories per bot
        );
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as SocialBehaviorConfig;
        const currentTime = Date.now();

        // Clean up old conversations
        this.cleanupConversations(config, currentTime);

        // Check for nearby players first - stop immediately if player is nearby, even if following a path
        const nearbyPlayers = this.bot.getNearbyPlayers(config.conversationRadius);
        if (nearbyPlayers.length > 0) {
            // Player nearby - stop immediately and face them
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Face the closest player
            if (nearbyPlayers.length > 0) {
                this.facePosition(nearbyPlayers[0].position);
            }
            // Update engagement state to ensure proper facing
            this.updateProximityEngagement();
            this.onBotPositionUpdated();
            return;
        }

        // CRITICAL: Check for nearby players FIRST - stop immediately if any found
        // The nearbyPlayers map is populated by onPlayerMoved() when players move within PROXIMITY_RADIUS (64px)
        // This is the PRIMARY source of truth - it's updated in real-time as players move
        
        // Update nearbyPlayers map from getNearbyPlayers() if available
        const nearbyPlayersList = this.bot.getNearbyPlayers(config.conversationRadius || 100);
        for (const player of nearbyPlayersList) {
            this.nearbyPlayers.set(player.userId, player.position);
        }
        // Only remove players if getNearbyPlayers() found them AND they're now far away
        if (nearbyPlayersList.length > 0) {
            for (const [playerId, playerPos] of this.nearbyPlayers) {
                if (!nearbyPlayersList.find(p => p.userId === playerId)) {
                    const botPos = this.bot.getState().getPosition();
                    const dx = playerPos.x - botPos.x;
                    const dy = playerPos.y - botPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance > (config.conversationRadius || 100) * 1.5) {
                        this.nearbyPlayers.delete(playerId);
                    }
                }
            }
        }
        
        // STOP immediately if players are nearby
        // PRIMARY: Check nearbyPlayers map (populated by onPlayerMoved in real-time)
        const hasNearbyPlayers = this.nearbyPlayers.size > 0 || nearbyPlayersList.length > 0;
        if (hasNearbyPlayers && !this.targetPlayerId) {
            console.log(`[SocialBehavior] 🛑 STOPPING - nearbyPlayersMap=${this.nearbyPlayers.size}, nearbyPlayersList=${nearbyPlayersList.length}`);
            // Player nearby and we're not already approaching someone - stop immediately
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Face closest player
            const nearbyPlayers = this.bot.getNearbyPlayers(1000);
            if (nearbyPlayers.length > 0) {
                this.facePosition(nearbyPlayers[0].position);
            } else {
                const firstPlayer = this.nearbyPlayers.values().next().value;
                if (firstPlayer) {
                    this.facePosition(firstPlayer);
                }
            }
            this.updateProximityEngagement();
            this.onBotPositionUpdated();
            return; // Don't continue movement
        }
        
        // If engaged in conversation, stop moving and face the player
        if (this.isEngaged) {
            // Cancel any active pathfinding
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Update engagement to ensure facing is correct (handles player movement)
            this.updateProximityEngagement();
            this.onBotPositionUpdated(); // Track position even when stopped
            return;
        }

        // If following a path, let BotClient handle movement
        if (this.bot.getIsFollowingPath()) {
            this.bot.updatePathFollowing(deltaTime);
            this.onBotPositionUpdated();
            return;
        }

        // Check for conversation opportunities periodically
        if (currentTime - this.lastConversationCheck > 1000) {
            this.lastConversationCheck = currentTime;
            this.checkForConversations(config);
        }

        // Handle movement
        if (this.targetPlayerId) {
            // Approach player (async, but we don't await - it will handle pathfinding internally)
            this.approachPlayer(this.targetPlayerId, config).catch(error => {
                console.error(`[SocialBehavior] Error approaching player:`, error);
            });
        } else {
            // Wander (async, but we don't await - it will handle pathfinding internally)
            this.wander(config, deltaTime).catch(error => {
                console.error(`[SocialBehavior] Error wandering:`, error);
            });
        }
        
        // Track bot position after movement
        this.onBotPositionUpdated();
    }

    onPlayerMoved(playerId: number, position: PositionInterface): void {
        // Call base behavior for proximity tracking and facing
        super.onPlayerMoved(playerId, position);
        
        // Update target if we're approaching this player
        if (this.targetPlayerId === playerId) {
            // Continue approaching
        }
    }

    onSpaceJoined(spaceName: string): void {
        if (!this.bot || !this.targetPlayerId) return;

        const config = this.config as SocialBehaviorConfig;
        const currentTime = Date.now();
        const botId = this.bot.getBotId();

        // Start conversation in memory
        this.conversationMemory.startConversation(botId, this.targetPlayerId);

        // Start conversation
        this.activeConversations.set(this.targetPlayerId, {
            playerId: this.targetPlayerId,
            spaceName,
            startTime: currentTime,
            lastMessageTime: currentTime,
        });

        // Get conversation context for personalized greeting
        const memory = this.conversationMemory.getMemory(botId, this.targetPlayerId);
        const greeting = this.getPersonalizedGreeting(config.conversationTopics, memory);

        if (greeting) {
            this.bot.sendChatMessage(spaceName, greeting);
            // Record bot's message in memory
            this.conversationMemory.addMessage(botId, this.targetPlayerId, greeting, 'bot', spaceName);
        }

        // Clear target
        this.targetPlayerId = null;
    }

    onSpaceLeft(spaceName: string): void {
        // Find and remove conversation
        for (const [playerId, state] of this.activeConversations.entries()) {
            if (state.spaceName === spaceName) {
                this.activeConversations.delete(playerId);
                const config = this.config as SocialBehaviorConfig;
                this.conversationHistory.set(playerId, Date.now());
                this.cleanupHistory(config);
                break;
            }
        }

        // Return to assigned space after conversation ends
        this.returnToAssignedSpace();
        
        // Clear any target
        this.targetPlayerId = null;
    }

    onChatMessage(spaceName: string, message: string, senderId: number): void {
        if (!this.bot) return;

        const botId = this.bot.getBotId();
        const conversation = this.activeConversations.get(senderId);
        
        if (conversation) {
            conversation.lastMessageTime = Date.now();
            
            // Store player's message in memory
            this.conversationMemory.addMessage(botId, senderId, message, 'player', spaceName);
            
            // Extract personal information from message
            this.conversationMemory.extractPersonalInfo(botId, senderId, message);
            
            // TODO: Process message with AI and respond
            // AI will use conversationMemory.getConversationContext() to get full context
        }
    }

    private checkForConversations(config: SocialBehaviorConfig): void {
        if (!this.bot) return;

        // Don't look for new conversations if at max
        if (this.activeConversations.size >= config.maxConcurrentConversations) {
            return;
        }

        // Don't look if we already have a target
        if (this.targetPlayerId) {
            return;
        }

        // Only look for conversations if within assigned space (or no assigned space)
        if (!this.isWithinAssignedSpace()) {
            return;
        }

        const nearbyPlayers = this.bot.getNearbyPlayers(config.conversationRadius);
        const currentTime = Date.now();

        for (const player of nearbyPlayers) {
            // Check if we can start conversation with this player
            if (this.canStartConversation(player.userId, config, currentTime)) {
                this.targetPlayerId = player.userId;
                break;
            }
        }
    }

    private canStartConversation(
        playerId: number,
        config: SocialBehaviorConfig,
        currentTime: number
    ): boolean {
        // Check if already in conversation with this player
        if (this.activeConversations.has(playerId)) {
            return false;
        }

        // Check cooldown
        const lastChat = this.conversationHistory.get(playerId);
        if (lastChat && currentTime - lastChat < config.minTimeBetweenConversations) {
            return false;
        }

        // Check player status if enabled
        if (config.respectPlayerStatus) {
            const player = this.bot?.getPlayerInfo(playerId);
            if (player) {
                // AvailabilityStatus: 0=ONLINE, 1=AWAY, 2=SPEAK, 3=LISTEN, 4=DO_NOT_DISTURB
                if (player.availabilityStatus === 1 || player.availabilityStatus === 4) {
                    return false; // AWAY or DO_NOT_DISTURB
                }
            }
        }

        // TODO: Check if other bots are targeting this player (via BotRegistry)
        // This would require access to a shared registry

        return true;
    }

    private async approachPlayer(playerId: number, config: SocialBehaviorConfig): Promise<void> {
        if (!this.bot) return;

        const player = this.bot.getPlayerInfo(playerId);
        if (!player) {
            this.targetPlayerId = null;
            return;
        }

        const botPos = this.bot.getState().getPosition();
        const dx = player.position.x - botPos.x;
        const dy = player.position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If close enough, stop and face the player, then wait for space join
        if (distance <= config.approachDistance) {
            this.bot.stop();
            // Face the player we're approaching
            this.facePosition(player.position);
            // Space will be joined automatically by backend when in proximity
            return;
        }

        // Always try pathfinding first if available and not already following a path - don't move through walls
        if (this.bot.hasPathfinding() && !this.bot.getIsFollowingPath()) {
            const success = await this.bot.moveToWithPathfinding(player.position.x, player.position.y);
            if (success) {
                // Pathfinding will handle movement via updatePathFollowing
                return;
            }
            // Pathfinding failed - don't move if we can't find a path (prevents walking through walls)
            console.warn(`[SocialBehavior] Pathfinding failed for player approach, staying in place`);
            return;
        }

        // Only use direct movement if pathfinding is not available
        // This should only happen during initialization before pathfinding is set up
        const effectiveSpeed = config.wanderSpeed > 75 ? config.wanderSpeed * 0.5 : config.wanderSpeed;
        const angle = Math.atan2(dy, dx);
        const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
        const newX = botPos.x + Math.cos(angle) * moveDistance;
        const newY = botPos.y + Math.sin(angle) * moveDistance;

        // Log direct movement
        movementLogger.log({
            timestamp: Date.now(),
            botId: this.bot.config.botId,
            eventType: 'move',
            position: { x: newX, y: newY },
            targetPosition: player.position,
            speed: config.wanderSpeed,
            effectiveSpeed: effectiveSpeed,
            moveDistance: moveDistance,
            distanceToTarget: distance,
            metadata: { movementType: 'direct_fallback', pathfindingFailed: true },
        });

        // Determine direction
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.bot.moveTo(newX, newY, direction);
    }

    private async wander(config: SocialBehaviorConfig, deltaTime: number): Promise<void> {
        if (!this.bot) return;

        // Prevent multiple concurrent wander calls
        if (this.wanderInProgress) {
            return;
        }

        // If bot has assigned space and is outside it, return first
        if (!this.isWithinAssignedSpace()) {
            this.returnToAssignedSpace();
            return;
        }

        const currentTime = Date.now();
        const botPos = this.bot.getState().getPosition();

        // If pathfinding recently failed, wait before retrying
        if (this.lastWanderFailure > 0 && currentTime - this.lastWanderFailure < this.WANDER_FAILURE_COOLDOWN) {
            return;
        }

        // Update wander target periodically or when reached
        if (
            !this.wanderTarget ||
            currentTime - this.lastWanderUpdate > 5000 ||
            this.isAtPosition(botPos, this.wanderTarget)
        ) {
            this.wanderTarget = this.generateWanderTarget(config);
            this.lastWanderUpdate = currentTime;
        }

        // Move towards wander target
        const dx = this.wanderTarget.x - botPos.x;
        const dy = this.wanderTarget.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 10) {
            this.wanderInProgress = true;
            
            // Always try pathfinding first if available and not already following a path
            if (this.bot.hasPathfinding() && !this.bot.getIsFollowingPath()) {
                const success = await this.bot.moveToWithPathfinding(this.wanderTarget.x, this.wanderTarget.y);
                this.wanderInProgress = false;
                
                if (success) {
                    // Pathfinding will handle movement via updatePathFollowing
                    this.lastWanderFailure = 0; // Reset failure counter on success
                    return;
                }
                
                // Pathfinding failed - generate new target and wait before retrying
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[SocialBehavior] Pathfinding failed for wander target at (${this.wanderTarget.x.toFixed(1)}, ${this.wanderTarget.y.toFixed(1)}), generating new target`);
                }
                
                // Generate a new wander target (current one might be invalid)
                this.wanderTarget = this.generateWanderTarget(config);
                this.lastWanderUpdate = currentTime;
                this.lastWanderFailure = currentTime;
                return;
            }

            // Only use direct movement if pathfinding is not available
            this.wanderInProgress = false;
            const effectiveSpeed = config.wanderSpeed > 75 ? config.wanderSpeed * 0.5 : config.wanderSpeed;
            const angle = Math.atan2(dy, dx);
            const moveDistance = effectiveSpeed * 0.016; // Adjusted for higher config speeds
            const newX = botPos.x + Math.cos(angle) * moveDistance;
            const newY = botPos.y + Math.sin(angle) * moveDistance;

            // Log direct movement
            movementLogger.log({
                timestamp: Date.now(),
                botId: this.bot.config.botId,
                eventType: 'move',
                position: { x: newX, y: newY },
                targetPosition: this.wanderTarget,
                speed: config.wanderSpeed,
                effectiveSpeed: effectiveSpeed,
                moveDistance: moveDistance,
                distanceToTarget: distance,
                metadata: { movementType: 'direct_fallback', pathfindingFailed: true },
            });

            let direction = PositionMessage_Direction.DOWN;
            if (Math.abs(dx) > Math.abs(dy)) {
                direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
            } else {
                direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
            }

            this.bot.moveTo(newX, newY, direction);
        } else {
            this.bot.stop();
            this.wanderInProgress = false;
        }
    }

    private generateWanderTarget(config: SocialBehaviorConfig): PositionInterface {
        // Use assigned space if available, otherwise use wander config
        if (this.config.assignedSpace) {
            const assignedSpace = this.config.assignedSpace;
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * assignedSpace.radius;
            return {
                x: assignedSpace.center.x + Math.cos(angle) * distance,
                y: assignedSpace.center.y + Math.sin(angle) * distance,
            };
        }

        // Fallback to wander config
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * config.wanderRadius;
        return {
            x: config.wanderCenter.x + Math.cos(angle) * distance,
            y: config.wanderCenter.y + Math.sin(angle) * distance,
        };
    }

    private isAtPosition(pos1: PositionInterface, pos2: PositionInterface, threshold: number = 10): boolean {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        return Math.sqrt(dx * dx + dy * dy) < threshold;
    }

    private cleanupConversations(config: SocialBehaviorConfig, currentTime: number): void {
        for (const [playerId, state] of this.activeConversations.entries()) {
            const duration = currentTime - state.startTime;
            if (duration > config.maxConversationDuration) {
                // Conversation too long, end it
                this.activeConversations.delete(playerId);
                this.conversationHistory.set(playerId, currentTime);
                // Bot will leave space automatically when players separate
            }
        }
    }

    private cleanupHistory(config: SocialBehaviorConfig): void {
        if (this.conversationHistory.size > config.conversationHistorySize) {
            // Remove oldest entries
            const entries = Array.from(this.conversationHistory.entries())
                .sort((a, b) => a[1] - b[1])
                .slice(0, this.conversationHistory.size - config.conversationHistorySize);

            for (const [playerId] of entries) {
                this.conversationHistory.delete(playerId);
            }
        }
    }

    private getConversationStarter(topics: string[]): string {
        if (topics.length === 0) {
            return "Hello! How are you doing today?";
        }
        const topic = topics[Math.floor(Math.random() * topics.length)];
        return `Hi! I'd love to chat about ${topic}. What do you think?`;
    }

    /**
     * Get personalized greeting based on conversation memory
     */
    private getPersonalizedGreeting(topics: string[], memory: BotPlayerMemory | null): string {
        if (!memory) {
            return this.getConversationStarter(topics);
        }

        const emotions = memory.emotions;
        const personalInfo = memory.personalInfo;
        const relationship = memory.relationship;

        // Check if bot is angry at player
        if (emotions.botEmotion.anger > 60) {
            return `Oh, it's you again. What do you want?`;
        }

        // Check if player is angry at bot
        if (emotions.playerEmotion.anger > 60) {
            return `I can see you're still upset. I'm sorry about that.`;
        }

        // Check if it's player's birthday (if we know it)
        if (personalInfo.birthday) {
            const today = new Date();
            const birthdayDate = this.parseBirthday(personalInfo.birthday);
            if (birthdayDate && this.isToday(birthdayDate)) {
                return `Happy birthday, ${personalInfo.name || 'friend'}! 🎉`;
            }
        }

        // Use player's name if we know it
        if (personalInfo.name && relationship.totalConversations > 1) {
            return `Hey ${personalInfo.name}! Good to see you again.`;
        }

        // First time meeting
        if (relationship.totalConversations === 1) {
            return `Hello! Nice to meet you. How are you doing today?`;
        }

        // Returning player
        if (relationship.totalConversations > 1) {
            const daysSinceLastMet = (Date.now() - relationship.lastMet) / (1000 * 60 * 60 * 24);
            if (daysSinceLastMet > 1) {
                return `Long time no see! How have you been?`;
            }
            return `Hey! We were just talking. What's up?`;
        }

        // Default
        return this.getConversationStarter(topics);
    }

    /**
     * Parse birthday string to Date (simple implementation)
     */
    private parseBirthday(birthdayStr: string): Date | null {
        // Simple parsing - can be enhanced
        try {
            // Try "January 15" format
            const date = new Date(birthdayStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {
            // Ignore
        }
        return null;
    }

    /**
     * Check if date is today (ignoring year)
     */
    private isToday(date: Date): boolean {
        const today = new Date();
        return date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    }
}

