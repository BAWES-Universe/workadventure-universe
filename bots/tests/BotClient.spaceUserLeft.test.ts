/**
 * The game tells a bot who left a bubble by their space user id ("room_7") alone. The behavior must be told the
 * number in it, or it never forgets them and a summoned bot is never sent back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotClient } from '../client/BotClient';

function setup() {
    const bot = new BotClient({
        botId: 'bot-1',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const behavior = { onSpaceUserLeft: vi.fn(), onPlayerLeft: vi.fn(), getConfiguredFacing: vi.fn(), setBot: vi.fn() };
    bot.setBehavior(behavior as never);
    const receive = (message: unknown) =>
        (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage(message);
    return { behavior, receive };
}

describe('BotClient: someone leaves a bubble', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('tells the behavior the number of the person who left', async () => {
        const { behavior, receive } = setup();
        await receive({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: 's', spaceUserId: 'room_7' } });
        expect(behavior.onSpaceUserLeft).toHaveBeenCalledWith('s', 7);
    });
});
