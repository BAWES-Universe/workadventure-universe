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

/** Like Excel, which draws the first 1,024 characters of a cell, a cell is drawn up to this long. */
const MAX_CELL_CHARS = 1024;
/**
 * A sheet can point many cells at one very long text (a shared string), so the cells drawn share a budget of text. A sheet
 * of ordinary cells is far below it.
 */
const MAX_SHEET_TEXT_CHARS = 2_000_000;

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

/** The cell with its text cut to what is drawn, taken from what is left of the sheet's text budget. */
function limitedCell(cell: SheetCell, budget: { left: number; cut: boolean }): SheetCell {
    const room = Math.max(0, Math.min(MAX_CELL_CHARS, budget.left));
    if (cell.text.length <= room) {
        budget.left -= cell.text.length;
        return cell;
    }
    // Never end on the first half of a character the file writes as two code units (an emoji, for one).
    const end = room > 0 && isHighSurrogate(cell.text.charCodeAt(room - 1)) ? room - 1 : room;
    budget.left -= end;
    budget.cut = true;
    return { ...cell, text: `${cell.text.slice(0, end)}…` };
}

/** The last column (from 0) that holds a cell in the rows that are shown, or -1 when they hold none. */
function lastUsedColumn(XLSX: typeof SheetJs, sheet: SheetJs.WorkSheet): number {
    let last = -1;
    for (const address in sheet) {
        if (address.charCodeAt(0) === 33) continue; // "!ref", "!fullref", "!merges"...
        const cell = XLSX.utils.decode_cell(address);
        // The reader keeps rows beyond the ones that are shown; they do not count.
        if (cell.r < MAX_TABLE_ROWS) last = Math.max(last, cell.c);
    }
    return last;
}

function holdsCells(sheet: SheetJs.WorkSheet | undefined): boolean {
    if (!sheet) return false;
    const type = (sheet as { "!type"?: string })["!type"];
    return type === undefined || type === "sheet";
}

function viewOfSheet(XLSX: typeof SheetJs, name: string, sheet: SheetJs.WorkSheet): SheetView {
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
    const stoppedEarly = range.e.r + 1 > MAX_TABLE_ROWS;
    const readAll = range.e.r + 1 <= MAX_TABLE_ROWS + READ_BEYOND_SHOWN - 1;
    const fullReference = sheet["!fullref"];
    const claimedRows = fullReference ? XLSX.utils.decode_range(fullReference).e.r + 1 : undefined;
    const totalRows = readAll ? range.e.r + 1 : claimedRows;
    const lastRow = Math.min(range.e.r, MAX_TABLE_ROWS - 1);
    // The columns are the ones that hold cells: the size a file claims can reach column XFD over a sheet of three.
    const usedColumns = lastUsedColumn(XLSX, sheet) + 1;
    const lastColumn = Math.min(Math.max(usedColumns, 1), MAX_TABLE_COLUMNS) - 1;
    // Like Excel, a sheet always starts at A1, even when its first cells are further down or to the right.
    const rows: SheetCell[][] = [];
    const budget = { left: MAX_SHEET_TEXT_CHARS, cut: false };
    for (let row = 0; row <= lastRow; row++) {
        const cells: SheetCell[] = [];
        for (let column = 0; column <= lastColumn; column++) {
            cells.push(limitedCell(textOfCell(sheet[XLSX.utils.encode_cell({ r: row, c: column })]), budget));
        }
        rows.push(cells);
    }
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

/**
 * The sheets an OpenDocument file hides, and the rows a sheet repeats past the ones that are read. The reader leaves
 * hidden sheets out of its workbook properties, so they are found in the file: a sheet names a style, and that style says
 * "display false". The file is walked tag by tag, once, so a crafted file cannot make it slow.
 *
 * A row repeated more often than the rows read is cut before the reader sees it, so the rows it leaves out are counted
 * here, by sheet name, to keep the sheet's length right. Only the first such row counts: the reader stops there.
 */
function scanOpenDocument(xml: string): { hidden: Set<string>; cutRows: Map<string, number> } {
    const cutRows = new Map<string, number>();
    const hiddenStyles = new Set<string>();
    const tables: { name: string; style: string }[] = [];
    /** The table style whose properties are being read. */
    let openStyle: string | undefined;
    /** The sheet whose rows are being counted, and the rows before the tag being read; undefined once the reader stops. */
    let rowsOf: { name: string; before: number } | undefined;
    let position = 0;
    for (;;) {
        const start = xml.indexOf("<", position);
        if (start < 0) break;
        const end = xml.indexOf(">", start);
        if (end < 0) break;
        position = end + 1;
        const tag = xml.slice(start + 1, end);
        const nameEnd = tag.search(/[\s/]|$/);
        const name = tag.slice(0, nameEnd);
        const attributes = tag.slice(nameEnd);
        if (name === "style:style") {
            const family = attributeOf(attributes, "style:family");
            openStyle = tag.endsWith("/") || family !== "table" ? undefined : attributeOf(attributes, "style:name");
        } else if (name === "/style:style") {
            openStyle = undefined;
        } else if (name === "style:table-properties") {
            if (openStyle !== undefined && /table:display\s*=\s*["']false["']/.test(attributes)) {
                hiddenStyles.add(openStyle);
            }
        } else if (name === "table:table") {
            const tableName = attributeOf(attributes, "table:name");
            const style = attributeOf(attributes, "table:style-name");
            if (tableName !== undefined && style !== undefined) tables.push({ name: tableName, style });
            rowsOf = tableName === undefined ? undefined : { name: tableName, before: 0 };
        } else if (name === "table:table-row" && rowsOf) {
            const repeated = Number(attributeOf(attributes, "table:number-rows-repeated") ?? 1);
            if (repeated > OPEN_DOCUMENT_LIMITS.rows) {
                const left = repeated - OPEN_DOCUMENT_LIMITS.rows;
                cutRows.set(rowsOf.name, left);
                cutRows.set(unescapeXml(rowsOf.name), left);
                rowsOf = undefined;
            } else {
                rowsOf.before += repeated;
                if (rowsOf.before >= MAX_TABLE_ROWS + READ_BEYOND_SHOWN) rowsOf = undefined;
            }
        }
    }
    const hidden = new Set<string>();
    for (const { name, style } of tables) {
        if (!hiddenStyles.has(style)) continue;
        // The reader keeps an ampersand in a sheet's name as it is written in the file, so either spelling is hidden.
        hidden.add(name);
        hidden.add(unescapeXml(name));
    }
    return { hidden, cutRows };
}

interface OpenDocument {
    data: Uint8Array;
    hidden: Set<string>;
    /** By sheet name: the repeats of a row that were cut away, which the sheet still counts in its length. */
    cutRows: Map<string, number>;
}

/**
 * An OpenDocument sheet can write one cell as "repeated a hundred thousand times" in a few bytes, and the reader then
 * builds every one of them. Only the first columns are shown, so a repeat is cut to one cell more than that: the cells
 * after it are past the last column shown either way. The sheets the file hides are listed too. A file that is not
 * OpenDocument is returned as it is.
 */
async function prepareOpenDocument(bytes: ArrayBuffer): Promise<OpenDocument> {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const content = zip.file("content.xml");
    if (!content) return { data: new Uint8Array(bytes), hidden: new Set(), cutRows: new Map() };
    const xml = await content.async("string");
    const { hidden, cutRows } = scanOpenDocument(xml);
    // A row repeated past the rows that are read is cut as well: the reader would fill every repeat with cells before
    // it looks at how many rows it has, and a million repeats of a wide row never finishes.
    const limits = OPEN_DOCUMENT_LIMITS;
    const limited = xml.replace(
        /(number-(columns|rows)-repeated\s*=\s*)(["'])(\d+)\3/g,
        (whole, name: string, kind: "columns" | "rows", quote: string, count: string) =>
            Number(count) > limits[kind] ? `${name}${quote}${limits[kind]}${quote}` : whole
    );
    if (limited === xml) return { data: new Uint8Array(bytes), hidden, cutRows };
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
    return (visible.length > 0 ? visible : sheets).map(({ name }) => {
        const view = viewOfSheet(XLSX, name, workbook.Sheets[name]);
        // The rows of a cut repeat still count in the sheet's length.
        const cut = opened.cutRows.get(name);
        if (cut !== undefined && view.rowsCut && view.totalRows !== undefined) view.totalRows += cut;
        return view;
    });
}
