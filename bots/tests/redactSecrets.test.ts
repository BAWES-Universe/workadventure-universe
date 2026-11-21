import { describe, expect, it, vi } from 'vitest';
import { createComputerRunner, whyOf, type RunnableJob, type RunnerEvent, type RunnerOrbit, type TurnOpened } from '../server/ComputerRunner';
import { runnerEventOf } from '../server/ComputerTurnStream';
import { HIDDEN, PLAIN_STEP, looksLikeCommand, redactSecrets, safeStepLabel } from '../server/redactSecrets';

// The shapes seen on a real machine on dev: the job's own key in an assignment in front of the command, "+ N commands" after it
const KEY = 'cjt_8f3kQ2mZp0Lx9RtYvB4nWc7HdSa1JeUg';
const RAW = `T=${KEY} curl -s -m 10 -H "Authorization: Bearer ${KEY}" https://bot-server.example.test/v1/models + 7 commands`;
const SECRETS = [KEY, 'hunter2', 'sk-live-abcdefghijklmnop1234', 'dXNlcjpzZWNyZXRwYXNzd29yZDEyMzQ1Njc4OTA='];

const noSecret = (text: string) => {
    for (const secret of SECRETS) expect(text, `"${secret}" in: ${text}`).not.toContain(secret);
};

describe('hiding what a raw command carries', () => {
    it('says a command that starts with the job’s own key in an assignment as a plain description, keeping the count', () => {
        const label = safeStepLabel(RAW);
        expect(label).toBe(`${PLAIN_STEP} + 7 commands`);
        noSecret(label);
        expect(safeStepLabel(`T=${KEY} + 1 command`)).toBe(`${PLAIN_STEP} + 1 command`);
        expect(safeStepLabel(`T=${KEY}`)).toBe(PLAIN_STEP);
    });

    it('says any raw command as a plain description, whatever it holds', () => {
        for (const command of [
            'curl -s https://example.test/health',
            'cd /tmp && ls -la',
            'export TOKEN=abc123 && node run.js',
            "python3 -c 'print(1)'",
            'cat notes.txt | grep visa',
            'echo done > out.txt',
            'sudo apt-get install xdotool',
            'wget https://example.test/file.zip',
        ]) {
            expect(looksLikeCommand(command), command).toBe(true);
            expect(safeStepLabel(command), command).toBe(PLAIN_STEP);
        }
    });

    it('keeps a description a person can read, as it was', () => {
        for (const label of ['Opening the form', 'Typing the dates', "Clicking 'Submit'", 'Click export to PDF', 'Reading the page about the visa', 'Opening the cat photo gallery', 'Scrolling down']) {
            expect(looksLikeCommand(label), label).toBe(false);
            expect(safeStepLabel(label), label).toBe(label);
        }
    });

    it('hides a secret inside a description too: a header, an assignment, a URL with a password, a key by its shape', () => {
        noSecret(safeStepLabel(`Opening https://user:hunter2@example.test/account`));
        expect(safeStepLabel('Opening https://user:hunter2@example.test/account')).toBe(`Opening https://${HIDDEN}@example.test/account`);
        noSecret(safeStepLabel(`Using ${KEY} to sign in`));
        noSecret(safeStepLabel('Pasting sk-live-abcdefghijklmnop1234 into the form'));
        expect(safeStepLabel(`Using ${KEY} to sign in`)).toBe(`Using ${HIDDEN} to sign in`);
    });
});

describe('hiding secrets in any text', () => {
    it('hides an Authorization header, a Bearer token, and a header given to a command', () => {
        expect(redactSecrets('Authorization: Bearer hunter2')).toBe(`Authorization: ${HIDDEN}`);
        expect(redactSecrets('authorization=Bearer hunter2')).toBe(`authorization: ${HIDDEN}`);
        expect(redactSecrets('sent Bearer hunter2abc to the service')).toBe(`sent Bearer ${HIDDEN} to the service`);
        expect(redactSecrets("curl -H 'X-Api-Key: hunter2' https://x.test")).toBe(`curl -H ${HIDDEN} https://x.test`);
        expect(redactSecrets('curl --header "Cookie: session=hunter2" https://x.test')).toBe(`curl --header ${HIDDEN} https://x.test`);
        expect(redactSecrets('curl -H "Authorization: Bearer hunter2" https://x.test')).not.toContain('hunter2');
    });

    it('hides the value of an assignment, and of a query parameter, and keeps the name', () => {
        expect(redactSecrets(`T=${KEY} run`)).toBe(`T=${HIDDEN} run`);
        expect(redactSecrets('KEY="a b c" TOKEN=\'x y\' run')).toBe(`KEY=${HIDDEN} TOKEN=${HIDDEN} run`);
        expect(redactSecrets('https://x.test/path?token=hunter2&page=2')).toBe(`https://x.test/path?token=${HIDDEN}&page=${HIDDEN}`);
    });

    it('hides credentials in a URL, with or without a password, and nothing after the @', () => {
        expect(redactSecrets('https://user:hunter2@example.test/a/b')).toBe(`https://${HIDDEN}@example.test/a/b`);
        expect(redactSecrets('git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y')).toBe(`git clone https://${HIDDEN}@github.com/x/y`);
        expect(redactSecrets('mail me at someone@example.test')).toBe('mail me at someone@example.test');
    });

    it('hides a key by its shape wherever it stands: a job key, a provider key, a JWT, a long base64 or hex run', () => {
        expect(redactSecrets(`the key is ${KEY}.`)).toBe(`the key is ${HIDDEN}.`);
        expect(redactSecrets('sk-live-abcdefghijklmnop1234')).toBe(HIDDEN);
        expect(redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r')).toBe(HIDDEN);
        expect(redactSecrets('dXNlcjpzZWNyZXRwYXNzd29yZDEyMzQ1Njc4OTA=')).toBe(HIDDEN);
        expect(redactSecrets('a3f9c2e17b4d8a60f1e2d3c4b5a69788')).toBe(HIDDEN);
    });

    it('leaves ordinary words, numbers, dates and short ids alone', () => {
        for (const text of ['Booked the visa appointment for 12 December at 10:30', 'Order 48213 is confirmed', 'internationalization-and-localization-guidelines', 'job-1 brick-1', 'See https://example.test/visa/apply']) {
            expect(redactSecrets(text), text).toBe(text);
        }
    });
});

describe('what leaves the runner', () => {
    const JOB: RunnableJob = { jobId: 'job-1', botId: 'brick-1', title: 'Visa form', brief: null, writes: false, hasTurn: false };
    const stream = (events: RunnerEvent[]): TurnOpened => ({ ok: true, events: (async function* () { for (const event of events) yield event; })() });
    const rig = (turns: RunnerEvent[][], warn = vi.fn()) => {
        const actions: Array<Record<string, unknown>> = [];
        const orbit: RunnerOrbit = {
            running: async () => [JOB],
            job: async () => ({ status: 'running', control: 'brick' }),
            action: async (_b, _j, body) => (actions.push(body), { ok: true }),
            prepare: async () => ({ ok: true }),
            turn: async () => stream(turns.shift() ?? []),
            stream: async () => stream(turns.shift() ?? []),
            cancel: async () => undefined,
        };
        const runner = createComputerRunner({ orbit, relayUrl: 'https://bot-server.example.test', sleep: async () => undefined, log: { warn, error: vi.fn(), info: vi.fn() }, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0], prepareMs: [0] } });
        return { actions, run: async () => { await runner.tick(); await runner.idle(); }, warn };
    };

    it('sends Orbit a plain description for a step that is a raw command with the job’s key in it', async () => {
        const { actions, run } = rig([
            [
                { type: 'created', id: 'r', sessionId: 's' },
                { type: 'tool', state: 'started', tool: 'terminal', label: RAW },
                { type: 'tool', state: 'completed', tool: 'terminal' },
                { type: 'completed', outputText: '[[done]]', usage: null },
            ],
        ]);
        await run();
        const labels = actions.filter((a) => a.action === 'progress').map((a) => a.label);
        expect(labels.length).toBeGreaterThan(0);
        expect(new Set(labels)).toEqual(new Set([`${PLAIN_STEP} + 7 commands`]));
        noSecret(JSON.stringify(actions));
    });

    it('sends nothing secret in the sentence the computer gave for why it could not go on', async () => {
        const words = `I ran T=${KEY} curl -H "Authorization: Bearer ${KEY}" https://user:hunter2@x.test and it refused me. [[failed]]`;
        expect(whyOf(words)).not.toContain(KEY);
        expect(whyOf(words)).not.toContain('hunter2');
        const { actions, run } = rig([[{ type: 'created', id: 'r', sessionId: 's' }, { type: 'completed', outputText: words, usage: null }]]);
        await run();
        const finish = actions.find((a) => a.action === 'finish');
        expect(finish).toMatchObject({ outcome: 'failed', cause: 'agent' });
        noSecret(JSON.stringify(actions));
    });

    it('logs nothing secret when a failure carries an address or a header in its message', async () => {
        const warn = vi.fn();
        const orbit: RunnerOrbit = {
            running: async () => [JOB],
            job: async () => ({ status: 'running', control: 'brick' }),
            action: async () => {
                throw new Error(`Request to https://user:hunter2@orbit.example.test failed with Authorization: Bearer ${KEY}`);
            },
            prepare: async () => ({ ok: true }),
            turn: async () => stream([{ type: 'created', id: 'r', sessionId: 's' }, { type: 'completed', outputText: '[[done]]', usage: null }]),
            stream: async () => stream([]),
            cancel: async () => undefined,
        };
        const runner = createComputerRunner({ orbit, relayUrl: 'https://bot-server.example.test', sleep: async () => undefined, log: { warn, error: vi.fn(), info: vi.fn() }, timing: { waitMs: 0, progressMs: 0, reconnectMs: [0], prepareMs: [0] } });
        await runner.tick();
        await runner.idle();
        expect(warn).toHaveBeenCalled();
        noSecret(JSON.stringify(warn.mock.calls));
        expect(JSON.stringify(warn.mock.calls)).toContain(HIDDEN);
    });

    it('hides it already where the stream is read: a step’s label, a tool error and a failure message', () => {
        const tool = runnerEventOf(JSON.stringify({ type: 'tool', state: 'started', tool: 'terminal', label: RAW, error: `curl failed: Authorization: Bearer ${KEY}` }));
        expect(tool).toMatchObject({ type: 'tool', label: `${PLAIN_STEP} + 7 commands` });
        noSecret(JSON.stringify(tool));
        const failed = runnerEventOf(JSON.stringify({ type: 'failed', code: 'model_error', message: `401 for https://user:hunter2@x.test with key ${KEY}` }));
        expect(failed).toMatchObject({ type: 'failed', code: 'model_error' });
        noSecret(JSON.stringify(failed));
    });
});
