/**
 * A tool that ran but failed answers with isError (MCP spec): it reads as an error, so the steps line shows it as
 * didn't work (#1545) instead of done.
 */
import { describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('axios', () => ({ default: { post: (...args: unknown[]) => post(...args), isCancel: () => false } }));
vi.mock('../mcp/outboundGuard', () => ({ checkOutboundUrl: async () => ({ allowed: true }), guardedLookup: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { MCPConnector } from '../mcp/MCPConnector';

const answer = (result: unknown) => ({ data: { jsonrpc: '2.0', id: 1, result }, headers: {}, status: 200 });

describe('MCPConnector.executeToolCall', () => {
    it('returns a failed run as an error with its reason', async () => {
        post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce(
            answer({ isError: true, content: [{ type: 'text', text: 'daily limit reached' }] })
        );
        const result = await MCPConnector.executeToolCall('s1', 'https://music.test/mcp', 'generate_music', {}, 'none', undefined, undefined, 'p1');
        expect(result).toEqual({ error: 'Tool error: daily limit reached' });
    });

    it('returns a run that worked as its content, as before', async () => {
        post.mockResolvedValueOnce(answer({ content: [{ type: 'text', text: 'ok' }] }));
        const result = await MCPConnector.executeToolCall('s1', 'https://music.test/mcp', 'generate_music', {}, 'none', undefined, undefined, 'p1');
        expect(result).toEqual([{ type: 'text', text: 'ok' }]);
    });
});
