/**
 * BotClient - Headless WebSocket client for WorkAdventure bots
 * 
 * This client connects to WorkAdventure using the same protocol as browser clients,
 * allowing bots to fully participate in the game world.
 */

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
    ClientToServerMessage,
    ServerToClientMessage,
    UserMovesMessage,
    PositionMessage_Direction,
    JoinSpaceRequestMessage,
    LeaveSpaceRequestMessage,
    FilterType,
    UpdateSpaceUserMessage,
    SpaceUser,
    apiVersionHash,
} from '@workadventure/messages';
import type { PositionInterface, ViewportInterface } from '../../play/src/front/Connection/ConnexionModels';
import { BotState } from './BotState';
import type { BaseBehavior } from '../behaviors/BaseBehavior';

// Get the secret key from environment - must match pusher's SECRET_KEY
const SECRET_KEY = process.env.SECRET_KEY || 'default-secret-key';

export interface BotConfig {
    botId: string;
    name: string;
    roomUrl: string;
    pusherUrl: string;
    position: PositionInterface;
    viewport: ViewportInterface;
    characterTextureIds: string[];
    companionTextureId?: string;
    token?: string;
}

export class BotClient {
    private ws: WebSocket | null = null;
    private state: BotState;
    private behavior: BaseBehavior | null = null;
    private userId: number | null = null;
    private connected: boolean = false;
    private spaces: Map<string, SpaceUser['spaceUserId']> = new Map();
    private players: Map<number, PlayerInfo> = new Map();
    private queryId: number = 0;
    private pendingQueries: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();

    constructor(private config: BotConfig) {
        this.state = new BotState(config.position);
    }

    /**
     * Generate a JWT token for this bot
     */
    private generateBotToken(): string {
        // Generate a unique identifier for this bot
        const botIdentifier = `bot-${this.config.botId}`;
        
        // Create a JWT token matching the AuthTokenData schema
        const tokenData = {
            identifier: botIdentifier,
            username: this.config.name,
            tags: ['bot'],
        };
        
        return jwt.sign(tokenData, SECRET_KEY, { expiresIn: '30d' });
    }

    /**
     * Connect to WorkAdventure server
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL('ws/room', this.config.pusherUrl);
            url.protocol = url.protocol.replace('http', 'ws');

            const params = url.searchParams;
            params.set('roomId', this.config.roomUrl);
            params.set('name', this.config.name);
            for (const textureId of this.config.characterTextureIds) {
                params.append('characterTextureIds', textureId);
            }
            params.set('x', Math.floor(this.config.position.x).toString());
            params.set('y', Math.floor(this.config.position.y).toString());
            params.set('top', Math.floor(this.config.viewport.top).toString());
            params.set('bottom', Math.floor(this.config.viewport.bottom).toString());
            params.set('left', Math.floor(this.config.viewport.left).toString());
            params.set('right', Math.floor(this.config.viewport.right).toString());
            if (this.config.companionTextureId) {
                params.set('companionTextureId', this.config.companionTextureId);
            }
            params.set('availabilityStatus', '0'); // ONLINE
            params.set('version', apiVersionHash); // Imported from @workadventure/messages
            params.set('chatID', '');
            params.set('roomName', '');
            params.set('cameraState', 'false');
            params.set('microphoneState', 'false');
            params.set('screenSharingState', 'false');

            // Generate bot token for authentication
            const token = this.config.token || this.generateBotToken();
            const subProtocols = [token];

            console.log(`[Bot ${this.config.botId}] Connecting to: ${url.toString()}`);
            console.log(`[Bot ${this.config.botId}] Using token: ${token.substring(0, 50)}...`);
            this.ws = new WebSocket(url.toString(), subProtocols);
            this.ws.binaryType = 'arraybuffer';

            this.ws.on('open', () => {
                console.log(`[Bot ${this.config.botId}] Connected successfully`);
                this.connected = true;
                resolve();
            });

            this.ws.on('error', (error) => {
                console.error(`[Bot ${this.config.botId}] WebSocket error:`, error);
                reject(error);
            });

            this.ws.on('close', (code: number, reason: Buffer) => {
                const reasonStr = reason ? reason.toString() : 'No reason provided';
                console.log(`[Bot ${this.config.botId}] Disconnected - Code: ${code}, Reason: ${reasonStr}`);
                this.connected = false;
            });

            this.ws.on('message', (data: ArrayBuffer) => {
                this.handleMessage(data);
            });

            // Handle ping/pong for keepalive
            this.ws.on('ping', (data: Buffer) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.pong(data);
                }
            });
        });
    }

    /**
     * Disconnect from server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    /**
     * Set behavior for this bot
     */
    setBehavior(behavior: BaseBehavior): void {
        this.behavior = behavior;
        behavior.setBot(this);
    }

    /**
     * Update bot (called every frame/tick)
     */
    update(deltaTime: number): void {
        if (!this.connected || !this.behavior) {
            return;
        }

        // Update behavior
        this.behavior.update(deltaTime);

        // Update position if changed
        const newPosition = this.state.getPosition();
        if (newPosition.x !== this.config.position.x || newPosition.y !== this.config.position.y) {
            this.sendPosition(newPosition, this.state.getDirection(), this.state.isMoving());
            this.config.position = newPosition;
        }
    }

    /**
     * Move bot to position
     */
    moveTo(x: number, y: number, direction: PositionMessage_Direction = PositionMessage_Direction.DOWN): void {
        this.state.setPosition({ x, y });
        this.state.setDirection(direction);
        this.state.setMoving(true);
    }

    /**
     * Stop moving
     */
    stop(): void {
        this.state.setMoving(false);
    }

    /**
     * Send chat message to space
     */
    sendChatMessage(spaceName: string, message: string): void {
        const spaceUserId = this.spaces.get(spaceName);
        if (!spaceUserId) {
            console.warn(`[Bot ${this.config.botId}] Not in space ${spaceName}`);
            return;
        }

        this.send({
            message: {
                $case: 'updateSpaceUserMessage',
                updateSpaceUserMessage: {
                    spaceName,
                    message: {
                        message,
                    },
                },
            },
        });
    }

    /**
     * Get player information
     */
    getPlayerInfo(playerId: number): PlayerInfo | undefined {
        return this.players.get(playerId);
    }

    /**
     * Get all nearby players
     */
    getNearbyPlayers(radius: number): PlayerInfo[] {
        const botPos = this.state.getPosition();
        return Array.from(this.players.values()).filter((player) => {
            const dx = player.position.x - botPos.x;
            const dy = player.position.y - botPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance <= radius;
        });
    }

    /**
     * Teleport bot to a new position instantly
     */
    teleportTo(x: number, y: number): void {
        this.state.setPosition({ x, y });
        this.config.position = { x, y };
        this.sendPosition(this.state.getPosition(), this.state.getDirection(), false);
        console.log(`[Bot ${this.config.botId}] Teleported to (${x}, ${y})`);
    }

    /**
     * Update bot configuration (position, behavior config, etc.)
     */
    updateConfig(updates: {
        position?: { x: number; y: number };
        behaviorConfig?: Record<string, unknown>;
    }): void {
        if (updates.position) {
            this.teleportTo(updates.position.x, updates.position.y);
        }

        // Behavior config updates are handled by BotManager which creates new behavior
        console.log(`[Bot ${this.config.botId}] Config updated`);
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get bot ID
     */
    getBotId(): string {
        return this.config.botId;
    }

    /**
     * Get user ID (assigned by server)
     */
    getUserId(): number | null {
        return this.userId;
    }

    /**
     * Get bot state
     */
    getState(): BotState {
        return this.state;
    }

    /**
     * Handle incoming WebSocket message
     */
    private handleMessage(data: ArrayBuffer): void {
        try {
            const message = ServerToClientMessage.decode(new Uint8Array(data));
            const msg = message.message;
            if (!msg) return;

            switch (msg.$case) {
                case 'batchMessage':
                    for (const subMessage of msg.batchMessage.payload) {
                        this.handleSubMessage(subMessage.message);
                    }
                    break;
                default:
                    this.handleSubMessage(msg);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error handling message:`, error);
        }
    }

    private handleSubMessage(message: ServerToClientMessage['message']): void {
        if (!message) return;

        switch (message.$case) {
            case 'roomJoinedMessage':
                this.userId = message.roomJoinedMessage.currentUserId;
                console.log(`[Bot ${this.config.botId}] Joined room, userId: ${this.userId}`);
                break;

            case 'userJoinedMessage':
                this.players.set(message.userJoinedMessage.userId, {
                    userId: message.userJoinedMessage.userId,
                    name: message.userJoinedMessage.name,
                    position: {
                        x: message.userJoinedMessage.position?.x ?? 0,
                        y: message.userJoinedMessage.position?.y ?? 0,
                    },
                    availabilityStatus: message.userJoinedMessage.availabilityStatus ?? 0,
                });
                break;

            case 'userMovedMessage':
                const player = this.players.get(message.userMovedMessage.userId);
                if (player && message.userMovedMessage.position) {
                    player.position = {
                        x: message.userMovedMessage.position.x,
                        y: message.userMovedMessage.position.y,
                    };
                    if (this.behavior) {
                        this.behavior.onPlayerMoved(message.userMovedMessage.userId, player.position);
                    }
                }
                break;

            case 'userLeftMessage':
                this.players.delete(message.userLeftMessage.userId);
                break;

            case 'groupUpdateMessage':
                if (this.behavior) {
                    this.behavior.onGroupJoined(message.groupUpdateMessage.groupId, message.groupUpdateMessage.userIds);
                }
                break;

            case 'joinSpaceRequestMessage':
                this.handleJoinSpaceRequest(message.joinSpaceRequestMessage);
                break;

            case 'leaveSpaceRequestMessage':
                this.handleLeaveSpaceRequest(message.leaveSpaceRequestMessage);
                break;

            case 'addSpaceUserMessage':
                if (this.behavior) {
                    this.behavior.onSpaceUserJoined(message.addSpaceUserMessage.spaceName, message.addSpaceUserMessage.user);
                }
                break;

            case 'updateSpaceUserMessage':
                if (message.updateSpaceUserMessage.message) {
                    const chatMessage = message.updateSpaceUserMessage.message.message;
                    if (chatMessage && this.behavior) {
                        this.behavior.onChatMessage(
                            message.updateSpaceUserMessage.spaceName,
                            chatMessage,
                            message.updateSpaceUserMessage.userId ?? 0
                        );
                    }
                }
                break;

            case 'removeSpaceUserMessage':
                if (this.behavior) {
                    this.behavior.onSpaceUserLeft(message.removeSpaceUserMessage.spaceName, message.removeSpaceUserMessage.userId);
                }
                break;

            case 'errorMessage':
                console.error(`[Bot ${this.config.botId}] Server error:`, message.errorMessage.message);
                break;

            case 'errorScreenMessage':
                console.error(`[Bot ${this.config.botId}] Server error screen:`, JSON.stringify(message.errorScreenMessage, null, 2));
                break;

            case 'answerMessage':
                this.handleAnswer(message.answerMessage);
                break;

            case 'pingMessage':
                // Respond to server ping to keep connection alive
                this.sendPong();
                break;
        }
    }

    /**
     * Send pong response to server ping
     */
    private sendPong(): void {
        this.send({
            message: {
                $case: 'pingMessage',
                pingMessage: {},
            },
        });
    }

    private async handleJoinSpaceRequest(request: JoinSpaceRequestMessage): Promise<void> {
        // Skip ALL proximity/bubble/jitsi spaces for bots
        // These trigger media connections (audio/video) which bots don't support
        // This prevents the loading indicator showing for bot cameras
        const isProximitySpace = request.spaceName.includes('proximity') || 
                                  request.spaceName.includes('bubble') ||
                                  request.spaceName.includes('jitsi');
        
        if (isProximitySpace) {
            console.log(`[Bot ${this.config.botId}] Skipping proximity/media space: ${request.spaceName}`);
            return;
        }

        try {
            // Default filterType to ALL_USERS (0) if not provided
            const filterType = request.filterType ?? FilterType.ALL_USERS;
            const propertiesToSync = request.propertiesToSync || [];
            
            const spaceUserId = await this.emitJoinSpace(request.spaceName, filterType, propertiesToSync);
            this.spaces.set(request.spaceName, spaceUserId);
            if (this.behavior) {
                this.behavior.onSpaceJoined(request.spaceName);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error joining space:`, error);
        }
    }

    private async handleLeaveSpaceRequest(request: LeaveSpaceRequestMessage): Promise<void> {
        try {
            await this.emitLeaveSpace(request.spaceName);
            this.spaces.delete(request.spaceName);
            if (this.behavior) {
                this.behavior.onSpaceLeft(request.spaceName);
            }
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error leaving space:`, error);
        }
    }

    private async emitJoinSpace(spaceName: string, filterType: FilterType, propertiesToSync: string[]): Promise<SpaceUser['spaceUserId']> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'joinSpaceQuery',
                            joinSpaceQuery: {
                                spaceName,
                                filterType,
                                propertiesToSync,
                            },
                        },
                    },
                },
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Join space timeout'));
                }
            }, 10000);
        });
    }

    private async emitLeaveSpace(spaceName: string): Promise<void> {
        const queryId = ++this.queryId;
        return new Promise((resolve, reject) => {
            this.pendingQueries.set(queryId, { resolve, reject });

            this.send({
                message: {
                    $case: 'queryMessage',
                    queryMessage: {
                        id: queryId,
                        query: {
                            $case: 'leaveSpaceQuery',
                            leaveSpaceQuery: {
                                spaceName,
                            },
                        },
                    },
                },
            });

            setTimeout(() => {
                if (this.pendingQueries.has(queryId)) {
                    this.pendingQueries.delete(queryId);
                    reject(new Error('Leave space timeout'));
                }
            }, 10000);
        });
    }

    private handleAnswer(answer: any): void {
        const query = this.pendingQueries.get(answer.id);
        if (query) {
            this.pendingQueries.delete(answer.id);
            if (answer.answer?.$case === 'joinSpaceAnswer') {
                query.resolve(answer.answer.joinSpaceAnswer.spaceUserId);
            } else if (answer.answer?.$case === 'leaveSpaceAnswer') {
                query.resolve(undefined);
            } else {
                query.reject(new Error('Unexpected answer type'));
            }
        }
    }

    private sendPosition(position: PositionInterface, direction: PositionMessage_Direction, moving: boolean): void {
        // Safety checks for undefined values
        const x = position?.x ?? 0;
        const y = position?.y ?? 0;
        const top = this.config.viewport?.top ?? 0;
        const bottom = this.config.viewport?.bottom ?? 1000;
        const left = this.config.viewport?.left ?? 0;
        const right = this.config.viewport?.right ?? 1000;
        
        // Ensure direction is a valid enum value
        const safeDirection = typeof direction === 'number' ? direction : PositionMessage_Direction.DOWN;

        // Check for NaN values
        if (isNaN(x) || isNaN(y)) {
            console.warn(`[Bot ${this.config.botId}] Invalid position: x=${x}, y=${y}`);
            return;
        }

        this.send({
            message: {
                $case: 'userMovesMessage',
                userMovesMessage: {
                    position: {
                        x: Math.floor(x),
                        y: Math.floor(y),
                        direction: safeDirection,
                        moving: !!moving,
                    },
                    viewport: {
                        top: Math.floor(top),
                        bottom: Math.floor(bottom),
                        left: Math.floor(left),
                        right: Math.floor(right),
                    },
                },
            },
        });
    }

    private send(message: ClientToServerMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            const encoded = ClientToServerMessage.encode(message).finish();
            this.ws.send(encoded);
        } catch (error) {
            console.error(`[Bot ${this.config.botId}] Error sending message:`, error);
        }
    }
}

interface PlayerInfo {
    userId: number;
    name: string;
    position: PositionInterface;
    availabilityStatus: number;
}

