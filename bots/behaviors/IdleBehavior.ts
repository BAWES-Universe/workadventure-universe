/**
 * IdleBehavior - Bot stands in place and responds to interactions
 */

import { BaseBehavior, type BehaviorConfig } from './BaseBehavior';
import { PositionMessage_Direction, type SpaceUser } from '@workadventure/messages';
import { ConversationMemory } from '../memory/ConversationMemory';
import { BotClient } from '../client/BotClient';
import { parseEmotionsFromResponse, appendStreamedChunk, detectEmotionPrefixAtEnd } from '../ai/EmotionParser';
import { createBatchState, batchAppend, batchFlush } from '../ai/StreamBatcher';

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

    constructor(config: IdleBehaviorConfig) {
        super(config);
        // ConversationMemory will be set by BotManager via setConversationMemory
    }
    
    /**
     * Set user UUID in conversation memory (called from BaseBehavior when user joins space)
     */
    protected setUserUuidInMemory(botId: string, userId: number, userUuid: string, isLogged: boolean): void {
        if (this.conversationMemory && 'setUserUuid' in this.conversationMemory) {
            (this.conversationMemory as any).setUserUuid(botId, userId, userUuid, isLogged);
        }
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
        // Bot joined a conversation space - track it but defer greeting
        // Greeting is now in onMemoryReady (fires after UUID is known and memory restored)
        if (!this.bot) return;
        
        // Check if we just completed leading someone to this person
        const nearbyPlayers = this.bot.getNearbyPlayers(100);
        if (nearbyPlayers.length > 0) {
            const playerId = nearbyPlayers[0].userId;
            const botId = this.bot.getBotId();
            
            if (this.justCompletedLeading && this.justCompletedLeading.targetPersonId === playerId) {
                const followerUuid = this.justCompletedLeading.followerUuid;
                this.justCompletedLeading = null;
                
                // Check if onMemoryReady already greeted this player (addSpaceUserMessage arrived first).
                if (this.leadingGreetedPlayers.has(playerId)) {
                    return;
                }
                
                // Claim this slot — prevent onMemoryReady from also greeting this player.
                this.leadingGreetedPlayers.add(playerId);
                
                this.generateAIGreetingWithLeadingContext(spaceName, playerId, botId, followerUuid).catch(error => {
                    // Release the slot so onMemoryReady can send a fallback greeting
                    this.leadingGreetedPlayers.delete(playerId);
                    console.error(`[IdleBehavior] Error generating leading completion greeting:`, error);
                });
                return;
            }
        }
    }
    
    /**
     * Called after memory is restored for a user joining the space.
     */
    protected onMemoryReady(spaceName: string, user: SpaceUser & { id: number }): void {
        if (!this.bot) return;
        
        // If we just completed leading to this person, defer to onSpaceJoined
        // for the special leading-completion greeting with context. Otherwise
        // onMemoryReady will send a generic greeting and onSpaceJoined will see
        // the Set claimed and skip the special greeting entirely.
        if (this.justCompletedLeading && this.justCompletedLeading.targetPersonId === user.id) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] onMemoryReady: deferring to onSpaceJoined for player ${user.id} — leading-completion greeting pending`);
            }
            return;
        }
        
        // Skip if this player already received a leading-completion greeting
        // (from onSpaceJoined). Use a Set instead of justCompletedLeading flag
        // because spaceJoined and addSpaceUserMessage can arrive in any order.
        if (this.leadingGreetedPlayers.has(user.id)) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] onMemoryReady: skipping greeting for player ${user.id} — leading-completion greeting was already sent`);
            }
            this.leadingGreetedPlayers.delete(user.id);
            return;
        }
        
        // Claim this slot — prevent onSpaceJoined leading-completion from
        // also sending a greeting if addSpaceUserMessage arrived first.
        this.leadingGreetedPlayers.add(user.id);
        
        const botId = this.bot.getBotId();
        const playerId = user.id;
        
        // Generate AI greeting — memory is now restored
        this.generateAIGreeting(spaceName, playerId, botId).catch(error => {
            console.error(`[IdleBehavior] Error generating AI greeting:`, error);
        });
    }

    onSpaceLeft(spaceName: string): void {
        // Clear engagedWithUsers entries for the departing space
        for (const [userId, userData] of this.engagedWithUsers) {
            if (userData.spaceName === spaceName) {
                this.engagedWithUsers.delete(userId);
            }
        }
        // Sync isEngaged with actual map size after removals
        this.isEngaged = this.engagedWithUsers.size > 0;
        // Call super to handle base cleanup (leading state, return to assigned space, etc.)
        super.onSpaceLeft(spaceName);
    }

    async onChatMessage(spaceName: string, message: string, senderId: number, url?: string, mediaType?: string, mimeType?: string): Promise<void> {
        if (!this.bot) {
            return;
        }

        const botId = this.bot.getBotId();
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] onChatMessage: botId=${botId}, senderId=${senderId}, message="${message}", spaceName=${spaceName}`);
        }

        // If the user sent a file, use FileParser to extract content
        if (url) {
            const mType = mimeType || 'application/octet-stream';
            try {
                const { FileParser } = await import('../services/FileParser');
                const parsed = await FileParser.parseFile(url, mType);

                switch (parsed.type) {
                    case 'text':
                        message = `${message}\n[User also sent a file]\n--- BEGIN FILE CONTENT ---\n${parsed.text}\n--- END FILE CONTENT ---`;
                        break;
                    case 'image':
                        message = `${message}\n[User also sent an image: ${url}]`;
                        break;
                    case 'document':
                        message = `${message}\n[User sent a document]${parsed.text ? `\n--- BEGIN DOCUMENT CONTENT ---\n${parsed.text}\n--- END DOCUMENT CONTENT ---\n(Summary: ${parsed.summary})` : `\n(Summary: ${parsed.summary})`}`;
                        break;
                    case 'webpage':
                        message = `${message}\n[User shared a web page]${parsed.text ? `\n--- BEGIN WEB PAGE CONTENT ---\n${parsed.text}\n--- END WEB PAGE CONTENT ---\n(Summary: ${parsed.summary})` : `\n(Summary: ${parsed.summary})`}`;
                        break;
                    case 'audio':
                        message = `${message}\n[User sent an audio file — can't be played inline]`;
                        break;
                    case 'video':
                        message = `${message}\n[User sent a video file — can't be played inline]`;
                        break;
                    default:
                        message = `${message}\n[User sent a file (${mType}) — content not extracted]`;
                        break;
                }
            } catch {
                const mediaLabel = mediaType || 'file';
                message = `${message}\n[User also sent a ${mediaLabel}: ${url}]`;
            }
        }

        // Get user info from bot's player map
        const playerInfo = this.bot.getPlayerInfo(senderId);
        const userName = playerInfo?.name;
        
        // Get UUID (REQUIRED by Admin API) - should be available from InitSpaceUsersMessage or addSpaceUserMessage
        let userUuid = this.userIdToUuid.get(senderId);
        
        // Log UUID tracking status for debugging
        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[IdleBehavior] UUID lookup: senderId=${senderId}, uuid=${userUuid || 'NOT FOUND'}, mapSize=${this.userIdToUuid.size}`);
        }
        
        if (!userUuid) {
            // UUID not tracked yet - proceed anyway but log warning
            // This can happen if initSpaceUsersMessage hasn't been processed yet
            console.warn(`[IdleBehavior] UUID not found for user ${senderId} (${userName}). Proceeding without conversation storage.`);
            // Continue to generate response - just skip storage
        }
        
        // Get authentication status (for isGuest determination)
        const isLogged = this.userIdToIsLogged.get(senderId) ?? false;
        
        // Start conversation in memory if needed
        if (this.conversationMemory) {
            this.conversationMemory.startConversation(botId, senderId);
            this.conversationMemory.addMessage(botId, senderId, message, 'person', spaceName);
            this.conversationMemory.extractPersonalInfo(botId, senderId, message);
        }
        
        // Start conversation in storage (if available and UUID is known)
        if (this.conversationStorage && userUuid) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] Starting conversation storage: botId=${botId}, userUuid=${userUuid}`);
            }
            this.conversationStorage.startConversation(botId, userUuid, {
                name: userName,
                uuid: userUuid,
                isLogged: isLogged,
            });
            this.conversationStorage.addMessage(botId, userUuid, message, 'person').catch(error => {
                if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                    console.error('[IdleBehavior] Error adding person message to conversation storage:', error);
                }
            });
        } else if (!this.conversationStorage) {
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] conversationStorage is null - conversations will not be persisted`);
            }
        }

        // Start typing indicator
        this.bot?.startTyping(spaceName);

        // Generate AI response
        this.generateAIResponseStream(spaceName, senderId, message, botId).catch(error => {
            console.error(`[IdleBehavior] Error generating AI response:`, error);
            // Stop typing indicator on error
            this.bot?.stopTyping(spaceName);
            // Send fallback message via stream for consistent UX
            const errId = `bot-${botId}-player-${senderId}-${crypto.randomUUID()}`;
            this.bot?.sendStreamMessage(spaceName, errId, "I'm having trouble processing that. Could you rephrase?", true, "I'm having trouble processing that. Could you rephrase?");
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
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';

        // Generate streaming response
        let fullMessage = '';
        const startTime = Date.now(); // Track response time BEFORE streaming starts
        let tokensUsed = 0;
        let latency = 0;
        // Batch chunks to ~100ms to avoid flooding the event pipeline
        let lastBatchTime = 0;
        const BATCH_MS = 100;
        // Unique ID for this streamed response — used by frontend to correlate chunks
        let responseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
        // Track whether the model has started generating the emotion block at the end
        // of the response. Once detected, stop streaming chunks to prevent raw partial
        // tags like "[EMOTION_UPDATE]" from displaying in the chat bubble.
        let emotionBlockStarted = false;
        // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
        let pendingPrefix = '';
        const batchState = createBatchState();
        const sendBatch = (text: string) => {
            this.bot?.sendStreamMessage(spaceName, responseId, text, false);
        };

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
                if (chunk.reset) {
                    batchFlush(batchState, sendBatch);
                    // Tool calls overrode streamed pre-tool content — finalize current bubble
                    // only if there was pre-tool text. If the model went straight to tool calls,
                    // skip the empty bubble entirely.
                    if (fullMessage) {
                        // Strip any deferred '[' that was not streamed to the frontend
                        const finalContent = pendingPrefix ? fullMessage.slice(0, -pendingPrefix.length) : fullMessage;
                        this.bot?.sendStreamMessage(spaceName, responseId, '', true, finalContent);
                    }
                    responseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                    fullMessage = '';
                    emotionBlockStarted = false;
                    pendingPrefix = '';
                    // Show tool names as separate bubbles — one per tool call invocation
                    if (chunk.toolNames?.length) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            for (let ti = 0; ti < chunk.toolNames.length; ti++) {
                                const toolStatus = `🔍 ${chunk.toolNames[ti]}...`;
                                responseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                                fullMessage = toolStatus;
                                this.bot?.sendStreamMessage(spaceName, responseId, toolStatus, false);
                                // Finalize the tool-name bubble so it doesn't linger in
                                // the frontend's streamMessages map.
                                this.bot?.sendStreamMessage(spaceName, responseId, '', true, toolStatus);
                            }
                        }
                        // Create a new responseId for follow-up content so it appears
                        // in its own bubble instead of merging into the last tool-name bubble.
                        responseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                        fullMessage = ''; // Clear so follow-up content starts fresh
                    }
                    continue;
                }

                if (chunk.content) {
                    fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                    // Once the model starts generating the [EMOTION_UPDATE] block
                    // (always at the end of every response), stop streaming chunks
                    // to the frontend — partial tags show as raw text.
                    if (emotionBlockStarted) {
                        continue;
                    }
                    // Check for [EM both within current chunk AND across chunk boundaries.
                    // With true per-chunk streaming, the provider may split [EMOTION_UPDATE]
                    // across two tokens (e.g. "[" then "EMOTION_UPDATE]...").
                    const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                    const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                    if (emInChunk || emInFull) {
                        emotionBlockStarted = true;
                        pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                        if (emInChunk) {
                            const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                            const beforeEmotion = chunk.content.substring(0, emotionIdx);
                            if (beforeEmotion.trim()) {
                                batchFlush(batchState, sendBatch);
                                this.bot?.sendStreamMessage(spaceName, responseId, beforeEmotion, false);
                            }
                        }
                        // else: [EM spans chunk boundary — the "[" was already sent in a
                        // prior chunk. Don't send anything extra, just stop forwarding.
                        continue;
                    }

                    /*
                     * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                     * With per-chunk streaming, the provider may split the tag at any
                     * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                     * matching suffix until we can confirm or reject the full tag.
                     */
                    const combinedContent = pendingPrefix + chunk.content;
                    const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                    if (deferredLen > 0) {
                        pendingPrefix = combinedContent.slice(-deferredLen);
                        const contentToStream = combinedContent.slice(0, -deferredLen);
                        if (contentToStream) {
                            this.bot?.sendStreamMessage(spaceName, responseId, contentToStream, false);
                        }
                        continue;
                    }

                    // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                    const contentToStream = pendingPrefix + chunk.content;
                    pendingPrefix = '';

                    // Stream each content chunk directly to the frontend as it arrives
                    this.bot?.sendStreamMessage(spaceName, responseId, contentToStream, false);
                }

                // Extract token usage from chunk metadata
                if (chunk.metadata?.tokensUsed) {
                    tokensUsed = chunk.metadata.tokensUsed;
                }
                if (chunk.metadata?.latency) {
                    latency = chunk.metadata.latency;
                }

                if (chunk.done) {
                    batchFlush(batchState, sendBatch);
                    // Stop typing indicator
                    this.bot?.stopTyping(spaceName);

                    // Calculate response time (use latency from metadata if available, otherwise calculate)
                    const responseTime = latency || (Date.now() - startTime);

                    // Parse emotions from AI response (unified emotion system)
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let processedMessage = parsedResponse.cleanedResponse;

                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && processedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }

                    if (this.responseProcessor && processedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        // Pass responseTime and tokenUsage to ResponseProcessor so it can include them in ONE metric record
                        const tokenUsage = tokensUsed > 0 ? {
                            prompt: chunk.metadata?.promptTokens || Math.floor(tokensUsed * 0.7),
                            completion: chunk.metadata?.completionTokens || Math.floor(tokensUsed * 0.3),
                            total: tokensUsed
                        } : undefined;

                        // Note: Emotions already parsed above, use processedMessage (cleaned response)
                        let processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            processedMessage,
                            chatInstructions,
                            responseTime,
                            tokenUsage
                        );
                        processedMessage = processed.cleaned;

                        // If high repetition detected (score >= 0.85), block and regenerate (up to 3 attempts)
                        // Lower threshold catches near-duplicates like "*snorts* response" vs "*grunts* response"
                        let regenerationAttempts = 0;
                        const maxRegenerationAttempts = 3;
                        const repetitionThreshold = 0.85; // Block at 85% similarity, not just exact duplicates
                        let currentRepetitionScore = processed.metrics.repetitionScore;
                        let currentMessage = fullMessage;

                        while (currentRepetitionScore >= repetitionThreshold && regenerationAttempts < maxRegenerationAttempts) {
                            regenerationAttempts++;
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[IdleBehavior] ⚠️ High repetition (${(currentRepetitionScore * 100).toFixed(0)}%) detected for bot ${botId}, player ${playerId} (attempt ${regenerationAttempts}/${maxRegenerationAttempts}). Blocking response: "${currentMessage.substring(0, 50)}..."`);
                            }

                            // BLOCK the duplicate - clear frontend buffer and start fresh
                            this.bot?.sendStreamMessage(spaceName, responseId, '', false, undefined, false, undefined, true);

                            // Instead, generate a new response with explicit anti-repetition instruction
                            const urgency = regenerationAttempts > 1 ? `ATTEMPT ${regenerationAttempts} - ` : '';
                            const antiRepetitionPrompt = `${chatInstructions}\n\n${urgency}CRITICAL: You just said "${currentMessage.substring(0, 100)}". DO NOT repeat this. Give a COMPLETELY DIFFERENT response. Use different words and structure.`;

                            // Regenerate with anti-repetition prompt
                            let regeneratedMessage = '';
                            try {
                                let emotionBlockStarted = false;
                                // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
                                let pendingPrefix = '';
                                for await (const chunk of this.aiService.generateBotResponseStream(
                                    botId,
                                    playerId,
                                    playerMessage + ` [IMPORTANT: Give a COMPLETELY DIFFERENT response- attempt ${regenerationAttempts}]`,
                                    antiRepetitionPrompt,
                                    botConfig.aiProviderRef,
                                    spaceName,
                                    context,
                                    this.bot,
                                    this.adminApiService
                                )) {
                                    if (chunk.reset) {
                                        this.bot?.sendStreamMessage(spaceName, responseId, '', false, undefined, false, undefined, true);
                                        regeneratedMessage = '';
                                        emotionBlockStarted = false;
                                        pendingPrefix = '';
                                        continue;
                                    }

                                    if (chunk.content) {
                                        regeneratedMessage = appendStreamedChunk(regeneratedMessage, chunk.content);

                                        if (emotionBlockStarted) {
                                            continue;
                                        }
                                        const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                                        const emInFull = regeneratedMessage.includes('[EMOTION_UPDATE');
                                        if (emInChunk || emInFull) {
                                            emotionBlockStarted = true;
                                            pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                                            if (emInChunk) {
                                                const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                                                const beforeEmotion = chunk.content.substring(0, emotionIdx);
                                                if (beforeEmotion.trim()) {
                                                    this.bot?.sendStreamMessage(spaceName, responseId, beforeEmotion, false);
                                                }
                                            }
                                            continue;
                                            }

                                            /*
                                             * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                                             * With per-chunk streaming, the provider may split the tag at any
                                             * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                                             * matching suffix until we can confirm or reject the full tag.
                                             */
                                            const combinedContent = pendingPrefix + chunk.content;
                                            const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                                            if (deferredLen > 0) {
                                                pendingPrefix = combinedContent.slice(-deferredLen);
                                                const contentToStream = combinedContent.slice(0, -deferredLen);
                                                if (contentToStream) {
                                                    this.bot?.sendStreamMessage(spaceName, responseId, contentToStream, false);
                                                }
                                                continue;
                                            }

                                            // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                                            const contentToStream = pendingPrefix + chunk.content;
                                            pendingPrefix = '';

                                            this.bot?.sendStreamMessage(spaceName, responseId, contentToStream, false);
                                            }
                                            if (chunk.done) {
                                            break;
                                            }
                                            }

                                    // Parse emotions from regenerated response
                                const regeneratedParsed = parseEmotionsFromResponse(regeneratedMessage);

                                // Update emotions from regenerated response
                                if (regeneratedParsed.emotions && this.conversationMemory) {
                                    this.conversationMemory.updateEmotionsFromAI(botId, playerId, regeneratedParsed.emotions);
                                }

                                // Process the regenerated response
                                if (regeneratedParsed.cleanedResponse.trim() && this.responseProcessor) {
                                    // Use the same responseTime and tokenUsage from the original response
                                    const reprocessed = this.responseProcessor.processResponse(
                                        botId,
                                        playerId,
                                        regeneratedParsed.cleanedResponse,
                                        chatInstructions,
                                        responseTime, // Use original response time
                                        tokenUsage    // Use original token usage
                                    );
                                    processedMessage = reprocessed.cleaned;
                                    currentRepetitionScore = reprocessed.metrics.repetitionScore;
                                    currentMessage = regeneratedParsed.cleanedResponse;
                                    processed = reprocessed; // Update processed for next iteration check

                                    if (currentRepetitionScore < 1.0) {
                                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                            console.log(`[IdleBehavior] ✅ Regenerated response after blocking duplicate (attempt ${regenerationAttempts})`);
                                        }
                                    }
                                } else {
                                    // Fallback if regeneration fails - don't break, try again
                                    continue;
                                }
                            } catch (error) {
                                console.error(`[IdleBehavior] Error regenerating response after duplicate:`, error);
                                // Clear pending batch timer to prevent stale partial content from leaking
                                if (batchState.timer) {
                                    clearTimeout(batchState.timer);
                                    batchState.timer = null;
                                }
                                batchState.buffer = '';
                                // Don't break, try again if attempts remaining
                                continue;
                            }
                        }

                        // If still too similar after max attempts, use a varied fallback
                        if (currentRepetitionScore >= repetitionThreshold && regenerationAttempts >= maxRegenerationAttempts) {
                            console.warn(`[IdleBehavior] ⚠️ Still duplicate after ${maxRegenerationAttempts} attempts, using fallback and clearing context`);
                            // Use varied fallbacks to avoid repetition loop
                            const fallbacks = [
                                "Hmm, let me approach this differently.",
                                "Interesting point. Let me think...",
                                "That's something to consider.",
                                "I hear you.",
                                "Alright then.",
                                "Fair enough.",
                                "I see what you mean.",
                                "Got it.",
                            ];
                            processedMessage = fallbacks[Math.floor(Math.random() * fallbacks.length)];
                            // Clear recent responses to break the repetition cycle
                            if (this.responseProcessor) {
                                this.responseProcessor.clearRecentResponses(botId, playerId);
                            }
                        }

                        if (processed.metrics.repetitionScore > 0.8 && processed.metrics.repetitionScore < 1.0) {
                            // High repetition (but not exact duplicate) - warn but allow
                            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                console.warn(`[IdleBehavior] ⚠️ High repetition detected (${(processed.metrics.repetitionScore * 100).toFixed(1)}%) for bot ${botId}, player ${playerId}`);
                            }
                        }
                    }

                    // Record metrics (skip for test conversations - playerId 999999 is used for tests)
                    // ResponseProcessor already records responseQuality which includes these metrics
                    // We only need to record responseTime and tokenUsage if they're not already in responseQuality
                    // For now, skip individual metrics - they're already captured in recordResponseQuality
                    // This prevents duplicate metrics (3 per response -> 1 per response)

                    // Send processed message via stream final chunk — always send even if empty (to close bubble)
                    if (processedMessage.trim()) {
                        // Send the final chunk with the complete cleaned message
                        this.bot?.sendStreamMessage(spaceName, responseId, '', true, processedMessage);

                        // Store bot's message in memory
                        if (this.conversationMemory) {
                            this.conversationMemory.addMessage(botId, playerId, processedMessage, 'bot', spaceName);
                        }
                        // Store bot's message in conversation storage
                        if (this.conversationStorage) {
                            const userUuid = this.userIdToUuid.get(playerId);
                            if (userUuid) {
                                this.conversationStorage.addMessage(botId, userUuid, processedMessage, 'bot').catch(error => {
                                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                        console.error('[IdleBehavior] Error adding bot message to conversation storage:', error);
                                    }
                                });
                            }
                        }
                    } else {
                        // Response contained only emotion/control blocks — finalize with empty content to close bubble
                        this.bot?.sendStreamMessage(spaceName, responseId, '', true, '');
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI error:`, error);
            // Stop typing indicator on error
            this.bot?.stopTyping(spaceName);
            // Finalize the stream as error instead of sending a separate chat message
            this.bot?.sendStreamMessage(spaceName, responseId, '', false, '', true, "I'm having trouble processing that. Could you rephrase?");
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

        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';
        const destinationText = destinationType === 'person' ? 'this person' : 'the destination';
        
        let fullMessage = '';
        let goodbyeResponseId: string | undefined;
        try {
            const goodbyePrompt = `You've arrived at ${destinationText}. It was nice talking to them. Say goodbye and that you'll see them soon.`;

            goodbyeResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
            let emotionBlockStarted = false;
            // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
            let pendingPrefix = '';
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
                if (chunk.reset) {
                    if (fullMessage) {
                        const finalContent = pendingPrefix ? fullMessage.slice(0, -pendingPrefix.length) : fullMessage;
                        this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, '', true, finalContent);
                    }
                    goodbyeResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                    fullMessage = '';
                    emotionBlockStarted = false;
                    pendingPrefix = '';
                    if (chunk.toolNames?.length) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            for (let ti = 0; ti < chunk.toolNames.length; ti++) {
                                const toolStatus = `🔍 ${chunk.toolNames[ti]}...`;
                                goodbyeResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                                fullMessage = toolStatus;
                                this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, toolStatus, false);
                                this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, '', true, toolStatus);
                            }
                        }
                        goodbyeResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                        fullMessage = '';
                    }
                    continue;
                }
                if (chunk.content) {
                    fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                    // Stop forwarding when emotion block starts
                    if (emotionBlockStarted) {
                        continue;
                    }
                    const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                    const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                    if (emInChunk || emInFull) {
                        emotionBlockStarted = true;
                        pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                        if (emInChunk) {
                            const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                            const beforeEmotion = chunk.content.substring(0, emotionIdx);
                            if (beforeEmotion.trim()) {
                                this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, beforeEmotion, false);
                            }
                        }
                        continue;
                    }

                    /*
                     * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                     * With per-chunk streaming, the provider may split the tag at any
                     * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                     * matching suffix until we can confirm or reject the full tag.
                     */
                    const combinedContent = pendingPrefix + chunk.content;
                    const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                    if (deferredLen > 0) {
                        pendingPrefix = combinedContent.slice(-deferredLen);
                        const contentToStream = combinedContent.slice(0, -deferredLen);
                        if (contentToStream) {
                            this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, contentToStream, false);
                        }
                        continue;
                    }

                    // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                    const contentToStream = pendingPrefix + chunk.content;
                    pendingPrefix = '';

                    // Forward chunk to frontend
                    this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, contentToStream, false);
                }

                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;

                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        if (this.bot) {
                            this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, '', true, cleanedMessage.trim());
                            if (this.conversationMemory) {
                                this.conversationMemory.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
                            }
                            // Store bot's message in conversation storage
                            if (this.conversationStorage) {
                                const userUuid = this.userIdToUuid.get(playerId);
                                if (userUuid) {
                                    this.conversationStorage.addMessage(botId, userUuid, cleanedMessage.trim(), 'bot').catch(error => {
                                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                                            console.error('[IdleBehavior] Error adding bot message to conversation storage:', error);
                                        }
                                    });
                                }
                            }
                        }
                    } else {
                        this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, '', true, '');
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating goodbye message:`, error);
            this.bot?.sendStreamMessage(spaceName, goodbyeResponseId, '', true, '');
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
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';

        let fullMessage = '';
        let greetingResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;

        try {
            // Special prompt for leading completion
            const leadingContext = followerUuid === 'group' 
                ? 'You just guided a group of people to this person. They asked about them. Let them know you\'ve brought the people who wanted to talk with them.'
                : 'You just guided someone to this person. They asked about them. Let them know you\'ve brought the person who wanted to talk with them.';

            const playerMessage = leadingContext;

            // Start typing indicator
            this.bot?.startTyping(spaceName);

            let emotionBlockStarted = false;
            // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
            let pendingPrefix = '';
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
                    fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                    // Stop forwarding when emotion block starts
                    if (emotionBlockStarted) {
                        continue;
                    }
                    const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                    const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                    if (emInChunk || emInFull) {
                        emotionBlockStarted = true;
                        pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                        if (emInChunk) {
                            const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                            const beforeEmotion = chunk.content.substring(0, emotionIdx);
                            if (beforeEmotion.trim()) {
                                this.bot?.sendStreamMessage(spaceName, greetingResponseId, beforeEmotion, false);
                            }
                        }
                        continue;
                    }

                    /*
                     * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                     * With per-chunk streaming, the provider may split the tag at any
                     * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                     * matching suffix until we can confirm or reject the full tag.
                     */
                    const combinedContent = pendingPrefix + chunk.content;
                    const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                    if (deferredLen > 0) {
                        pendingPrefix = combinedContent.slice(-deferredLen);
                        const contentToStream = combinedContent.slice(0, -deferredLen);
                        if (contentToStream) {
                            this.bot?.sendStreamMessage(spaceName, greetingResponseId, contentToStream, false);
                        }
                        continue;
                    }

                    // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                    const contentToStream = pendingPrefix + chunk.content;
                    pendingPrefix = '';

                    // Forward chunk to frontend
                    this.bot?.sendStreamMessage(spaceName, greetingResponseId, contentToStream, false);
                }

                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot. Respond naturally when someone approaches you.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    // Send response
                    if (cleanedMessage.trim()) {
                        if (this.bot) {
                            this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, cleanedMessage.trim());
                            // Store bot's message in memory
                            if (this.conversationMemory) {
                                this.conversationMemory.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
                            }
                        }
                    } else {
                        this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, '');
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
            this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, '');
        } finally {
            // Stop typing indicator regardless of how the stream ended
            this.bot?.stopTyping(spaceName);
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
        
        let arrivalResponseId = '';
        let fullMessage = '';
        let emotionBlockStarted = false;
        
        try {
            const context = this.conversationMemory?.getConversationContext(botId, followerUserId) || '';
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to the ${areaName} area. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            // Start typing indicator
            this.bot?.startTyping(spaceName);
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] sendAreaArrivalMessage: Generating AI response...`);
            }

            arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
            let emotionBlockStarted = false;
            // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
            let pendingPrefix = '';
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
                    if (chunk.reset) {
                        if (fullMessage) {
                            const finalContent = pendingPrefix ? fullMessage.slice(0, -pendingPrefix.length) : fullMessage;
                            this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, finalContent);
                        }
                        arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                        fullMessage = '';
                        emotionBlockStarted = false;
                        pendingPrefix = '';
                        if (chunk.toolNames?.length) {
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                for (let ti = 0; ti < chunk.toolNames.length; ti++) {
                                    const toolStatus = `🔍 ${chunk.toolNames[ti]}...`;
                                    arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                                    fullMessage = toolStatus;
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, toolStatus, false);
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, toolStatus);
                                }
                            }
                            arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                            fullMessage = '';
                        }
                        continue;
                    }
                    if (chunk.content) {
                        fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                        if (emotionBlockStarted) {
                            continue;
                        }
                        const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                        const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                        if (emInChunk || emInFull) {
                            emotionBlockStarted = true;
                            pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                            if (emInChunk) {
                                const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                                const beforeEmotion = chunk.content.substring(0, emotionIdx);
                                if (beforeEmotion.trim()) {
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, beforeEmotion, false);
                                }
                            }
                            continue;
                        }

                        /*
                         * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                         * With per-chunk streaming, the provider may split the tag at any
                         * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                         * matching suffix until we can confirm or reject the full tag.
                         */
                        const combinedContent = pendingPrefix + chunk.content;
                        const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                        if (deferredLen > 0) {
                            pendingPrefix = combinedContent.slice(-deferredLen);
                            const contentToStream = combinedContent.slice(0, -deferredLen);
                            if (contentToStream) {
                                this.bot?.sendStreamMessage(spaceName, arrivalResponseId, contentToStream, false);
                            }
                            continue;
                        }

                        // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                        const contentToStream = pendingPrefix + chunk.content;
                        pendingPrefix = '';

                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, contentToStream, false);
                    }

                    if (chunk.done) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendAreaArrivalMessage: Stream completed`);
                    }
                    
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, followerUserId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, followerUserId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            followerUserId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] sendAreaArrivalMessage: Sending message to space: "${cleanedMessage.trim()}"`);
                        }
                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, cleanedMessage.trim());
                        if (this.conversationMemory) {
                            this.conversationMemory.addMessage(botId, followerUserId, cleanedMessage.trim(), 'bot', spaceName);
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[IdleBehavior] sendAreaArrivalMessage: Generated message is empty`);
                        }
                        // Finalize with empty content to prevent stream leak on frontend
                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, '');
                    }
                    break;
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (!fullMessage.trim()) {
                    console.warn(`[IdleBehavior] sendAreaArrivalMessage: Stream ended without chunk.done=true or message is empty`);
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating area arrival message:`, error);
            this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, '');
        } finally {
            // Stop typing indicator regardless of how the stream ended
            this.bot?.stopTyping(spaceName);
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
        
        let arrivalResponseId = '';
        let fullMessage = '';
        let emotionBlockStarted = false;
        
        try {
            const context = this.conversationMemory?.getConversationContext(botId, followerUserId) || '';
            const arrivalPrompt = `You just guided ${followers.length > 1 ? 'a group of people' : 'someone'} to ${personName}. Let them know you've arrived at the destination, it was nice talking to them, and you'll see them soon. Then say goodbye.`;
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] sendPersonArrivalMessage: Generating AI response...`);
            }

            // Start typing indicator
            this.bot?.startTyping(spaceName);

            arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
            let emotionBlockStarted = false;
            // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
            let pendingPrefix = '';
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
                    if (chunk.reset) {
                        if (fullMessage) {
                            const finalContent = pendingPrefix ? fullMessage.slice(0, -pendingPrefix.length) : fullMessage;
                            this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, finalContent);
                        }
                        arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                        fullMessage = '';
                        emotionBlockStarted = false;
                        pendingPrefix = '';
                        if (chunk.toolNames?.length) {
                            if (process.env.ENABLE_BOT_DEBUG === 'true') {
                                for (let ti = 0; ti < chunk.toolNames.length; ti++) {
                                    const toolStatus = `🔍 ${chunk.toolNames[ti]}...`;
                                    arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                                    fullMessage = toolStatus;
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, toolStatus, false);
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, toolStatus);
                                }
                            }
                            arrivalResponseId = `bot-${botId}-player-${followerUserId}-${crypto.randomUUID()}`;
                            fullMessage = '';
                        }
                        continue;
                    }
                    if (chunk.content) {
                        fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                        if (emotionBlockStarted) {
                            continue;
                        }
                        const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                        const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                        if (emInChunk || emInFull) {
                            emotionBlockStarted = true;
                            pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                            if (emInChunk) {
                                const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                                const beforeEmotion = chunk.content.substring(0, emotionIdx);
                                if (beforeEmotion.trim()) {
                                    this.bot?.sendStreamMessage(spaceName, arrivalResponseId, beforeEmotion, false);
                                }
                            }
                            continue;
                        }

                        /*
                         * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                         * With per-chunk streaming, the provider may split the tag at any
                         * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                         * matching suffix until we can confirm or reject the full tag.
                         */
                        const combinedContent = pendingPrefix + chunk.content;
                        const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                        if (deferredLen > 0) {
                            pendingPrefix = combinedContent.slice(-deferredLen);
                            const contentToStream = combinedContent.slice(0, -deferredLen);
                            if (contentToStream) {
                                this.bot?.sendStreamMessage(spaceName, arrivalResponseId, contentToStream, false);
                            }
                            continue;
                        }

                        // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                        const contentToStream = pendingPrefix + chunk.content;
                        pendingPrefix = '';

                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, contentToStream, false);
                    }

                    if (chunk.done) {
                    if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                        console.log(`[IdleBehavior] sendPersonArrivalMessage: Stream completed`);
                    }
                    
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, followerUserId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, followerUserId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            followerUserId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    if (cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] sendPersonArrivalMessage: Sending message: "${cleanedMessage.trim()}"`);
                        }
                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, cleanedMessage.trim());
                        if (this.conversationMemory) {
                            this.conversationMemory.addMessage(botId, followerUserId, cleanedMessage.trim(), 'bot', spaceName);
                        }
                    } else {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.warn(`[IdleBehavior] sendPersonArrivalMessage: Generated message is empty`);
                        }
                        // Finalize with empty content to prevent stream leak on frontend
                        this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, '');
                    }
                    break;
                }
            }
            
            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                if (!fullMessage.trim()) {
                    console.warn(`[IdleBehavior] sendPersonArrivalMessage: Stream ended without chunk.done=true or message is empty`);
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] Error generating person arrival message:`, error);
            this.bot?.sendStreamMessage(spaceName, arrivalResponseId, '', true, '');
        } finally {
            // Stop typing indicator regardless of how the stream ended
            this.bot?.stopTyping(spaceName);
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
        const context = this.conversationMemory?.getConversationContext(botId, playerId) || '';
        const playerName = this.resolvePlayerName(botId, playerId, this.conversationMemory);

        // Generate natural response using AI - not a greeting, just respond naturally
        let fullMessage = '';
        let greetingResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;

        try {
            // Natural prompt: person approached, respond naturally based on context
            // The AI has access to memory (if they've met before), map context, and can assess the situation
            // It should respond naturally, not ask meta questions
            // Use a more direct prompt that encourages a greeting, not a meta-response
            const hasContext = context.length > 0;

            if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                console.log(`[IdleBehavior] generateAIGreeting: context.length=${context.length}, hasContext=${hasContext}`);
                if (hasContext) {
                    console.log(`[IdleBehavior] Context preview: ${context.substring(0, 200)}...`);
                }
            }

            const playerMessage = hasContext
                ? playerName
                    ? `${playerName} just approached you. ⚠️ CRITICAL: This is NOT your first meeting with them. You have history — past conversations, shared experiences, and a relationship. DO NOT treat this like meeting a stranger or someone new. Greet them based on your shared memories and past interactions, naturally like greeting someone familiar.`
                    : `They just approached you again. ⚠️ CRITICAL: This is NOT your first meeting with them. You have history — past conversations, shared experiences, and a relationship. DO NOT treat this like meeting a stranger or someone new. Greet them based on your shared memories and past interactions, naturally like greeting someone familiar.`
                : playerName
                    ? `${playerName} just approached you. Greet them naturally.`
                    : `Someone just approached you. Greet them naturally.`;

            // Start typing indicator
            this.bot?.startTyping(spaceName);

            let emotionBlockStarted = false;
            // Deferred '[' that may be the start of [EMOTION_UPDATE] across chunk boundaries
            let pendingPrefix = '';
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
                if (chunk.reset) {
                    // Only finalize the pre-tool bubble if there was actual text
                    if (fullMessage) {
                        // Strip any deferred '[' that was not streamed to the frontend
                        const finalContent = pendingPrefix ? fullMessage.slice(0, -pendingPrefix.length) : fullMessage;
                        this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, finalContent);
                    }
                    greetingResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                    fullMessage = '';
                    emotionBlockStarted = false;
                    pendingPrefix = '';
                    if (chunk.toolNames?.length) {
                        if (process.env.ENABLE_BOT_DEBUG === 'true') {
                            for (let ti = 0; ti < chunk.toolNames.length; ti++) {
                                const toolStatus = `🔍 ${chunk.toolNames[ti]}...`;
                                greetingResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                                fullMessage = toolStatus;
                                this.bot?.sendStreamMessage(spaceName, greetingResponseId, toolStatus, false);
                                // Finalize the tool-name bubble so it does not linger
                                this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, toolStatus);
                            }
                        }
                        greetingResponseId = `bot-${botId}-player-${playerId}-${crypto.randomUUID()}`;
                        fullMessage = '';
                    }
                    continue;
                }
                if (chunk.content) {
                    fullMessage = appendStreamedChunk(fullMessage, chunk.content);

                    // Stop forwarding when emotion block starts
                    if (emotionBlockStarted) {
                        continue;
                    }
                    const emInChunk = chunk.content.includes('[EMOTION_UPDATE');
                    const emInFull = fullMessage.includes('[EMOTION_UPDATE');
                    if (emInChunk || emInFull) {
                        emotionBlockStarted = true;
                        pendingPrefix = ''; // discard — it's part of [EMOTION_UPDATE]
                        if (emInChunk) {
                            const emotionIdx = chunk.content.indexOf('[EMOTION_UPDATE');
                            const beforeEmotion = chunk.content.substring(0, emotionIdx);
                            if (beforeEmotion.trim()) {
                                this.bot?.sendStreamMessage(spaceName, greetingResponseId, beforeEmotion, false);
                            }
                        }
                        continue;
                    }

                    /*
                     * Check if chunk ends with a prefix of [EMOTION_UPDATE.
                     * With per-chunk streaming, the provider may split the tag at any
                     * character boundary (e.g. "[EMOTIO" / "N_UPDATE..."). Defer the
                     * matching suffix until we can confirm or reject the full tag.
                     */
                    const combinedContent = pendingPrefix + chunk.content;
                    const deferredLen = detectEmotionPrefixAtEnd(combinedContent);
                    if (deferredLen > 0) {
                        pendingPrefix = combinedContent.slice(-deferredLen);
                        const contentToStream = combinedContent.slice(0, -deferredLen);
                        if (contentToStream) {
                            this.bot?.sendStreamMessage(spaceName, greetingResponseId, contentToStream, false);
                        }
                        continue;
                    }

                    // Flush any previously deferred prefix — not the start of [EMOTION_UPDATE]
                    const contentToStream = pendingPrefix + chunk.content;
                    pendingPrefix = '';

                    // Forward chunk to frontend
                    this.bot?.sendStreamMessage(spaceName, greetingResponseId, contentToStream, false);
                }

                if (chunk.done) {
                    // Parse emotions and clean the message
                    const parsedResponse = parseEmotionsFromResponse(fullMessage);
                    let cleanedMessage = parsedResponse.cleanedResponse;
                    
                    // Update emotions from AI analysis
                    if (parsedResponse.emotions && this.conversationMemory) {
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, parsedResponse.emotions);
                    } else if (!parsedResponse.emotions && this.conversationMemory && cleanedMessage.trim()) {
                        if (process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true') {
                            console.log(`[IdleBehavior] AI omitted emotion block, using neutral fallback`);
                        }
                        this.conversationMemory.updateEmotionsFromAI(botId, playerId, {
                            personSentiment: 0,
                            isInsult: false,
                            insultSeverity: 0,
                            context: 'neutral',
                        });
                    }
                    
                    // Clean with ResponseProcessor if available
                    if (this.responseProcessor && cleanedMessage.trim()) {
                        const chatInstructions = botConfig.chatInstructions || 'You are a helpful bot. Respond naturally when someone approaches you.';
                        const processed = this.responseProcessor.processResponse(
                            botId,
                            playerId,
                            cleanedMessage,
                            chatInstructions
                        );
                        cleanedMessage = processed.cleaned;
                    }
                    
                    // Send response
                    if (cleanedMessage.trim()) {
                        if (this.bot) {
                            this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, cleanedMessage.trim());
                            // Store bot's message in memory
                            if (this.conversationMemory) {
                                this.conversationMemory.addMessage(botId, playerId, cleanedMessage.trim(), 'bot', spaceName);
                            }
                        }
                    } else {
                        this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, '');
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[IdleBehavior] AI greeting error:`, error);
            this.bot?.sendStreamMessage(spaceName, greetingResponseId, '', true, '');
        } finally {
            // Stop typing indicator regardless of how the stream ended
            this.bot?.stopTyping(spaceName);
        }
    }
}

