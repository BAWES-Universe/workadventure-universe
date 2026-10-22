import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { format } from 'util';
import axios from 'axios';
import { installAxiosErrorRedaction, redactUrl } from '../server/redactAxiosErrors';

const TOKEN = 'service-token-that-must-never-be-logged';
const TRANSCRIPT = 'a private message the player sent the bot';

/** What Sentry's console logging sends for `console.error(label, error)`: the error becomes a log attribute through JSON.stringify. */
const sentryLogAttribute = (error: unknown) => JSON.stringify(error);

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
    installAxiosErrorRedaction();
    server = http.createServer((request, response) => {
        response.statusCode = request.url?.startsWith('/missing') ? 404 : 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: 'Internal server error' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function failingCall(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to fail');
}

describe('a failed axios call keeps tokens and message text out of the logs', () => {
    it('Orbit answering 500: the service token is in neither the container log nor the Sentry log attribute', async () => {
        const error = await failingCall(
            axios.get(`${baseUrl}/api/bots/bot-1/ai-credentials`, { headers: { Authorization: `Bearer ${TOKEN}` } })
        );
        expect(format('[AdminApiService] Error getting bot AI credentials:', error)).not.toContain(TOKEN);
        expect(sentryLogAttribute(error)).not.toContain(TOKEN);
    });

    it('a request body (a transcript being saved) is not logged either', async () => {
        const error = await failingCall(
            axios.post(`${baseUrl}/api/bots/bot-1/conversations`, { message: TRANSCRIPT }, { headers: { Authorization: `Bearer ${TOKEN}` } })
        );
        expect(format(error)).not.toContain(TRANSCRIPT);
        expect(sentryLogAttribute(error)).not.toContain(TRANSCRIPT);
    });

    it('an MCP key in a custom header or in the address is not logged', async () => {
        const error = await failingCall(
            axios.post(`${baseUrl}/mcp?api_key=${TOKEN}&room=lobby`, {}, { headers: { 'x-api-key': TOKEN } })
        );
        expect(format(error)).not.toContain(TOKEN);
        expect(sentryLogAttribute(error)).not.toContain(TOKEN);
        expect(format(error)).toContain('room=lobby');
    });

    it('a login written in the address (with or without a query) is not logged, and an address without one is unchanged', async () => {
        const port = new URL(baseUrl).port;
        const withQuery = await failingCall(axios.post(`http://svc:${TOKEN}@127.0.0.1:${port}/mcp?room=lobby`, {}));
        const withoutQuery = await failingCall(axios.get(`http://svc:${TOKEN}@127.0.0.1:${port}/mcp`));
        const viaBase = await failingCall(axios.get('/mcp', { baseURL: `http://svc:${TOKEN}@127.0.0.1:${port}` }));
        for (const error of [withQuery, withoutQuery, viaBase]) {
            expect(format(error)).not.toContain(TOKEN);
            expect(sentryLogAttribute(error)).not.toContain(TOKEN);
        }
        expect(redactUrl('https://orbit.example.com/api/bots?room=lobby')).toBe('https://orbit.example.com/api/bots?room=lobby');
        expect(redactUrl('https://u:p@orbit.example.com/api')).toBe('https://[redacted]@orbit.example.com/api');
        expect(redactUrl('https://u:pa@ss@orbit.example.com/api?room=lobby')).toBe('https://[redacted]@orbit.example.com/api?room=lobby');
        expect(redactUrl('https://orbit.example.com/api/user@example.com')).toBe('https://orbit.example.com/api/user@example.com');
    });

    it('a server that cannot be reached at all: the token is still not logged', async () => {
        const error = await failingCall(
            axios.get('http://127.0.0.1:9/api/bots', { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 2000 })
        );
        expect(axios.isAxiosError(error)).toBe(true);
        expect(format(error)).not.toContain(TOKEN);
        expect(sentryLogAttribute(error)).not.toContain(TOKEN);
    });

    it('callers still read the status and the answer, as before', async () => {
        const error = await failingCall(axios.get(`${baseUrl}/missing`, { headers: { Authorization: `Bearer ${TOKEN}` } }));
        expect(axios.isAxiosError(error)).toBe(true);
        if (!axios.isAxiosError(error)) return;
        expect(error.response?.status).toBe(404);
        expect(error.response?.data).toEqual({ error: 'Internal server error' });
        expect(format(error)).toContain('/missing');
    });

    it('redactUrl keeps an address without secrets exactly as it was', () => {
        expect(redactUrl('https://orbit.example/api/bots?roomId=1')).toBe('https://orbit.example/api/bots?roomId=1');
        expect(redactUrl('https://x.example/v1?key=abc&alt=sse')).toBe('https://x.example/v1?key=%5Bredacted%5D&alt=sse');
    });
});
