import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';

vi.mock('axios', () => ({ default: { post: vi.fn(), isAxiosError: () => false } }));

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

describe('the report of what a model call used', () => {
    beforeEach(() => {
        vi.stubEnv('BOT_SERVICE_TOKEN', 'bot-token');
        post.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('is sent with a time limit, so one that never comes back cannot hold what waits on it', async () => {
        post.mockResolvedValue({ status: 200, data: {} });
        await new AdminApiService('http://orbit.test', 'admin-token').trackAIUsage({ botId: 'brick-1', providerId: 'deepseek-flash', tokensUsed: 10 });
        expect(post).toHaveBeenCalledTimes(1);
        const [url, , options] = post.mock.calls[0];
        expect(url).toBe('http://orbit.test/api/bots/ai-usage');
        expect(options.timeout).toBeGreaterThan(0);
    });

    it('does not throw when the time runs out', async () => {
        post.mockRejectedValue(Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }));
        await expect(new AdminApiService('http://orbit.test', 'admin-token').trackAIUsage({ botId: 'brick-1', providerId: 'deepseek-flash' })).resolves.toBeUndefined();
    });
});
