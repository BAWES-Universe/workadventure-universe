/**
 * Keeps secrets out of anything that leaves the bot server as words for people or for logs: the step label of a computer job (it reaches Orbit, the
 * person's screen and Activity), the computer's own sentence about why it could not go on, and the logs of the runner.
 *
 * A machine's tools show raw commands, and a raw command carries what the machine was given to run it: the job's own key in an environment assignment
 * (`T=cjt_… curl …`), an `Authorization: Bearer …` header, a `-H` header, a URL with a password in it. Every such part is hidden; and a label that is
 * a raw command at all is said as a plain description instead.
 */

export const HIDDEN = '[hidden]';

/** What a label says when the machine's step is a command: a plain description, never the command. */
export const PLAIN_STEP = 'Working on the computer';

/** Tokens that are secrets by their shape: Universe's job keys (`cjt_…`), provider keys (`sk-…`), GitHub, Slack and AWS style tokens, JWTs. */
const KNOWN_TOKENS = /\b(?:cjt_[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;

/** `Authorization: Bearer x`, `Authorization: Basic x`, `Bearer x`, with or without quotes around the header. */
const AUTH_HEADER = /\b(Authorization|Proxy-Authorization)\s*[:=]\s*(?:Bearer|Basic|Token)?\s*[^\s'"]+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;

/** A header given to a command: `-H 'X-Api-Key: …'`, `--header "…"`. The whole header goes, whatever it holds. */
const HEADER_FLAG = /(^|\s)(-H|--header)(?:\s+|=)(?:'[^']*'|"[^"]*"|\S+)/g;

/** A URL with credentials in it: `https://user:pass@host`, `https://token@host`. */
const URL_CREDENTIALS = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@'"]+@/g;

/** Where a shell assignment `NAME=` begins (an environment variable given to a command, or a query parameter); its value is read by `endOfShellWord`. */
const ASSIGNMENT_START = /(^|[\s;&|?(])([A-Za-z_][A-Za-z0-9_]*)=/g;

/**
 * Where the value that starts at `from` ends, read as the shell reads one word: plain characters, an escaped character (`two\ words`, `a\"b`, a lone
 * backslash at the end), a double-quoted part (escapes inside it), a single-quoted part, a command substitution (`$(…)` with its own quotes and
 * parentheses, `$((…))`, backticks) and a `${…}` expansion, any of them joined (`a"b c"d`). A quote, a substitution or a brace that is never closed runs to
 * the end of the text, since where its value ends cannot be told, and nothing of it may be left showing.
 */
function endOfShellWord(text: string, from: number): number {
    const quoted = (start: number, quote: '"' | "'"): number => {
        // `start` is the character after the opening quote; returns the index after the closing quote (or the end)
        let i = start;
        while (i < text.length) {
            const c = text[i];
            if (quote === '"' && c === '\\') i += 2;
            else if (c === quote) return i + 1;
            else if (quote === '"' && c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) i = nested(i + 1);
            else if (quote === '"' && c === '`') i = backticks(i + 1);
            else i++;
        }
        return text.length;
    };
    const backticks = (start: number): number => {
        let i = start;
        while (i < text.length) {
            if (text[i] === '\\') i += 2;
            else if (text[i] === '`') return i + 1;
            else i++;
        }
        return text.length;
    };
    // `open` is the index of the `(` or `{` after a `$`; returns the index after its balanced close (or the end)
    const nested = (open: number): number => {
        const stack: string[] = [text[open] === '(' ? ')' : '}'];
        let i = open + 1;
        while (i < text.length && stack.length > 0) {
            const c = text[i];
            if (c === '\\') i += 2;
            else if (c === "'") i = quoted(i + 1, "'");
            else if (c === '"') i = quoted(i + 1, '"');
            else if (c === '`') i = backticks(i + 1);
            else if (c === '(') {
                stack.push(')');
                i++;
            } else if (c === '{' && text[i - 1] === '$') {
                stack.push('}');
                i++;
            } else if (c === stack[stack.length - 1]) {
                stack.pop();
                i++;
            } else i++;
        }
        return stack.length > 0 ? text.length : i;
    };
    let i = from;
    while (i < text.length) {
        const c = text[i];
        if (c === '\\') i += 2;
        else if (c === '"' || c === "'") i = quoted(i + 1, c);
        else if (c === '`') i = backticks(i + 1);
        else if (c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) i = nested(i + 1);
        else if (/[\s&;|)]/.test(c)) break;
        else i++;
    }
    return Math.min(i, text.length);
}

/** Hides the value of every shell assignment in the text (and of every query parameter), keeping the name. */
function hideAssignments(text: string): string {
    let out = '';
    let at = 0;
    ASSIGNMENT_START.lastIndex = 0;
    for (let found = ASSIGNMENT_START.exec(text); found !== null; found = ASSIGNMENT_START.exec(text)) {
        const end = endOfShellWord(text, found.index + found[0].length);
        out += `${text.slice(at, found.index)}${found[1]}${found[2]}=${HIDDEN}`;
        at = end;
        ASSIGNMENT_START.lastIndex = Math.max(end, found.index + found[0].length);
    }
    return out + text.slice(at);
}

/** A long run of letters and digits with at least one digit (base64, hex, an id used as a secret) that is no word. */
const LONG_OPAQUE = /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_-])/g;

/** The words that start a raw command (at the start of the label or of a part after `;`, `&`, `|`, `(`), and the shapes only a command has. */
const COMMAND_WORDS =
    /(^|[;&|(]\s*)(curl|wget|bash|sh|zsh|python3?|node|npm|npx|pnpm|yarn|sudo|cd|export|echo|cat|grep|sed|awk|chmod|chown|rm|mv|cp|ssh|scp|git|pip3?|apt(?:-get)?|docker|kill|pkill|nohup|xdotool|xclip|jq|tee|printf|eval|exec|env|source|ls|mkdir|touch|tar|unzip)(?=\s|$)/;
/** A command given by its path (`/usr/bin/python3 login.py …`, `./run.sh`, `~/bin/tool`, `../x`): the first word of the label, or of a part after `;`, `&`, `|`, `(`. */
const EXECUTABLE_PATH = /(^|[;&|(]\s*)(?:\.{0,2}\/|~\/)[^\s;&|()]+(?=\s|$)/;
const COMMAND_SHAPES = /&&|\|\||\$\(|`|\s\|\s|\s>>?\s|\s2>&?1|(^|\s)--?[A-Za-z][\w-]*(\s|=|$)|\\\n|\n/;

/** Hides every part of the text that is a secret, by its place (a header, an assignment, a URL's credentials) or by its shape (a known key, a long opaque run). */
export function redactSecrets(text: string): string {
    const redacted = text
        .replace(AUTH_HEADER, (_m, name: string) => `${name}: ${HIDDEN}`)
        .replace(HEADER_FLAG, (_m, space: string, flag: string) => `${space}${flag} ${HIDDEN}`)
        .replace(BEARER, (_m, word: string) => `${word} ${HIDDEN}`)
        .replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${HIDDEN}@`)
        // By shape first: a base64 run ends in `=`, which an assignment would read as its own
        .replace(KNOWN_TOKENS, HIDDEN)
        .replace(LONG_OPAQUE, HIDDEN);
    return hideAssignments(redacted);
}

/** Whether the tool that ran is a terminal or a shell: what it shows as its label is the command itself. */
export function isTerminalTool(tool: string | undefined): boolean {
    return typeof tool === 'string' && /terminal|shell|bash|command|exec|process/i.test(tool);
}

/** Whether a label is a raw command (or has what only a raw command has), rather than a description a person can read. */
export function looksLikeCommand(label: string): boolean {
    const text = label.trim();
    // Starts with an assignment (`T=… curl …`), or holds a command word or a command's shapes
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text) || COMMAND_WORDS.test(text) || EXECUTABLE_PATH.test(text) || COMMAND_SHAPES.test(text);
}

/**
 * A step's label as it may leave the bot server: a description is kept (with anything secret in it hidden), a raw command is said as a plain description.
 * The count the machine adds after a command ("+ 7 commands") is kept: it says how much was done, and holds nothing.
 */
export function safeStepLabel(label: string, tool?: string): string {
    // Read as the machine wrote it: the line breaks and tabs are what tell a command (`Checking\nPASSWORD=… curl …`) from a description, and where an
    // assignment begins, so nothing is collapsed before the label has been judged and its secrets hidden
    // The machine's own word for the kind of tool is the surest sign: a terminal's label is a command, whatever it looks like. The text check is for the rest
    if (isTerminalTool(tool) || looksLikeCommand(label)) {
        const more = /\+\s*(\d+)\s+(commands?|steps?)\s*$/i.exec(label.trim());
        return more ? `${PLAIN_STEP} + ${more[1]} ${more[2].toLowerCase()}` : PLAIN_STEP;
    }
    return redactSecrets(label).replace(/\s+/g, ' ').trim();
}
