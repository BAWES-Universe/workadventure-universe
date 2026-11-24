/**
 * A header that cannot be sent is refused and logged by its name and the method only: the server address (it can carry a key in
 * its query) is never in the log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn(), isCancel: () => false } }));
vi.mock('../mcp/outboundGuard', () => ({ checkOutboundUrl: async () => ({ allowed: true }), guardedLookup: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { MCPConnector } from '../mcp/MCPConnector';

afterEach(() => vi.restoreAllMocks());

describe('a header that cannot be sent', () => {
    it('is logged without the server address, which can carry a key', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const outcome = await MCPConnector.executeToolCall('s-h', 'https://tools.example/mcp?key=secret-key', 'x', {}, 'bearer', 'bad\nvalue', undefined, 'u-sara');
        expect(outcome).toMatchObject({ outcome: 'not_sent' });
        const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(logged).toContain('cannot be sent');
        expect(logged).not.toContain('secret-key');
        expect(logged).not.toContain('tools.example');
    });
});
