/**
 * A voice bot's greeting is a Universe AI reply nobody asked for (#1669): it is made only while replies beyond the ones kept for text
 * are left. Orbit answers (reply-allowance with `greeting`); these tests check who is asked and what is done with the answer.
 * Apart from the other allowance tests because BaseBehavior needs the generated protobuf code.
 */
import { describe, expect, it, vi } from 'vitest';
import { BaseBehavior, type BehaviorConfig } from '../behaviors/BaseBehavior';

describe('a voice bot\'s greeting', () => {
    class Greeter extends BaseBehavior {
        constructor() {
            super({} as BehaviorConfig);
        }
        update(): void {}
        onChatMessage(): Promise<void> {
            return Promise.resolve();
        }
        getConversationMemory(): any {
            return null;
        }
        generateAIResponseStream(): Promise<void> {
            return Promise.resolve();
        }
        seed(options: { source: 'universe-ai' | 'provider' | 'own-key' | null; answer?: { allowed: boolean }; signedIn?: boolean; known?: boolean; ref?: string | null }) {
            this.bot = { getBotId: () => 'sam', getFullConfig: () => ({ aiProviderRef: options.ref === undefined ? 'universe-ai' : options.ref }) } as never;
            this.aiService = { replySource: vi.fn(async () => options.source) } as never;
            this.adminApiService = { checkReplyAllowance: vi.fn(async () => options.answer ?? { allowed: true }) } as never;
            if (options.known !== false) {
                this.userIdToUuid.set(7, 'uuid-7');
                this.userIdToIsLogged.set(7, options.signedIn ?? true);
            }
            return { ai: this.aiService as unknown as { replySource: ReturnType<typeof vi.fn> }, orbit: this.adminApiService as unknown as { checkReplyAllowance: ReturnType<typeof vi.fn> } };
        }
    }

    it('asks Orbit as a greeting, for the person and what the reply runs on, and is made when allowed', async () => {
        const g = new Greeter();
        const { orbit } = g.seed({ source: 'universe-ai' });
        expect(await g.mayGreetWithinAllowance(7)).toBe(true);
        expect(orbit.checkReplyAllowance).toHaveBeenCalledWith('sam', { userId: 'uuid-7', isGuest: false, source: 'universe-ai', greeting: true });
    });

    it('is not made once only the replies kept for text are left', async () => {
        const g = new Greeter();
        g.seed({ source: 'universe-ai', answer: { allowed: false } });
        expect(await g.mayGreetWithinAllowance(7)).toBe(false);
    });

    it('asks as a guest for someone who is not signed in', async () => {
        const g = new Greeter();
        const { orbit } = g.seed({ source: 'provider', signedIn: false });
        await g.mayGreetWithinAllowance(7);
        expect(orbit.checkReplyAllowance).toHaveBeenCalledWith('sam', expect.objectContaining({ isGuest: true, source: 'provider' }));
    });

    it('is made without asking when the maker\'s own key pays, nobody is known yet or the source cannot be told', async () => {
        const own = new Greeter();
        const a = own.seed({ source: 'own-key', answer: { allowed: false } });
        expect(await own.mayGreetWithinAllowance(7)).toBe(true);
        expect(a.orbit.checkReplyAllowance).not.toHaveBeenCalled();

        const nobody = new Greeter();
        const b = nobody.seed({ source: 'universe-ai', known: false, answer: { allowed: false } });
        expect(await nobody.mayGreetWithinAllowance(7)).toBe(true);
        expect(b.orbit.checkReplyAllowance).not.toHaveBeenCalled();

        const unknown = new Greeter();
        const c = unknown.seed({ source: null, answer: { allowed: false } });
        expect(await unknown.mayGreetWithinAllowance(7)).toBe(true);
        expect(c.orbit.checkReplyAllowance).not.toHaveBeenCalled();
    });
});
