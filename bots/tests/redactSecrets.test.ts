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

describe('a label of several lines, or with tabs, is judged and hidden as the machine wrote it', () => {
    it('says a label with a command on any line as a plain description, and never shows an assignment that starts a line', () => {
        for (const label of [
            'Checking service\nPASSWORD=hunter2 curl https://example.test',
            'Checking service\n\tPASSWORD=hunter2',
            'Checking\nTOKEN=hunter2',
            'Opening the form\ncurl -s https://x.test',
            'Reading page\r\nexport KEY=hunter2',
            'PASSWORD=hunter2\nOpening the form',
            'Working\n\n\nT=sk-live-abcdefghijklmnop1234 run.sh + 3 commands',
        ]) {
            const said = safeStepLabel(label);
            expect(looksLikeCommand(label), label).toBe(true);
            expect(said, label).toMatch(new RegExp(`^${PLAIN_STEP}( \\+ \\d+ commands)?$`));
            noSecret(said);
        }
        expect(safeStepLabel('Working\nT=cjt_8f3kQ2mZp0Lx9RtYvB4nWc7HdSa1JeUg curl x + 3 commands')).toBe(`${PLAIN_STEP} + 3 commands`);
    });

    it('hides an assignment after a line break or a tab in any text, keeping the line it was on, and the name', () => {
        expect(redactSecrets('Checking service\nPASSWORD=hunter2 curl https://example.test')).toBe(`Checking service\nPASSWORD=${HIDDEN} curl https://example.test`);
        expect(redactSecrets('Note:\tSECRET=hunter2\tdone')).toBe(`Note:\tSECRET=${HIDDEN}\tdone`);
        expect(redactSecrets('PASSWORD=hunter2\nnext line')).toBe(`PASSWORD=${HIDDEN}\nnext line`);
        expect(redactSecrets('line one\r\n\tKEY="a b c"\r\nline three')).toBe(`line one\r\n\tKEY=${HIDDEN}\r\nline three`);
    });

    it('hides an assignment that begins a line in the computer’s own sentence about why it could not go on', () => {
        for (const words of ['I could not sign in.\nPASSWORD=hunter2 curl https://x.test [[failed]]', 'It refused me after:\n\tTOKEN=hunter2 run [[failed]]', 'Checking service\r\nPASSWORD=hunter2 [[failed]]']) {
            expect(whyOf(words), words).not.toContain('hunter2');
            expect(whyOf(words), words).toContain(HIDDEN);
        }
    });

    it('keeps a description a person can read on one line, with tabs and runs of spaces made single spaces, and its secrets hidden', () => {
        expect(safeStepLabel('Reading   the page\tabout   the visa')).toBe('Reading the page about the visa');
        expect(safeStepLabel(`Note:\tSECRET=hunter2\tdone`)).toBe(`Note: SECRET=${HIDDEN} done`);
    });
});

describe('a value is read whole, as the shell reads a word', () => {
    it('hides a value with an escaped space, an escaped quote, or quotes joined to plain characters, all of it', () => {
        const cases: Array<[string, string]> = [
            ['PASSWORD=two\\ words next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=a\\ b\\ c;echo', `PASSWORD=${HIDDEN};echo`],
            ['PASSWORD="say \\"hi\\" now" next', `PASSWORD=${HIDDEN} next`],
            ["PASSWORD=it\\'s\\ here next", `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=pre"mid dle"post next', `PASSWORD=${HIDDEN} next`],
            ["PASSWORD='two words' next", `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=hunter2 next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD="two words" next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD="never closed words', `PASSWORD=${HIDDEN}`],
            ['x?token=abc&other=1', `x?token=${HIDDEN}&other=${HIDDEN}`],
        ];
        for (const [text, hidden] of cases) {
            expect(redactSecrets(text), text).toBe(hidden);
            for (const left of ['words', 'two', 'dle', 'closed', 'here', 'say', 'hi']) if (!hidden.includes(left)) expect(redactSecrets(text), text).not.toContain(left);
        }
    });

    it('hides an unclosed double quote that ends in a lone backslash, and the rest of an incomplete escape', () => {
        expect(redactSecrets('PASSWORD="hunter2\\')).toBe(`PASSWORD=${HIDDEN}`);
        expect(redactSecrets('warn: PASSWORD="hunter2 two\\')).toBe(`warn: PASSWORD=${HIDDEN}`);
        expect(redactSecrets('PASSWORD=hunter2\\')).toBe(`PASSWORD=${HIDDEN}`);
    });

    it('hides a command substitution, a backtick command or an expansion in a value, all of it', () => {
        const cases: Array<[string, string]> = [
            ["PASSWORD=$(printf '%s' 'hunter2') next", `PASSWORD=${HIDDEN} next`],
            ["PASSWORD=$(printf '%s' 'hunter2')", `PASSWORD=${HIDDEN}`],
            ['PASSWORD=$(echo "a ) b" | tr a-z A-Z) next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=$(cat $(echo hunter2.txt)) next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=$((1 + 2)) next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=`printf hunter2 x` next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD=${HUNTER:-hunter2 x} next', `PASSWORD=${HIDDEN} next`],
            ['PASSWORD="$(printf hunter2 x) y" next', `PASSWORD=${HIDDEN} next`],
            ["PASSWORD=pre$(printf '%s' 'hunter2')post next", `PASSWORD=${HIDDEN} next`],
            // where the end cannot be told, the rest of the text goes
            ["PASSWORD=$(printf '%s' 'hunter2'", `PASSWORD=${HIDDEN}`],
            ['PASSWORD=`printf hunter2 x', `PASSWORD=${HIDDEN}`],
            ['A=1 B=$(printf hunter2 x) C=3', `A=${HIDDEN} B=${HIDDEN} C=${HIDDEN}`],
        ];
        for (const [text, hidden] of cases) {
            expect(redactSecrets(text), text).toBe(hidden);
            expect(redactSecrets(text), text).not.toContain('hunter2');
        }
    });

    it('also hides it where the computer says why it could not go on, and in a label', () => {
        expect(whyOf('It refused me: PASSWORD=two\\ words [[failed]]')).not.toContain('words');
        expect(safeStepLabel('Signing in with PASSWORD=two\\ words now')).toBe(`Signing in with PASSWORD=${HIDDEN} now`);
    });
});

describe('a command given by its path, or by a terminal tool, is never shown', () => {
    it('says a command that starts with a path as a plain description, whatever follows', () => {
        for (const command of ['/usr/bin/python3 login.py alice hunter2', './run.sh alice hunter2', '~/bin/login alice hunter2', '../tools/login alice hunter2', 'cd /tmp; /opt/app/login alice hunter2', '/usr/bin/python3 login.py alice hunter2 + 2 commands']) {
            expect(looksLikeCommand(command), command).toBe(true);
            expect(safeStepLabel(command), command).toMatch(new RegExp(`^${PLAIN_STEP}( \\+ \\d+ commands)?$`));
            noSecret(safeStepLabel(command));
        }
        expect(safeStepLabel('/usr/bin/python3 login.py alice hunter2 + 2 commands')).toBe(`${PLAIN_STEP} + 2 commands`);
    });

    it('keeps an ordinary description that only mentions a path or a slash', () => {
        for (const label of ['Opening the file at /home/user/notes', 'Reading and/or editing the form', 'Opening https://example.test/account', 'Typing 12/05/2026 in the date box']) {
            expect(looksLikeCommand(label), label).toBe(false);
            expect(safeStepLabel(label), label).toBe(label);
        }
    });

    it('says a terminal tool’s label as a plain description even when it reads like a sentence, and keeps a browser tool’s label', () => {
        expect(safeStepLabel('login alice hunter2', 'terminal')).toBe(PLAIN_STEP);
        expect(safeStepLabel('login alice hunter2 + 3 commands', 'shell')).toBe(`${PLAIN_STEP} + 3 commands`);
        expect(safeStepLabel('Opening the form', 'browser')).toBe('Opening the form');
        const terminal = runnerEventOf(JSON.stringify({ type: 'tool', state: 'started', tool: 'terminal', label: 'login alice hunter2' }));
        expect(terminal).toMatchObject({ type: 'tool', label: PLAIN_STEP });
        const path = runnerEventOf(JSON.stringify({ type: 'tool', state: 'started', tool: 'browser', label: '/usr/bin/python3 login.py alice hunter2' }));
        expect(path).toMatchObject({ type: 'tool', label: PLAIN_STEP });
        noSecret(JSON.stringify([terminal, path]));
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
