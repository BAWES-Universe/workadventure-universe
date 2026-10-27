import type JSZip from "jszip";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "./textFiles";

/** What a cell of an Excel file (.xlsx) looks like, as far as the viewer draws it. Every value is checked here. */
export interface CellStyle {
    bold?: boolean;
    italic?: boolean;
    /** The text size in pixels, scaled to the viewer (the file's default size is the viewer's own size). */
    fontSize?: number;
    /** "#rrggbb", never anything else. */
    color?: string;
    /** "#rrggbb", never anything else. */
    fill?: string;
}

/** The look of one sheet: the styled cells (keyed by row * MAX_TABLE_COLUMNS + column) and the columns' widths in pixels. */
export interface SheetLook {
    cells: Map<number, CellStyle>;
    columnWidths: (number | undefined)[];
    /** The last column (from 0) that holds a filled cell, so a coloured band is drawn to its end past the last value. */
    lastFilledColumn: number;
}

/** The size the viewer draws a cell's text in, which is what the file's default font size (11 points in Excel) comes to. */
const VIEWER_FONT_PX = 12;
/** A text size is drawn from 8 to 48 pixels, whatever the file says. */
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 48;
/** What Excel draws a column's width in characters as, in pixels: seven for a digit and five for the grid line and space. */
const PIXELS_PER_CHARACTER = 7;
const COLUMN_PADDING_PIXELS = 5;
/** A column is drawn 24 to 800 pixels wide at least, scaled like the text. */
const MIN_COLUMN_PX = 24;
const MAX_COLUMN_PX = 800;
/** Excel's default font and the viewer's, to scale pixels of the file to the pixels of the viewer. */
const DEFAULT_FONT_PX = 14.67;
const SCALE = VIEWER_FONT_PX / DEFAULT_FONT_PX;

/** Excel's own limits on the styles of a file are 64,000 or so of each; a file with more is read no further. */
const MAX_STYLE_ENTRIES = 65_536;
/** The style list, the theme and the workbook's list of sheets are small; a file with a bigger one is drawn plain. */
const MAX_SMALL_PART_BYTES = 2 * 1024 * 1024;
/** A sheet's cells are looked at up to this much of its text: the rows that are shown come first in the file. */
const MAX_SHEET_SCAN_BYTES = 8 * 1024 * 1024;
/** The styled cells of a whole workbook that are kept, like the cells it draws. */
const MAX_STYLED_CELLS = 400_000;

/** Excel's default colours, for a file that names a colour by its place in the theme but has no theme of its own. */
const DEFAULT_THEME = [
    "FFFFFF",
    "000000",
    "E7E6E6",
    "44546A",
    "4472C4",
    "ED7D31",
    "A5A5A5",
    "FFC000",
    "5B9BD5",
    "70AD47",
    "0563C1",
    "954F72",
];
/** The colour scheme's entries in the order a theme index counts them (a theme lists dark before light, the index light first). */
const THEME_TAGS = [
    "lt1",
    "dk1",
    "lt2",
    "dk2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
];

interface XmlElement {
    /** The text inside the opening tag after the name, such as ` fontId="1" fillId="2"/`. */
    attributes: string;
    /** What is between the tags, or "" for a tag that closes itself. */
    inner: string;
}

/**
 * The elements called `tag` in `xml`, in order. This walks the text once with `indexOf` rather than matching a pattern:
 * a pattern that looks for a closing tag from every opening one takes time with the square of the text when the closing
 * tags are missing, and these files come from anyone.
 */
function* elementsOf(xml: string, tag: string, closes = true): Generator<XmlElement> {
    const open = `<${tag}`;
    const close = `</${tag}>`;
    let at = 0;
    for (;;) {
        const start = xml.indexOf(open, at);
        if (start < 0) return;
        const after = xml.charCodeAt(start + open.length);
        // `<fonts` is not `<font`: the name ends at a space, a slash or the end of the tag.
        if (after !== 32 && after !== 62 && after !== 47 && after !== 10 && after !== 13 && after !== 9) {
            at = start + open.length;
            continue;
        }
        const end = xml.indexOf(">", start);
        if (end < 0) return;
        const attributes = xml.slice(start + open.length, end);
        at = end + 1;
        if (attributes.endsWith("/") || !closes) {
            yield { attributes, inner: "" };
            continue;
        }
        const stop = xml.indexOf(close, at);
        if (stop < 0) return;
        yield { attributes, inner: xml.slice(at, stop) };
        at = stop + close.length;
    }
}

function attributeOf(attributes: string, name: string): string | undefined {
    const match = new RegExp(`(?:^|\\s)${name}="([^"]{0,64})"`).exec(attributes);
    return match?.[1];
}

/** A plain number, or one in exponent form: Excel writes a small tint as `-4.9989318521683403E-2`. */
function numberOf(value: string | undefined): number | undefined {
    if (value === undefined || !/^-?\d{1,9}(\.\d{1,20})?([eE][-+]?\d{1,3})?$/.test(value)) return undefined;
    return Number(value);
}

/** An element such as `<b/>` or `<b val="0"/>` that switches something on, unless it says val="0" or "false". */
function isOn(inner: string, tag: string): boolean {
    for (const { attributes } of elementsOf(inner, tag, false)) {
        const value = attributeOf(attributes, "val");
        return value !== "0" && value !== "false";
    }
    return false;
}

function hex(value: number): string {
    return Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0");
}

/** Excel's tint: a lighter (above 0) or darker (below 0) colour of the same hue, worked out in hue, lightness and saturation. */
function tinted(color: string, tint: number): string {
    const r = parseInt(color.slice(0, 2), 16) / 255;
    const g = parseInt(color.slice(2, 4), 16) / 255;
    const b = parseInt(color.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;
    if (max !== min) {
        const delta = max - min;
        saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue /= 6;
    }
    lightness = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint;
    const channel = (offset: number): number => {
        const t = (hue + offset + 1) % 1;
        const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
        const p = 2 * lightness - q;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    if (saturation === 0) return `${hex(lightness * 255)}${hex(lightness * 255)}${hex(lightness * 255)}`;
    return `${hex(channel(1 / 3) * 255)}${hex(channel(0) * 255)}${hex(channel(-1 / 3) * 255)}`;
}

/** The colour of a `<color>`, `<fgColor>`: "#rrggbb", or undefined for automatic, indexed or anything it cannot read. */
function colorOf(attributes: string, theme: string[]): string | undefined {
    const rgb = attributeOf(attributes, "rgb");
    if (rgb !== undefined)
        return /^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(rgb) ? `#${rgb.slice(-6).toLowerCase()}` : undefined;
    const index = numberOf(attributeOf(attributes, "theme"));
    if (index === undefined || !Number.isInteger(index) || index < 0 || index >= theme.length) return undefined;
    const tint = numberOf(attributeOf(attributes, "tint")) ?? 0;
    return `#${tint === 0 ? theme[index] : tinted(theme[index], Math.max(-1, Math.min(1, tint)))}`.toLowerCase();
}

/** The twelve theme colours from the file's theme, or Excel's own when it has none (or none it can read). */
function themeColors(theme: string | undefined): string[] {
    const colors = [...DEFAULT_THEME];
    if (!theme) return colors;
    const from = theme.indexOf("<a:clrScheme");
    if (from < 0) return colors;
    const scheme = theme.slice(from);
    THEME_TAGS.forEach((tag, place) => {
        const match = new RegExp(`<a:${tag}>\\s*<a:(?:srgbClr val|sysClr[^>]{0,80}?lastClr)="([0-9A-Fa-f]{6})"`).exec(
            scheme
        );
        if (match) colors[place] = match[1].toLowerCase();
    });
    return colors;
}

/** The style of each cell format (`cellXfs`) in the file's style list, in order, so a cell's `s` number picks one. */
function cellFormats(styles: string, theme: string[]): (CellStyle | undefined)[] {
    const fonts: { bold: boolean; italic: boolean; size?: number; color?: string }[] = [];
    const fontList = [...elementsOf(styles, "fonts")][0]?.inner ?? "";
    for (const { inner } of elementsOf(fontList, "font")) {
        if (fonts.length >= MAX_STYLE_ENTRIES) break;
        const size = numberOf(attributeOf([...elementsOf(inner, "sz", false)][0]?.attributes ?? "", "val"));
        const color = colorOf([...elementsOf(inner, "color", false)][0]?.attributes ?? "", theme);
        fonts.push({
            bold: isOn(inner, "b"),
            italic: isOn(inner, "i"),
            size: size !== undefined && size > 0 ? size : undefined,
            color: color === "#000000" ? undefined : color,
        });
    }
    const defaultSize = fonts[0]?.size ?? 11;

    const fills: (string | undefined)[] = [];
    const fillList = [...elementsOf(styles, "fills")][0]?.inner ?? "";
    for (const { inner } of elementsOf(fillList, "fill")) {
        if (fills.length >= MAX_STYLE_ENTRIES) break;
        const pattern = [...elementsOf(inner, "patternFill")][0];
        const solid = pattern !== undefined && attributeOf(pattern.attributes, "patternType") === "solid";
        const foreground = solid ? [...elementsOf(pattern.inner, "fgColor", false)][0] : undefined;
        fills.push(foreground ? colorOf(foreground.attributes, theme) : undefined);
    }

    const formats: (CellStyle | undefined)[] = [];
    const formatList = [...elementsOf(styles, "cellXfs")][0]?.inner ?? "";
    for (const { attributes } of elementsOf(formatList, "xf", false)) {
        if (formats.length >= MAX_STYLE_ENTRIES) break;
        const font = fonts[numberOf(attributeOf(attributes, "fontId")) ?? 0];
        const fill = fills[numberOf(attributeOf(attributes, "fillId")) ?? 0];
        const style: CellStyle = {};
        if (font?.bold) style.bold = true;
        if (font?.italic) style.italic = true;
        if (font?.size !== undefined) {
            const pixels = Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, (VIEWER_FONT_PX * font.size) / defaultSize));
            // The default size is the viewer's own: only a size that differs is kept.
            if (Math.abs(pixels - VIEWER_FONT_PX) >= 0.5) style.fontSize = Math.round(pixels * 10) / 10;
        }
        if (font?.color) style.color = font.color;
        if (fill) style.fill = fill;
        formats.push(Object.keys(style).length > 0 ? style : undefined);
    }
    return formats;
}

function widthsOf(sheet: string): (number | undefined)[] {
    const widths: (number | undefined)[] = [];
    const cols = [...elementsOf(sheet, "cols")][0]?.inner ?? "";
    for (const { attributes } of elementsOf(cols, "col", false)) {
        const first = numberOf(attributeOf(attributes, "min"));
        const last = numberOf(attributeOf(attributes, "max"));
        const characters = numberOf(attributeOf(attributes, "width"));
        const hidden = attributeOf(attributes, "hidden");
        if (first === undefined || last === undefined || characters === undefined || characters <= 0) continue;
        if (hidden === "1" || hidden === "true") continue;
        const pixels = (characters * PIXELS_PER_CHARACTER + COLUMN_PADDING_PIXELS) * SCALE;
        const width = Math.round(Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, pixels)));
        for (let column = Math.max(1, first); column <= Math.min(last, MAX_TABLE_COLUMNS); column++) {
            widths[column - 1] = width;
        }
    }
    return widths;
}

/** The column number from its letters ("A" is 0), or undefined past the columns that are shown. */
function columnOf(letters: string): number | undefined {
    let column = 0;
    for (let index = 0; index < letters.length; index++) column = column * 26 + (letters.charCodeAt(index) - 64);
    return column >= 1 && column <= MAX_TABLE_COLUMNS ? column - 1 : undefined;
}

function cellsOf(sheet: string, formats: (CellStyle | undefined)[], look: SheetLook, room: { left: number }): void {
    let at = sheet.indexOf("<sheetData");
    if (at < 0) return;
    for (;;) {
        const start = sheet.indexOf("<c ", at);
        if (start < 0) return;
        const end = sheet.indexOf(">", start);
        if (end < 0) return;
        at = end;
        // A tag longer than any cell's is not read.
        if (end - start > 400) continue;
        const tag = sheet.slice(start + 3, end);
        const format = numberOf(attributeOf(tag, "s"));
        if (format === undefined || !Number.isInteger(format) || format <= 0) continue;
        const style = formats[format];
        if (!style) continue;
        const place = /(?:^|\s)r="([A-Z]{1,3})(\d{1,7})"/.exec(tag);
        if (!place) continue;
        const row = Number(place[2]) - 1;
        const column = columnOf(place[1]);
        if (column === undefined || row < 0 || row >= MAX_TABLE_ROWS) continue;
        if (room.left <= 0) return;
        const key = row * MAX_TABLE_COLUMNS + column;
        if (!look.cells.has(key)) room.left -= 1;
        look.cells.set(key, style);
        if (style.fill) look.lastFilledColumn = Math.max(look.lastFilledColumn, column);
    }
}

async function textOf(entry: JSZip.JSZipObject | null, limit: number): Promise<string | undefined> {
    if (!entry) return undefined;
    const bytes = await entry.async("uint8array");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, limit));
}

/** The path of the file a relationship points at, from the folder the relationships are of. */
function pathOf(target: string): string {
    return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/**
 * The look of every sheet of an Excel file (.xlsx): its columns' widths and the bold, italic, size, text colour and fill
 * of its cells, by the sheet's place in the workbook. Nothing in the file is run or followed, and a colour or a size is
 * only ever a number this makes itself. A file that is not an .xlsx, or whose style list is damaged or too big, gives
 * undefined, and the sheets are drawn plain.
 */
export async function readXlsxLook(bytes: ArrayBuffer): Promise<(SheetLook | undefined)[] | undefined> {
    try {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(bytes);
        const workbook = await textOf(zip.file("xl/workbook.xml"), MAX_SMALL_PART_BYTES);
        const relationships = await textOf(zip.file("xl/_rels/workbook.xml.rels"), MAX_SMALL_PART_BYTES);
        const styles = await textOf(zip.file("xl/styles.xml"), MAX_SMALL_PART_BYTES);
        if (workbook === undefined || relationships === undefined || styles === undefined) return undefined;
        const theme = themeColors(await textOf(zip.file("xl/theme/theme1.xml"), MAX_SMALL_PART_BYTES));
        const formats = cellFormats(styles, theme);

        const targets = new Map<string, string>();
        for (const { attributes } of elementsOf(relationships, "Relationship", false)) {
            const id = attributeOf(attributes, "Id");
            const target = attributeOf(attributes, "Target");
            if (id !== undefined && target !== undefined) targets.set(id, pathOf(target));
        }
        const looks: (SheetLook | undefined)[] = [];
        const room = { left: MAX_STYLED_CELLS };
        for (const { attributes } of elementsOf(workbook, "sheet", false)) {
            const id = attributeOf(attributes, "r:id");
            const path = id === undefined ? undefined : targets.get(id);
            // One sheet at a time, so only one sheet's text is held at once.
            // eslint-disable-next-line no-await-in-loop
            const text = path === undefined ? undefined : await textOf(zip.file(path), MAX_SHEET_SCAN_BYTES);
            if (text === undefined) {
                looks.push(undefined);
                continue;
            }
            const look: SheetLook = { cells: new Map(), columnWidths: widthsOf(text), lastFilledColumn: -1 };
            cellsOf(text, formats, look, room);
            looks.push(look);
        }
        return looks;
    } catch (error) {
        console.warn("Could not read how a spreadsheet looks, showing it plain", error);
        return undefined;
    }
}
