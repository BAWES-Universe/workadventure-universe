/**
 * The reply limit card in nearby chat (#1159): sent to the one person who reached the limit, as a private event in the
 * bot's space, with the bot's own id and name so the game can draw the card.
 */
import { describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';

const SPACE = 'room-space';

function setup() {
    const bot = new BotClient({
        botId: 'bot-test',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const send = vi.fn();
    Object.assign(bot as unknown as { send: unknown }, { send });
    return { bot, send, spaces: (bot as unknown as { spaces: Map<string, string> }).spaces };
}

const CARD = { limit: 'universe-ai', resetsAt: '2026-10-27T20:20:00.000Z', who: 'member' };

describe('BotClient reply limit card', () => {
    it('sends the card only to the person, in the space they talked in', () => {
        const { bot, send, spaces } = setup();
        spaces.set(SPACE, 'room-1_12');
        bot.sendReplyLimitCard(SPACE, 7, CARD);
        expect(send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName: SPACE,
                    receiverUserId: 'room-1_7',
                    spaceEvent: { event: { $case: 'botReplyLimit', botReplyLimit: { ...CARD, botId: 'bot-test', botName: 'Nora' } } },
                },
            },
        });
    });

    it('sends nothing for a space the bot is not in', () => {
        const { bot, send } = setup();
        bot.sendReplyLimitCard(SPACE, 7, CARD);
        expect(send).not.toHaveBeenCalled();
    });
});
