/**
 * The small model that sorts a ready-made App's actions that neither their name nor the App's own tags could sort (Orbit #1042,
 * game "Ask, Do, Ignore" for Bricks). Orbit keeps one list per App for everyone; until an action is sorted it is under "Deletes or
 * sends out", so it asks first.
 *
 * Orbit hands out up to 60 waiting actions at a time (GET /api/app-actions/unsorted) and moves them to the back of its line, so
 * they are asked for only when the model can answer now, and the picks go back at once (PUT). The model is the same sorter and the
 * same prompt as a bot's own tools (suggestFromDescriptions), on the provider of the Brick whose reply brought an App along, the
 * way its own tools are sorted. At most one batch every few minutes on this bot server; a failure waits for the next turn.
 *
 * Nothing in an action's name or words is trusted as an instruction: they go to the model as data, and Orbit takes "Makes new
 * things" only for an action it knows stays private, and never a looser heading than the action's name says.
 */
import axios from 'axios';
import { suggestFromDescriptions, type ToolHeading, type ToolSuggester } from './ToolCatalog';

/** One sort at most this often on a bot server. */
export const SORT_EVERY_MS = 10 * 60_000;
const ORBIT_TIMEOUT_MS = 15_000;
const BATCH = 60;

export interface SorterOrbit {
    adminApiUrl: string;
    /** BOT_SERVICE_TOKEN: the lists are Universe's, not one bot's. */
    serviceToken: string;
}

interface Waiting {
    toolkit: string;
    slug: string;
    title?: string;
    description?: string;
}

const isWaiting = (value: unknown): value is Waiting => {
    const item = value as Record<string, unknown> | null;
    return !!item && typeof item.toolkit === 'string' && typeof item.slug === 'string';
};

export class AppActionSorter {
    private lastAt = Number.NEGATIVE_INFINITY;
    private running: Promise<number> | null = null;

    constructor(
        private readonly orbit: () => SorterOrbit | null,
        private readonly now: () => number = Date.now
    ) {}

    /** Sorts one batch when it is time to. Never throws, and never makes the reply wait: answers how many it sent back. */
    maybeSort(ask: ToolSuggester | undefined): Promise<number> {
        if (!ask || this.running || this.now() - this.lastAt < SORT_EVERY_MS) return Promise.resolve(0);
        const orbit = this.orbit();
        if (!orbit) return Promise.resolve(0);
        this.lastAt = this.now();
        this.running = this.sortOnce(orbit, ask)
            .catch((error) => {
                console.warn('[AppActionSorter] Could not sort App actions:', error instanceof Error ? error.message : error);
                return 0;
            })
            .finally(() => {
                this.running = null;
            });
        return this.running;
    }

    private async sortOnce(orbit: SorterOrbit, ask: ToolSuggester): Promise<number> {
        const url = `${orbit.adminApiUrl}/api/app-actions/unsorted`;
        const headers = { Authorization: `Bearer ${orbit.serviceToken}` };
        const { data } = await axios.get(url, { headers, params: { limit: BATCH }, timeout: ORBIT_TIMEOUT_MS });
        const waiting = (Array.isArray(data?.actions) ? data.actions : []).filter(isWaiting).slice(0, BATCH) as Waiting[];
        if (waiting.length === 0) return 0;
        // The model reads each action by a name of its own in this batch: the same slug in two Apps is two actions
        const named = waiting.map((action, index) => ({ key: `a${index}`, action }));
        const picks = await suggestFromDescriptions(
            named.map(({ key, action }) => ({ name: key, ...(action.title ? { title: action.title } : {}), description: action.description ?? action.slug })),
            ask
        );
        const actions = named.flatMap(({ key, action }) => {
            const heading: ToolHeading | undefined = picks.get(key);
            return heading ? [{ toolkit: action.toolkit, slug: action.slug, heading }] : [];
        });
        if (actions.length === 0) return 0;
        await axios.put(url, { actions }, { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: ORBIT_TIMEOUT_MS });
        return actions.length;
    }
}
