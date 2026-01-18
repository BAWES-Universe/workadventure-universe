/**
 * ConversationReplay - Records and replays conversations for testing
 * 
 * Features:
 * - Record real conversations for replay
 * - Replay conversations with different prompt versions
 * - Compare original vs new responses
 * - Identify problematic conversations automatically
 */

import type { RegressionTest } from './types';
import { BotTestRunner } from './BotTestRunner';

export interface ConversationRecord {
    botId: string;
    playerId: number;
    conversationId: string;
    messages: Array<{
        sender: 'bot' | 'person';
        message: string;
        timestamp: number;
    }>;
    chatInstructions: string;
    startedAt: number;
    endedAt: number;
}

export class ConversationReplay {
    private testRunner: BotTestRunner;
    private recordedConversations: Map<string, ConversationRecord> = new Map();

    constructor(testRunner: BotTestRunner) {
        this.testRunner = testRunner;
    }

    /**
     * Record a conversation for later replay
     */
    recordConversation(record: ConversationRecord): void {
        this.recordedConversations.set(record.conversationId, record);
    }

    /**
     * Get a recorded conversation
     */
    getRecordedConversation(conversationId: string): ConversationRecord | undefined {
        return this.recordedConversations.get(conversationId);
    }

    /**
     * Get all recorded conversations for a bot
     */
    getRecordedConversationsForBot(botId: string): ConversationRecord[] {
        return Array.from(this.recordedConversations.values())
            .filter(record => record.botId === botId);
    }

    /**
     * Convert a recorded conversation to a regression test
     */
    convertToRegressionTest(record: ConversationRecord, expectedResponse?: string): RegressionTest {
        return {
            id: `regression-${record.conversationId}`,
            name: `Replay: ${record.conversationId}`,
            conversationHistory: record.messages,
            expectedResponse,
            botId: record.botId,
            chatInstructions: record.chatInstructions,
            createdAt: record.startedAt,
        };
    }

    /**
     * Replay a recorded conversation with new chat instructions
     */
    async replayConversation(
        conversationId: string,
        newChatInstructions?: string
    ): Promise<{
        originalResponse?: string;
        newResponse: string;
        differences: string[];
    }> {
        const record = this.recordedConversations.get(conversationId);
        if (!record) {
            throw new Error(`Conversation ${conversationId} not found`);
        }

        // Get the last bot response as expected (if available)
        const lastBotMessage = record.messages
            .filter(m => m.sender === 'bot')
            .pop()?.message;

        const regressionTest = this.convertToRegressionTest(record, lastBotMessage);
        return await this.testRunner.replayConversation(regressionTest, newChatInstructions);
    }

    /**
     * Identify problematic conversations (e.g., those with errors, long response times, etc.)
     */
    identifyProblematicConversations(botId: string, criteria?: {
        minErrors?: number;
        minResponseTime?: number;
        hasSystemPromptLeakage?: boolean;
        hasRepetition?: boolean;
    }): ConversationRecord[] {
        const records = this.getRecordedConversationsForBot(botId);
        
        // For now, return all conversations
        // In a real implementation, we would analyze each conversation
        // and filter based on criteria
        return records;
    }

    /**
     * Clear recorded conversations (for cleanup)
     */
    clearRecordedConversations(botId?: string): void {
        if (botId) {
            // Clear only for specific bot
            for (const [id, record] of this.recordedConversations.entries()) {
                if (record.botId === botId) {
                    this.recordedConversations.delete(id);
                }
            }
        } else {
            // Clear all
            this.recordedConversations.clear();
        }
    }
}
