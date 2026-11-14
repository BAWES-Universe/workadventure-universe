/**
 * A Brick that walks beside someone says so on the map (#2005): its player carries a `visiting:<name>` tag, which the
 * game reads for the line under its name and for its card. A Brick that is not visiting carries nothing extra.
 */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { BotClient } from '../client/BotClient';
import type { BotConfiguration } from '../server/AdminApiService';

function tagsOf(
  visiting?: { ownerUuid: string; ownerName: string },
  voiceEnabled?: boolean
): string[] {
  const bot = new BotClient({
    botId: 'brick-1',
    name: 'Brick',
    roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
    pusherUrl: 'http://play.example.test',
    position: { x: 100, y: 100 },
    viewport: { top: 0, bottom: 600, left: 0, right: 800 },
    characterTextureIds: [],
  });
  bot.setFullConfig({
    botId: 'brick-1',
    voiceEnabled,
    brick: { ownerId: 'u1', isDefault: true, visiting },
  } as unknown as BotConfiguration);
  const token = (
    bot as unknown as { generateBotToken(): string }
  ).generateBotToken();
  return (jwt.decode(token) as { tags: string[] }).tags;
}

describe('the tag of a visiting Brick', () => {
  it('names the person it walks with', () => {
    expect(tagsOf({ ownerUuid: 'khalid-uuid', ownerName: 'Khalid' })).toEqual([
      'bot',
      'visiting:Khalid',
    ]);
  });

  it('carries nothing extra when it is not visiting', () => {
    expect(tagsOf(undefined)).toEqual(['bot']);
  });

  it('keeps the voice tag next to it, and a long or untidy name short and on one line', () => {
    expect(tagsOf({ ownerUuid: 'u', ownerName: 'Dana' }, true)).toEqual([
      'bot',
      'voice-bot',
      'visiting:Dana',
    ]);
    const long = tagsOf({
      ownerUuid: 'u',
      ownerName: `  Dana\n${'x'.repeat(80)}`,
    });
    expect(long[1]).toBe(`visiting:Dana ${'x'.repeat(35)}`);
    expect(long[1].length).toBeLessThanOrEqual('visiting:'.length + 40);
  });

  it('leaves a blank name out rather than tag nothing', () => {
    expect(tagsOf({ ownerUuid: 'u', ownerName: '   ' })).toEqual(['bot']);
  });
});
