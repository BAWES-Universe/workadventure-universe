/**
 * SocialBehavior - Bot actively seeks conversations with players
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import type { PositionInterface } from '../../play/src/front/Connection/ConnexionModels';
import { PositionMessage_Direction } from '@workadventure/messages';
import type { SpaceUser } from '@workadventure/messages';
import { ConversationMemory, type BotPlayerMemory } from '../memory/ConversationMemory';
import { movementLogger } from '../utils/MovementLogger';
import { BotClient } from '../client/BotClient';

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
    private currentSpaceName: string | null = null; // Track current space to prevent wandering

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

        // If bot is summoned or leading, allow movement (don't stop for normal behavior logic)
        // The bot will stop when it reaches the target position
        if (this.isSummoned || this.isLeading) {
            // When leading, get the target from leadingTarget
            let targetPos: { x: number; y: number } | null = null;
            if (this.isLeading && this.leadingTarget) {
                targetPos = this.leadingTarget.position;
            } else if (this.isSummoned && this.summonedPlayerUuid) {
                targetPos = this.getSummonedPlayerPosition();
            }
            
            // Check if we've reached the target position
            if (targetPos) {
                const botPos = this.bot.getState().getPosition();
                const dx = targetPos.x - botPos.x;
                const dy = targetPos.y - botPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If we're close to the target (< 50px), stop and wait for bubble to initiate
                if (distance < 50) {
                    if (this.bot.getIsFollowingPath()) {
                        this.bot.cancelPathfinding();
                    }
                    this.bot.stop();
                    
                    // If leading to a person, send goodbye message to follower, then return
                    if (this.isLeading && this.leadingTarget?.type === 'person') {
                        // Leading to a person - send goodbye message to follower, then return
                        const targetPersonName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (followers.length > 0) {
                            // Send goodbye message FIRST (before ending leading)
                            // This ensures the person is still following and in the space
                            this.sendPersonArrivalMessage(targetPersonName, followers).then(() => {
                                // After message sent, end leading and return
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[SocialBehavior] Error sending person arrival message:`, error);
                                // Still end leading and return even if message failed
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            // No followers found, just end leading and return
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else if (this.isLeading && this.leadingTarget?.type === 'area') {
                        // Leading to an area - send arrival message to follower
                        const areaName = this.leadingTarget.name;
                        
                        // Find the follower (they should be nearby since they're following)
                        const nearbyPlayers = this.bot.getNearbyPlayers(200); // Larger radius to find follower
                        const followers = nearbyPlayers.filter(p => !BotClient.isBot(p.userId));
                        
                        if (followers.length > 0) {
                            // Send arrival and goodbye message FIRST (before ending leading)
                            // This ensures the person is still following and in the space
                            this.sendAreaArrivalMessage(areaName, followers).then(() => {
                                // After message sent, end leading and return
                                this.endLeading();
                                this.returnAfterLeading();
                            }).catch(error => {
                                console.error(`[SocialBehavior] Error sending area arrival message:`, error);
                                // Still end leading and return even if message failed
                                this.endLeading();
                                this.returnAfterLeading();
                            });
                        } else {
                            // No followers found, just end leading and return
                            this.endLeading();
                            this.returnAfterLeading();
                        }
                    } else {
                        // Not leading, just end leading normally
                        this.endLeading();
                    }
                    
                    this.facePosition(targetPos);
                    this.onBotPositionUpdated();
                    return;
                }
            }
            
            // During summon/leading, only stop if we've reached the target and are in a conversation space
            // BUT: When leading, don't stop just because we're in a space - continue to target
            if (this.bot.getIsFollowingPath()) {
                // Bot is moving to target - allow it
                this.onBotPositionUpdated();
                return;
            } else if ((this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading) {
                // Bot reached player and is in conversation - stop and face (only when summoned, not leading)
                this.bot.stop();
                this.updateProximityEngagement();
                this.onBotPositionUpdated();
                return;
            } else if (this.isLeading) {
                // When leading, if path ended but we're not at target, continue (pathfinding will handle it)
                this.onBotPositionUpdated();
                return;
            } else {
                // Path ended but not in space yet - bot reached target, stop and wait for bubble
                // Don't continue with normal behavior - wait for player to get close enough for bubble
                this.bot.stop();
                this.updateProximityEngagement(); // Face the player if nearby
                this.onBotPositionUpdated();
                return;
            }
        }

        // If bot is returning to original position after summon, allow movement
        if (this.isReturning) {
            // During return, allow pathfinding to continue
            if (this.bot.getIsFollowingPath()) {
                // Bot is returning - allow it to continue
                this.onBotPositionUpdated();
                return;
            }
            // If not following path, might have reached original position
            // Continue with normal behavior to resume wandering
        }

        // Clean up old conversations
        this.cleanupConversations(config, currentTime);

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
        
        // GHOST MODE: Only stop if actually in a conversation space
        // Don't stop just because players are nearby - continue moving until actively engaging
        // Check both currentSpaceName (immediate) and engagedWithUsers (after users join)
        // CRITICAL: Check this BEFORE path following to prevent movement in bubbles
        // BUT: When leading, don't stop just because we're in a space - continue to target
        if ((this.currentSpaceName || this.engagedWithUsers.size > 0) && !this.isLeading) {
            // Actually in a conversation space - stop immediately and cancel any movement
            if (this.bot.getIsFollowingPath()) {
                this.bot.cancelPathfinding();
            }
            this.bot.stop();
            // Update engagement to ensure facing is correct (handles player movement)
            this.updateProximityEngagement();
            this.onBotPositionUpdated(); // Track position even when stopped
            return;
        }

        // If following a path, let BotClient handle movement (only if not in a space)
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
        if (!this.bot) return;

        // CRITICAL: Track space name immediately to prevent wandering
        this.currentSpaceName = spaceName;

        // CRITICAL: Cancel any active pathfinding and stop immediately when entering a space
        if (this.bot.getIsFollowingPath()) {
            this.bot.cancelPathfinding();
        }
        this.bot.stop();

        const config = this.config as SocialBehaviorConfig;
        const currentTime = Date.now();
        const botId = this.bot.getBotId();

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[SocialBehavior] onSpaceJoined: spaceName=${spaceName}, targetPlayerId=${this.targetPlayerId}, engagedWithUsers=${this.engagedWithUsers.size}`);
        }

        // Check if we just completed leading someone to this person
        if (this.justCompletedLeading && this.justCompletedLeading.targetPersonId) {
            const targetPersonId = this.justCompletedLeading.targetPersonId;
            const followerUuid = this.justCompletedLeading.followerUuid;
            
            // Find the player in the space who matches the target
            const nearbyPlayers = this.bot.getNearbyPlayers(100);
            const targetPlayer = nearbyPlayers.find(p => p.userId === targetPersonId);
            
            if (targetPlayer) {
                // Clear the flag
                this.justCompletedLeading = null;
                
                // Start conversation in memory
                this.conversationMemory.startConversation(botId, targetPersonId);
                
                // Start conversation
                this.activeConversations.set(targetPersonId, {
                    playerId: targetPersonId,
                    spaceName,
                    startTime: currentTime,
                    lastMessageTime: currentTime,
                });
                
                // Generate special greeting explaining we brought someone, then say goodbye and return
                this.generateAIGreetingWithLeadingContext(spaceName, targetPersonId, botId, followerUuid).then(() => {
                    // After greeting, send goodbye message and return
                    this.sendGoodbyeAndReturn(spaceName, targetPersonId, botId, 'person').catch(error => {
                        console.error(`[SocialBehavior] Error sending goodbye and returning:`, error);
                    });
                }).catch(error => {
                    console.error(`[SocialBehavior] Error generating leading completion greeting:`, error);
                });
                return; // Don't continue with normal greeting
            }
        }

        // If we have a target player, start a formal conversation (bot-initiated)
        if (this.targetPlayerId) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Bot-initiated conversation with player ${this.targetPlayerId}`);
            }
            
            // Start conversation in memory
            this.conversationMemory.startConversation(botId, this.targetPlayerId);

            // Start conversation
            this.activeConversations.set(this.targetPlayerId, {
                playerId: this.targetPlayerId,
                spaceName,
                startTime: currentTime,
                lastMessageTime: currentTime,
            });

            // Generate AI greeting instead of preset
            this.generateAIGreeting(spaceName, this.targetPlayerId, botId).catch(error => {
                console.error(`[SocialBehavior] Error generating AI greeting:`, error);
                // Fallback: don't send anything if AI fails (no preset greeting)
            });

            // Clear target
            this.targetPlayerId = null;
        } else {
            // No target player - player-initiated conversation
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Player-initiated conversation - checking for nearby players and setting up delayed check`);
            }
            
            // Immediately check for nearby players who might be in the space
            // This handles the case where the player is nearby but addSpaceUserMessage hasn't arrived yet
            const nearbyPlayers = this.bot.getNearbyPlayers(config.conversationRadius || 100);
            for (const player of nearbyPlayers) {
                if (!this.activeConversations.has(player.userId)) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[SocialBehavior] Found nearby player ${player.userId} - starting conversation immediately`);
                    }
                    this.startConversationWithPlayer(player.userId, spaceName, config, botId);
                    break; // Only start one conversation at a time
                }
            }
            
            // Also set up a delayed check for engaged users (in case addSpaceUserMessage arrives later)
            setTimeout(() => {
                if (!this.bot || this.currentSpaceName !== spaceName) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[SocialBehavior] Delayed check cancelled: bot=${!!this.bot}, currentSpaceName=${this.currentSpaceName}, spaceName=${spaceName}`);
                    }
                    return;
                }
                
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[SocialBehavior] Delayed check: engagedWithUsers=${this.engagedWithUsers.size}, activeConversations=${this.activeConversations.size}`);
                }
                
                // Check if we have engaged users but no active conversations yet
                // This handles the case where users were already in the space
                for (const [userId, userData] of this.engagedWithUsers.entries()) {
                    if (userData.spaceName === spaceName && !this.activeConversations.has(userId)) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[SocialBehavior] Found engaged user ${userId} without conversation - starting conversation`);
                        }
                        // User is engaged but we haven't started a conversation yet
                        // This means they were already in the space when we joined
                        this.startConversationWithPlayer(userId, spaceName, config, botId);
                    }
                }
            }, 1000); // Give time for addSpaceUserMessage to arrive
        }
    }
    
    /**
     * Send greeting message with retry mechanism (handles server sync delays)
     */
    private sendGreetingWithRetry(
        spaceName: string,
        greeting: string,
        botId: string,
        playerId: number,
        attempt: number
    ): void {
        const MAX_ATTEMPTS = 5;
        const DELAY_MS = 1000; // Start with 1 second delay
        
        if (attempt >= MAX_ATTEMPTS) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[SocialBehavior] Failed to send greeting after ${MAX_ATTEMPTS} attempts`);
            }
            return;
        }
        
        const delay = DELAY_MS * (attempt + 1); // Exponential backoff: 1s, 2s, 3s, 4s, 5s
        
        setTimeout(() => {
            if (!this.bot || this.currentSpaceName !== spaceName || !this.activeConversations.has(playerId)) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[SocialBehavior] Greeting send cancelled (attempt ${attempt + 1}): bot=${!!this.bot}, currentSpaceName=${this.currentSpaceName}, spaceName=${spaceName}, hasConversation=${this.activeConversations.has(playerId)}`);
                }
                return;
            }
            
            // Check if bot is actually in the space
            const spaceUserId = (this.bot as any).spaces?.get(spaceName);
            if (!spaceUserId) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.log(`[SocialBehavior] Bot not in space yet (attempt ${attempt + 1}), retrying in ${delay}ms...`);
                }
                this.sendGreetingWithRetry(spaceName, greeting, botId, playerId, attempt + 1);
                return;
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Sending greeting message (attempt ${attempt + 1}): "${greeting}" to space ${spaceName}`);
            }
            
            try {
                this.bot.sendChatMessage(spaceName, greeting);
                // Record bot's message in memory
                this.conversationMemory.addMessage(botId, playerId, greeting, 'bot', spaceName);
            } catch (error) {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.warn(`[SocialBehavior] Error sending greeting (attempt ${attempt + 1}), will retry:`, error);
                }
                // Retry on error
                this.sendGreetingWithRetry(spaceName, greeting, botId, playerId, attempt + 1);
            }
        }, delay);
    }

    /**
     * Helper method to start a conversation with a person (used by both onSpaceJoined and onSpaceUserJoined)
     */
    private startConversationWithPlayer(
        playerId: number,
        spaceName: string,
        config: SocialBehaviorConfig,
        botId: string
    ): void {
        if (!this.bot || this.activeConversations.has(playerId)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] startConversationWithPlayer skipped: bot=${!!this.bot}, hasConversation=${this.activeConversations.has(playerId)}`);
            }
            return;
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[SocialBehavior] startConversationWithPlayer: playerId=${playerId}, spaceName=${spaceName}`);
        }
        
        const currentTime = Date.now();
        
        // Start conversation in memory (this creates memory if it doesn't exist)
        this.conversationMemory.startConversation(botId, playerId);
        
        // Start conversation tracking
        this.activeConversations.set(playerId, {
            playerId: playerId,
            spaceName,
            startTime: currentTime,
            lastMessageTime: currentTime,
        });
        
        // Generate AI greeting instead of preset
        this.generateAIGreeting(spaceName, playerId, botId).catch(error => {
            console.error(`[SocialBehavior] Error generating AI greeting:`, error);
            // Fallback: don't send anything if AI fails (no preset greeting)
        });
    }

    onSpaceUserJoined(spaceName: string, user: SpaceUser): void {
        if (!this.bot) return;

        // Call base behavior first to track engagement
        super.onSpaceUserJoined(spaceName, user);

        // Get the userId from the SpaceUser (it's 'id' field, not 'userId')
        const playerId = user.id;

        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[SocialBehavior] onSpaceUserJoined: spaceName=${spaceName}, playerId=${playerId}, currentSpaceName=${this.currentSpaceName}, engagedWithUsers=${this.engagedWithUsers.size}`);
        }

        // Skip if it's the bot itself
        if (playerId === this.bot.getUserId()) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Skipping - it's the bot itself`);
            }
            return;
        }

        // Skip if already in conversation with this player
        if (this.activeConversations.has(playerId)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Skipping - already in conversation with player ${playerId}`);
            }
            return;
        }

        // Only handle player-initiated conversations (when bot is in space but no targetPlayerId)
        // If we're in a space and don't have an active conversation with this player, start one
        if (this.currentSpaceName === spaceName) {
            const config = this.config as SocialBehaviorConfig;
            const botId = this.bot.getBotId();
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Starting conversation with player ${playerId} via onSpaceUserJoined`);
            }
            
            // Use the helper method to start conversation
            this.startConversationWithPlayer(playerId, spaceName, config, botId);
        } else {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Not starting conversation - currentSpaceName (${this.currentSpaceName}) !== spaceName (${spaceName})`);
            }
        }
    }

    onSpaceLeft(spaceName: string): void {
        // Clear space name tracking
        if (this.currentSpaceName === spaceName) {
            this.currentSpaceName = null;
        }

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

        // If we're leading, don't return to assigned space - we're moving to a target
        if (this.isLeading) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Left space ${spaceName} while leading - not returning to assigned space`);
            }
            return;
        }
        
        // If summoned and player left, return to original position using endSummon()
        // This uses pathfinding to walk back (not teleport)
        if (this.isSummoned && this.summonedPlayerUuid) {
            // Check if the summoned player is still nearby
            const playerStillNearby = this.checkSummonedPlayerStillNearby();
            if (!playerStillNearby) {
                console.log(`[SocialBehavior] Summoned player left, ending summon and returning to original position`);
                this.endSummon();
            }
        } else {
            // Normal conversation ended - return to assigned space using pathfinding
            this.returnToAssignedSpace();
        }
        
        // Clear any target
        this.targetPlayerId = null;
    }

    onChatMessage(spaceName: string, message: string, senderId: number): void {
        if (!this.bot) {
            console.warn(`[SocialBehavior] onChatMessage: bot is null`);
            return;
        }

        const botId = this.bot.getBotId();
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[SocialBehavior] onChatMessage received: botId=${botId}, senderId=${senderId}, message="${message}", spaceName=${spaceName}`);
        }
        
        let conversation = this.activeConversations.get(senderId);
        
        // Start typing indicator
        this.bot?.startTyping(spaceName);

        // If no active conversation exists, create one (player initiated chat)
        if (!conversation) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] No active conversation found for player ${senderId}, creating one...`);
            }
            const config = this.config as SocialBehaviorConfig;
            this.startConversationWithPlayer(senderId, spaceName, config, botId);
            conversation = this.activeConversations.get(senderId);
            
            // If still no conversation (startConversationWithPlayer might have failed), return
            if (!conversation) {
                console.warn(`[SocialBehavior] Failed to create conversation for player ${senderId}`);
                return;
            }
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[SocialBehavior] Created conversation for player ${senderId}`);
            }
        }
        
        conversation.lastMessageTime = Date.now();
        
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
        
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[SocialBehavior] Generating AI response for player ${senderId}...`);
        }
        
        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[SocialBehavior] Error generating AI response:`, error);
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
        if (!this.bot || !this.aiService) {
            console.warn(`[SocialBehavior] Missing required services for AI response`);
            return;
        }
        
        // Get bot configuration from client (stored at spawn, no HTTP request needed)
        const botConfig = this.bot.getFullConfig();
        if (!botConfig) {
            console.error(`[SocialBehavior] Bot configuration not found for ${botId}`);
            return;
        }
        
        if (!botConfig.aiProviderRef) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.warn(`[SocialBehavior] Bot ${botId} has no AI provider configured (aiProviderRef missing). Bot config:`, {
                    botId: botConfig.botId,
                    name: botConfig.name,
                    hasAiProviderRef: !!botConfig.aiProviderRef,
                });
            }
            return;
        }
        
        const chatInstructions = botConfig.chatInstructions || 'You are a friendly bot.';
        console.log(`[SocialBehavior] Generating AI response for bot ${botId}:`, {
            aiProviderRef: botConfig.aiProviderRef,
            chatInstructions: chatInstructions.substring(0, 100) + (chatInstructions.length > 100 ? '...' : ''),
            chatInstructionsLength: chatInstructions.length,
            playerMessage: playerMessage.substring(0, 50),
        });

        // Get conversation context
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate streaming response
        let fullMessage = '';
        
        try {
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                chatInstructions,
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
                    
                    // Send complete message (WorkAdventure chat requires complete messages)
                    if (fullMessage.trim()) {
                        this.bot.sendChatMessage(spaceName, fullMessage);
                        
                        // Store in memory
                        this.conversationMemory.addMessage(botId, playerId, fullMessage, 'bot', spaceName);
                        // Store in conversation storage
                        if (this.conversationStorage) {
                            this.conversationStorage.addMessage(botId, playerId, fullMessage, 'bot');
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] AI error:`, error);
            // Stop typing indicator on error
            this.bot.stopTyping(spaceName);
            this.bot.sendChatMessage(spaceName, "I'm having trouble processing that. Could you rephrase?");
        }
    }

    /**
     * Send area arrival message to follower(s)
     * Sends one message to the space - all followers in that space will receive it
     */
    private async sendAreaArrivalMessage(areaName: string, followers: Array<{ userId: number; name?: string; position: { x: number; y: number } }>): Promise<void> {
        if (!this.bot || !this.aiService || followers.length === 0) {
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
            console.warn(`[SocialBehavior] Bot not in any space when trying to send area arrival message`);
            return;
        }

        // Get bot configuration
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            return;
        }

        const botId = this.bot.getBotId();
        
        // Find the first follower who is still nearby
        const nearbyPlayers = this.bot.getNearbyPlayers(100);
        const followerPlayer = nearbyPlayers.find(p => followers.some(f => f.userId === p.userId));
        
        if (!followerPlayer) {
            // No followers nearby, skip
            return;
        }
        
        // Set flag to prevent returnToAssignedSpace from being called while sending message
        this.isSendingGoodbye = true;
        
        try {
            // Get conversation context (use first follower for context, but message goes to all)
            const context = this.conversationMemory.getConversationContext(botId, followerPlayer.userId);
            
            // Generate arrival and goodbye message using AI
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to the ${areaName} area. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            let fullMessage = '';
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerPlayer.userId,
                arrivalPrompt,
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
                        // Send message to space - all followers in the space will receive it
                        this.bot.sendChatMessage(spaceName, fullMessage.trim());
                        // Store in memory for the first follower (representative of the group)
                        this.conversationMemory.addMessage(botId, followerPlayer.userId, fullMessage.trim(), 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] Error generating area arrival message:`, error);
        } finally {
            // Clear flag and leave the space after message is sent
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
            console.warn(`[SocialBehavior] Bot not in any space when trying to send person arrival message`);
            return;
        }

        // Get bot configuration
        const botConfig = this.bot.getFullConfig();
        if (!botConfig?.aiProviderRef) {
            return;
        }

        const botId = this.bot.getBotId();
        
        // Find the first follower who is still nearby
        const nearbyPlayers = this.bot.getNearbyPlayers(100);
        const followerPlayer = nearbyPlayers.find(p => followers.some(f => f.userId === p.userId));
        
        if (!followerPlayer) {
            // No followers nearby, skip
            return;
        }
        
        // Set flag to prevent returnToAssignedSpace from being called while sending message
        this.isSendingGoodbye = true;
        
        try {
            // Get conversation context (use first follower for context, but message goes to all)
            const context = this.conversationMemory.getConversationContext(botId, followerPlayer.userId);
            
            // Generate arrival and goodbye message using AI
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to ${personName}. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            let fullMessage = '';
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                followerPlayer.userId,
                arrivalPrompt,
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
                        // Send message to space - all followers in the space will receive it
                        this.bot.sendChatMessage(spaceName, fullMessage.trim());
                        // Store in memory for the first follower (representative of the group)
                        this.conversationMemory.addMessage(botId, followerPlayer.userId, fullMessage.trim(), 'bot', spaceName);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] Error generating person arrival message:`, error);
        } finally {
            // Clear flag and leave the space after message is sent
            this.isSendingGoodbye = false;
            await this.bot.leaveAllSpaces();
        }
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
                        if (this.bot && this.currentSpaceName === spaceName && this.activeConversations.has(playerId)) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] Error generating goodbye message:`, error);
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
        if (!botConfig?.aiProviderRef) {
            // No AI provider configured - don't send greeting
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
                botConfig.chatInstructions || 'You are a friendly bot. Respond naturally when someone approaches you.',
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
                    
                    // Send response
                    if (fullMessage.trim()) {
                        if (this.bot && this.currentSpaceName === spaceName && this.activeConversations.has(playerId)) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            // Record bot's message in memory
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
                    }
                    // After greeting, send goodbye message and return
                    this.sendGoodbyeAndReturn(spaceName, playerId, botId, 'person').catch(error => {
                        console.error(`[SocialBehavior] Error sending goodbye and returning:`, error);
                    });
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] AI leading completion greeting error:`, error);
            // Don't send fallback - just fail silently
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
        // This context includes previous conversations, emotional state, and relationship history
        // The AI will use this to remember bad interactions and respond appropriately
        const context = this.conversationMemory.getConversationContext(botId, playerId);

        // Generate natural response using AI - not a greeting, just respond naturally
        // The context will inform the AI about previous interactions, emotions, and relationship state
        let fullMessage = '';
        
        try {
            // Natural prompt: person approached, respond naturally based on context
            // The AI has access to memory (if they've met before), map context, and can assess the situation
            // It should respond naturally, not ask meta questions
            const playerMessage = 'Greet this person who just approached you.';
            
            for await (const chunk of this.aiService.generateBotResponseStream(
                botId,
                playerId,
                playerMessage,
                botConfig.chatInstructions || 'You are a friendly bot. Respond naturally when someone approaches you.',
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
                    
                    // Send response
                    if (fullMessage.trim()) {
                        if (this.bot && this.currentSpaceName === spaceName && this.activeConversations.has(playerId)) {
                            this.bot.sendChatMessage(spaceName, fullMessage.trim());
                            // Record bot's message in memory
                            this.conversationMemory.addMessage(botId, playerId, fullMessage.trim(), 'bot', spaceName);
                        }
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[SocialBehavior] AI greeting error:`, error);
            // Don't send fallback - just fail silently
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
        // BUT: Allow if bot is summoned (can leave assigned space when summoned)
        if (!this.isSummoned && !this.isWithinAssignedSpace()) {
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

        // Don't approach if already in a conversation space
        if (this.currentSpaceName || this.engagedWithUsers.size > 0) {
            return;
        }

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

        // Don't wander if already in a conversation space
        if (this.currentSpaceName || this.engagedWithUsers.size > 0) {
            return;
        }

        // Prevent multiple concurrent wander calls
        if (this.wanderInProgress) {
            return;
        }

        // If bot has assigned space and is outside it, return first
        // BUT: Allow if bot is summoned or returning (can leave assigned space when summoned/returning)
        if (!this.isSummoned && !this.isReturning && !this.isWithinAssignedSpace()) {
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
        if (emotions.personEmotion.anger > 60) {
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

