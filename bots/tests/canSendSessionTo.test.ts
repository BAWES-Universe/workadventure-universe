import { describe, expect, it } from 'vitest';
import { canSendSessionTo } from '../server/AdminApiService';

const allowed = (url: string, env = 'development') => canSendSessionTo(new URL(url), env);

describe('canSendSessionTo', () => {
    it('always allows https', () => {
        expect(allowed('https://admin.example.com', 'production')).toBe(true);
        expect(allowed('https://admin.example.com')).toBe(true);
    });

    it('never allows http in production, even locally', () => {
        expect(allowed('http://localhost:3333', 'production')).toBe(false);
        expect(allowed('http://admin:3000', 'production')).toBe(false);
    });

    it('allows http to local and docker hosts outside production', () => {
        for (const url of [
            'http://localhost:3333',
            'http://admin.workadventure.localhost',
            'http://127.0.0.1:3333',
            'http://[::1]:3333',
            'http://host.docker.internal:3333',
            'http://admin:3000',
            'http://10.0.0.5',
            'http://172.17.0.1:3333',
            'http://192.168.1.20:3333',
        ]) {
            expect(allowed(url), url).toBe(true);
        }
    });

    it('rejects http to public hosts outside production', () => {
        for (const url of ['http://admin.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'ftp://localhost']) {
            expect(allowed(url), url).toBe(false);
        }
    });
});
