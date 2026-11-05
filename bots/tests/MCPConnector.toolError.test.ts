/**
 * A tool that ran but failed answers with isError (MCP spec): it reads as an error, so the steps line shows it as
 * didn't work (#1545) instead of done.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('axios', () => ({ default: { post: (...args: unknown[]) => post(...args), isCancel: () => false } }));
vi.mock('../mcp/outboundGuard', () => ({ checkOutboundUrl: async () => ({ allowed: true }), guardedLookup: vi.fn() }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

import { MCPConnector } from '../mcp/MCPConnector';

const answer = (result: unknown) => ({ data: { jsonrpc: '2.0', id: 1, result }, headers: {}, status: 200 });

describe('MCPConnector.executeToolCall', () => {
    beforeEach(() => post.mockReset());

    it('returns a failed run as an error with its reason', async () => {
        post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce(
            answer({ isError: true, content: [{ type: 'text', text: 'daily limit reached' }] })
        );
        const result = await MCPConnector.executeToolCall('s1', 'https://music.test/mcp', 'generate_music', {}, 'none', undefined, undefined, 'p1');
        expect(result).toEqual({ error: 'Tool error: daily limit reached', outcome: 'failed' });
    });

    it("keeps the server's words out of the logs, while the bot still gets them", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce(
                answer({ isError: true, content: [{ type: 'text', text: 'no mailbox for canary-4821@example.com' }] })
            );
            const failed = await MCPConnector.executeToolCall('s3', 'https://mail.test/mcp', 'read_mail', {}, 'none', undefined, undefined, 'p1');
            expect(failed).toEqual({ error: 'Tool error: no mailbox for canary-4821@example.com', outcome: 'failed' });

            post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce({
                data: { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'bad address canary-4821@example.com' } },
                headers: {},
                status: 200,
            });
            const refused = await MCPConnector.executeToolCall('s4', 'https://mail2.test/mcp', 'read_mail', {}, 'none', undefined, undefined, 'p1');
            expect(refused).toMatchObject({ error: 'Tool error: bad address canary-4821@example.com', outcome: 'failed' });

            const logged = JSON.stringify(warn.mock.calls);
            expect(logged).toContain('read_mail');
            expect(logged).not.toContain('canary-4821');
        } finally {
            warn.mockRestore();
        }
    });

    it('returns a run that worked as its content, as before', async () => {
        post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce(answer({ content: [{ type: 'text', text: 'ok' }] }));
        const result = await MCPConnector.executeToolCall('s2', 'https://music2.test/mcp', 'generate_music', {}, 'none', undefined, undefined, 'p1');
        expect(result).toEqual([{ type: 'text', text: 'ok' }]);
    });
});
