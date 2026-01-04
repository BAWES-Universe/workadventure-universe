/**
 * SocialBehavior - Bot actively seeks conversations with players
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';

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

    constructor(config: SocialBehaviorConfig) {
        super(config);
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as SocialBehaviorConfig;
        const currentTime = Date.now();

        // Clean up old conversations
        this.cleanupConversations(config, currentTime);

        // Check for conversation opportunities periodically
        if (currentTime - this.lastConversationCheck > 1000) {
            this.lastConversationCheck = currentTime;
            this.checkForConversations(config);
        }

        // Handle movement
        if (this.targetPlayerId) {
            this.approachPlayer(this.targetPlayerId, config);
        } else {
            this.wander(config, deltaTime);
        }
    }

    onPlayerMoved(playerId: number, position: PositionInterface): void {
        // Update target if we're approaching this player
        if (this.targetPlayerId === playerId) {
            // Continue approaching
        }
    }

    onSpaceJoined(spaceName: string): void {
        if (!this.bot || !this.targetPlayerId) return;

        const config = this.config as SocialBehaviorConfig;
        const currentTime = Date.now();

        // Start conversation
        this.activeConversations.set(this.targetPlayerId, {
            playerId: this.targetPlayerId,
            spaceName,
            startTime: currentTime,
            lastMessageTime: currentTime,
        });

        // Send initial greeting
        const greeting = this.getConversationStarter(config.conversationTopics);
        if (greeting) {
            this.bot.sendChatMessage(spaceName, greeting);
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

        const conversation = this.activeConversations.get(senderId);
        if (conversation) {
            conversation.lastMessageTime = Date.now();
            // TODO: Process message with AI and respond
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

    private approachPlayer(playerId: number, config: SocialBehaviorConfig): void {
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

        // If close enough, stop and wait for space join
        if (distance <= config.approachDistance) {
            this.bot.stop();
            // Space will be joined automatically by backend when in proximity
            return;
        }

        // Move towards player
        const angle = Math.atan2(dy, dx);
        const newX = botPos.x + Math.cos(angle) * config.wanderSpeed * 0.016; // Assuming 60fps
        const newY = botPos.y + Math.sin(angle) * config.wanderSpeed * 0.016;

        // Determine direction
        let direction = PositionMessage_Direction.DOWN;
        if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
        } else {
            direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
        }

        this.bot.moveTo(newX, newY, direction);
    }

    private wander(config: SocialBehaviorConfig, deltaTime: number): void {
        if (!this.bot) return;

        // If bot has assigned space and is outside it, return first
        if (!this.isWithinAssignedSpace()) {
            this.returnToAssignedSpace();
            return;
        }

        const currentTime = Date.now();
        const botPos = this.bot.getState().getPosition();

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
            const angle = Math.atan2(dy, dx);
            const newX = botPos.x + Math.cos(angle) * config.wanderSpeed * 0.016;
            const newY = botPos.y + Math.sin(angle) * config.wanderSpeed * 0.016;

            let direction = PositionMessage_Direction.DOWN;
            if (Math.abs(dx) > Math.abs(dy)) {
                direction = dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
            } else {
                direction = dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
            }

            this.bot.moveTo(newX, newY, direction);
        } else {
            this.bot.stop();
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
}

