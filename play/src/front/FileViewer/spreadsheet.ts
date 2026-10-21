import type * as SheetJs from "xlsx";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "./textFiles";

/** A spreadsheet is read in memory; a file far bigger than any sheet people share is offered as a download instead. */
export const MAX_SPREADSHEET_BYTES = 30 * 1024 * 1024;

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

function viewOfSheet(XLSX: typeof SheetJs, name: string, sheet: SheetJs.WorkSheet): SheetView {
    const reference = sheet["!ref"];
    if (!reference) return { name, rows: [], columnCount: 0, totalRows: 0, rowsCut: false, columnsCut: false };
    const range = XLSX.utils.decode_range(reference);
    // Reading stops after the rows that are shown; the full size of the sheet is kept next to the cut one.
    const fullReference = sheet["!fullref"];
    const fullRange = fullReference ? XLSX.utils.decode_range(fullReference) : undefined;
    const totalRows = fullRange ? fullRange.e.r + 1 : range.e.r + 1;
    const rowsCut = totalRows > MAX_TABLE_ROWS;
    const lastRow = Math.min(range.e.r, MAX_TABLE_ROWS - 1);
    const lastColumn = Math.min(range.e.c, MAX_TABLE_COLUMNS - 1);
    // Like Excel, a sheet always starts at A1, even when its first cells are further down or to the right.
    const rows: SheetCell[][] = [];
    for (let row = 0; row <= lastRow; row++) {
        const cells: SheetCell[] = [];
        for (let column = 0; column <= lastColumn; column++) {
            cells.push(textOfCell(sheet[XLSX.utils.encode_cell({ r: row, c: column })]));
        }
        rows.push(cells);
    }
    return {
        name,
        rows,
        columnCount: lastColumn + 1,
        totalRows: !fullRange && range.e.r + 1 > MAX_TABLE_ROWS ? undefined : totalRows,
        rowsCut: rowsCut || (!fullRange && range.e.r + 1 > MAX_TABLE_ROWS),
        columnsCut: range.e.c + 1 > MAX_TABLE_COLUMNS || (fullRange ? fullRange.e.c + 1 > MAX_TABLE_COLUMNS : false),
    };
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
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(new Uint8Array(bytes), {
        type: "array",
        // Only the rows that are shown are read, so a sheet of a million rows opens as fast as a small one.
        sheetRows: MAX_TABLE_ROWS + 1,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        cellDates: false,
        bookVBA: false,
    });
    const hidden = workbook.Workbook?.Sheets ?? [];
    const names = workbook.SheetNames.filter((_, index) => !hidden[index]?.Hidden);
    // A workbook whose sheets are all hidden still opens.
    const shown = names.length > 0 ? names : workbook.SheetNames;
    return shown.map((name) => viewOfSheet(XLSX, name, workbook.Sheets[name]));
}
