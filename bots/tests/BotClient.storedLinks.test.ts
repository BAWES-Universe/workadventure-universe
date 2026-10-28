/**
 * A file sent again (#1508) is already in storage: its link goes out as it is, never downloaded and uploaded again.
 */
import { describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';

function bot() {
    return new BotClient({
        botId: 'bot-test',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
        uploaderUrl: 'http://uploader.internal',
    });
}

describe('BotClient links to files already in storage', () => {
    it('sends a stored link as it is, and fetches any other link to upload it', async () => {
        const client = bot();
        const fetchMediaBuffer = vi.spyOn(client as never, 'fetchMediaBuffer').mockRejectedValue(new Error('fetched') as never);
        const upload = (url: string) => (client as unknown as { uploadMedia: (url: string, mime?: string) => Promise<{ location: string }> }).uploadMedia(url, 'audio/mpeg');
        client.markStored('https://cdn.example.com/song.mp3');
        await expect(upload('https://cdn.example.com/song.mp3')).resolves.toMatchObject({ location: 'https://cdn.example.com/song.mp3' });
        expect(fetchMediaBuffer).not.toHaveBeenCalled();
        await expect(upload('https://elsewhere.example.com/song.mp3')).rejects.toThrow('fetched');
    });

    it('goes out as what it is when its link has no extension to tell', async () => {
        const client = bot();
        const sent = vi.spyOn(client as never, 'sendMediaMessage').mockReturnValue(true as never);
        client.markStored('https://cdn.example.com/files/7f3a?sig=x');
        await client.sendAudio('bubble-1', 'https://cdn.example.com/files/7f3a?sig=x', undefined, 'audio/mpeg');
        expect(sent).toHaveBeenCalledWith('bubble-1', 'https://cdn.example.com/files/7f3a?sig=x', 'audio', 'audio/mpeg', undefined, undefined, undefined);
    });
});
