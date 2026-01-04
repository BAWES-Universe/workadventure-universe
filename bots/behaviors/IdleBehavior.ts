/**
 * IdleBehavior - Bot stands in place and responds to interactions
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import { PositionMessage_Direction } from '@workadventure/messages';

export interface IdleBehaviorConfig extends BehaviorConfig {
    type: 'idle';
    position: { x: number; y: number };
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

        // Play idle animations periodically
        if (config.idleAnimations && config.idleAnimations.length > 0) {
            const interval = config.animationInterval || 5000;
            if (currentTime - this.lastAnimationTime > interval) {
                // TODO: Implement animation playing
                this.lastAnimationTime = currentTime;
            }
        }

        // Check for nearby players
        const nearbyPlayers = this.bot.getNearbyPlayers(config.responseRadius);
        for (const player of nearbyPlayers) {
            if (!this.greetedPlayers.has(player.userId)) {
                this.greetPlayer(player.userId);
                this.greetedPlayers.add(player.userId);
            }
        }
    }

    onPlayerMoved(playerId: number): void {
        if (!this.bot) return;

        const config = this.config as IdleBehaviorConfig;
        const player = this.bot.getPlayerInfo(playerId);
        if (!player) return;

        const botPos = this.bot.getState().getPosition();
        const dx = player.position.x - botPos.x;
        const dy = player.position.y - botPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Remove from greeted set if player moved away
        if (distance > config.responseRadius * 2) {
            this.greetedPlayers.delete(playerId);
        }
    }

    onSpaceJoined(spaceName: string): void {
        // Bot joined a conversation, greet everyone
        if (!this.bot) return;

        const config = this.config as IdleBehaviorConfig;
        const greeting = this.getRandomGreeting(config.greetingMessages);
        if (greeting) {
            this.bot.sendChatMessage(spaceName, greeting);
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

    private getRandomGreeting(messages: string[]): string | null {
        if (messages.length === 0) return null;
        return messages[Math.floor(Math.random() * messages.length)];
    }
}

