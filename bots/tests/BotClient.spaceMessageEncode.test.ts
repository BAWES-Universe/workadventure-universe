import { describe, expect, it, vi } from 'vitest';
import { ClientToServerMessage } from '@workadventure/messages';

/**
 * What the bot says in nearby chat is encoded before it is sent: every message it builds must encode, or the bot
 * drops it without a word (a list field left out makes the encoder throw).
 */
describe('a nearby chat message the bot sends', () => {
    it('encodes, as text, as a file and as a gallery', async () => {
        const { BotClient } = await import('../client/BotClient');
        const client = Object.create(BotClient.prototype) as InstanceType<typeof BotClient>;
        const send = vi.fn();
        Object.assign(client, { behavior: {}, config: { botId: 'bot-1', name: 'Guide' }, spaces: new Map([['space-1', 7]]), send });

        client.sendChatMessage('space-1', 'hello');
        client.sendMediaMessage('space-1', 'https://cdn.example.com/a.mp3', 'audio', 'audio/mpeg');
        client.sendMediaGallery('space-1', ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'], 'two');

        expect(send).toHaveBeenCalledTimes(3);
        for (const [message] of send.mock.calls) {
            expect(() => ClientToServerMessage.encode(message).finish()).not.toThrow();
        }
    });
});
