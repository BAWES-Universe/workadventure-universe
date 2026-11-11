/**
 * More Bricks (game #1996): the two tools a person's own Brick has in its owner's direct messages.
 *
 * `make_brick` makes another Brick for the person, right away, when they ask for one ("make me a bot that keeps my mum's
 * recipes"). `suggest_brick` is the gentle offer: when the same kind of job keeps coming back, the Brick may suggest a
 * Brick just for it. Orbit decides whether the suggestion may be shown (once per person and topic, on every device), and
 * the card goes out after the answer is finished, never in the middle of it. Orbit only acts for the owner of the Brick
 * that asks, so neither tool can reach anyone else's Bricks.
 */
import type { AdminApiService } from '../server/AdminApiService';

export const MAKE_BRICK_TOOL = 'make_brick';
export const SUGGEST_BRICK_TOOL = 'suggest_brick';
export const BRICK_TOOL_NAMES: readonly string[] = [MAKE_BRICK_TOOL, SUGGEST_BRICK_TOOL];

export function isBrickTool(name: string): boolean {
    return BRICK_TOOL_NAMES.includes(name);
}

/** A Brick this turn made: the game shows one line for it, and its chat is one tap away. */
export interface MadeBrickNote {
    kind: 'made';
    id: string;
    name: string;
    line: string | null;
    look: string | null;
    /** False when the person already had it and nothing new was made. */
    made: boolean;
}

/** A suggestion Orbit allowed: the game shows it as a card once the answer is done. */
export interface BrickOfferNote {
    kind: 'offer';
    topic: string;
    /** The one sentence on the card ("You cook a lot. Want a Brick just for recipes?"). */
    ask: string;
    name: string;
    line: string;
    instructions: string;
}

export type BrickNote = MadeBrickNote | BrickOfferNote;

const NAME_MAX = 40;
const LINE_MAX = 120;
const ASK_MAX = 160;
const HELLO_MAX = 300;
const INSTRUCTIONS_MAX = 4000;

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: object } };

const NEW_BRICK_FIELDS = {
    name: { type: 'string', description: 'Its name: two or three plain words that end in "Brick", like "Recipe Brick".' },
    line: { type: 'string', description: 'One short line on what it does for them, starting with a verb: "Keeps your mum\'s recipes".' },
    instructions: {
        type: 'string',
        description:
            'What the new Brick is told: its one job, how it should go about it, and everything this person already told you that it needs. Written to the new Brick as "you". It starts with no memory of this chat.',
    },
};

export function brickToolDefinitions(): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: MAKE_BRICK_TOOL,
                description:
                    'Make another Brick for this person, right now. Use it when they ask you to make, create or set up a bot, a Brick, a helper or an assistant for something ' +
                    '("make me a bot that keeps my mum\'s recipes"). "Bot" and "Brick" mean the same. Do not ask them to confirm and do not ask for details first: make it from what they said, ' +
                    'they can change it later. If they already have one of that name you get that one back; make a second only when they clearly want a second. ' +
                    'After it, tell them in one or two short sentences that it is ready and that its chat is in Chats.',
                parameters: {
                    type: 'object',
                    properties: {
                        ...NEW_BRICK_FIELDS,
                        hello: { type: 'string', description: 'The first line the new Brick shows in its empty chat, as itself, saying what to send it first. One or two short sentences.' },
                        second: { type: 'boolean', description: 'True only when they asked for another one of a name they already have.' },
                    },
                    required: ['name', 'line', 'instructions'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: SUGGEST_BRICK_TOOL,
                description:
                    'Suggest a Brick just for one kind of job, on a small card under your answer. Only when this same kind of job has clearly come back several times with this person ' +
                    '(the "Bricks" note says how often counts), you have already done what they asked in this reply, and the topic is not one already suggested. ' +
                    'Never when they are in the middle of something, never as a way to avoid doing the job yourself, and at most once in a reply. ' +
                    'Call it silently after your answer is complete: do not mention the suggestion in your words, the card says it.',
                parameters: {
                    type: 'object',
                    properties: {
                        topic: { type: 'string', description: 'The kind of job in one or two plain words, lower case: "recipes", "workouts", "travel plans".' },
                        ask: { type: 'string', description: 'The card\'s one question to them, in their language: "You cook a lot. Want a Brick just for recipes?"' },
                        ...NEW_BRICK_FIELDS,
                    },
                    required: ['topic', 'ask', 'name', 'line', 'instructions'],
                },
            },
        },
    ];
}

/** The note a Brick with these tools gets with its instructions: how often counts, and what was already suggested. */
export function brickToolsNote(offers: { after: number; topics: string[] } | null): string {
    const lines = [
        'Bricks: you can make another Brick for this person with make_brick the moment they ask for one. Never say you cannot make bots or Bricks.',
    ];
    if (offers) {
        lines.push(
            `You may suggest a Brick for a kind of job with suggest_brick only when that same kind of job has come back at least ${offers.after} times in what you remember of this person, and only after you finished answering.`
        );
        if (offers.topics.length > 0) {
            lines.push(`Already suggested, so never suggest these or anything close to them again: ${offers.topics.slice(0, 40).join(', ')}.`);
        }
    }
    return lines.join('\n');
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const longText = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export interface BrickToolContext {
    admin: Pick<AdminApiService, 'makeBrickFor' | 'claimBrickOffer'>;
    /** The Brick that asks, and the person it belongs to (their game uuid). */
    botId: string;
    userId: string;
    /** Where this turn's notes for the game wait until the reply goes out. */
    notes: BrickNote[];
}

/** Runs one of the two tools. Never throws: the model is told in plain words what happened. */
export async function runBrickTool(name: string, args: Record<string, unknown>, context: BrickToolContext): Promise<Record<string, unknown>> {
    const brickName = text(args.name, NAME_MAX);
    const line = text(args.line, LINE_MAX);
    const instructions = longText(args.instructions, INSTRUCTIONS_MAX);
    if (!brickName) return { error: 'Give the Brick a name.' };

    if (name === MAKE_BRICK_TOOL) {
        // One Brick per ask: a model that calls twice in one reply gets the first one back
        const already = context.notes.find((note): note is MadeBrickNote => note.kind === 'made' && note.name.toLowerCase() === brickName.toLowerCase());
        if (already) return { made: already.made, name: already.name, note: 'Already done in this reply.' };
        const hello = text(args.hello, HELLO_MAX);
        try {
            const { made, brick } = await context.admin.makeBrickFor(context.botId, context.userId, {
                name: brickName,
                ...(line ? { description: line } : {}),
                ...(instructions ? { chatInstructions: instructions } : {}),
                ...(hello ? { hello } : {}),
                ...(args.second === true ? { evenIfThere: true } : {}),
            });
            context.notes.push({ kind: 'made', id: brick.id, name: brick.name, line: brick.description, look: brick.characterTextureId, made });
            return made
                ? { made: true, name: brick.name, note: 'It is ready and knows its job. Its chat is in their Chats now. Say so in one or two short sentences.' }
                : { made: false, name: brick.name, note: 'They already have a Brick of this name, so nothing new was made. Tell them it is in their Chats. Make a second only if they ask for one.' };
        } catch (error) {
            console.warn('[BrickTools] Could not make a Brick:', error instanceof Error ? error.message : error);
            return { error: 'The Brick could not be made just now. Say so in one plain sentence and offer to try again.' };
        }
    }

    if (name === SUGGEST_BRICK_TOOL) {
        const topic = text(args.topic, 60);
        const ask = text(args.ask, ASK_MAX);
        if (!topic || !ask || !line) return { shown: false, note: 'Nothing was suggested. Do not mention it.' };
        if (context.notes.some((note) => note.kind === 'offer')) return { shown: false, note: 'One suggestion in a reply is enough. Do not mention it.' };
        try {
            const claim = await context.admin.claimBrickOffer(context.botId, context.userId, topic);
            if (!claim.show) return { shown: false, note: 'This was already suggested to them once. Never suggest it again, and do not mention it.' };
            context.notes.push({ kind: 'offer', topic: claim.topic, ask, name: brickName, line, instructions });
            return { shown: true, note: 'The card is under your answer. Do not mention it in your words.' };
        } catch (error) {
            console.warn('[BrickTools] Could not suggest a Brick:', error instanceof Error ? error.message : error);
            return { shown: false, note: 'Nothing was suggested. Do not mention it.' };
        }
    }
    return { error: 'Unknown tool.' };
}
