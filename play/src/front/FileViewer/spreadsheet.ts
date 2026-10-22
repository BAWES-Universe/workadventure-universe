import type * as SheetJs from "xlsx";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "./textFiles";
import { assertUnpackedWithin, zipUnpackedSize } from "./zipSize";

/** A spreadsheet is read in memory; a file far bigger than any sheet people share is offered as a download instead. */
export const MAX_SPREADSHEET_BYTES = 30 * 1024 * 1024;
/** Rows read after the ones that are shown, to tell a sheet that ends there from one that goes on. */
const READ_BEYOND_SHOWN = 2;
/** The most a repeated column or row of an OpenDocument sheet is let to count: one more than the reader goes on to use. */
const OPEN_DOCUMENT_LIMITS = { columns: MAX_TABLE_COLUMNS + 1, rows: MAX_TABLE_ROWS + READ_BEYOND_SHOWN + 1 };
/**
 * A sheet's text can be many times its zip, and every cell it holds takes about eight times its text in memory once read
 * (measured: a million cells, 26 MB of text, 215 MB of memory). At this much unpacked a sheet takes about 400 MB to read,
 * which a phone can hold; a file past it is offered as a download instead.
 */
const MAX_UNPACKED_SPREADSHEET_BYTES = 50 * 1024 * 1024;
/**
 * The most cells with a value an OpenDocument sheet is let to repeat into, counted over the rows that are read. A few
 * bytes can repeat a cell a hundred times and a row a thousand times, so the size limit alone does not bound the cells
 * the reader builds (measured: four million repeated cells, 2.5 MB of text, 14 seconds and 430 MB).
 */
const MAX_OPEN_DOCUMENT_CELLS = 2_000_000;

/** Like Excel, which draws the first 1,024 characters of a cell, a cell is drawn up to this long. */
const MAX_CELL_CHARS = 1024;
/**
 * A sheet can point many cells at one very long text (a shared string), so the cells drawn share a budget of text. A sheet
 * of ordinary cells is far below it.
 */
const MAX_SHEET_TEXT_CHARS = 2_000_000;
/**
 * The same limits for a whole workbook, so that many sheets cannot add up to far more than one: the text its sheets
 * draw, and the cells of the grids drawn (a sheet with a cell far down and to the right is drawn as a grid of 100,000).
 * A workbook of ordinary sheets is far below them.
 */
const MAX_WORKBOOK_TEXT_CHARS = 10_000_000;
const MAX_WORKBOOK_GRID_CELLS = 2_000_000;

/** What is left of the limits of a whole workbook, taken from by each sheet drawn. */
interface WorkbookBudget {
    textLeft: number;
    gridLeft: number;
}

export interface SheetCell {
    /** The cell as the file shows it (dates, percentages and currencies already formatted). Always drawn as text. */
    text: string;
    /** A number, a date or a formula result of those: aligned to the right, as in Excel. */
    number: boolean;
}

export interface SheetView {
    name: string;
    /** Up to MAX_TABLE_ROWS rows from the top of the sheet, each up to MAX_TABLE_COLUMNS cells from column A. */
    rows: SheetCell[][];
    columnCount: number;
    /** How many rows the sheet has in all, or undefined when the file does not say. */
    totalRows: number | undefined;
    rowsCut: boolean;
    columnsCut: boolean;
    /** A cell's text was drawn shorter than the file has it (a very long text, or the sheet's text budget ran out). */
    textCut: boolean;
}

/** "A", "B", ... "Z", "AA": the column letters over a sheet. */
export function columnLetters(index: number): string {
    let letters = "";
    for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
        letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
    }
    return letters;
}

/** A zip (.xlsx, .ods) or an old Office file (.xls, and a password-locked .xlsx). */
function isSpreadsheetContainer(head: Uint8Array): boolean {
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    const isOldOffice = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => head[index] === value);
    return isZip || isOldOffice;
}

function textOfCell(cell: SheetJs.CellObject | undefined): SheetCell {
    if (!cell || cell.v === undefined || cell.v === null) return { text: "", number: false };
    // `w` is the text the file's own number format makes of the value. A cell without one shows its plain value.
    const text = cell.w ?? String(cell.v);
    return { text, number: cell.t === "n" };
}

function isHighSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

/**
 * A cell this short is always drawn whole, so numbers and short labels stay readable on a sheet that has used up its text
 * budget (the cells drawn are limited too, so this adds at most this many characters to each).
 */
const SHORT_CELL_CHARS = 16;

/** The cell with its text cut to what is drawn, taken from what is left of the sheet's text budget. */
function limitedCell(cell: SheetCell, budget: { left: number; cut: boolean }): SheetCell {
    const room = Math.max(0, Math.min(MAX_CELL_CHARS, budget.left));
    if (cell.text.length <= room) {
        budget.left -= cell.text.length;
        return cell;
    }
    if (cell.text.length <= SHORT_CELL_CHARS) return cell;
    // Never end on the first half of a character the file writes as two code units (an emoji, for one).
    const end = room > 0 && isHighSurrogate(cell.text.charCodeAt(room - 1)) ? room - 1 : room;
    budget.left -= end;
    budget.cut = true;
    return { ...cell, text: `${cell.text.slice(0, end)}…` };
}

/**
 * The last row and the last column (from 0) that hold a cell, or -1 when there are none. The reader keeps the cells it
 * reads whatever size the file claims, so the rows count from the cells too: a file that claims a smaller size than its
 * cells fill would otherwise lose the rest of its rows without a word. Only the columns of the rows that are shown count.
 */
function usedExtent(XLSX: typeof SheetJs, sheet: SheetJs.WorkSheet): { row: number; column: number } {
    let row = -1;
    let column = -1;
    for (const address in sheet) {
        if (address.charCodeAt(0) === 33) continue; // "!ref", "!fullref", "!merges"...
        const cell = XLSX.utils.decode_cell(address);
        row = Math.max(row, cell.r);
        // The reader keeps rows beyond the ones that are shown; they do not count.
        if (cell.r < MAX_TABLE_ROWS) column = Math.max(column, cell.c);
    }
    return { row, column };
}

function holdsCells(sheet: SheetJs.WorkSheet | undefined): boolean {
    if (!sheet) return false;
    const type = (sheet as { "!type"?: string })["!type"];
    return type === undefined || type === "sheet";
}

function viewOfSheet(
    XLSX: typeof SheetJs,
    name: string,
    sheet: SheetJs.WorkSheet,
    workbook: WorkbookBudget
): SheetView {
    const reference = sheet["!ref"];
    // A sheet with no cells is drawn like Excel draws it: the grid of one empty cell, A1.
    if (!reference) {
        return {
            name,
            rows: [[textOfCell(undefined)]],
            columnCount: 1,
            totalRows: 0,
            rowsCut: false,
            columnsCut: false,
            textCut: false,
        };
    }
    const range = XLSX.utils.decode_range(reference);
    // Reading stops two rows after the rows that are shown. A sheet that ends within them is as long as its cells say,
    // whatever size the file claims. One that fills them all goes on, and its length is the size the file claims, or
    // unknown when it claims none: a file that gives no size cannot be counted without reading all of it.
    const used = usedExtent(XLSX, sheet);
    const lastKnownRow = Math.max(range.e.r, used.row);
    const stoppedEarly = lastKnownRow + 1 > MAX_TABLE_ROWS;
    const readAll = lastKnownRow + 1 <= MAX_TABLE_ROWS + READ_BEYOND_SHOWN - 1;
    const fullReference = sheet["!fullref"];
    const claimedRows = fullReference ? XLSX.utils.decode_range(fullReference).e.r + 1 : undefined;
    const totalRows = readAll ? lastKnownRow + 1 : claimedRows;
    const lastRow = Math.min(lastKnownRow, MAX_TABLE_ROWS - 1);
    // The columns are the ones that hold cells: the size a file claims can reach column XFD over a sheet of three.
    const usedColumns = used.column + 1;
    const lastColumn = Math.min(Math.max(usedColumns, 1), MAX_TABLE_COLUMNS) - 1;
    // Like Excel, a sheet always starts at A1, even when its first cells are further down or to the right.
    workbook.gridLeft -= (lastRow + 1) * (lastColumn + 1);
    if (workbook.gridLeft < 0) throw new Error("The file is too big to show");
    const rows: SheetCell[][] = [];
    const textRoom = Math.min(MAX_SHEET_TEXT_CHARS, workbook.textLeft);
    const budget = { left: textRoom, cut: false };
    for (let row = 0; row <= lastRow; row++) {
        const cells: SheetCell[] = [];
        for (let column = 0; column <= lastColumn; column++) {
            cells.push(limitedCell(textOfCell(sheet[XLSX.utils.encode_cell({ r: row, c: column })]), budget));
        }
        rows.push(cells);
    }
    workbook.textLeft -= textRoom - budget.left;
    return {
        name,
        rows,
        columnCount: lastColumn + 1,
        totalRows,
        rowsCut: stoppedEarly,
        columnsCut: usedColumns > MAX_TABLE_COLUMNS,
        textCut: budget.cut,
    };
}

/** The text of an XML attribute value with the five entities XML defines turned back into characters. */
function unescapeXml(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function attributeOf(attributes: string, name: string): string | undefined {
    return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attributes)?.[2];
}

/** The repeat attributes of a tag, whatever prefix the file gives them: the reader drops the prefix and reads the name. */
const REPEAT_ATTRIBUTE = /(\bnumber-(columns|rows)-repeated\s*=\s*)(["'])(.*?)\3/g;

/** How often the reader repeats, for a repeat attribute's text: the way it reads each (rows as a number, columns as an integer), and 1 when that is nothing. */
function repeatCountOf(text: string, kind: "columns" | "rows"): number {
    const count = kind === "rows" ? Number(text) : parseInt(text, 10);
    return count >= 1 ? Math.floor(count) : 1;
}

/** The repeat of a row or a cell tag: the largest of its repeat attributes, 1 when it has none. */
function repeatOf(tag: string, kind: "columns" | "rows"): number {
    let repeated = 1;
    for (const match of tag.matchAll(REPEAT_ATTRIBUTE)) {
        if (match[2] === kind) repeated = Math.max(repeated, repeatCountOf(match[4], kind));
    }
    return repeated;
}

/** A tag with its repeat attributes written as whole numbers no larger than the reader goes on to use. */
function tagWithLimitedRepeats(tag: string): string {
    return tag.replace(
        REPEAT_ATTRIBUTE,
        (whole, name: string, kind: "columns" | "rows", quote: string, text: string) => {
            const limited = String(Math.min(repeatCountOf(text, kind), OPEN_DOCUMENT_LIMITS[kind]));
            return limited === text ? whole : `${name}${quote}${limited}${quote}`;
        }
    );
}

/** A tag's name without its prefix and without the suffix the reader ignores, as the reader goes by it. */
function localNameOf(name: string): string {
    return name
        .replace(/^\/?[^:]*:/, "")
        .replace(/^\//, "")
        .replace(/_[\s\S]*$/, "");
}

interface OpenDocument {
    data: Uint8Array;
    hidden: Set<string>;
    /** By sheet name: the repeats of a row that were cut away, which the sheet still counts in its length. */
    cutRows: Map<string, number>;
}

/**
 * A run of spaces in a cell's text is written as one tag with its length ("<text:s text:c="3"/>"), and the reader turns it
 * into that many spaces (it first turns every tab and line break into a space and every run of spaces into one, so the
 * tag may be spelled with any of them between its name and its attribute). A run is cut to this many: a cell is drawn up to 1,024 characters, and a few bytes would
 * otherwise make a string of billions.
 */
const MAX_SPACE_RUN = 32;
const SPACE_RUN = /<text:s[ \t\r\n]+text:c="(\d+)"\/>/g;

/** The tags the reader goes by in an OpenDocument sheet (its own pattern): a value in quotes may hold a ">". */
const OPEN_DOCUMENT_TAG = /<([/]?)([^\s?><!/:"]*:|)([^\s?<>:/"]+)(?:\s+[^<>=?"'\s]+="[^"]*?")*\s*[/]?>/g;

/** The file as the reader sees it: without comments (an unfinished one takes the rest of the file) and a leading doctype. */
function asReaderSees(xml: string): string {
    const parts: string[] = [];
    let last = 0;
    for (let open = xml.indexOf("<!--"); open >= 0; open = xml.indexOf("<!--", last)) {
        parts.push(xml.slice(last, open));
        const close = xml.indexOf("-->", open + 4);
        if (close < 0) return finishWithoutDoctype(parts.join(""));
        last = close + 3;
    }
    parts.push(xml.slice(last));
    return finishWithoutDoctype(parts.join(""));
}

function finishWithoutDoctype(xml: string): string {
    const doctype = xml.slice(0, 1024).indexOf("<!DOCTYPE");
    if (doctype < 0) return xml;
    const firstTag = /<\w/.exec(xml);
    return firstTag ? xml.slice(0, doctype) + xml.slice(firstTag.index) : xml;
}

/**
 * An OpenDocument sheet can write one cell as "repeated a hundred thousand times" in a few bytes, and the reader then
 * builds every one of them. Only the first columns and rows are shown, so a repeat is cut to one more than that: what
 * comes after it is past the last column or row shown either way. The file is walked tag by tag, once, so a crafted
 * file cannot make it slow, and the repeat attributes of its tags are rewritten as whole numbers within the limit.
 *
 * The tags are found with the reader's own pattern, on the file without the comments the reader skips, so both see the
 * same tags. The same walk finds the sheets the file hides (the reader leaves them out of its workbook properties: a
 * sheet names a style, and that style says "display false"), adds up the rows the repeats cut away before a sheet's last
 * row with a value (by sheet name, to keep its length right), and counts the cells with a value that the rows read
 * repeat into: a file past the limit throws.
 */
function scanOpenDocument(xml: string): { hidden: Set<string>; cutRows: Map<string, number>; limited?: string } {
    const cutRows = new Map<string, number>();
    const hiddenStyles = new Set<string>();
    const tables: { name: string; style: string }[] = [];
    /** The table style whose properties are being read. */
    let openStyle: string | undefined;
    /** The sheet whose rows are being walked, the rows before the tag being read, and the repeats cut away so far. */
    let rowsOf: { name: string; before: number; cut: number } | undefined;
    /**
     * The row being read: its cells with a value, how often it is repeated, and whether it lies within the rows the
     * reader builds (past them it builds nothing, so it counts toward no budget).
     */
    let openRow: { cells: number; repeated: number; built: boolean; sheet: string } | undefined;
    let cells = 0;
    const countCells = (): void => {
        if (cells + (openRow ? openRow.cells * openRow.repeated : 0) > MAX_OPEN_DOCUMENT_CELLS) {
            throw new Error("The file is too big to show");
        }
    };
    /** The pieces of the file once a tag has been rewritten, and where the part not yet copied starts. */
    const pieces: string[] = [];
    let copied = 0;
    const tags = new RegExp(OPEN_DOCUMENT_TAG.source, "g");
    for (let found = tags.exec(xml); found; found = tags.exec(xml)) {
        const start = found.index;
        const end = start + found[0].length - 1;
        const tag = found[0].slice(1, -1);
        if (tag.includes("-repeated")) {
            const limited = tagWithLimitedRepeats(tag);
            if (limited !== tag) {
                pieces.push(xml.slice(copied, start + 1), limited);
                copied = end;
            }
        }
        // The name ends at the first space or slash, after the slash a closing tag starts with.
        const nameStart = tag.startsWith("/") ? 1 : 0;
        const nameEnd = nameStart + tag.slice(nameStart).search(/[\s/]|$/);
        const name = tag.slice(0, nameEnd);
        const attributes = tag.slice(nameEnd);
        const closing = name.startsWith("/");
        const local = localNameOf(name);
        const selfClosing = tag.endsWith("/");
        if (name === "style:style") {
            const family = attributeOf(attributes, "style:family");
            openStyle = selfClosing || family !== "table" ? undefined : attributeOf(attributes, "style:name");
        } else if (name === "/style:style") {
            openStyle = undefined;
        } else if (name === "style:table-properties") {
            if (openStyle !== undefined && /table:display\s*=\s*["']false["']/.test(attributes)) {
                hiddenStyles.add(openStyle);
            }
        } else if ((local === "table" || local === "工作表") && !closing) {
            const tableName = attributeOf(attributes, "table:name");
            const style = attributeOf(attributes, "table:style-name");
            if (tableName !== undefined && style !== undefined) tables.push({ name: tableName, style });
            const sheet = tableName ?? /(?:^|\s)(?:[^\s=:]+:)?name\s*=\s*(["'])(.*?)\1/.exec(attributes)?.[2];
            rowsOf = sheet === undefined ? undefined : { name: sheet, before: 0, cut: 0 };
        } else if ((local === "table-row" || local === "行") && !closing && rowsOf) {
            const repeated = repeatOf(tag, "rows");
            openRow = selfClosing
                ? undefined
                : {
                      cells: 0,
                      repeated: Math.min(repeated, OPEN_DOCUMENT_LIMITS.rows),
                      built: rowsOf.before < MAX_TABLE_ROWS + READ_BEYOND_SHOWN,
                      sheet: rowsOf.name,
                  };
            // Every repeat moves the rows after it, and every repeat cut away is part of the sheet's length, empty
            // rows too. (The reader does not move on past a row written as one tag, "<row/>", so neither does this.)
            if (!selfClosing) {
                rowsOf.cut = Math.min(
                    rowsOf.cut + Math.max(0, repeated - OPEN_DOCUMENT_LIMITS.rows),
                    Number.MAX_SAFE_INTEGER
                );
                rowsOf.before = Math.min(rowsOf.before + repeated, Number.MAX_SAFE_INTEGER);
            }
        } else if ((local === "table-cell" || local === "数据") && !closing && openRow) {
            // A cell that is not empty: it names its type, or it has content (an empty cell is written without any).
            if (!selfClosing || /(?:^|\s)(?:[^\s=:]+:)?value-type\s*=/.test(attributes)) {
                openRow.cells += Math.min(repeatOf(tag, "columns"), OPEN_DOCUMENT_LIMITS.columns);
                if (openRow.built) countCells();
            }
        } else if ((local === "table-row" || local === "行") && closing && openRow) {
            if (openRow.built) cells += openRow.cells * openRow.repeated;
            // The sheet ends at its last row with a value: what was cut before it (and in it) is part of its length.
            if (rowsOf && rowsOf.cut > 0 && openRow.cells > 0) {
                cutRows.set(openRow.sheet, rowsOf.cut);
                cutRows.set(unescapeXml(openRow.sheet), rowsOf.cut);
            }
            openRow = undefined;
            countCells();
        }
    }
    const hidden = new Set<string>();
    for (const { name, style } of tables) {
        if (!hiddenStyles.has(style)) continue;
        // The reader keeps an ampersand in a sheet's name as it is written in the file, so either spelling is hidden.
        hidden.add(name);
        hidden.add(unescapeXml(name));
    }
    if (pieces.length === 0) return { hidden, cutRows };
    pieces.push(xml.slice(copied));
    return { hidden, cutRows, limited: pieces.join("") };
}

async function prepareOpenDocument(bytes: ArrayBuffer): Promise<OpenDocument> {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const content = zip.file("content.xml");
    if (!content) return { data: new Uint8Array(bytes), hidden: new Set(), cutRows: new Map() };
    const text = asReaderSees(await content.async("string"));
    const spaced = text.replace(SPACE_RUN, (whole, run: string) =>
        Number(run) > MAX_SPACE_RUN ? `<text:s text:c="${MAX_SPACE_RUN}"/>` : whole
    );
    const scanned = scanOpenDocument(spaced);
    const { hidden, cutRows } = scanned;
    const limited = scanned.limited ?? (spaced !== text ? spaced : undefined);
    if (limited === undefined) return { data: new Uint8Array(bytes), hidden, cutRows };
    zip.file("content.xml", limited);
    return { data: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), hidden, cutRows };
}

/**
 * The sheets of an Excel (.xlsx, .xls) or OpenDocument (.ods) file, as plain text cells. Only values are read:
 * formulas, macros, links, styles, pictures and charts are left out, and a cell is never turned into HTML. A damaged
 * or password-locked file throws.
 */
export async function readSpreadsheet(bytes: ArrayBuffer): Promise<SheetView[]> {
    // The reader also takes plain text and web pages as sheets; only the real file types are accepted here.
    const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
    if (!isSpreadsheetContainer(head)) throw new Error("Not a spreadsheet file");
    // A zip (.xlsx, .ods) is measured before anything is unpacked, by the sizes it lists and then by the bytes that
    // really come out. An old .xls is not a zip.
    if (head[0] === 0x50) {
        const unpacked = zipUnpackedSize(bytes);
        if (unpacked === undefined || unpacked > MAX_UNPACKED_SPREADSHEET_BYTES) {
            throw new Error("The file is too big to show");
        }
        await assertUnpackedWithin(bytes, MAX_UNPACKED_SPREADSHEET_BYTES);
    }
    const XLSX = await import("xlsx");
    const opened =
        head[0] === 0x50
            ? await prepareOpenDocument(bytes)
            : { data: new Uint8Array(bytes), hidden: new Set<string>(), cutRows: new Map<string, number>() };
    const workbook = XLSX.read(opened.data, {
        type: "array",
        // Only the rows that are shown are read, so a sheet of a million rows opens as fast as a small one.
        sheetRows: MAX_TABLE_ROWS + READ_BEYOND_SHOWN,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        cellDates: false,
        bookVBA: false,
    });
    const hiddenInWorkbook = workbook.Workbook?.Sheets ?? [];
    // A sheet the file lists but holds no data for (a damaged file) is left out instead of failing the others.
    // A chart sheet, macro sheet or dialog sheet holds no cells: it is left out like a hidden one, not drawn as an empty grid.
    const sheets = workbook.SheetNames.map((name, index) => ({
        name,
        hidden: Boolean(hiddenInWorkbook[index]?.Hidden) || opened.hidden.has(name),
    })).filter(({ name }) => holdsCells(workbook.Sheets[name]));
    // A workbook whose data sheets are all hidden still opens.
    const visible = sheets.filter(({ hidden }) => !hidden);
    const budget: WorkbookBudget = { textLeft: MAX_WORKBOOK_TEXT_CHARS, gridLeft: MAX_WORKBOOK_GRID_CELLS };
    return (visible.length > 0 ? visible : sheets).map(({ name }) => {
        const view = viewOfSheet(XLSX, name, workbook.Sheets[name], budget);
        // The rows of a cut repeat still count in the sheet's length.
        const cut = opened.cutRows.get(name);
        if (cut !== undefined && view.rowsCut && view.totalRows !== undefined) view.totalRows += cut;
        return view;
    });
}
