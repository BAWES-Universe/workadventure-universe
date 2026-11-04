/**
 * A pick on a question card goes to the bot as what the person said (game #1661), but only if Orbit still lets them chat
 * with the bot: the owner may have limited it since the card was shown.
 */
import { describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';

function setup(verdict: { allowed: boolean; kind: string; line?: string }, options: { inBubble?: boolean; meeting?: boolean } = {}) {
    const bot = new BotClient({
        botId: 'abc',
        name: 'Echo',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const onChatMessage = vi.fn(async () => undefined);
    const check = vi.fn(async () => verdict);
    const sendChatMessage = vi.fn();
    const internals = bot as unknown as Record<string, any>;
    internals.behavior = { onChatMessage, getPersonForAccess: () => ({ signedIn: true, identifier: 'u1' }) };
    internals.spaces = new Map([['space-1', 'room_9']]);
    internals.accessGate = { check };
    internals.inBubble = () => options.inBubble ?? true;
    internals.isMeetingSpace = () => options.meeting ?? false;
    internals.sendChatMessage = sendChatMessage;
    return { bot, onChatMessage, check, sendChatMessage };
}

describe('answerFromCard', () => {
    it('hands the pick to the bot when the person may chat with it', async () => {
        const s = setup({ allowed: true, kind: 'allowed' });
        expect(await s.bot.answerFromCard('space-1', 7, 'My answer')).toBe(true);
        expect(s.check).toHaveBeenCalledWith('abc', 'chat', expect.anything(), 'Echo');
        expect(s.onChatMessage).toHaveBeenCalledWith('space-1', 'My answer', 7);
    });

    it('does not hand it on, and says the owner\'s line once, when the person may no longer chat', async () => {
        const s = setup({ allowed: false, kind: 'refused', line: 'Only members can chat with Echo.' });
        expect(await s.bot.answerFromCard('space-1', 7, 'My answer')).toBe(false);
        expect(await s.bot.answerFromCard('space-1', 7, 'My answer')).toBe(false);
        expect(s.onChatMessage).not.toHaveBeenCalled();
        expect(s.sendChatMessage).toHaveBeenCalledTimes(1);
        expect(s.sendChatMessage).toHaveBeenCalledWith('space-1', 'Only members can chat with Echo.');
    });

    it('does not hand it on when the check can not be made', async () => {
        const s = setup({ allowed: false, kind: 'cannot_check', line: "I can't check that right now." });
        expect(await s.bot.answerFromCard('space-1', 7, 'x')).toBe(false);
        expect(s.onChatMessage).not.toHaveBeenCalled();
    });

    it('does nothing for a person who left the bubble, or in a meeting room', async () => {
        const left = setup({ allowed: true, kind: 'allowed' }, { inBubble: false });
        expect(await left.bot.answerFromCard('space-1', 7, 'x')).toBe(false);
        const meeting = setup({ allowed: true, kind: 'allowed' }, { meeting: true });
        expect(await meeting.bot.answerFromCard('space-1', 7, 'x')).toBe(false);
        expect(left.onChatMessage).not.toHaveBeenCalled();
        expect(meeting.onChatMessage).not.toHaveBeenCalled();
    });
});
