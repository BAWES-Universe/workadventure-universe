/**
 * Free greetings (approved by Khalid 10 Nov 2026): a bot greets a person each time they come, the greeting costs them nothing and is
 * text only, never a voice reply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';
import { greetingReplyId, isGreetingReply } from '../client/GreetingReply';
import type { BotAccessGate } from '../server/BotAccessGate';

const SPACE = 'room-space';

describe('a greeting reply id', () => {
    it('is told apart from any other reply, and still names the person it is for', () => {
        const id = greetingReplyId('bot-1', 7);
        expect(isGreetingReply(id)).toBe(true);
        expect(/-player-(\d+)-/.exec(id)?.[1]).toBe('7');
        expect(isGreetingReply(`bot-bot-1-player-7-${crypto.randomUUID()}`)).toBe(false);
        expect(isGreetingReply(`bot-bot-1-say-${crypto.randomUUID()}`)).toBe(false);
    });
});

function botWith(options: { voice?: boolean; access?: 'allowed' | 'refused' } = {}) {
    const bot = new BotClient({
        botId: 'bot-1',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const behavior = {
        getPersonForAccess: vi.fn().mockReturnValue({ signedIn: true, identifier: 'wa-sara' }),
        // Kept only to show it is no longer asked: a greeting does not depend on the person's replies left
        mayGreetWithinAllowance: vi.fn().mockResolvedValue(false),
    };
    (bot as unknown as { behavior: unknown }).behavior = behavior;
    vi.spyOn(bot, 'isVoiceBot').mockReturnValue(options.voice ?? false);
    const verdict = options.access === 'refused' ? { allowed: false, kind: 'refused', code: 'not_allowed', line: 'Sorry.' } : { allowed: true, kind: 'allowed' };
    bot.setAccessGate({ check: vi.fn().mockResolvedValue(verdict) } as unknown as BotAccessGate);
    vi.spyOn(bot, 'sendChatMessage').mockImplementation(() => undefined);
    const speech = { final: vi.fn(), begin: vi.fn() };
    const inner = bot as unknown as { spaces: Map<string, string>; speech: unknown; send: (message: unknown) => void };
    inner.spaces.set(SPACE, 'room_1');
    inner.speech = speech;
    inner.send = vi.fn();
    return { bot, behavior, speech };
}

describe('a bot deciding whether to greet someone who walks up', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('greets them each time they come back', async () => {
        const { bot } = botWith();
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
    });

    it("greets a voice bot's visitor whatever replies they have left: a greeting is free for them", async () => {
        const { bot, behavior } = botWith({ voice: true });
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
        expect(behavior.mayGreetWithinAllowance).not.toHaveBeenCalled();
    });

    it('does not greet a person the owner refused', async () => {
        const { bot } = botWith({ access: 'refused' });
        expect(await bot.mayGreet(SPACE, 7)).toBe(false);
    });
});

describe('a greeting is never a voice reply', () => {
    it('stays in the chat and is never handed to the voice, while an ordinary reply still is', () => {
        const { bot, speech } = botWith({ voice: true });
        const greeting = greetingReplyId('bot-1', 7);
        bot.sendStreamMessage(SPACE, greeting, 'Hello ', false);
        bot.sendStreamMessage(SPACE, greeting, '', true, 'Hello Sara.');
        expect(speech.begin).not.toHaveBeenCalled();
        expect(speech.final).not.toHaveBeenCalled();
        const reply = `bot-bot-1-player-7-${crypto.randomUUID()}`;
        bot.sendStreamMessage(SPACE, reply, '', true, 'Here you go.');
        expect(speech.final).toHaveBeenCalledWith(SPACE, reply, 'Here you go.');
    });
});
