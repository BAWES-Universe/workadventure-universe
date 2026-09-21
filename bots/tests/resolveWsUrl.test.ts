/**
 * Tests for BotManager.resolveWsUrl — the WebSocket endpoint handed to bot clients.
 *
 * Covers:
 *  - WS_URL unset or empty (docker compose passes an empty string): falls back to the pusher URL
 *  - absolute WS_URL: kept, normalized to http(s) so BotClient can switch to ws(s)
 *  - root-relative WS_URL: resolved against the pusher URL instead of throwing TypeError: Invalid URL
 *  - the resulting value is a valid base for the bot client's `ws/room` URL
 */
import { describe, expect, it } from 'vitest';
import { resolveWsUrl } from '../utils/resolveWsUrl';

const PUSHER_URL = 'http://play.workadventure.localhost';

describe('resolveWsUrl', () => {
    it('falls back to the pusher URL when WS_URL is not set', () => {
        expect(resolveWsUrl(undefined, PUSHER_URL)).toBe(PUSHER_URL);
    });

    it('falls back to the pusher URL when WS_URL is an empty string', () => {
        expect(resolveWsUrl('', PUSHER_URL)).toBe(PUSHER_URL);
    });

    it('keeps an absolute WS_URL, normalized to http(s)', () => {
        expect(resolveWsUrl('wss://ws.example.com/', PUSHER_URL)).toBe('https://ws.example.com/');
        expect(resolveWsUrl('ws://ws.example.com/', PUSHER_URL)).toBe('http://ws.example.com/');
    });

    it('resolves a root-relative WS_URL against the pusher URL instead of throwing', () => {
        expect(resolveWsUrl('/', PUSHER_URL)).toBe('http://play.workadventure.localhost/');
        expect(resolveWsUrl('/socket/', PUSHER_URL)).toBe('http://play.workadventure.localhost/socket/');
    });

    it('resolves a relative WS_URL against a pusher URL given as ws://', () => {
        expect(resolveWsUrl('/socket/', 'ws://pusher:8080')).toBe('http://pusher:8080/socket/');
    });

    it('normalizes a ws:// pusher URL used as the fallback', () => {
        expect(resolveWsUrl(undefined, 'ws://pusher:8080')).toBe('http://pusher:8080');
    });

    it('returns a base the bot client can build ws/room on', () => {
        for (const base of [resolveWsUrl('wss://ws.example.com/', PUSHER_URL), resolveWsUrl(undefined, PUSHER_URL)]) {
            const url = new URL('ws/room', base);
            url.protocol = url.protocol.replace('http', 'ws');
            expect(url.pathname).toBe('/ws/room');
        }

        const url = new URL('ws/room', resolveWsUrl('wss://ws.example.com/', PUSHER_URL));
        url.protocol = url.protocol.replace('http', 'ws');
        expect(url.toString()).toBe('wss://ws.example.com/ws/room');
    });

    it('returns a base for a root-relative WS_URL that still points at the pusher', () => {
        const url = new URL('ws/room', resolveWsUrl('/', PUSHER_URL));
        url.protocol = url.protocol.replace('http', 'ws');
        expect(url.toString()).toBe('ws://play.workadventure.localhost/ws/room');
    });
});
