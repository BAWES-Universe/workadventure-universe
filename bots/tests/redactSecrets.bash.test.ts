import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../server/redactSecrets';

/**
 * A differential test of the shell-word scanner behind `redactSecrets` against real Bash: seeded random command substitutions are built from the
 * tokens that decide where one ends (blanks, line breaks, `; & | ( ) < > # ' " \ $ ` $( ${`, comments, here-documents, `case`), only the ones Bash itself
 * accepts as a whole (`bash -n`, which parses and runs nothing) are kept, and the secret that sits inside such a value must never survive. The committed
 * run is small (it spawns one Bash for each try); FUZZ_ATTEMPTS and FUZZ_SEED run it for as long as is wanted, and a miss prints the string.
 */
const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const haveBash = bash.status === 0 && bash.stdout.trim() === 'ok';
const SECRET = 'hunter2';

/** The text as Bash reads it once its line continuations are out: a word that a continuation split is one word again. */
const joined = (text: string): string => text.replace(/\\\n/g, '');
/** Whether the secret is in the text, as it was written or as Bash reads it (a continuation inside the marker hides it from a plain search). */
const showsSecret = (text: string): boolean => text.includes(SECRET) || joined(text).includes(SECRET);

/** Whether Bash parses the whole text as a script (and nothing more is done with it). */
const validBash = (script: string): boolean => spawnSync('bash', ['-n'], { input: script, encoding: 'utf8', timeout: 5000 }).status === 0;

function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const RAW = [' ', ' ', '\n', ';', '&', '|', '(', ')', '(', ')', '<', '>', '<<', '#', '#', "'", '"', '\\', '$', '`', '$(', '${', '}', '{', '$((', '))', 'x', 'echo', 'case', 'esac', 'in', 'a', ';;', '$\'', '<<-', '<<<', '[[', ']]', 'if', 'then', 'fi', 'do', 'done', '!', '&&', '||', ';;&', '$#', '${#', '\\\n'];
const FRAGMENTS = [
    'echo a',
    "printf '%s' x",
    '(echo a)',
    '{ echo a; }',
    'echo a # c )\n',
    '# c )\n',
    '(printf ok)# )\n',
    'echo "a)"',
    "echo ')'",
    'echo $(echo a)',
    'echo ${#x}',
    'echo $#',
    'echo a#b',
    'cat <<EOF\nz )\nEOF\n',
    "cat <<-'EOF'\n\tz )\n\tEOF\n",
    'cat <<< x',
    'case a in a) echo;; esac',
    'case a in (a) echo;; *) :;; esac',
    'echo `echo a`',
    'echo $((1 + 2))',
    'echo a \\\n b',
    'x=1',
    'a[1]=x',
    'a[ ) ]=x',
    'echo a\\ #b )\n',
    'echo \\;# )\n',
    'echo a\\\n# )\n',
    'echo a[0-9]',
    'echo $((1 + (2 * 3)))',
    'echo $((;# ( x ))',
    '(echo a)',
    'echo $(( 1 )) # )\n',
    'x=$((2))',
    'echo ${a[1]}',
    `echo ${SECRET}`,
    `echo '${SECRET} )'`,
    `echo "${SECRET} )"`,
    `# ${SECRET} )\n`,
    `echo a # ${SECRET} )\n`,
    `(printf ok)# ${SECRET} )\n`,
    `cat <<EOF\n${SECRET} )\nEOF\n`,
    `case x in x) echo ${SECRET};; esac`,
    `echo $(echo ${SECRET})`,
    `echo $(# )\n ${SECRET})`,
    `echo \`echo ${SECRET}\``,
    `echo \\\n ${SECRET}`,
    `echo $'it\\'s ${SECRET}'`,
    `echo ${SECRET}`,
];
/** How much of a try is made of whole fragments rather than loose tokens: FUZZ_FRAGMENTS (0 to 1) shifts it. */
const FRAGMENT_SHARE = Number(process.env.FUZZ_FRAGMENTS ?? 0.7);
const CONTINUED_SHARE = Number(process.env.FUZZ_CONTINUED ?? 0.35);
const SEPARATORS = ['', ' ', '\n', ';', '; ', ' && ', ' | ', ' || ', '\n\n', ' ; '];

function generate(random: () => number): string {
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const parts: string[] = [];
    const count = 1 + Math.floor(random() * 5);
    let hasSecret = false;
    for (let n = 0; n < count; n++) {
        const piece = random() < FRAGMENT_SHARE ? pick(FRAGMENTS) : Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(RAW)).join(random() < 0.5 ? '' : ' ');
        if (piece.includes(SECRET)) hasSecret = true;
        parts.push(piece);
        if (n < count - 1) parts.push(pick(SEPARATORS));
    }
    if (!hasSecret) parts.splice(Math.floor(random() * (parts.length + 1)), 0, random() < 0.5 ? SECRET : ` ${SECRET} `);
    let body = parts.join('');
    // A share of the bodies have line continuations put in at random: Bash takes them out before it reads a word, so a keyword or a marker may be split by one
    if (random() < CONTINUED_SHARE) {
        for (let n = 1 + Math.floor(random() * 3); n > 0; n--) {
            const at = Math.floor(random() * (body.length + 1));
            body = `${body.slice(0, at)}\\\n${body.slice(at)}`;
        }
    }
    return body;
}

/** The cases Bash accepts: the body is a whole script by itself, and the substitution around it is one too, so the whole body is inside the value. */
export function validCases(seed: number, attempts: number): string[] {
    const random = seeded(seed);
    const found: string[] = [];
    for (let n = 0; n < attempts; n++) {
        const body = generate(random);
        const script = `PASSWORD=$(${body})`;
        // Only a try that has the secret in it, as Bash reads it, can show that redaction kept it: a continuation may split the only one
        if (validBash(body) && validBash(script) && showsSecret(script)) found.push(script);
    }
    return found;
}

/** What the other passes of the redaction hide: a header, a Bearer token, a header flag, a URL login, a key by its shape, a standalone header. */
const MATERIAL = ['Authorization=abc', 'authorization=Bearer abc', 'x Bearer abcdef', 'https://u:p@h/', 'sk-live-abcdefghijklmnop1234', 'cjt_8f3kQ2mZp0Lx9RtYvB4nWc7HdSa1JeUg', 'Proxy-Authorization: Basic abc', "-H 'X-Key: abc'", '-H "X-Key: abc"', 'dXNlcjpzZWNyZXRwYXNzd29yZDEyMzQ1Njc4OTA=', 'q?token=abc&b=1'];
/** The loose parts of the inside of a double-quoted value: no unescaped double quote, so the secret is inside it by construction. */
const QUOTED_PARTS = [' ', ' ', 'a', 'x1', '\\"', '\\\\', '\\\n', '$x', '${x}', '$(echo a)', '#', "'", ')', '(', ';', '&', '|', '<', '>', SECRET, SECRET, ...MATERIAL.filter((one) => !one.includes('"'))];

/** Whether the secret survives in any text built round a value: the other passes' parts before it, after it, and both. */
function leaksAround(assignment: string, random: () => number): string | null {
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const before = pick(MATERIAL);
    const after = pick(MATERIAL);
    for (const text of [assignment, `${before} ${assignment}`, `${assignment} ${after}`, `${before} ${assignment} ${after}`, `${assignment} next`]) {
        if (showsSecret(redactSecrets(text))) return text;
    }
    return null;
}

describe.skipIf(!haveBash)('redactSecrets against real Bash: where the other passes are on, and where a keyword is split by a continuation', () => {
    it('hides the secret in a quoted value, whatever the other passes hid round it, in both orders of text', () => {
        const attempts = Number(process.env.FUZZ_QUOTED ?? 1500);
        const random = seeded(Number(process.env.FUZZ_SEED ?? 20261121) + 7);
        const leaks: string[] = [];
        let valid = 0;
        for (let n = 0; n < attempts; n++) {
            const body = Array.from({ length: 1 + Math.floor(random() * 8) }, () => QUOTED_PARTS[Math.floor(random() * QUOTED_PARTS.length)]).join(random() < 0.5 ? '' : ' ');
            if (!body.includes(SECRET)) continue;
            const assignment = `PASSWORD="${body}"`;
            if (!validBash(assignment) || !showsSecret(assignment)) continue;
            valid++;
            const leaked = leaksAround(assignment, random);
            if (leaked) leaks.push(JSON.stringify(leaked));
        }
        if (process.env.FUZZ_DUMP) writeFileSync(`${process.env.FUZZ_DUMP}.quoted`, JSON.stringify(leaks, null, 1));
        expect(leaks, `${valid} valid of ${attempts}`).toEqual([]);
        expect(valid).toBeGreaterThan(Math.min(20, attempts / 100));
    }, 600_000);

    it('hides the secret in a substitution with the other passes on round it', () => {
        const attempts = Number(process.env.FUZZ_ATTEMPTS ?? 1500) / 3;
        const random = seeded(Number(process.env.FUZZ_SEED ?? 20261121) + 11);
        const leaks: string[] = [];
        for (const script of validCases(Number(process.env.FUZZ_SEED ?? 20261121) + 13, attempts)) {
            const leaked = leaksAround(script, random);
            if (leaked) leaks.push(JSON.stringify(leaked));
        }
        if (process.env.FUZZ_DUMP) writeFileSync(`${process.env.FUZZ_DUMP}.around`, JSON.stringify(leaks, null, 1));
        expect(leaks).toEqual([]);
    }, 600_000);

    it('hides the secret when a continuation splits a keyword or a marker at any place', () => {
        const bodies = [
            `case x in x) printf ${SECRET};; esac`,
            `case "$x" in (a) echo a;; *) printf ${SECRET};; esac`,
            `cat <<EOF\nx )\n${SECRET}\nEOF\n`,
            `cat <<-'EOF'\n\tx )\n\t${SECRET}\n\tEOF\n`,
            `echo a # ) \n printf ${SECRET}`,
            `printf ${SECRET}; (echo a)# ) \n`,
            `a[ ) ]=x; echo ${SECRET}`,
            `echo $(echo ${SECRET}) \${#x} $#`,
            `echo \${x:-${SECRET}} $'it\\'s ${SECRET}'`,
            `echo \`echo ${SECRET}\` $((1 + 2))`,
            `if true; then echo ${SECRET}; fi`,
        ];
        const leaks: string[] = [];
        let valid = 0;
        for (const body of bodies) {
            for (let at = 0; at <= body.length; at++) {
                const split = `${body.slice(0, at)}\\\n${body.slice(at)}`;
                const script = `PASSWORD=$(${split})`;
                // Only a split that leaves the secret in the text as Bash reads it can show that redaction kept it (one that splits the marker itself leaves
                // none in the raw text, and an unchanged text would pass)
                if (!validBash(split) || !validBash(script) || !showsSecret(script)) continue;
                valid++;
                for (const text of [script, `${script} next`, `${MATERIAL[1]} ${script}`]) if (showsSecret(redactSecrets(text))) leaks.push(JSON.stringify(text));
            }
        }
        expect(leaks, `${valid} valid splits`).toEqual([]);
        expect(valid).toBeGreaterThan(100);
    }, 600_000);
});


describe.skipIf(!haveBash)('redactSecrets against real Bash: a secret inside the value of an assignment never survives', () => {
    it('hides the secret in every substitution that Bash accepts as a whole', () => {
        const attempts = Number(process.env.FUZZ_ATTEMPTS ?? 1500);
        const seed = Number(process.env.FUZZ_SEED ?? 20261121);
        const cases = validCases(seed, attempts);
        const leaks = cases.filter((script) => showsSecret(redactSecrets(script)) || showsSecret(redactSecrets(`${script} tail`)));
        // A miss prints the string, to be put in the tests above (FUZZ_DUMP names a file that gets them as JSON)
        if (process.env.FUZZ_DUMP) writeFileSync(process.env.FUZZ_DUMP, JSON.stringify(leaks, null, 1));
        expect(leaks.map((script) => JSON.stringify(script)), `seed ${seed}: ${cases.length} valid of ${attempts}`).toEqual([]);
        // The run must have exercised something
        expect(cases.length).toBeGreaterThan(Math.min(20, attempts / 100));
    }, 600_000);

    it('hides an assignment on the line after a comment that ends in a backslash: Bash starts a new line there, whatever the comment holds', () => {
        for (const script of [`# note!\\\nPASSWORD=${SECRET}`, `echo a # c\\\nPASSWORD=${SECRET} next`, `# a\\\n# b\\\nPASSWORD=${SECRET}`]) {
            // a real new line, and a real assignment: Bash accepts it, and what it holds is hidden
            expect(validBash(script), script).toBe(true);
            expect(redactSecrets(script), script).not.toContain(SECRET);
        }
    });

    it('detects a secret that stays in the text: the fixtures that hold one count, and a split marker is read as Bash reads it', () => {
        // a continuation inside the marker: the raw text does not hold it, the text as Bash reads it does
        const split = `printf hun\\\nter2`;
        expect(split.includes(SECRET)).toBe(false);
        expect(showsSecret(split)).toBe(true);
        // an input returned unchanged would be caught
        expect(showsSecret(`PASSWORD=$(${split})`)).toBe(true);
        expect(showsSecret(redactSecrets(`PASSWORD=$(${split})`))).toBe(false);
    });

    it('keeps the line after the value, when the value ends where Bash ends it', () => {
        for (const script of ['PASSWORD=$(printf ok) next', "PASSWORD=$(echo a # c )\necho b) next", 'PASSWORD=$( (printf ok)# )\n) next', 'PASSWORD=$((1 << 2)) next', 'PASSWORD=$((1<<2)) next', 'PASSWORD=$((1 + (2 << 3))) next']) {
            if (!validBash(script)) continue;
            expect(redactSecrets(script), script).toBe('PASSWORD=[hidden] next');
        }
    });
});
