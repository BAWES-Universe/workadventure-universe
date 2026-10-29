import { describe, expect, it, vi } from 'vitest';
import { AIService } from '../ai/AIService';

vi.mock('../client/BotClient', () => ({ BotClient: vi.fn() }));

function service(memory: Record<string, unknown>) {
    const ai = new AIService(null!, null!, '');
    (ai as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => memory };
    return ai;
}

// Six songs from one reply, each its own tool step, as Imagine Music made them (#1544)
const songs = Array.from({ length: 6 }, (_, i) => [
    { id: `t${i}`, name: 'generate_music', result: { status: 'completed', url: `https://bot-gens.example.com/song-${i}.mp3` } },
]);

describe('files a reply makes', () => {
    it('are all kept, in order, when a direct message sends them with its reply', () => {
        const memory = { pendingMedia: [] as Array<{ url: string }>, maxPendingMedia: 5 };
        const ai = service(memory);
        for (const step of songs) ai['preQueueToolResults'](step, new Set(), 'bot1', 7, true);
        expect(memory.pendingMedia.map((item) => item.url)).toEqual(songs.map(([tr]) => tr.result.url));
    });

    it('still stop at the waiting-list limit in nearby chat, where they are sent as they are made', () => {
        const memory = { pendingMedia: [] as Array<{ url: string }>, maxPendingMedia: 5 };
        const ai = service(memory);
        for (const step of songs) ai['preQueueToolResults'](step, new Set(), 'bot1', 7);
        expect(memory.pendingMedia).toHaveLength(5);
    });

    it('are kept once each, even when a tool returns the same file again', () => {
        const memory = { pendingMedia: [] as Array<{ url: string }>, maxPendingMedia: 5 };
        const ai = service(memory);
        ai['preQueueToolResults'](songs[0], new Set(), 'bot1', 7, true);
        ai['preQueueToolResults'](songs[0], new Set(), 'bot1', 7, true);
        expect(memory.pendingMedia).toHaveLength(1);
    });
});
