import type { AIService } from '../../ai/AIService';

/** A tool gate that lets every call run and offers every tool, for tests of something other than the gate (#1656). */
export function openToolGate<T extends AIService>(service: T): T {
    service['toolGate'] = {
        decide: async () => ({ kind: 'run' }),
        offers: async () => true,
    } as never;
    return service;
}
