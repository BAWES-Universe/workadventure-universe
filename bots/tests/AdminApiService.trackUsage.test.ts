/**
 * What the bot server sends Orbit for a reply's usage (#1173): the price facts when it has them, the old cost
 * only when it does not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';

let server: http.Server;
let service: AdminApiService;
let sent: Record<string, unknown> | undefined;

beforeAll(async () => {
    process.env.BOT_SERVICE_TOKEN = 'service-token';
    server = http.createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            sent = JSON.parse(body);
            response.setHeader('content-type', 'application/json');
            response.end('{"status":"tracked"}');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
});

beforeEach(() => {
    sent = undefined;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('tracking AI usage in Orbit', () => {
    it('sends the price facts, and no old cost beside them', async () => {
        await service.trackAIUsage({
            botId: 'b1',
            providerId: 'deepseek-flash',
            tokensUsed: 5200,
            cost: 0.5,
            price: { inputTokens: 1000, cachedTokens: 4000, cacheWriteTokens: 0, outputTokens: 200, reasoningTokens: 0, costMicros: 282, costBasis: 'priced', priceSource: 'models.dev', priceVersion: '2026-10-25 deepseek-off-peak' },
        });
        expect(sent).toMatchObject({ botId: 'b1', tokensUsed: 5200, cost: null, costMicros: 282, costBasis: 'priced', cachedTokens: 4000, inputTokens: 1000, priceVersion: '2026-10-25 deepseek-off-peak' });
    });

    it('sends an unknown price as no number, not as zero', async () => {
        await service.trackAIUsage({
            botId: 'b1',
            providerId: 'x',
            price: { inputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0, costMicros: null, costBasis: 'unknown', priceSource: null, priceVersion: null },
        });
        expect(sent).toMatchObject({ costMicros: null, costBasis: 'unknown' });
    });

    it('still sends only the old cost when there are no price facts', async () => {
        await service.trackAIUsage({ botId: 'b1', providerId: 'x', tokensUsed: 10, cost: 0.0123 });
        expect(sent).toMatchObject({ cost: 0.0123 });
        expect(sent).not.toHaveProperty('costBasis');
    });
});
