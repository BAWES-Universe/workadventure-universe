import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService, BotConfigRefused, type BotConfiguration } from '../server/AdminApiService';

let server: http.Server;
let service: AdminApiService;
let seenAuthorization: string | undefined;
let answer: { status: number; body: unknown };

const config = {
    botId: 'b1',
    name: 'Ada',
    behaviorType: 'social',
    behaviorConfig: {},
    aiProviderRef: 'key-123',
    createdAt: new Date(),
    updatedAt: new Date(),
} as unknown as BotConfiguration;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        seenAuthorization = request.headers.authorization;
        request.resume();
        request.on('end', () => {
            response.statusCode = answer.status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(answer.body));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('saving a bot configuration to Orbit', () => {
    it('goes with the admin token unless a person is saving their own key', async () => {
        answer = { status: 200, body: {} };
        await service.saveBotConfiguration(config);
        expect(seenAuthorization).toBe('Bearer admin-token');
        await service.saveBotConfiguration(config, 'orb_sess_v2_person');
        expect(seenAuthorization).toBe('Bearer orb_sess_v2_person');
    });

    it('turns Orbit\'s 400 with a reason into a BotConfigRefused carrying that reason', async () => {
        answer = { status: 400, body: { error: 'That key isn’t lent to this universe.' } };
        const failure = await service.saveBotConfiguration(config).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BotConfigRefused);
        expect((failure as Error).message).toBe('That key isn’t lent to this universe.');
    });

    it('still throws a plain error for anything else', async () => {
        answer = { status: 500, body: { error: 'Internal server error' } };
        const failure = await service.saveBotConfiguration(config).catch((error: unknown) => error);
        expect(failure).not.toBeInstanceOf(BotConfigRefused);
        expect(failure).toBeInstanceOf(Error);
    });
});
