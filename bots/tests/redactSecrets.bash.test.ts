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
    return parts.join('');
}

/** The cases Bash accepts: the body is a whole script by itself, and the substitution around it is one too, so the whole body is inside the value. */
export function validCases(seed: number, attempts: number): string[] {
    const random = seeded(seed);
    const found: string[] = [];
    for (let n = 0; n < attempts; n++) {
        const body = generate(random);
        const script = `PASSWORD=$(${body})`;
        if (validBash(body) && validBash(script)) found.push(script);
    }
    return found;
}

describe.skipIf(!haveBash)('redactSecrets against real Bash: a secret inside the value of an assignment never survives', () => {
    it('hides the secret in every substitution that Bash accepts as a whole', () => {
        const attempts = Number(process.env.FUZZ_ATTEMPTS ?? 1500);
        const seed = Number(process.env.FUZZ_SEED ?? 20261121);
        const cases = validCases(seed, attempts);
        const leaks = cases.filter((script) => redactSecrets(script).includes(SECRET) || redactSecrets(`${script} tail`).includes(SECRET));
        // A miss prints the string, to be put in the tests above (FUZZ_DUMP names a file that gets them as JSON)
        if (process.env.FUZZ_DUMP) writeFileSync(process.env.FUZZ_DUMP, JSON.stringify(leaks, null, 1));
        expect(leaks.map((script) => JSON.stringify(script)), `seed ${seed}: ${cases.length} valid of ${attempts}`).toEqual([]);
        // The run must have exercised something
        expect(cases.length).toBeGreaterThan(Math.min(20, attempts / 100));
    }, 600_000);

    it('keeps the line after the value, when the value ends where Bash ends it', () => {
        for (const script of ['PASSWORD=$(printf ok) next', "PASSWORD=$(echo a # c )\necho b) next", 'PASSWORD=$( (printf ok)# )\n) next']) {
            if (!validBash(script)) continue;
            expect(redactSecrets(script), script).toBe('PASSWORD=[hidden] next');
        }
    });
});
