/**
 * IdleBehavior - Bot stands in place and responds to interactions
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import { PositionMessage_Direction } from '@workadventure/messages';
import { ConversationMemory } from '../memory/ConversationMemory';

export interface IdleBehaviorConfig extends BehaviorConfig {
    type: 'idle';
    // assignedSpace is inherited from BehaviorConfig
    // For idle bots: radius=0 means they won't move
    responseRadius: number; // Distance to respond to players
    greetingMessages: string[]; // Random greetings
    idleAnimations?: string[]; // Idle animations to play
    animationInterval?: number; // Milliseconds between animations
    conversationHistorySize?: number; // Size of conversation history to keep
}

export class IdleBehavior extends BaseBehavior {
    private lastAnimationTime: number = 0;
    private greetedPlayers: Set<number> = new Set();
    private conversationMemory: ConversationMemory;

    constructor(config: IdleBehaviorConfig) {
        super(config);
        this.conversationMemory = new ConversationMemory(
            config.conversationHistorySize || 50,
            1000 // Max 1000 player memories per bot
        );
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
            
            // Path ended but not close to target and not in space - bot reached target, stop and wait for bubble
            // Don't continue with normal behavior - wait for player to get close enough for bubble
            this.bot.stop();
            this.updateProximityEngagement(); // Face the player if nearby
            this.onBotPositionUpdated();
            return;
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

        // Find the player who triggered the space join (first nearby player)
        const nearbyPlayers = this.bot.getNearbyPlayers(100); // Use reasonable radius
        if (nearbyPlayers.length > 0) {
            const playerId = nearbyPlayers[0].userId;
            const botId = this.bot.getBotId();
            
            // Generate AI greeting instead of preset
            this.generateAIGreeting(spaceName, playerId, botId).catch(error => {
                console.error(`[IdleBehavior] Error generating AI greeting:`, error);
                // Fallback: don't send anything if AI fails (no preset greeting)
            });
        }
    }

    onChatMessage(spaceName: string, message: string, senderId: number): void {
        if (!this.bot) {
            console.warn(`[IdleBehavior] onChatMessage: bot is null`);
            return;
        }

        const botId = this.bot.getBotId();
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] onChatMessage received: botId=${botId}, senderId=${senderId}, message="${message}", spaceName=${spaceName}`);
        }

        // Start conversation in memory if needed
        this.conversationMemory.startConversation(botId, senderId);
        
        // Store player's message in memory
        this.conversationMemory.addMessage(botId, senderId, message, 'player', spaceName);
        
        // Extract personal information from message
        this.conversationMemory.extractPersonalInfo(botId, senderId, message);

        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[IdleBehavior] Error generating AI response:`, error);
            // Send fallback message
            this.bot?.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        });
    }

    /**
     * Generate AI response stream and send to player
     */
    private async generateAIResponseStream(
        spaceName: string,
        playerId: number,
        playerMessage: string,
        botId: string
    ): Promise<void> {
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] generateAIResponseStream called for bot ${botId}`);
        }
        
        if (!this.bot || !this.aiService || !this.adminApiService) {
            console.warn(`[IdleBehavior] Missing required services for AI response: bot=${!!this.bot}, aiService=${!!this.aiService}, adminApiService=${!!this.adminApiService}`);
            return;
        }

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] Fetching bot configuration for ${botId}...`);
        }
        
        // Get bot configuration
        const botConfig = await this.adminApiService.getBotConfiguration(botId);
        if (!botConfig) {
            console.error(`[IdleBehavior] Bot configuration not found for ${botId}`);
            return;
        }
        
        if (!botConfig.aiProviderRef) {
            console.warn(`[IdleBehavior] Bot ${botId} has no AI provider configured (aiProviderRef missing). Bot config:`, {
                botId: botConfig.botId,
                name: botConfig.name,
                hasAiProviderRef: !!botConfig.aiProviderRef,
            });
            return;
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] Using AI provider: ${botConfig.aiProviderRef}`);
        }

        // Get conversation context (includes memory, emotions, relationship history)
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate streaming response
        let fullMessage = '';
        
        try {
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.movementInstructions,
                botConfig.aiProviderRef,
                spaceName,
                context
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send complete message
                    if (fullMessage.trim()) {
                        this.bot.sendChatMessage(spaceName, fullMessage);
                        // Store bot's message in memory
                        this.conversationMemory.addMessage(botId, playerId, fullMessage, 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI error:`, error);
            this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        }
    }

    private greetPlayer(playerId: number): void {
        // When player approaches, we wait for them to join space
        // The greeting will be sent in onSpaceJoined
    }

    /**
     * Generate AI greeting for a player
     */
    private async generateAIGreeting(
        spaceName: string,
        playerId: number,
        botId: string
    ): Promise<void> {
        if (!this.bot || !this.aiService || !this.adminApiService) {
            return;
        }

        // Get bot configuration
        const botConfig = await this.adminApiService.getBotConfiguration(botId);
        if (!botConfig?.aiProviderRef) {
            // No AI provider configured - don't send greeting
            return;
        }

        // Get conversation context (includes memory, emotions, relationship history)
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate natural response using AI - not a greeting, just respond naturally
        let fullMessage = '';
        
        try {
            // Simple prompt: player approached, respond naturally
            // The AI will use the conversation context (memory, emotions, relationship) from chatInstructions
            const playerMessage = 'A player just approached you.';
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a friendly bot.',
                botConfig.movementInstructions,
                botConfig.aiProviderRef,
                spaceName,
                context
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send response
                    if (fullMessage.trim()) {
                        // Wait a bit for the space to sync
                        setTimeout(() => {
                            if (this.bot) {
                                this.bot.sendChatMessage(spaceName, fullMessage.trim());
                                // Store bot's message in memory
                                this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                            }
                        }, 500);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI greeting error:`, error);
            // Don't send fallback - just fail silently
        }
    }
}

