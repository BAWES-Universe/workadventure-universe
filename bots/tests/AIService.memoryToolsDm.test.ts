/** The memory tools are the person's own, in their direct message: a turn said anywhere else never runs them (game #2003, #1993). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';
import { ConversationMemory } from '../memory/ConversationMemory';
import { heardInDm } from '../memory/Heard';
import { openToolGate } from './helpers/openToolGate';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

function setup() {
    const memory = new ConversationMemory();
    memory.useHeard(() => heardInDm());
    memory.addMessage('bot1', 7, 'I love coffee, no sugar', 'person', 'dm');
    const forget = vi.fn(async () => 0);
    (memory as unknown as { forgetThings: unknown }).forgetThings = forget;
    const ai = openToolGate(new AIService(null!, null!, ''));
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = memory;
    return { ai, forget };
}

const remember = { id: 'm1', name: 'what_i_remember', arguments: '{}' };
const forgetCall = { id: 'm2', name: 'forget_memory', arguments: JSON.stringify({ about: 'coffee' }) };

describe('the memory tools are run only in a direct message', () => {
    it('runs them in the direct message', async () => {
        const { ai } = setup();
        const [result] = await ai['executeToolCalls']([remember], undefined, undefined, undefined, 'uuid-7', 'matrix-dm', 'bot1', 7, undefined, undefined, false, undefined, undefined, undefined, false, false, false, undefined, 'dm');
        expect((result.result as { things?: unknown[] }).things?.length).toBeGreaterThan(0);
    });

    it('does not run them in a turn said anywhere else, even with no body in the room (a shared voice turn), whatever the model asks for', async () => {
        const { ai, forget } = setup();
        for (const channel of [undefined, 'world'] as const) {
            const results = await ai['executeToolCalls']([remember, forgetCall], undefined, undefined, undefined, 'uuid-7', 'some-space', 'bot1', 7, undefined, undefined, false, undefined, undefined, undefined, false, false, false, undefined, channel);
            for (const { result } of results) expect((result as { things?: unknown }).things).toBeUndefined();
        }
        expect(forget).not.toHaveBeenCalled();
    });
});
