/**
 * The steps line of a nearby-chat reply (#1545): one line the bot replaces while it uses its tools, not a bubble per call.
 */
import { describe, expect, it } from 'vitest';
import type { AIStreamChunk } from '../ai/types';
import type { StepsField } from '../ai/ToolSteps';
import { withNearbySteps } from '../behaviors/NearbySteps';

const song = (id: string, prompt: string) => ({ id, doing: 'Make a song', done: 'Make a song', detail: prompt, group: 'tool:generate_music' });

async function* reply(chunks: AIStreamChunk[], failAtEnd = false): AsyncGenerator<AIStreamChunk> {
    for (const chunk of chunks) yield chunk;
    if (failAtEnd) throw new Error('provider down');
}

function lineFor(show = true) {
    const state = { aborted: false };
    const sent: Array<{ responseId: string; text: string; isFinal: boolean; field: StepsField }> = [];
    let ids = 0;
    return {
        sent,
        line: {
            shouldShow: async () => show,
            send: (responseId: string, text: string, isFinal: boolean, field: StepsField) => sent.push({ responseId, text, isFinal, field }),
            newResponseId: () => `steps-${++ids}`,
            aborted: () => state.aborted,
        },
        state,
    };
}

async function read(stream: AsyncIterable<AIStreamChunk>, stopAtDone = true): Promise<AIStreamChunk[]> {
    const seen: AIStreamChunk[] = [];
    for await (const chunk of stream) {
        seen.push(chunk);
        if (stopAtDone && chunk.done) break;
    }
    return seen;
}

const toolRound: AIStreamChunk[] = [
    { content: 'On it', done: false },
    { content: '', done: false, reset: true, toolNames: ['generate_music'], toolSteps: [song('a', 'funk'), song('b', 'funk')] },
    { content: '', done: false, toolStepResults: [{ id: 'a', ok: true }, { id: 'b', ok: false, note: 'daily limit reached' }] },
    { content: 'Here it is', done: false },
    { content: '', done: true },
];

describe('withNearbySteps', () => {
    it('replaces one line while the tools run, then folds it to a summary', async () => {
        const { sent, line } = lineFor();
        const seen = await read(withNearbySteps(reply(toolRound), line));

        // The reply sees everything but the results, which only the line needs
        expect(seen.map((c) => c.content)).toEqual(['On it', '', 'Here it is', '']);
        expect(sent.map((s) => s.responseId)).toEqual(['steps-1', 'steps-1', 'steps-1']);
        expect(sent.map((s) => [s.field.state, s.isFinal])).toEqual([
            ['working', false],
            ['working', false],
            ['done', true],
        ]);
        expect(sent[0].text).toBe('Make a song…');
        expect(sent[2].text).toBe("Make a song · 1 didn't work");
        expect(sent[2].field.steps[1]).toMatchObject({ state: 'failed', again: true, note: 'daily limit reached' });
    });

    it('shows nothing when the bot keeps its tool calls hidden', async () => {
        const { sent, line } = lineFor(false);
        const seen = await read(withNearbySteps(reply(toolRound), line));
        expect(sent).toEqual([]);
        expect(seen).toHaveLength(4);
    });

    it('shows nothing for a reply without tools', async () => {
        const { sent, line } = lineFor();
        await read(withNearbySteps(reply([{ content: 'Hi', done: false }, { content: '', done: true }]), line));
        expect(sent).toEqual([]);
    });

    it('marks the line stopped when the reply fails part-way', async () => {
        const { sent, line } = lineFor();
        await expect(read(withNearbySteps(reply(toolRound.slice(0, 2), true), line), false)).rejects.toThrow('provider down');
        expect(sent.at(-1)?.field).toMatchObject({ state: 'stopped', steps: [{ state: 'failed' }, { state: 'failed' }] });
        expect(sent.at(-1)?.isFinal).toBe(true);
    });

    it('marks the line stopped when the reply was cut off', async () => {
        const { sent, line, state } = lineFor();
        for await (const chunk of withNearbySteps(reply(toolRound), line)) {
            if (chunk.reset) {
                state.aborted = true;
                break;
            }
        }
        expect(sent.at(-1)?.field.state).toBe('stopped');
    });

    it('marks the line stopped when the reply fails before its answer came', async () => {
        const { sent, line } = lineFor();
        await expect(
            (async () => {
                for await (const chunk of withNearbySteps(reply(toolRound), line)) {
                    if (chunk.content === 'Here it is') throw new Error('reply broke');
                }
            })()
        ).rejects.toThrow('reply broke');
        expect(sent.at(-1)?.field.state).toBe('stopped');
    });

    it('marks the line stopped when the provider failed part-way', async () => {
        const { sent, line } = lineFor();
        const failed = [...toolRound.slice(0, 3), { content: '', done: true, metadata: { error: true } } as AIStreamChunk];
        await read(withNearbySteps(reply(failed), line));
        expect(sent.at(-1)?.field.state).toBe('stopped');
    });

    it('shows nothing when the reply was cut off before its first step', async () => {
        const { sent, line, state } = lineFor();
        state.aborted = true;
        await read(withNearbySteps(reply(toolRound), line));
        expect(sent).toEqual([]);
    });
});
