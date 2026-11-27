/**
 * Real files a Brick makes on request (Brick file tool, 27 Nov): "send me the notes as a markdown file", "give me that as a
 * sheet". The tool turns text or rows into a .md, .csv or .xlsx file, puts it on the uploader and sends it as the normal chat
 * file card (which opens beside the map and has a Download button). It is not an artifact: an artifact is a Doc, app, page or
 * drawing that lives in the chat window. A person who asks for a file gets a file; one who asks for an app still gets an app.
 *
 * The file is built here, from what the model wrote. Nothing is read from Orbit and nothing is stored but the chat's file
 * (the file keeper lists it like any file the bot sends). What the tool returns never holds the address of the file, so the
 * media interceptors leave it alone.
 *
 * Cells are always plain text or plain numbers, never formulas: a cell that starts with "=" is text in a sheet, and a CSV
 * guards it so a spreadsheet app opening the file does not run it.
 */
import type * as XLSXTypes from 'xlsx';

/** The spreadsheet library is big: it is loaded the first time a spreadsheet is made, not when the bot server starts. */
let xlsxLoaded: Promise<typeof XLSXTypes> | undefined;
const loadXlsx = (): Promise<typeof XLSXTypes> => (xlsxLoaded ??= import('xlsx'));

export const MAKE_FILE_TOOL = 'make_file';

export function isMakeFileTool(name: string): boolean {
    return name === MAKE_FILE_TOOL;
}

export type MadeFileFormat = 'md' | 'csv' | 'xlsx';

/** The most one chat file may be, under the uploader's own default limit (10 MB). */
export const MAX_MADE_FILE_BYTES = 8 * 1024 * 1024;
/** The most cells in one sheet file, so a runaway table never stalls the bot server while the file is built. */
export const MAX_MADE_FILE_CELLS = 250_000;
/** Tabs in one spreadsheet file. */
export const MAX_MADE_FILE_TABS = 50;
/** A sheet cell holds at most this many characters. */
export const MAX_SHEET_CELL_CHARS = 32_767;
/** A sheet's tab is named in at most this many characters. */
export const MAX_SHEET_NAME_CHARS = 31;
/** A file's name, before its extension. */
const MAX_NAME_CHARS = 80;

const MIME: Record<MadeFileFormat, string> = {
    md: 'text/markdown',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** How each kind of file is called in words people read: "Spreadsheet file (.xlsx)", never a product's name. */
export const FILE_WORDS: Record<MadeFileFormat, string> = {
    md: 'Markdown file (.md)',
    csv: 'CSV file (.csv)',
    xlsx: 'Spreadsheet file (.xlsx)',
};

const FORMATS: readonly MadeFileFormat[] = ['md', 'csv', 'xlsx'];

/** What the model says when the file is too big, failed, or was asked for wrongly, as the mock "When it cannot" has it. */
export const TOO_BIG_LINE =
    'That would be too big for a chat file. Say so in one plain sentence, and offer to split it into smaller files (for example one file per section or per tab) and ask if they want that. Do not make an app or a Doc instead.';
export const NOT_MADE_LINE = 'The file could not be made just now. Nothing was sent. Say so in one plain sentence and offer to try again in a moment. Do not make an app or a Doc instead.';

export function makeFileToolDefinition(): { type: 'function'; function: { name: string; description: string; parameters: object } } {
    return {
        type: 'function',
        function: {
            name: MAKE_FILE_TOOL,
            description:
                'Make a real file and send it in this chat: a Markdown file (.md), a CSV file (.csv) or a spreadsheet file (.xlsx). Use it whenever ' +
                'someone asks you to send, give, save, export or download something as a file, a markdown, a .md, a CSV, a sheet or a spreadsheet ' +
                '("send me the notes as markdown", "give me that as a spreadsheet", "export it to CSV"). It arrives as a file card they tap to open ' +
                'beside the chat, with a Download button. It is NOT an artifact: make_artifact is for something shown in the chat window (a mini app, ' +
                'a page, a Doc, a drawing) when they ask you to build, make or design one. A request for a file is never answered with make_artifact. ' +
                'For "md" send the whole text in content. For "csv" send rows. For "xlsx" send rows for one tab, or sheets for several tabs ' +
                '(one per group, like "one tab per bucket"). Rows are lists of cells, each written as text, the first row usually the column names. ' +
                'Cells are plain text, never formulas: write the value itself. Send the real content, never a placeholder. Call it silently, then say in one ' +
                'short line what you made in plain words: "a Markdown file (.md)", "a spreadsheet file (.xlsx)", never "a Doc" or "an app" for a file.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'The file name people see, like "Calendar notes". The extension is added for you.' },
                    format: { type: 'string', enum: [...FORMATS], description: '"md" Markdown text, "csv" one table as comma-separated text, "xlsx" a spreadsheet with one or more tabs.' },
                    content: { type: 'string', description: 'For "md": the whole Markdown text.' },
                    rows: {
                        type: 'array',
                        description: 'For "csv", or "xlsx" with one tab: the rows, each a list of cells written as text.',
                        items: { type: 'array', items: { type: 'string' } },
                    },
                    sheets: {
                        type: 'array',
                        description: 'For "xlsx" with several tabs: each tab with its name and rows.',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'The tab name, like "Task".' },
                                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                            },
                            required: ['name', 'rows'],
                        },
                    },
                },
                required: ['name', 'format'],
            },
        },
    };
}

/** A file ready to send. */
export interface BuiltFile {
    name: string;
    format: MadeFileFormat;
    mimeType: string;
    bytes: Buffer;
    /** Tabs of a spreadsheet file. */
    tabs?: number;
}

export type BuildResult = { file: BuiltFile } | { error: { reason: 'invalid' | 'too_big'; message: string } };

const invalid = (message: string): BuildResult => ({ error: { reason: 'invalid', message } });
const tooBig = (message: string): BuildResult => ({ error: { reason: 'too_big', message } });

/** A string with no half of an emoji at its end, cut to `max` UTF-16 units. */
function cut(text: string, max: number): string {
    if (text.length <= max) return text;
    const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
    return text.slice(0, end);
}

// Characters a sheet's XML cannot hold, and ones that only confuse a file name
// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;
const KNOWN_EXTENSION = /\.(md|markdown|csv|xlsx|xls|txt)$/i;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** The file's name: no folder, no character a system refuses, the right extension, never empty. */
export function fileNameFor(raw: unknown, format: MadeFileFormat): string {
    let base = typeof raw === 'string' ? raw : '';
    base = base.replace(CONTROL, ' ').replace(/[\\/:*?"<>|]+/g, ' ');
    base = base.replace(/\s+/g, ' ').trim().replace(KNOWN_EXTENSION, '').replace(/^[.\s]+/, '').replace(/[ .]+$/, '').trim();
    base = cut(base, MAX_NAME_CHARS).replace(/[ .]+$/, '');
    if (!base) base = 'File';
    if (WINDOWS_RESERVED.test(base)) base = `${base}_`;
    return `${base}.${format}`;
}

/** Strips the quotes Excel refuses at the ends of a tab name, and the spaces around them, until nothing changes. */
function trimTabName(name: string): string {
    let current = name;
    for (;;) {
        const next = current.replace(/^['\s]+|['\s]+$/g, '');
        if (next === current) return next;
        current = next;
    }
}

/** One tab name made valid: no \ / ? * [ ] : or control character, 31 characters at most, no quote at either end after the cut. */
export function cleanTabName(raw: unknown): string {
    const text = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    const spaced = text.replace(CONTROL, ' ').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ');
    // The cut can leave a quote or a space at the end, so it is trimmed after it
    return trimTabName(cut(trimTabName(spaced), MAX_SHEET_NAME_CHARS));
}

/** "History" is a name a sheet app keeps for itself, whatever the case. */
const RESERVED_TABS = new Set(['history']);

/**
 * Valid, unique tab names, in order. An empty name becomes "Sheet 3" (its place), a name already taken (without regard to case) or
 * the reserved "History" gets a number after it, and the base is cut to leave room so the whole name stays within 31 characters.
 */
export function tabNames(raw: unknown[]): string[] {
    const taken = new Set<string>();
    return raw.map((one, index) => {
        const base = cleanTabName(one) || `Sheet ${index + 1}`;
        let name = base;
        // A reserved name takes "1" first, a name already taken "2" (the first is the one that kept it)
        let n = RESERVED_TABS.has(base.toLowerCase()) ? 0 : 1;
        while (RESERVED_TABS.has(name.toLowerCase()) || taken.has(name.toLowerCase())) {
            n++;
            const suffix = ` ${n}`;
            name = trimTabName(cut(base, MAX_SHEET_NAME_CHARS - suffix.length)) + suffix;
        }
        taken.add(name.toLowerCase());
        return name;
    });
}

type Cell = string | number;

/** A cell as plain text or a plain number; empty for nothing. */
function cellOf(value: unknown): Cell {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '';
    }
}

/** Rows as the model sent them, or a message saying what is wrong with them. */
function rowsOf(value: unknown, where: string): { rows: Cell[][] } | { error: string } {
    if (!Array.isArray(value) || value.length === 0) return { error: `${where} needs rows: a list of rows, each a list of cells.` };
    const rows: Cell[][] = [];
    for (const row of value) {
        if (!Array.isArray(row)) return { error: `${where}: each row must be a list of cells.` };
        rows.push(row.map(cellOf));
    }
    return { rows };
}

const cellCount = (rows: Cell[][]): number => rows.reduce((sum, row) => sum + row.length, 0);

/** The characters of a CSV cell that a sheet app would read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMBER_LIKE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** One CSV field: quoted when it holds a comma, quote or line break, and kept from running as a formula in a sheet app. */
function csvField(cell: Cell): string {
    let text = typeof cell === 'number' ? String(cell) : cell.replace(XML_BAD, '');
    // A text that begins with =, + - or @ is run as a formula by a sheet app that opens the file: a quote in front keeps it text. A number that is only a number is left alone
    if (typeof cell === 'string' && FORMULA_START.test(text) && !NUMBER_LIKE.test(text.trim())) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: Cell[][]): Buffer {
    // The byte order mark makes a sheet app read the file as UTF-8, so names in Arabic or accents are not turned to noise
    return Buffer.from('﻿' + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n', 'utf8');
}

async function buildWorkbook(tabs: Array<{ name: string; rows: Cell[][] }>): Promise<Buffer> {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    for (const tab of tabs) {
        const sheet: XLSXTypes.WorkSheet = {};
        let width = 0;
        const widths: number[] = [];
        tab.rows.forEach((row, r) => {
            width = Math.max(width, row.length);
            row.forEach((cell, c) => {
                if (cell === '') return;
                // Plain text stays text, even one that starts with "=": it is typed as a string, never as a formula
                const value = typeof cell === 'number' ? ({ t: 'n', v: cell } as XLSXTypes.CellObject) : ({ t: 's', v: cell.replace(XML_BAD, '') } as XLSXTypes.CellObject);
                sheet[XLSX.utils.encode_cell({ r, c })] = value;
                // Column width from the longest short line, so the table reads without dragging the columns
                const longest = typeof cell === 'number' ? String(cell).length : cell.split(/\r?\n/).reduce((most, line) => Math.max(most, line.length), 0);
                widths[c] = Math.max(widths[c] ?? 8, Math.min(longest + 2, 60));
            });
        });
        sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(tab.rows.length - 1, 0), c: Math.max(width - 1, 0) } });
        sheet['!cols'] = Array.from({ length: width }, (_, c) => ({ wch: widths[c] ?? 8 }));
        XLSX.utils.book_append_sheet(book, sheet, tab.name);
    }
    return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Uint8Array);
}

/** An argument the model sent: one it left out, or sent as null for "none", was not sent. */
const given = (value: unknown): boolean => value !== undefined && value !== null;

/** Builds the file a call asks for. Pure: nothing is sent or stored. */
export async function buildFile(args: Record<string, unknown>): Promise<BuildResult> {
    const format = typeof args.format === 'string' ? (args.format.trim().toLowerCase() as MadeFileFormat) : undefined;
    if (!format || !FORMATS.includes(format)) return invalid('format must be md, csv or xlsx.');
    const name = fileNameFor(args.name, format);

    if (format === 'md') {
        const content = typeof args.content === 'string' ? args.content : '';
        if (!content.trim()) return invalid('A Markdown file needs its text in content.');
        const bytes = Buffer.from(content.replace(/\u0000/g, ''), 'utf8');
        if (bytes.length > MAX_MADE_FILE_BYTES) return tooBig('The text is over the size of a chat file.');
        return { file: { name, format, mimeType: MIME.md, bytes } };
    }

    if (format === 'csv') {
        if (given(args.sheets) && !given(args.rows)) return invalid('A CSV file is one table: send rows. For several tabs make a spreadsheet file (xlsx).');
        const table = rowsOf(args.rows, 'A CSV file');
        if ('error' in table) return invalid(table.error);
        if (cellCount(table.rows) > MAX_MADE_FILE_CELLS) return tooBig('The table has more cells than one chat file takes.');
        const bytes = buildCsv(table.rows);
        if (bytes.length > MAX_MADE_FILE_BYTES) return tooBig('The table is over the size of a chat file.');
        return { file: { name, format, mimeType: MIME.csv, bytes } };
    }

    // xlsx: rows for one tab, or sheets for several
    if (given(args.rows) && given(args.sheets)) return invalid('Send rows for one tab or sheets for several tabs, not both.');
    let raw: Array<{ name: unknown; rows: unknown }>;
    if (given(args.sheets)) {
        if (!Array.isArray(args.sheets) || args.sheets.length === 0) return invalid('sheets must be a list of tabs, each with a name and rows.');
        if (args.sheets.length > MAX_MADE_FILE_TABS) return tooBig(`A spreadsheet file takes at most ${MAX_MADE_FILE_TABS} tabs.`);
        raw = [];
        for (const sheet of args.sheets) {
            if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return invalid('Each tab needs a name and rows.');
            raw.push({ name: (sheet as Record<string, unknown>).name, rows: (sheet as Record<string, unknown>).rows });
        }
    } else {
        raw = [{ name: name.slice(0, -'.xlsx'.length), rows: args.rows }];
    }
    const names = tabNames(raw.map((sheet) => sheet.name));
    const tabs: Array<{ name: string; rows: Cell[][] }> = [];
    let cells = 0;
    for (let i = 0; i < raw.length; i++) {
        const table = rowsOf(raw[i].rows, `The tab "${names[i]}"`);
        if ('error' in table) return invalid(table.error);
        cells += cellCount(table.rows);
        if (cells > MAX_MADE_FILE_CELLS) return tooBig('The tables have more cells than one chat file takes.');
        if (table.rows.some((row) => row.some((cell) => typeof cell === 'string' && cell.length > MAX_SHEET_CELL_CHARS))) {
            return tooBig(`A sheet cell holds at most ${MAX_SHEET_CELL_CHARS} characters.`);
        }
        tabs.push({ name: names[i], rows: table.rows });
    }
    let bytes: Buffer;
    try {
        bytes = await buildWorkbook(tabs);
    } catch (error) {
        console.warn('[MakeFileTool] Could not build the spreadsheet:', error instanceof Error ? error.message : error);
        return invalid('The spreadsheet could not be built from those rows.');
    }
    if (bytes.length > MAX_MADE_FILE_BYTES) return tooBig('The spreadsheet is over the size of a chat file.');
    return { file: { name, format, mimeType: MIME.xlsx, bytes, tabs: tabs.length } };
}

/** What a tool needs to put the file in the chat: both steps are the bot server's own. */
export interface MakeFileContext {
    /** Put the bytes on the uploader. Resolves with the link, or null when nothing can be uploaded here. */
    upload: (file: BuiltFile) => Promise<string | null>;
    /** Put the uploaded file in this chat. Resolves with a line saying why it could not, or null once it is on its way. */
    send: (file: BuiltFile, url: string) => Promise<string | null>;
}

/**
 * Makes the file and sends it. Never throws: a problem comes back as `{ error }`, in words the model passes on. The result never holds
 * the address of the file.
 */
export async function runMakeFile(args: Record<string, unknown>, context: MakeFileContext): Promise<Record<string, unknown>> {
    const built = await buildFile(args);
    if ('error' in built) {
        const { reason, message } = built.error;
        return { error: reason === 'too_big' ? `${message} ${TOO_BIG_LINE}` : `${message} Nothing was sent.`, reason };
    }
    const { file } = built;
    let url: string | null;
    try {
        url = await context.upload(file);
    } catch (error) {
        console.warn('[MakeFileTool] Could not upload the file:', error instanceof Error ? error.message : error);
        return { error: NOT_MADE_LINE, reason: 'failed' };
    }
    if (!url) return { error: NOT_MADE_LINE, reason: 'failed' };
    let refused: string | null;
    try {
        refused = await context.send(file, url);
    } catch (error) {
        console.warn('[MakeFileTool] Could not send the file:', error instanceof Error ? error.message : error);
        return { error: NOT_MADE_LINE, reason: 'failed' };
    }
    if (refused) return { error: refused, reason: 'not_sent' };
    return {
        success: true,
        name: file.name,
        kind: FILE_WORDS[file.format],
        sizeBytes: file.bytes.length,
        ...(file.tabs !== undefined ? { tabs: file.tabs } : {}),
    };
}

/** The result as the model reads it. */
export function formatMakeFileResult(result: Record<string, unknown>): string {
    if (typeof result.error === 'string') return `${MAKE_FILE_TOOL}: ${result.error}`;
    const tabs = typeof result.tabs === 'number' ? ` with ${result.tabs} ${result.tabs === 1 ? 'tab' : 'tabs'}` : '';
    return (
        `${MAKE_FILE_TOOL}: Made "${result.name}", a ${String(result.kind).replace(/^./, (c) => c.toLowerCase())}${tabs}, and sent it in this chat as a file card they can tap to open or download. ` +
        'Say in one short line what you made, naming it as a file with its type, like "a spreadsheet file (.xlsx)" or "a Markdown file (.md)". It is a file, not a Doc, an app or an artifact: never call it those. ' +
        'Do NOT paste its text, an address or the id.'
    );
}
