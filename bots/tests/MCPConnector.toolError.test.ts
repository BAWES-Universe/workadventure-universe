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

    describe('an App step Orbit held back (a ready-made App, reached through Orbit)', () => {
        let serial = 0;
        // Orbit's link keeps a session for each server, so each run is its own server
        const linked = (result: unknown) => ({ data: { status: 200, contentType: 'application/json', sessionId: null, body: JSON.stringify({ jsonrpc: '2.0', id: '2', result }) } });
        const run = async (result: unknown, withLink = true) => {
            process.env.BOT_SERVICE_TOKEN = 'token';
            if (withLink) {
                const link = { orbitUrl: 'https://orbit.test', botId: 'b1', serverId: `srv-stop-${++serial}`, callId: 'call-1', requesterKey: 'u1' };
                post.mockResolvedValueOnce(linked({})).mockResolvedValueOnce({ data: { status: 200 } }).mockResolvedValueOnce(linked(result));
                return MCPConnector.executeToolCall(link.serverId, 'https://ignored.test', 'notion_add', {}, 'none', undefined, undefined, 'p1', undefined, undefined, link);
            }
            post.mockResolvedValueOnce(answer({})).mockResolvedValueOnce(answer(result));
            return MCPConnector.executeToolCall(`srv-other-${++serial}`, 'https://other.test/mcp', 'notion_add', {}, 'none', undefined, undefined, 'p1');
        };
        const stopped = (stop: Record<string, unknown>) => ({ isError: true, content: [{ type: 'text', text: 'Apps are paused' }], _meta: { 'universe/stop': stop } });

        it("says the person's own allowance is used up, with the day it comes back, and that a card can ask for more", async () => {
            const result = (await run(stopped({ by: 'person', resetsAt: '2099-12-01T00:00:00.000Z', canAskForMore: true }))) as Record<string, any>;
            expect(result.outcome).toBe('not_sent');
            expect(result.error).toBe("I can't do that right now: this month's App use is used up. It comes back on 1 Dec. I can ask the Universe team for more.");
            expect(result.stopped).toEqual({ by: 'person', resetsAt: '2099-12-01T00:00:00.000Z', canAskForMore: true });
        });

        it('says "Nothing you need to do", with no date, for the platform or a provider, and never offers more', async () => {
            for (const by of ['budget', 'provider']) {
                const result = (await run(stopped({ by, resetsAt: '2099-12-01T00:00:00.000Z', canAskForMore: false }))) as Record<string, any>;
                expect(result.error).toBe("Apps are paused for now, so I can't do that right now. Nothing you need to do.");
                expect(result.stopped).toEqual({ by, canAskForMore: false });
            }
        });

        it('says it is busy for a moment for capacity, and nothing to the person for a hold', async () => {
            expect(((await run(stopped({ by: 'capacity' }))) as Record<string, any>).error).toMatch(/Apps are busy for a moment/);
            const hold = (await run(stopped({ by: 'hold' }))) as Record<string, any>;
            expect(hold.outcome).toBe('not_sent');
            expect(hold.hint).toContain('say nothing');
        });

        it('keeps the old words for an answer that names no reason, and for any other server that claims one', async () => {
            const plain = (await run({ isError: true, content: [{ type: 'text', text: 'Apps are paused for a while' }] })) as Record<string, any>;
            expect(plain).toEqual({ error: 'Tool error: Apps are paused for a while', outcome: 'failed' });
            const other = (await run(stopped({ by: 'person', canAskForMore: true }), false)) as Record<string, any>;
            expect(other.outcome).toBe('failed');
            expect(other.stopped).toBeUndefined();
        });
    });
});
