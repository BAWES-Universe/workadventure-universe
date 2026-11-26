/**
 * "New Bricks per hour" (Orbit: 30 a person, tunable there): Orbit turns a person away with 429 and a kind line that already
 * names the time they can make another ("You've made a lot of Bricks this hour. Try again at 3:40 PM."). This is that refusal,
 * so a Brick can say the line as it is, instead of "I couldn't make it just now".
 */
export const NEW_BRICKS_LIMIT_CODE = 'new_bricks_limit';

export class BrickLimitReached extends Error {
    constructor(
        /** The line to say, in Orbit's own words. */
        readonly line: string,
        /** When they can make another (ISO time), when Orbit said. */
        readonly retryAt?: string
    ) {
        super(line);
        this.name = 'BrickLimitReached';
    }
}

/** The refusal Orbit's answer is, when it is one for "New Bricks per hour"; undefined for any other failure. */
export function brickLimitFrom(error: unknown): BrickLimitReached | undefined {
    const answer = (error as { response?: { status?: unknown; data?: { code?: unknown; error?: unknown; retryAt?: unknown } } } | null | undefined)?.response;
    if (answer?.status !== 429 || answer.data?.code !== NEW_BRICKS_LIMIT_CODE || typeof answer.data.error !== 'string' || answer.data.error.trim() === '') return undefined;
    return new BrickLimitReached(answer.data.error.trim(), typeof answer.data.retryAt === 'string' ? answer.data.retryAt : undefined);
}
