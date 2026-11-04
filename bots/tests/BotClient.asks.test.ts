/**
 * Cards in nearby chat and voice (#1658), the bot client's side: the card and replies go to one person as private events,
 * a plain line goes to everyone and is said aloud by a voice bot, and a tap counts only from a person in the bubble.
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
    const internals = bot as unknown as { spaces: Map<string, string>; bubbles: Map<string, number[]> };
    internals.spaces.set(SPACE, 'room-1_12');
    const asks = { tap: vi.fn(), personBack: vi.fn() };
    bot.setAsks(asks);
    return { bot, send, asks, internals };
}

const privateEvent = (over: Record<string, unknown> = {}) => ({
    spaceName: SPACE,
    receiverUserId: 'room-1_12',
    sender: { spaceUserId: 'room-1_7', uuid: 'uuid-khalid', tags: [] },
    spaceEvent: { event: { $case: 'botAskAnswer', botAskAnswer: { askId: 'act_1', revision: 1, tap: '{"action":"close"}' } } },
    ...over,
});
const receive = (bot: BotClient, event: unknown) => (bot as unknown as { onAskEvent: (event: unknown) => void }).onAskEvent(event);

describe('BotClient cards in nearby chat', () => {
    it('sends a card to one person, with the bot as the sender and the card as the game reads it', () => {
        const { bot, send } = setup();
        expect(bot.sendAskEvent(SPACE, 7, { kind: 'card', id: 'act_1', revision: 2, body: '{}' })).toBe(true);
        expect(send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName: SPACE,
                    receiverUserId: 'room-1_7',
                    spaceEvent: { event: { $case: 'botAsk', botAsk: { botId: 'bot-test', botName: 'Nora', kind: 'card', id: 'act_1', revision: 2, body: '{}' } } },
                },
            },
        });
    });

    it('sends nothing for a space the bot is not in', () => {
        const { bot, send } = setup();
        expect(bot.sendAskEvent('elsewhere', 7, { kind: 'reply', id: 'r1', revision: 0, body: 'x' })).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });

    it('says a line to everyone as one finished message, which a voice bot then says aloud', () => {
        const { bot, send } = setup();
        expect(bot.sayToBubble(SPACE, 'Khalid, I sent the email for you.')).toBe(true);
        const events = send.mock.calls.map((call) => call[0].message.publicEvent.spaceEvent.event.spaceStreamMessage);
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ token: 'Khalid, I sent the email for you.', isFinal: false });
        expect(events[1]).toMatchObject({ token: '', isFinal: true, finalContent: 'Khalid, I sent the email for you.' });
        expect(events[0].responseId).toBe(events[1].responseId);
        expect(bot.sayToBubble(SPACE, '  ')).toBe(false);
    });

    it('knows whether a person is in a bubble it sees', () => {
        const { bot, internals } = setup();
        expect(bot.inBubble(7)).toBe(false);
        internals.bubbles.set('b1', [7, 9]);
        expect(bot.inBubble(7)).toBe(true);
    });

    it('passes a tap from a person in its space to the cards, with who tapped from the game and not from the event', () => {
        const { bot, asks } = setup();
        receive(bot, privateEvent());
        expect(asks.tap).toHaveBeenCalledWith(bot, SPACE, 7, { askId: 'act_1', revision: 1, tap: '{"action":"close"}' });
    });

    it('ignores a tap from a bot, one meant for someone else, or one with no sender', () => {
        const { bot, asks } = setup();
        receive(bot, privateEvent({ sender: { spaceUserId: 'room-1_9', uuid: 'bot-other', tags: ['bot'] } }));
        receive(bot, privateEvent({ receiverUserId: 'room-1_99' }));
        receive(bot, privateEvent({ sender: undefined }));
        receive(bot, privateEvent({ spaceName: 'elsewhere' }));
        receive(bot, privateEvent({ spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'x' } } } }));
        expect(asks.tap).not.toHaveBeenCalled();
    });

    it('does nothing with a tap when no cards are set up', () => {
        const { bot } = setup();
        bot.setAsks(undefined);
        expect(() => receive(bot, privateEvent())).not.toThrow();
    });
});
