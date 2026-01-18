/**
 * IdleBehavior - Bot stands in place and responds to interactions
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import { PositionMessage_Direction } from '@workadventure/messages';
import { ConversationMemory } from '../memory/ConversationMemory';
import { BotClient } from '../client/BotClient';

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

        // If bot is summoned or leading, allow movement (idle bots can move when summoned or leading)
        if (this.isSummoned || this.isLeading) {
            // When leading, get the target from leadingTarget instead of summonedPlayerUuid
            const botPos = this.bot.getState().getPosition();
            let targetPos: { x: number; y: number } | null = null;
            
            if (this.isLeading && this.leadingTarget) {
                // When leading, use the leading target position
                targetPos = this.leadingTarget.position;
            } else if (this.isSummoned && this.summonedPlayerUuid) {
                // When summoned, use the summoned player position
                targetPos = this.getSummonedPlayerPosition();
            }
            
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
                    
                    // If leading to a person, leave current space and move one step closer to trigger bubble, then end leading
                    if (this.isLeading && this.leadingTarget?.type === 'person') {
                        // Leading to a person - send goodbye message to follower, then return
                        // Prevent multiple concurrent calls
                        if (this.isSendingGoodbye) {
                            return;
                        }
                        
                        const targetPersonName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] 🎯 Reached person destination: ${targetPersonName}, found ${followers.length} followers`);
                        }
                        
                        if (followers.length > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[IdleBehavior] 📤 Calling sendPersonArrivalMessage for ${followers.length} follower(s)`);
                            }
                            // Send goodbye message, then end leading and return
                            this.sendPersonArrivalMessage(targetPersonName, followers).then(() => {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[IdleBehavior] ✅ Person arrival message sent, ending leading and returning`);
                                }
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[IdleBehavior] ❌ Error sending person arrival message:`, error);
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[IdleBehavior] ⚠️ No followers found when reaching person destination`);
                            }
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else if (this.isLeading && this.leadingTarget?.type === 'area') {
                        // Leading to an area - send arrival and goodbye message, then return
                        // Prevent multiple concurrent calls
                        if (this.isSendingGoodbye) {
                            return;
                        }
                        
                        const areaName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] 🎯 Reached area destination: ${areaName}, found ${followers.length} followers`);
                        }
                        
                        if (followers.length > 0) {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.log(`[IdleBehavior] 📤 Calling sendAreaArrivalMessage for ${followers.length} follower(s)`);
                            }
                            // Send goodbye message, then end leading and return
                            this.sendAreaArrivalMessage(areaName, followers).then(() => {
                                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                    console.log(`[IdleBehavior] ✅ Area arrival message sent, ending leading and returning`);
                                }
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[IdleBehavior] ❌ Error sending area arrival message:`, error);
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[IdleBehavior] ⚠️ No followers found when reaching area destination`);
                            }
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else {
                        // Not leading, just end leading normally
                        this.endLeading();
                    }
                    
                    // Face the target position
                    this.facePosition(targetPos);
                    this.onBotPositionUpdated();
                    return;
                }
            }
            
            // If we're in a conversation space, stop and engage normally (not ghost)
            // BUT: When leading, don't stop just because we're in a space - continue to target
            if (this.engagedWithUsers.size > 0 && !this.isLeading) {
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
            
            // Path ended but not close to target and not in space
            // When leading, don't stop - the pathfinding should continue or we should recalculate
            // When summoned, stop and wait for bubble
            if (this.isSummoned && !this.isLeading) {
                this.bot.stop();
                this.updateProximityEngagement(); // Face the player if nearby
                this.onBotPositionUpdated();
                return;
            }
            // When leading, if path ended but we're not at target, continue (pathfinding will handle it)
            if (this.isLeading) {
                this.onBotPositionUpdated();
                return;
            }
        }

        // If bot is returning to original position after leading/summon, allow movement
        if (this.isReturning) {
            // During return, allow pathfinding to continue
            if (this.bot.getIsFollowingPath()) {
                // Bot is returning - allow it to continue
                this.onBotPositionUpdated();
                return;
            }
            // If not following path, might have reached start position
            // Continue with normal behavior
        }

        // If engaged, just update facing (idle bots don't move, so no need to stop)
        // BUT: When leading, don't stop just because we're engaged - continue to target
        if (this.isEngaged && !this.isLeading) {
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
            
            // Check if we just completed leading someone to this person
            if (this.justCompletedLeading && this.justCompletedLeading.targetPersonId === playerId) {
                const followerUuid = this.justCompletedLeading.followerUuid;
                // Clear the flag
                this.justCompletedLeading = null;
                
                // Generate special greeting explaining we brought someone, then say goodbye and return
                this.generateAIGreetingWithLeadingContext(spaceName, playerId, botId, followerUuid).then(() => {
                    // After greeting, send goodbye message and return
                    this.sendGoodbyeAndReturn(spaceName, playerId, botId, 'person').catch(error => {
                        console.error(`[IdleBehavior] Error sending goodbye and returning:`, error);
                    });
                }).catch(error => {
                    console.error(`[IdleBehavior] Error generating leading completion greeting:`, error);
                });
                return;
            }
            
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
        
        // Start conversation in storage (if available)
        if (this.conversationStorage) {
            this.conversationStorage.startConversation(botId, senderId);
        }
        
        // Store player's message in memory
        this.conversationMemory.addMessage(botId, senderId, message, 'person', spaceName);
        
        // Store player's message in conversation storage
        if (this.conversationStorage) {
            this.conversationStorage.addMessage(botId, senderId, message, 'person');
        }
        
        // Extract personal information from message
        this.conversationMemory.extractPersonalInfo(botId, senderId, message);

        // Start typing indicator
        this.bot?.startTyping(spaceName);

        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[IdleBehavior] Error generating AI response:`, error);
            // Stop typing indicator on error
            this.bot?.stopTyping(spaceName);
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
        
        if (!this.bot || !this.aiService) {
            console.warn(`[IdleBehavior] Missing required services for AI response: bot=${!!this.bot}, aiService=${!!this.aiService}`);
            return;
        }
        
        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig) {
            console.error(`[IdleBehavior] Bot configuration not found for ${botId}`);
            return;
        }
        
        if (!botConfig.aiProviderRef) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] Bot ${botId} has no AI provider configured (aiProviderRef missing). Bot config:`, {
                    botId: botConfig.botId,
                    name: botConfig.name,
                    hasAiProviderRef: !!botConfig.aiProviderRef,
                });
            }
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
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Stop typing indicator
                    this.bot.stopTyping(spaceName);
                    
                    // Send complete message
                    if (fullMessage.trim()) {
                        this.bot.sendChatMessage(spaceName, fullMessage);
                        // Store bot's message in memory
                        this.conversationMemory.addMessage(botId, playerId, fullMessage, 'bot', spaceName);
                        // Store bot's message in conversation storage
                        if (this.conversationStorage) {
                            this.conversationStorage.addMessage(botId, playerId, fullMessage, 'bot');
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI error:`, error);
            // Stop typing indicator on error
            this.bot.stopTyping(spaceName);
            this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        }
    }

    private greetPlayer(playerId: number): void {
        // When player approaches, we wait for them to join space
        // The greeting will be sent in onSpaceJoined
    }

    /**
     * Send goodbye message and return to start position
     */
    private async sendGoodbyeAndReturn(spaceName: string, playerId: number, botId: string, destinationType: 'person' | 'area'): Promise<void> {
        if (!this.bot || !this.aiService) {
            this.returnAfterLeading();
            return;
        }

        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            this.returnAfterLeading();
            return;
        }

        const context = this.conversationMemory.getConversationContext(botId, playerId);
        const destinationText = destinationType === 'person' ? 'this person' : 'the destination';
        
        let fullMessage = '';
        try {
            const goodbyePrompt = `You've arrived at ${destinationText}. It was nice talking to them. Say goodbye and that you'll see them soon.`;
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                goodbyePrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    if (fullMessage.trim()) {
                        if (this.bot) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                            // Store bot's message in conversation storage
                            if (this.conversationStorage) {
                                this.conversationStorage.addMessage(botId, playerId, fullMessage.trim(), 'bot');
                            }
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating goodbye message:`, error);
        }
        
        // Return to start position after sending message
        this.returnAfterLeading();
    }

    /**
     * Generate AI greeting with special context for leading completion
     */
    private async generateAIGreetingWithLeadingContext(
        spaceName: string,
        playerId: number,
        botId: string,
        followerUuid: string | null
    ): Promise<void> {
        if (!this.bot || !this.aiService) {
            return;
        }

        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig) {
            console.warn(`[IdleBehavior] No bot config available for greeting`);
            return;
        }

        // Get conversation context
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        let fullMessage = '';
        
        try {
            // Special prompt for leading completion
            const leadingContext = followerUuid === 'group' 
                ? 'You just guided a group of people to this person. They asked about them. Let them know you\'ve brought the people who wanted to talk with them.'
                : 'You just guided someone to this person. They asked about them. Let them know you\'ve brought the person who wanted to talk with them.';
            
            const playerMessage = leadingContext;
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a helpful bot. Respond naturally when someone approaches you.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send response
                    if (fullMessage.trim()) {
                        if (this.bot) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            // Store bot's message in memory
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
                    }
                    // After greeting, send goodbye message and return
                    this.sendGoodbyeAndReturn(spaceName, playerId, botId, 'person').catch(error => {
                        console.error(`[IdleBehavior] Error sending goodbye and returning:`, error);
                    });
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI leading completion greeting error:`, error);
            // Don't send fallback - just fail silently
        }
    }

    /**
     * Send area arrival message to follower(s)
     * Sends one message to the space - all followers in that space will receive it
     */
    private async sendAreaArrivalMessage(areaName: string, followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>): Promise<void> {
        if (!this.bot || !this.aiService || followers.length === 0) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendAreaArrivalMessage: Missing bot/aiService or no followers`);
            }
            return;
        }

        // Get the current space - prefer conversation spaces over world spaces
        const currentSpaces = this.bot.getCurrentSpaces();
        // Filter out world spaces (like "allWorldUser") and prefer conversation spaces
        const conversationSpaces = currentSpaces.filter(space => !space.includes('allWorldUser') && space.includes('#'));
        const spaceName = conversationSpaces.length > 0 
            ? conversationSpaces[0] 
            : (currentSpaces.length > 0 ? currentSpaces[0] : this.leadingSpaceName);
        if (!spaceName) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendAreaArrivalMessage: Bot not in any space (currentSpaces=${currentSpaces.length}, leadingSpaceName=${this.leadingSpaceName})`);
            }
            return;
        }

        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendAreaArrivalMessage: No AI provider configured`);
            }
            return;
        }

        const botId = this.bot.getBotId();
        const followerUserId = followers[0].userId; // Use first follower for context
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] sendAreaArrivalMessage: spaceName=${spaceName}, followerUserId=${followerUserId}, areaName=${areaName}`);
        }
        
        this.isSendingGoodbye = true;
        
        try {
            const context = this.conversationMemory.getConversationContext(botId, followerUserId);
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to the ${areaName} area. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] sendAreaArrivalMessage: Generating AI response...`);
            }
            
            let fullMessage = '';
            let chunkCount = 0;
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerUserId,
                arrivalPrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                chunkCount++;
                if (chunk.content) {
                    fullMessage += chunk.content;
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendAreaArrivalMessage: Received chunk ${chunkCount}, content length: ${chunk.content.length}, total: ${fullMessage.length}`);
                    }
                }
                if (chunk.done) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendAreaArrivalMessage: Stream completed after ${chunkCount} chunks, final message length: ${fullMessage.length}`);
                    }
                    if (fullMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] sendAreaArrivalMessage: Sending message to space: "${fullMessage.trim()}"`);
                        }
                        this.bot.sendChatMessage(spaceName, fullMessage.trim());
                        this.conversationMemory.addMessage(botId, followerUserId, fullMessage.trim(), 'bot', spaceName);
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[IdleBehavior] sendAreaArrivalMessage: Generated message is empty`);
                        }
                    }
                    break;
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (!fullMessage.trim()) {
                    console.warn(`[IdleBehavior] sendAreaArrivalMessage: Stream ended without chunk.done=true or message is empty. Chunks received: ${chunkCount}`);
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating area arrival message:`, error);
        } finally {
            this.isSendingGoodbye = false;
            await this.bot.leaveAllSpaces();
        }
    }

    /**
     * Send person arrival message to follower(s)
     * Similar to sendAreaArrivalMessage but for when leading to a person
     */
    private async sendPersonArrivalMessage(personName: string, followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>): Promise<void> {
        if (!this.bot || !this.aiService || followers.length === 0) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendPersonArrivalMessage: Missing bot/aiService or no followers`);
            }
            return;
        }

        // Get the current space - prefer conversation spaces over world spaces
        // Use leadingSpaceName as fallback (set when user joined during leading)
        const currentSpaces = this.bot.getCurrentSpaces();
        // Filter out world spaces (like "allWorldUser") and prefer conversation spaces
        const conversationSpaces = currentSpaces.filter(space => !space.includes('allWorldUser') && space.includes('#'));
        const spaceName = conversationSpaces.length > 0 
            ? conversationSpaces[0] 
            : (currentSpaces.length > 0 ? currentSpaces[0] : this.leadingSpaceName);
        if (!spaceName) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendPersonArrivalMessage: Bot not in any space (currentSpaces=${currentSpaces.length}, leadingSpaceName=${this.leadingSpaceName})`);
            }
            return;
        }

        // Get bot configuration
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[IdleBehavior] sendPersonArrivalMessage: No AI provider configured`);
            }
            return;
        }

        const botId = this.bot.getBotId();
        const followerUserId = followers[0].userId; // Use first follower for context
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] sendPersonArrivalMessage: spaceName=${spaceName}, followerUserId=${followerUserId}, personName=${personName}`);
        }
        
        this.isSendingGoodbye = true;
        
        try {
            const context = this.conversationMemory.getConversationContext(botId, followerUserId);
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to ${personName}. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] sendPersonArrivalMessage: Generating AI response...`);
            }
            
            let fullMessage = '';
            let chunkCount = 0;
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerUserId,
                arrivalPrompt,
                botConfig.chatInstructions || 'You are a helpful bot.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                chunkCount++;
                if (chunk.content) {
                    fullMessage += chunk.content;
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendPersonArrivalMessage: Received chunk ${chunkCount}, content length: ${chunk.content.length}, total: ${fullMessage.length}`);
                    }
                }
                if (chunk.done) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendPersonArrivalMessage: Stream completed after ${chunkCount} chunks, final message length: ${fullMessage.length}`);
                    }
                    if (fullMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] sendPersonArrivalMessage: Sending message to space: "${fullMessage.trim()}"`);
                        }
                        this.bot.sendChatMessage(spaceName, fullMessage.trim());
                        this.conversationMemory.addMessage(botId, followerUserId, fullMessage.trim(), 'bot', spaceName);
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[IdleBehavior] sendPersonArrivalMessage: Generated message is empty`);
                        }
                    }
                    break;
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (!fullMessage.trim()) {
                    console.warn(`[IdleBehavior] sendPersonArrivalMessage: Stream ended without chunk.done=true or message is empty. Chunks received: ${chunkCount}`);
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating person arrival message:`, error);
        } finally {
            this.isSendingGoodbye = false;
            await this.bot.leaveAllSpaces();
        }
    }

    /**
     * Generate AI greeting for a person
     */
    private async generateAIGreeting(
        spaceName: string,
        playerId: number,
        botId: string
    ): Promise<void> {
        if (!this.bot || !this.aiService) {
            return;
        }

        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            // No AI provider configured - don't send greeting
            return;
        }

        // Get conversation context (includes memory, emotions, relationship history)
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate natural response using AI - not a greeting, just respond naturally
        let fullMessage = '';
        
        try {
            // Natural prompt: person approached, respond naturally based on context
            // The AI has access to memory (if they've met before), map context, and can assess the situation
            // It should respond naturally, not ask meta questions
            // Use a more direct prompt that encourages a greeting, not a meta-response
            const playerMessage = 'Greet this person who just approached you.';
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a helpful bot. Respond naturally when someone approaches you.',
                botConfig.aiProviderRef,
                spaceName,
                context,
                this.bot,
                this.adminApiService
            )) {
                if (chunk.content) {
                    fullMessage += chunk.content;
                }
                
                if (chunk.done) {
                    // Send response
                    if (fullMessage.trim()) {
                        if (this.bot) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            // Store bot's message in memory
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
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

