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

    constructor(config: BehaviorConfig) {
        this.config = config;
    }

    /**
     * Set the bot instance this behavior controls
     */
    setBot(bot: BotClient): void {
        this.bot = bot;
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
        // Default: do nothing
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
        // Default: return to assigned space if configured
        this.returnToAssignedSpace();
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
        // Default: do nothing
    }

    /**
     * Called when a user leaves the space
     * @param spaceName Space name
     * @param userId User ID that left
     */
    onSpaceUserLeft(spaceName: string, userId: number): void {
        // Default: do nothing
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

