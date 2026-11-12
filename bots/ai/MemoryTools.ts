/**
 * What a bot remembers about a person, in the chat (game #2003): "what do you remember about me?" and "forget that".
 *
 * Both tools are for a direct message only, where the person is alone with the bot, so what they hear back is never read by
 * anyone else. They work on the same list a person sees in Orbit and name a thing by the same key. Forgetting is the
 * bot server's own: the thing is dropped from memory at once, with what was built from it, and Orbit is told by key so it
 * stays gone wherever a copy of the memory is held.
 */
import { memoryItemsOf, type MemoryItem } from '../memory/MemoryItems';
import type { BotPlayerMemory } from '../memory/ConversationMemory';

export const WHAT_I_REMEMBER_TOOL = 'what_i_remember';
export const FORGET_MEMORY_TOOL = 'forget_memory';
export const MEMORY_TOOL_NAMES: readonly string[] = [WHAT_I_REMEMBER_TOOL, FORGET_MEMORY_TOOL];

export function isMemoryTool(name: string): boolean {
    return MEMORY_TOOL_NAMES.includes(name);
}

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

export function memoryToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: WHAT_I_REMEMBER_TOOL,
                description:
                    'List what you remember about this person, one thing at a time. Use it when they ask what you remember or know about them, and before forgetting something when it is not clear which thing they mean. ' +
                    'Tell them in your own words, short and plain. Never list the ids.',
                parameters: { type: 'object', properties: {} },
            },
        },
        {
            type: 'function',
            function: {
                name: FORGET_MEMORY_TOOL,
                description:
                    'Forget something you remember about this person. Use it the moment they ask you to forget it ("forget that", "forget my name", "forget I like coffee", "forget everything about my birthday"). ' +
                    'Give the words of what to forget in `about`, or the ids from what_i_remember. The thing goes at once, with the lines of the chat it came from. ' +
                    'Then tell them in one short sentence that it is forgotten. Never ask them to confirm first, and never say you still remember it.',
                parameters: {
                    type: 'object',
                    properties: {
                        about: { type: 'string', description: 'What to forget, in a few of the person\'s own words: "coffee", "my birthday", "my name", "that I was tired".' },
                        ids: { type: 'array', items: { type: 'string' }, description: 'The ids of things from what_i_remember, when you know exactly which.' },
                    },
                },
            },
        },
    ];
}

/** What a bot with these tools is told with its instructions. */
export function memoryToolsNote(): string {
    return 'Memory: this person can ask what you remember about them (what_i_remember) and can ask you to forget any of it (forget_memory) at any time. Do it the moment they ask, and say so plainly. They can also look at, and forget from, the list in the chat menu.';
}

/** How a thing reads to the model, in plain words. */
function describe(item: MemoryItem): string {
    switch (item.kind) {
        case 'name':
            return `Their name is ${item.value}`;
        case 'birthday':
            return `Their birthday is ${item.value}`;
        case 'pref':
            return `They like ${item.value}`;
        default:
            return item.label === 'current_state' ? `They said they were ${item.value}` : `${item.label?.replace(/_/g, ' ') ?? 'A fact'}: ${item.value}`;
    }
}

const WORDS_OF = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((word) => word.length >= 3);

/** The things these words are about: the same words in what is remembered, or the kind of thing ("my name", "my birthday"). */
export function itemsAbout(items: MemoryItem[], about: string): MemoryItem[] {
    const asked = about.toLowerCase().trim();
    if (!asked) return [];
    const words = WORDS_OF(asked);
    return items.filter((item) => {
        const value = item.value.toLowerCase();
        if (item.kind === 'name' && /\bname\b/.test(asked)) return true;
        if (item.kind === 'birthday' && /\b(birthday|bday)\b/.test(asked)) return true;
        if (value.length >= 3 && (asked.includes(value) || value.includes(asked))) return true;
        const valueWords = WORDS_OF(value);
        return words.some((word) => valueWords.includes(word));
    });
}

export interface MemoryToolContext {
    memory: BotPlayerMemory | null | undefined;
    /** Drops these things from memory, with what was built from them, and tells Orbit. Returns how many went. */
    forget: (keys: ReadonlySet<string>, kinds: ReadonlyMap<string, string>) => Promise<number>;
}

/** Runs one of the two tools. Never throws: the model is told in plain words what happened. */
export async function runMemoryTool(name: string, args: Record<string, unknown>, context: MemoryToolContext): Promise<Record<string, unknown>> {
    if (!context.memory) return { error: "That can't be done in this chat right now." };
    const items = memoryItemsOf(context.memory);

    if (name === WHAT_I_REMEMBER_TOOL) {
        return items.length === 0
            ? { things: [], note: 'You remember nothing about them yet. Say so.' }
            : { things: items.map((item) => ({ id: item.id, what: describe(item) })) };
    }

    if (name === FORGET_MEMORY_TOOL) {
        const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : [];
        const about = typeof args.about === 'string' ? args.about.slice(0, 200) : '';
        if (ids.length === 0 && !about.trim()) return { error: 'Say what to forget, or call what_i_remember first and ask them which one.' };
        const chosen = new Map<string, MemoryItem>();
        for (const item of items) if (ids.includes(item.id)) chosen.set(item.id, item);
        for (const item of itemsAbout(items, about)) chosen.set(item.id, item);
        if (chosen.size === 0) return { forgotten: [], note: 'You do not remember anything like that, so nothing was forgotten. Tell them so in one short sentence.' };
        try {
            const went = await context.forget(new Set(chosen.keys()), new Map([...chosen].map(([id, item]) => [id, item.kind])));
            return { forgotten: [...chosen.values()].map(describe), count: went, note: 'It is forgotten, with the lines of this chat it came from. Tell them in one short sentence, and do not repeat what it was.' };
        } catch (error) {
            console.warn('[MemoryTools] Could not forget:', error instanceof Error ? error.message : error);
            return { error: 'It could not be forgotten just now. Say so in one plain sentence and offer to try again.' };
        }
    }
    return { error: 'Unknown tool.' };
}
