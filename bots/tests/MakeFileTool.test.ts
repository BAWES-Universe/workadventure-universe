import { randomBytes } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { artifactToolDefinitions, formatArtifactResult } from '../ai/ArtifactTools';
import { BRICK_WORK_RULES } from '../ai/brickRules';
import {
    FILE_WORDS,
    MAKE_FILE_TOOL,
    MAX_MADE_FILE_BYTES,
    MAX_MADE_FILE_CELLS,
    MAX_MADE_FILE_TABS,
    MAX_SHEET_CELL_CHARS,
    buildFile,
    cleanTabName,
    fileNameFor,
    formatMakeFileResult,
    makeFileToolDefinition,
    runMakeFile,
    tabNames,
    type BuiltFile,
} from '../ai/MakeFileTool';

/**
 * The Brick file tool (27 Nov): "send me markdown" or "give me a sheet" makes a real .md, .csv or .xlsx file and sends it as the chat's file
 * card; "make me an app" still makes an app. Cells are plain text, tab names are valid, and a file too big or a failure says so plainly.
 */

const built = async (args: Record<string, unknown>): Promise<BuiltFile> => {
    const result = await buildFile(args);
    if ('error' in result) throw new Error(`not built: ${result.error.message}`);
    return result.file;
};

const failed = async (args: Record<string, unknown>) => {
    const result = await buildFile(args);
    if (!('error' in result)) throw new Error('built, but should not have');
    return result.error;
};

const readBook = (file: BuiltFile) => XLSX.read(file.bytes, { type: 'buffer', cellFormula: true });

describe('the file name', () => {
    it('gets the right extension once, whatever the model wrote', () => {
        expect(fileNameFor('Calendar notes', 'xlsx')).toBe('Calendar notes.xlsx');
        expect(fileNameFor('Calendar notes.md', 'md')).toBe('Calendar notes.md');
        expect(fileNameFor('notes.csv', 'xlsx')).toBe('notes.xlsx');
        expect(fileNameFor('Report.XLSX', 'xlsx')).toBe('Report.xlsx');
    });

    it('holds no folder, no character a system refuses and no control character, and is never empty', () => {
        expect(fileNameFor('../../etc/passwd', 'md')).toBe('etc passwd.md');
        expect(fileNameFor('a:b*c?"d"<e>|f', 'csv')).toBe('a b c d e f.csv');
        expect(fileNameFor('line\none\u0000', 'md')).toBe('line one.md');
        expect(fileNameFor('', 'md')).toBe('File.md');
        expect(fileNameFor(undefined, 'csv')).toBe('File.csv');
        expect(fileNameFor('...', 'md')).toBe('File.md');
        expect(fileNameFor('CON', 'md')).toBe('CON_.md');
    });

    it('is cut at 80 characters without leaving half an emoji', () => {
        const name = fileNameFor('x'.repeat(79) + '😀' + 'tail', 'md');
        expect(name).toBe(`${'x'.repeat(79)}.md`);
    });
});

describe('tab names', () => {
    it('cleans what a sheet refuses and cuts to 31 characters', () => {
        expect(cleanTabName('Q1: Plan/Do [draft]?')).toBe('Q1 Plan Do draft');
        expect(cleanTabName('x'.repeat(40))).toBe('x'.repeat(31));
        expect(cleanTabName('  spaced   out  ')).toBe('spaced out');
    });

    it('has no apostrophe at either end, also after the cut at 31', () => {
        expect(cleanTabName("'quoted'")).toBe('quoted');
        const cutAtQuote = `${'a'.repeat(30)}'tail`;
        expect(cutAtQuote.slice(0, 31).endsWith("'")).toBe(true);
        expect(cleanTabName(cutAtQuote)).toBe('a'.repeat(30));
        // A space left at the end by the cut goes too
        expect(cleanTabName(`${'b'.repeat(30)} tail`)).toBe('b'.repeat(30));
        expect(cleanTabName("'' ' mixed ' ''")).toBe('mixed');
    });

    it('renames "History", whatever the case, and makes every name unique without regard to case', () => {
        expect(tabNames(['History'])).toEqual(['History 1']);
        expect(tabNames(['history', 'HISTORY', 'History 1'])).toEqual(['history 1', 'HISTORY 2', 'History 1 2']);
        expect(tabNames(['Task', 'task', 'TASK'])).toEqual(['Task', 'task 2', 'TASK 3']);
    });

    it('gives a blank name its place, and keeps a numbered name within 31 characters', () => {
        expect(tabNames(['', 'Real', '  '])).toEqual(['Sheet 1', 'Real', 'Sheet 3']);
        const long = 'z'.repeat(40);
        const names = tabNames([long, long, long]);
        expect(names).toEqual(['z'.repeat(31), `${'z'.repeat(29)} 2`, `${'z'.repeat(29)} 3`]);
        expect(names.every((name) => name.length <= 31)).toBe(true);
    });

    it('never ends a cut name with a quote left before its number', () => {
        const base = `${'c'.repeat(28)}'x`;
        const names = tabNames([base, base]);
        expect(names[1]).not.toMatch(/'\s\d+$/);
        expect(names.every((name) => !name.startsWith("'") && !name.endsWith("'"))).toBe(true);
    });
});

describe('a Markdown file', () => {
    it('is the text as it was written, with its name and type', async () => {
        const file = await built({ name: 'Calendar notes', format: 'md', content: '# Notes\n\n- one\n- **two**\n\nمرحبا' });
        expect(file).toMatchObject({ name: 'Calendar notes.md', format: 'md', mimeType: 'text/markdown' });
        expect(file.bytes.toString('utf8')).toBe('# Notes\n\n- one\n- **two**\n\nمرحبا');
    });

    it('needs text', async () => {
        expect((await failed({ name: 'x', format: 'md' })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'md', content: '   \n' })).reason).toBe('invalid');
    });

    it('is too big over the size of a chat file', async () => {
        const error = await failed({ name: 'big', format: 'md', content: 'a'.repeat(MAX_MADE_FILE_BYTES + 1) });
        expect(error.reason).toBe('too_big');
        expect((await built({ name: 'edge', format: 'md', content: 'a'.repeat(MAX_MADE_FILE_BYTES) })).bytes.length).toBe(MAX_MADE_FILE_BYTES);
    });
});

describe('a CSV file', () => {
    const text = (file: BuiltFile) => file.bytes.toString('utf8');

    it('starts with the byte order mark, so a sheet app reads Arabic and accents right, and ends rows with CRLF', async () => {
        const file = await built({ name: 'People', format: 'csv', rows: [['Name', 'City'], ['خالد', 'الكويت'], ['José', 'São Paulo']] });
        expect(file).toMatchObject({ name: 'People.csv', mimeType: 'text/csv' });
        expect(text(file)).toBe('﻿Name,City\r\nخالد,الكويت\r\nJosé,São Paulo\r\n');
        expect(file.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });

    it('quotes a cell with a comma, a quote or a line break', async () => {
        const file = await built({ name: 'q', format: 'csv', rows: [['a,b', 'say "hi"', 'two\nlines', 'plain']] });
        expect(text(file)).toBe('﻿"a,b","say ""hi""","two\nlines",plain\r\n');
    });

    it('keeps a cell that starts like a formula from running in a sheet app, and leaves a plain number alone', async () => {
        const file = await built({ name: 'f', format: 'csv', rows: [['=SUM(A1:A2)', '+1 555 0100', '-cmd|calc', '@here', '-12.5', '42', '\t=x']] });
        expect(text(file)).toBe("﻿'=SUM(A1:A2),'+1 555 0100,'-cmd|calc,'@here,-12.5,42,'\t=x\r\n");
    });

    it('writes missing cells empty and numbers as numbers', async () => {
        const file = await built({ name: 'n', format: 'csv', rows: [['a', null, 3, true], ['b']] });
        expect(text(file)).toBe('﻿a,,3,true\r\nb\r\n');
    });

    it('needs rows, each a list, and is one table', async () => {
        expect((await failed({ name: 'x', format: 'csv' })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'csv', rows: [] })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'csv', rows: ['a', 'b'] })).message).toMatch(/list of cells/);
        expect((await failed({ name: 'x', format: 'csv', sheets: [{ name: 'a', rows: [['1']] }] })).message).toMatch(/spreadsheet file/);
    });

    it('is too big over the cell limit', async () => {
        const row = Array.from({ length: 1000 }, () => 'x');
        const rows = Array.from({ length: MAX_MADE_FILE_CELLS / 1000 + 1 }, () => row);
        expect((await failed({ name: 'x', format: 'csv', rows })).reason).toBe('too_big');
    });
});

describe('a spreadsheet file', () => {
    it('is a real .xlsx with the rows in its one tab, named after the file', async () => {
        const file = await built({ name: 'Calendar notes.xlsx', format: 'xlsx', rows: [['#', 'Date', 'Note'], ['1', '2026-10-28', 'Nudge the handover']] });
        expect(file).toMatchObject({ name: 'Calendar notes.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tabs: 1 });
        expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
        const book = readBook(file);
        expect(book.SheetNames).toEqual(['Calendar notes']);
        expect(XLSX.utils.sheet_to_json(book.Sheets['Calendar notes'], { header: 1 })).toEqual([['#', 'Date', 'Note'], ['1', '2026-10-28', 'Nudge the handover']]);
    });

    it('makes one tab for each sheet, with valid, unique names', async () => {
        const file = await built({
            name: 'By bucket',
            format: 'xlsx',
            sheets: [
                { name: 'Task', rows: [['a']] },
                { name: 'task', rows: [['b']] },
                { name: 'History', rows: [['c']] },
                { name: "'Vision'", rows: [['d']] },
                { name: 'Build: 1/2', rows: [['e']] },
                { name: '', rows: [['f']] },
                { name: `${'n'.repeat(30)}'x`, rows: [['g']] },
            ],
        });
        expect(file.tabs).toBe(7);
        expect(readBook(file).SheetNames).toEqual(['Task', 'task 2', 'History 1', 'Vision', 'Build 1 2', 'Sheet 6', 'n'.repeat(30)]);
    });

    it('writes every cell as plain text: "=SUM(A1)" is text, never a formula', async () => {
        const file = await built({ name: 'f', format: 'xlsx', rows: [['=SUM(A1:A2)', '+1', '-2', '@x', '007', '1/2', 'TRUE']] });
        const sheet = readBook(file).Sheets.f;
        for (const address of ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1']) {
            expect(sheet[address].t, address).toBe('s');
            expect(sheet[address].f, address).toBeUndefined();
        }
        expect(sheet.A1.v).toBe('=SUM(A1:A2)');
        // A leading zero is not lost to a number
        expect(sheet.E1.v).toBe('007');
    });

    it('keeps Arabic text, line breaks and emoji, and strips a character a sheet file cannot hold', async () => {
        const file = await built({ name: 'u', format: 'xlsx', rows: [['خالد', 'two\nlines', '😀 ok', 'bad\u0001char']] });
        const sheet = readBook(file).Sheets.u;
        expect(sheet.A1.v).toBe('خالد');
        expect(sheet.B1.v).toBe('two\nlines');
        expect(sheet.C1.v).toBe('😀 ok');
        expect(sheet.D1.v).toBe('badchar');
    });

    it('takes uneven rows and empty cells', async () => {
        const file = await built({ name: 'u', format: 'xlsx', rows: [['a', '', 'c'], ['d'], []] });
        const sheet = readBook(file).Sheets.u;
        expect(sheet['!ref']).toBe('A1:C3');
        expect(sheet.B1).toBeUndefined();
        expect(sheet.A2.v).toBe('d');
    });

    it('needs rows or sheets, not both, and each tab needs rows', async () => {
        expect((await failed({ name: 'x', format: 'xlsx' })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'xlsx', rows: [['a']], sheets: [{ name: 'a', rows: [['1']] }] })).message).toMatch(/not both/);
        expect((await failed({ name: 'x', format: 'xlsx', sheets: [] })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'xlsx', sheets: ['a'] })).reason).toBe('invalid');
        expect((await failed({ name: 'x', format: 'xlsx', sheets: [{ name: 'a' }] })).message).toMatch(/needs rows/);
    });

    it('is too big over the tab, cell and cell-length limits, and over the size of a chat file', async () => {
        const tab = (i: number) => ({ name: `t${i}`, rows: [['a']] });
        expect((await failed({ name: 'x', format: 'xlsx', sheets: Array.from({ length: MAX_MADE_FILE_TABS + 1 }, (_, i) => tab(i)) })).reason).toBe('too_big');
        expect((await built({ name: 'x', format: 'xlsx', sheets: Array.from({ length: MAX_MADE_FILE_TABS }, (_, i) => tab(i)) })).tabs).toBe(MAX_MADE_FILE_TABS);
        const row = Array.from({ length: 1000 }, () => 'x');
        expect((await failed({ name: 'x', format: 'xlsx', rows: Array.from({ length: MAX_MADE_FILE_CELLS / 1000 + 1 }, () => row) })).reason).toBe('too_big');
        expect((await failed({ name: 'x', format: 'xlsx', rows: [['y'.repeat(MAX_SHEET_CELL_CHARS + 1)]] })).reason).toBe('too_big');
        expect((await built({ name: 'x', format: 'xlsx', rows: [['y'.repeat(MAX_SHEET_CELL_CHARS)]] })).format).toBe('xlsx');
    });

    it('is too big when the file made is over the size of a chat file', async () => {
        // Random text does not shrink when the file is zipped
        const noise = () => randomBytes(7_500).toString('base64');
        const rows = Array.from({ length: 600 }, () => [noise(), noise(), noise()]);
        expect(rows.length * 3).toBeLessThan(MAX_MADE_FILE_CELLS);
        expect((await failed({ name: 'x', format: 'xlsx', rows })).reason).toBe('too_big');
    }, 60_000);

    it('is told its format', async () => {
        expect((await failed({ name: 'x', format: 'docx', content: 'a' })).message).toMatch(/md, csv or xlsx/);
        expect((await failed({ name: 'x', content: 'a' })).reason).toBe('invalid');
    });
});

describe('running the tool', () => {
    const file = { name: 'Calendar notes', format: 'xlsx', rows: [['a', 'b']] };

    it('uploads, sends, and answers with what was made, never an address', async () => {
        const upload = vi.fn(async () => 'https://files.example/chat-file/bot-gens/0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.xlsx?X-Amz-Signature=abc');
        const send = vi.fn(async () => null);
        const result = await runMakeFile({ ...file, sheets: undefined }, { upload, send });
        expect(upload).toHaveBeenCalledWith(expect.objectContaining({ name: 'Calendar notes.xlsx', format: 'xlsx' }));
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: 'Calendar notes.xlsx' }), expect.stringContaining('files.example'));
        expect(result).toEqual({ success: true, name: 'Calendar notes.xlsx', kind: 'Spreadsheet file (.xlsx)', sizeBytes: expect.any(Number), tabs: 1 });
        expect(JSON.stringify(result)).not.toMatch(/https?:/);
    });

    it('sends nothing for a file that was asked for wrongly, or is too big, and says which', async () => {
        const upload = vi.fn(async () => 'https://x');
        const send = vi.fn(async () => null);
        const wrong = await runMakeFile({ name: 'x', format: 'md' }, { upload, send });
        expect(wrong).toMatchObject({ reason: 'invalid', error: expect.stringContaining('Nothing was sent') });
        const big = await runMakeFile({ name: 'x', format: 'md', content: 'a'.repeat(MAX_MADE_FILE_BYTES + 1) }, { upload, send });
        expect(big).toMatchObject({ reason: 'too_big', error: expect.stringMatching(/too big for a chat file[\s\S]*split it into smaller files[\s\S]*Do not make an app/) });
        expect(upload).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('says nothing was sent when the upload fails, throws or has nowhere to go', async () => {
        const send = vi.fn(async () => null);
        for (const upload of [vi.fn(async () => null), vi.fn(async () => { throw new Error('upload 500'); })]) {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const result = await runMakeFile(file, { upload, send });
            expect(result).toMatchObject({ reason: 'failed', error: expect.stringMatching(/could not be made just now\. Nothing was sent/) });
            warn.mockRestore();
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('passes on why it could not be sent, and never reports a file as made then', async () => {
        const result = await runMakeFile(file, { upload: async () => 'https://x', send: async () => 'The conversation ended before it could be sent.' });
        expect(result).toEqual({ error: 'The conversation ended before it could be sent.', reason: 'not_sent' });
        const thrown = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const boom = await runMakeFile(file, {
            upload: async () => 'https://x',
            send: async () => {
                throw new Error('socket closed');
            },
        });
        thrown.mockRestore();
        expect(boom).toMatchObject({ reason: 'failed' });
    });
});

describe('the words the Brick uses', () => {
    it('the result tells the model to name a file by its type and never to call it a Doc or an app', () => {
        const line = formatMakeFileResult({ success: true, name: 'Calendar notes.xlsx', kind: FILE_WORDS.xlsx, tabs: 6, sizeBytes: 18_000 });
        expect(line).toContain('"Calendar notes.xlsx", a spreadsheet file (.xlsx) with 6 tabs');
        expect(line).toMatch(/a spreadsheet file \(\.xlsx\)/);
        expect(line).toMatch(/a Markdown file \(\.md\)/);
        expect(line).toMatch(/not a Doc, an app or an artifact/);
        expect(line).not.toMatch(/https?:/);
        expect(formatMakeFileResult({ success: true, name: 'n.md', kind: FILE_WORDS.md, sizeBytes: 3 })).toContain('a markdown file (.md)'.replace('markdown', 'Markdown'));
        expect(formatMakeFileResult({ error: 'The file could not be made just now.' })).toBe('make_file: The file could not be made just now.');
    });

    it('never says Excel in a word people read: the kind of file is a "Spreadsheet file (.xlsx)"', () => {
        expect(FILE_WORDS).toEqual({ md: 'Markdown file (.md)', csv: 'CSV file (.csv)', xlsx: 'Spreadsheet file (.xlsx)' });
        const everything = JSON.stringify(makeFileToolDefinition()) + Object.values(FILE_WORDS).join(' ') + BRICK_WORK_RULES;
        expect(everything).not.toMatch(/excel/i);
    });

    it('the file tool is for files, and says an artifact is not one', () => {
        const tool = makeFileToolDefinition();
        expect(tool.function.name).toBe(MAKE_FILE_TOOL);
        expect(tool.function.description).toMatch(/send, give, save, export or download/);
        expect(tool.function.description).toMatch(/NOT an artifact/);
        expect(tool.function.parameters).toMatchObject({ required: ['name', 'format'], properties: { format: { enum: ['md', 'csv', 'xlsx'] } } });
    });

    it('make_artifact points a request for a file at make_file when it is offered, and keeps making apps', () => {
        const description = (fileWith: boolean) => artifactToolDefinitions({ fileWith }).find((tool) => tool.function.name === 'make_artifact')!.function.description;
        expect(description(true)).toMatch(/It is NOT a file\. When they ask you to send or give them a file, a markdown, a \.md, a CSV, a sheet or a spreadsheet[\s\S]*use make_file instead/);
        expect(description(true)).toMatch(/Only an app, a page, a Doc or a drawing they asked you to build or make is made here/);
        expect(description(true)).toMatch(/whenever someone asks|Use it when someone asks you to build, make, create or design/);
        expect(description(true)).toMatch(/Say plainly what you made: "a mini app", "a page", "a Doc in this chat", "a drawing"/);
        // Not offered: it never points at a tool the bot does not have
        expect(description(false)).not.toContain('make_file');
        expect(description(false)).toMatch(/Use it when someone asks you to build, make, create or design/);
        const kind = (artifactToolDefinitions({}).find((tool) => tool.function.name === 'make_artifact')!.function.parameters as { properties: { kind: { description: string } } }).properties.kind.description;
        expect(kind).toContain('a Doc shown in the chat window (not a file to download)');
    });

    it('a Doc made in the chat is told as a Doc in this chat, never a markdown file', () => {
        const line = formatArtifactResult('make_artifact', { success: true, id: 'a1', title: 'Notes', kind: 'markdown', version: 1 });
        expect(line).toContain('a Doc in this chat (not a file to download)');
        expect(line).not.toMatch(/markdown file/i);
        expect(formatArtifactResult('make_artifact', { success: true, id: 'a2', title: 'Board', kind: 'app', version: 1 })).toContain('It is a mini app in the chat');
        expect(formatArtifactResult('make_artifact', { success: true, id: 'a3', title: 'Pic', kind: 'svg', version: 1 })).toContain('a drawing');
    });

    it("the Brick's rules say a file request gets a file, an app request an app, and to say plainly which", () => {
        expect(BRICK_WORK_RULES).toContain('make a real file and send it. Never answer that with an app, a page or a Doc.');
        expect(BRICK_WORK_RULES).toContain('When they ask you to build, make or design an app, a page or a drawing, make that instead.');
        expect(BRICK_WORK_RULES).toContain('"a Doc in this chat" for a Doc, "a Markdown file (.md) you can download" or "a spreadsheet file (.xlsx) you can download" for a file');
        expect(BRICK_WORK_RULES).toContain('Never call a Doc a markdown file, and never call a file an app.');
        expect(BRICK_WORK_RULES).toContain('too big for one chat file');
        expect(BRICK_WORK_RULES).toContain('nothing was sent');
        // A tool's name is still never said to the person
        expect(BRICK_WORK_RULES).not.toContain('make_file');
    });
});
