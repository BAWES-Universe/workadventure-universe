/**
 * IdleBehavior - Bot stands in place and responds to interactions
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import { PositionMessage_Direction } from '@workadventure/messages';

export interface IdleBehaviorConfig extends BehaviorConfig {
    type: 'idle';
    // assignedSpace is inherited from BehaviorConfig
    // For idle bots: radius=0 means they won't move
    responseRadius: number; // Distance to respond to players
    greetingMessages: string[]; // Random greetings
    idleAnimations?: string[]; // Idle animations to play
    animationInterval?: number; // Milliseconds between animations
}

export class IdleBehavior extends BaseBehavior {
    private lastAnimationTime: number = 0;
    private greetedPlayers: Set<number> = new Set();

    constructor(config: IdleBehaviorConfig) {
        super(config);
    }

    update(deltaTime: number): void {
        if (!this.bot) return;

        const config = this.config as IdleBehaviorConfig;
        const currentTime = Date.now();

        // If bot is summoned, allow movement to player (idle bots can move when summoned)
        if (this.isSummoned) {
            // Check if we've reached the target position (close enough to stop and initiate bubble)
            const botPos = this.bot.getState().getPosition();
            const targetPos = this.summonedPlayerUuid ? this.getSummonedPlayerPosition() : null;
            
            if (targetPos) {
                const dx = targetPos.x - botPos.x;
                const dy = targetPos.y - botPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If we're close to the target (< 50px), stop and wait for bubble to initiate
                // This allows the bubble to form naturally when player is nearby
                if (distance < 50) {
                    // Stop moving and face the target
                    if (this.bot.getIsFollowingPath()) {
                        this.bot.cancelPathfinding();
                    }
                    this.bot.stop();
                    // Face the target position
                    this.facePosition(targetPos);
                    this.onBotPositionUpdated();
                    return;
                }
            }
            
            // If we're in a conversation space, stop and engage normally (not ghost)
            if (this.engagedWithUsers.size > 0) {
                // Bot reached player and is in conversation - stop and face
                if (this.bot.getIsFollowingPath()) {
                    this.bot.cancelPathfinding();
                }
                this.bot.stop();
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return;
            }
            
            // If still following path, continue moving
            if (this.bot.getIsFollowingPath()) {
                this.onBotPositionUpdated();
                return;
            }
            
            // If not following path and not close to target, might have reached or path failed
            // Continue with normal behavior
        }

        // If engaged, just update facing (idle bots don't move, so no need to stop)
        if (this.isEngaged) {
            // Update engagement to ensure facing is correct
            this.updateProximityEngagement();
            this.onBotPositionUpdated(); // Track position
            return;
        }

        // Play idle animations periodically
        if (config.idleAnimations && config.idleAnimations.length > 0) {
            const interval = config.animationInterval || 5000;
            if (currentTime - this.lastAnimationTime > interval) {
                // TODO: Implement animation playing
                this.lastAnimationTime = currentTime;
            }
        }

        // Check for nearby players
        const responseRadius = config.responseRadius || 100;
        const nearbyPlayers = this.bot.getNearbyPlayers(responseRadius);
        for (const player of nearbyPlayers) {
            if (!this.greetedPlayers.has(player.userId)) {
                this.greetPlayer(player.userId);
                this.greetedPlayers.add(player.userId);
            }
        }
        
        // Track bot position (idle bots don't move, but track for consistency)
        this.onBotPositionUpdated();
    }

    onPlayerMoved(playerId: number, position: { x: number; y: number }): void {
        // Call base behavior for proximity tracking and facing
        super.onPlayerMoved(playerId, position);
        
        if (!this.bot) return;

        const config = this.config as IdleBehaviorConfig;
        const player = this.bot.getPlayerInfo(playerId);
        if (!player) return;

        const botPos = this.bot.getState().getPosition();
        const dx = player.position.x - botPos.x;
        const dy = player.position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Remove from greeted set if player moved away
        const responseRadius = config.responseRadius || 100;
        if (distance > responseRadius * 2) {
            this.greetedPlayers.delete(playerId);
        }
    }

    onSpaceJoined(spaceName: string): void {
        // Bot joined a conversation, greet everyone
        if (!this.bot) return;

        const config = this.config as IdleBehaviorConfig;
        const greetingMessages = config.greetingMessages || [];
        const greeting = this.getRandomGreeting(greetingMessages);
        if (greeting) {
            // Wait a bit for the space to sync the bot as a user before sending message
            // The back service needs the bot to be in the space's users list to process the message
            setTimeout(() => {
                if (this.bot) {
                    this.bot.sendChatMessage(spaceName, greeting);
                }
            }, 500);
        }
    }

    onChatMessage(spaceName: string, message: string, senderId: number): void {
        // Respond to chat messages
        // This will be handled by AI provider (LMStudio, etc.)
        // For now, just acknowledge
        if (!this.bot) return;
        // TODO: Integrate with AI provider
    }

    private greetPlayer(playerId: number): void {
        // When player approaches, we wait for them to join space
        // The greeting will be sent in onSpaceJoined
    }

    private getRandomGreeting(messages: string[] | undefined): string | null {
        if (!messages || messages.length === 0) {
            // Default greeting if none configured
            return "Hello! How can I help you?";
        }
        return messages[Math.floor(Math.random() * messages.length)];
    }
}

