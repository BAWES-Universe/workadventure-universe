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
const AUTH_HEADER = /\b(Authorization|Proxy-Authorization)\s*[:=]\s*(?:Bearer|Basic|Token)?\s*(?:\\[\s\S]|[^\s'"\\])+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;

/** A header given to a command: `-H 'X-Api-Key: …'`, `--header "…"`. The whole header goes, whatever it holds. */
const HEADER_FLAG = /(^|\s)(-H|--header)(?:\s+|=)(?:'[^']*'|"(?:[^"\\]|\\[\s\S])*"|\S+)/g;

/** A URL with credentials in it: `https://user:pass@host`, `https://token@host`. */
const URL_CREDENTIALS = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@'"]+@/g;

/** Where a shell assignment `NAME=` begins (an environment variable given to a command, or a query parameter); its value is read by `endOfShellWord`. */
const ASSIGNMENT_START = /(^|[\s;&|?(])([A-Za-z_][A-Za-z0-9_]*)=/g;

/**
 * Where the value that starts at `from` ends in `text` (which has its line continuations taken out, as Bash does before it reads a word), read as the shell
 * reads one word: plain characters, an escaped character (`two\ words`, `a\"b`, a lone
 * backslash at the end, a backslash before a line break), a double-quoted part (escapes inside it), a single-quoted part, an ANSI-C quoted part
 * (`$'it\'s'`), a command substitution (`$(…)` with its own quotes, parentheses and comments, `$((…))`, backticks), a `${…}` expansion and an array
 * `(…)`, any of them joined (`a"b c"d`).
 *
 * Where the end cannot be told for sure, the value runs to the end of the text and nothing of it is left showing: a quote, a substitution, a brace or a
 * parenthesis that is never closed; a here-document (`<<EOF`), whose body is free text; a `case` inside a substitution, whose patterns hold a `)` that
 * closes nothing. A `#` that begins a word inside `$(…)` starts a comment to the end of its line, and nothing in it (a `)`, a quote) closes or opens anything;
 * a `#` anywhere else (inside quotes, `$#`, `${#x}`, in the middle of a word) is an ordinary character.
 */
function endOfShellWord(text: string, from: number, origin: number[]): number {
    const end = text.length;
    // Where a line continuation was taken out, a physical line ended: a comment does not go on past it, and what follows it begins a line
    const cut = (index: number): boolean => index > 0 && origin[index] > origin[index - 1] + 1;
    const lineStarts = new Set<number>();
    // The character at `at` is escaped by a backslash before it (an odd run of them): `\ #` is one word, not a blank and a comment
    const escapedAt = (at: number): boolean => {
        let run = 0;
        while (at - 1 - run >= 0 && text[at - 1 - run] === '\\') run++;
        return run % 2 === 1;
    };
    // The character before `at` begins a new word (as in Bash, where `#` starts a comment only then): the start of the text, a blank or line break, or one
    // of `; & | ( ) < >`, none of them escaped
    const wordStart = (index: number): boolean => index === 0 || lineStarts.has(index) || (/[\s;&|()<>]/.test(text[index - 1]) && !escapedAt(index - 1));
    // After a `<<` that is a here-document (not the `<<<` here-string)
    const heredocAt = (at: number): boolean => text[at] === '<' && text[at + 1] === '<' && text[at + 2] !== '<' && text[at - 1] !== '<';
    const quoted = (start: number, quote: '"' | "'", ansi = false): number => {
        // `start` is the character after the opening quote; returns the index after the closing quote (or the end)
        let i = start;
        while (i < end) {
            const c = text[i];
            if ((quote === '"' || ansi) && c === '\\') i += 2;
            else if (c === quote) return i + 1;
            else if (quote === '"' && c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) i = nested(i + 1);
            else if (quote === '"' && c === '`') i = backticks(i + 1);
            else i++;
        }
        return end;
    };
    const backticks = (start: number): number => {
        let i = start;
        while (i < end) {
            if (text[i] === '\\') i += 2;
            else if (text[i] === '`') return i + 1;
            else if (heredocAt(i)) return end;
            else i++;
        }
        return end;
    };
    // `open` is the index of a `[` that follows a name (`a[`, `echodo[[`): Bash reads what is up to the matching `]` as one word, a `)` or a blank in it
    // included (the subscript of an array assignment, read wherever a command may begin). Returns the index after the `]`, or the end when there is none
    const subscript = (open: number): number => {
        let depth = 1;
        let i = open + 1;
        while (i < end) {
            const c = text[i];
            if (c === '\\') i += 2;
            else if (c === "'") i = quoted(i + 1, "'");
            else if (c === '"') i = quoted(i + 1, '"');
            else if (c === '`') i = backticks(i + 1);
            else if (c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) i = nested(i + 1);
            else if (c === '[') {
                depth++;
                i++;
            } else if (c === ']') {
                depth--;
                i++;
                if (depth === 0) return i;
            } else i++;
        }
        return end;
    };
    // `open` is the index of the first `(` of a `$((`: Bash reads it as arithmetic (up to the `))` that balances it: no comment, here-document or `case` in it)
    // and, when that does not fit, as a command substitution that begins with a parenthesis. Which one it was is not told here: the later end of the two
    const arithmetic = (open: number): number => {
        let depth = 0;
        let i = open;
        while (i < end) {
            const c = text[i];
            if (c === '\\') i += 2;
            else if (c === "'") i = quoted(i + 1, "'");
            else if (c === '"') i = quoted(i + 1, '"');
            else if (c === '`') i = backticks(i + 1);
            else if (c === '(') {
                depth++;
                i++;
            } else if (c === ')') {
                depth--;
                i++;
                if (depth === 0) return i;
            } else i++;
        }
        return end;
    };
    // `open` is the index of the `(` or `{` after a `$`; returns the index after its balanced close (or the end)
    const nested = (open: number): number => (text[open] === '(' && text[open + 1] === '(' ? Math.max(arithmetic(open), command(open)) : command(open));
    const command = (open: number): number => {
        const stack: string[] = [text[open] === '(' ? ')' : '}'];
        let i = open + 1;
        while (i < end && stack.length > 0) {
            const c = text[i];
            const inCommand = stack[stack.length - 1] === ')';
            if (c === '\\') i += 2;
            else if (c === "'") i = quoted(i + 1, "'");
            else if (c === '"') i = quoted(i + 1, '"');
            else if (c === '$' && text[i + 1] === "'") i = quoted(i + 2, "'", true);
            else if (c === '`') i = backticks(i + 1);
            else if (inCommand && c === '#' && wordStart(i)) {
                // A comment: to the end of its physical line, whatever it holds (a backslash at its end continues nothing: the line after it is a line of its
                // own). No line end after it: it runs to the end, and so does the value
                let lineEnd = i + 1;
                while (lineEnd < end && text[lineEnd] !== '\n' && !cut(lineEnd)) lineEnd++;
                if (lineEnd >= end) return end;
                if (text[lineEnd] !== '\n') lineStarts.add(lineEnd);
                i = lineEnd;
            } else if (inCommand && heredocAt(i)) return end;
            else if (inCommand && c === 'c' && wordStart(i) && /^case\s/.test(text.slice(i, i + 5))) return end;
            else if (c === '$' && text[i + 1] === '(' && text[i + 2] === '(') i = nested(i + 1);
            else if (inCommand && c === '[' && /[A-Za-z0-9_]/.test(text[i - 1] ?? '')) i = subscript(i);
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
        return stack.length > 0 ? end : i;
    };
    let i = from;
    // An array: `NAME=(a b)`
    if (text[i] === '(') i = nested(i);
    while (i < end) {
        const c = text[i];
        if (c === '\\') i += 2;
        else if (c === '"' || c === "'") i = quoted(i + 1, c);
        else if (c === '$' && text[i + 1] === "'") i = quoted(i + 2, "'", true);
        else if (c === '`') i = backticks(i + 1);
        else if (c === '$' && (text[i + 1] === '(' || text[i + 1] === '{')) i = nested(i + 1);
        else if (/[\s&;|)]/.test(c)) break;
        else i++;
    }
    return Math.min(i, end);
}

/** A part of a text to say as something else, by its place in the original text. */
interface Span {
    start: number;
    end: number;
    text: string;
    /** An assignment: the one to give way when another pass found the same part (a base64 run that ends in `=` reads as an assignment, and its name is the secret). */
    weak?: true;
}

/** Takes out the line continuations (a backslash before a line break, not itself escaped), keeping where each character of what is left stood. */
function joinContinuations(text: string): { logical: string; at: number[] } {
    let logical = '';
    const at: number[] = [];
    let run = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\') {
            run++;
            // A backslash that is not escaped and is followed by a line break is a continuation: it and the line break go
            if (run % 2 === 1 && text[i + 1] === '\n') {
                i++;
                run = 0;
                continue;
            }
        } else run = 0;
        logical += c;
        at.push(i);
    }
    at.push(text.length);
    return { logical, at };
}

/** Every shell assignment in the text (and every query parameter): its value goes, the name stays. Read from the text as it was written. */
function assignmentSpans(text: string): Span[] {
    const { logical, at } = joinContinuations(text);
    const spans: Span[] = [];
    ASSIGNMENT_START.lastIndex = 0;
    for (let found = ASSIGNMENT_START.exec(logical); found !== null; found = ASSIGNMENT_START.exec(logical)) {
        const nameStart = found.index + found[1].length;
        const valueStart = found.index + found[0].length;
        const end = endOfShellWord(logical, valueStart, at);
        spans.push({ start: at[nameStart], end: at[end], text: `${found[2]}=${HIDDEN}`, weak: true });
        ASSIGNMENT_START.lastIndex = Math.max(end, valueStart);
    }
    return spans;
}

/** The parts of the text a pattern finds, each said as `say` makes it. */
function spansOf(text: string, pattern: RegExp, say: (found: RegExpExecArray) => { start: number; text: string }): Span[] {
    const spans: Span[] = [];
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
        const one = say(found);
        spans.push({ start: found.index + one.start, end: found.index + found[0].length, text: one.text });
        if (found[0].length === 0) pattern.lastIndex++;
    }
    return spans;
}

/** A long run of letters and digits with at least one digit (base64, hex, an id used as a secret) that is no word. */
const LONG_OPAQUE = /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_-])/g;

/** The words that start a raw command (at the start of the label or of a part after `;`, `&`, `|`, `(`), and the shapes only a command has. */
const COMMAND_WORDS =
    /(^|[;&|(]\s*)(curl|wget|bash|sh|zsh|python3?|node|npm|npx|pnpm|yarn|sudo|cd|export|echo|cat|grep|sed|awk|chmod|chown|rm|mv|cp|ssh|scp|git|pip3?|apt(?:-get)?|docker|kill|pkill|nohup|xdotool|xclip|jq|tee|printf|eval|exec|env|source|ls|mkdir|touch|tar|unzip)(?=\s|$)/;
/** A command given by its path (`/usr/bin/python3 login.py …`, `./run.sh`, `~/bin/tool`, `../x`): the first word of the label, or of a part after `;`, `&`, `|`, `(`. */
const EXECUTABLE_PATH = /(^|[;&|(]\s*)(?:\.{0,2}\/|~\/)[^\s;&|()]+(?=\s|$)/;
const COMMAND_SHAPES = /&&|\|\||\$\(|`|\s\|\s|\s>>?\s|\s2>&?1|(^|\s)--?[A-Za-z][\w-]*(\s|=|$)|\\\n|\n/;

/**
 * Hides every part of the text that is a secret, by its place (a header, an assignment, a URL's credentials) or by its shape (a known key, a long opaque
 * run). Every part is found in the text as it was written, never in text another pass has changed (a pass that hid part of a quoted value would change
 * where the value ends); parts that touch are hidden together, said as the longest of them says it, and a shape that gives its name to an assignment says it.
 */
export function redactSecrets(text: string): string {
    const spans: Span[] = [
        ...spansOf(text, AUTH_HEADER, (found) => ({ start: 0, text: `${found[1]}: ${HIDDEN}` })),
        ...spansOf(text, HEADER_FLAG, (found) => ({ start: found[1].length, text: `${found[2]} ${HIDDEN}` })),
        ...spansOf(text, BEARER, (found) => ({ start: 0, text: `${found[1]} ${HIDDEN}` })),
        ...spansOf(text, URL_CREDENTIALS, (found) => ({ start: 0, text: `${found[1]}${HIDDEN}@` })),
        ...spansOf(text, KNOWN_TOKENS, () => ({ start: 0, text: HIDDEN })),
        ...spansOf(text, LONG_OPAQUE, () => ({ start: 0, text: HIDDEN })),
        ...assignmentSpans(text),
    ];
    // An assignment that begins inside a part that ends in a quote (a `-H "Cookie: a=b"` header) is inside that quoted string: its value ends with the part, and
    // the quote that closes the string is not one that opens another
    for (const one of spans) {
        if (!one.weak) continue;
        for (const around of spans) {
            if (!around.weak && around.start < one.start && one.start < around.end && one.end > around.end && /["']$/.test(text.slice(around.start, around.end))) one.end = around.end;
        }
    }
    spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    let out = '';
    let at = 0;
    for (let i = 0; i < spans.length; ) {
        let chosen = spans[i];
        let end = chosen.end;
        let j = i + 1;
        // Spans that overlap are one part: all of it goes, said as the longest says it (a strong one before a weak one when they are as long)
        for (; j < spans.length && spans[j].start < end; j++) {
            const next = spans[j];
            end = Math.max(end, next.end);
            const longer = next.end - next.start > chosen.end - chosen.start;
            const same = next.end - next.start === chosen.end - chosen.start;
            if (longer || (same && chosen.weak && !next.weak)) chosen = next;
        }
        if (chosen.start >= at) {
            out += text.slice(at, chosen.start) + chosen.text;
            at = end;
        }
        i = j;
    }
    return out + text.slice(at);
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
