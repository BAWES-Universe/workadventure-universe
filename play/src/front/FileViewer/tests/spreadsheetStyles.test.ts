import * as XLSX from "xlsx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "../spreadsheet";

const NAMESPACE = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

interface Parts {
    /** The inside of `<styleSheet>`: fonts, fills and cellXfs. */
    styles?: string;
    /** The inside of `<worksheet>`. */
    sheet: string;
    theme?: string;
}

/** A small .xlsx written by hand, so a test can put anything in its style list and its sheet. */
async function xlsxBytes({ styles, sheet, theme }: Parts): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            "</Types>"
    );
    zip.file(
        "_rels/.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    );
    zip.file(
        "xl/workbook.xml",
        `<?xml version="1.0"?><workbook ${NAMESPACE} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
            '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    zip.file(
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    );
    if (styles !== undefined)
        zip.file("xl/styles.xml", `<?xml version="1.0"?><styleSheet ${NAMESPACE}>${styles}</styleSheet>`);
    if (theme !== undefined) zip.file("xl/theme/theme1.xml", theme);
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet ${NAMESPACE}>${sheet}</worksheet>`);
    return zip.generateAsync({ type: "arraybuffer" });
}

const text = (reference: string, value: string, style = 0) =>
    `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;

/** Fonts 0 plain (11), 1 bold 28 blue, 2 italic red; fills 0 none, 1 gray125, 2 yellow; formats 0 plain, 1 title, 2 italic on yellow. */
const STYLES =
    "<fonts>" +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="28"/><color rgb="FF3949AB"/><name val="Arial"/></font>' +
    '<font><i/><sz val="11"/><color rgb="FFFF0000"/></font>' +
    "</fonts>" +
    "<fills>" +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF59D"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    "<cellXfs>" +
    '<xf numFmtId="0" fontId="0" fillId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2"/>' +
    "</cellXfs>";

describe("the look of an Excel file", () => {
    it("gives a cell its bold, size, colour, italic and fill, and leaves plain cells plain", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles: STYLES,
                sheet:
                    "<sheetData>" +
                    `<row r="1">${text("A1", "Expense Report", 1)}${text("B1", "plain")}</row>` +
                    `<row r="2">${text("A2", "Total", 2)}</row>` +
                    "</sheetData>",
            })
        );
        expect(sheet.rows[0][0].style).toEqual({ bold: true, fontSize: 30.5, color: "#3949ab" });
        expect(sheet.rows[0][1].style).toBeUndefined();
        expect(sheet.rows[1][0].style).toEqual({ italic: true, color: "#ff0000", fill: "#fff59d" });
        expect(sheet.styled).toBe(true);
    });

    it("draws a file with no styles as a plain grid", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({ styles: "", sheet: `<sheetData><row r="1">${text("A1", "x")}</row></sheetData>` })
        );
        expect(sheet.rows[0][0].text).toBe("x");
        expect(sheet.styled).toBe(false);
    });

    it("gives a fill to an empty cell too", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles: STYLES,
                sheet:
                    '<dimension ref="A1:B2"/><sheetData>' +
                    `<row r="1">${text(
                        "A1",
                        "x"
                    )}</row><row r="2"><c r="A2" s="2"/><c r="B2" s="2"/></row></sheetData>`,
            })
        );
        expect(sheet.rows[1][0].style?.fill).toBe("#fff59d");
        expect(sheet.rows[1][1].style?.fill).toBe("#fff59d");
    });

    it("works out a theme colour with its tint like Excel does", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles:
                    '<fonts><font><sz val="11"/></font><font><color theme="4"/></font></fonts>' +
                    '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.59999389629810485"/></patternFill></fill></fills>' +
                    '<cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="1"/></cellXfs>',
                sheet: `<sheetData><row r="1">${text("A1", "x", 1)}</row></sheetData>`,
            })
        );
        // Accent 1 of Excel's own theme is #4472c4, and its "Lighter 60%" is #b4c6e7.
        expect(sheet.rows[0][0].style?.color).toBe("#4472c4");
        const fill = sheet.rows[0][0].style?.fill ?? "";
        expect(fill).toMatch(/^#[0-9a-f]{6}$/);
        const [r, g, b] = [1, 3, 5].map((at) => parseInt(fill.slice(at, at + 2), 16));
        expect(Math.abs(r - 0xb4)).toBeLessThanOrEqual(2);
        expect(Math.abs(g - 0xc6)).toBeLessThanOrEqual(2);
        expect(Math.abs(b - 0xe7)).toBeLessThanOrEqual(2);
    });

    it("takes a theme colour from the file's own theme", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles:
                    '<fonts><font><sz val="11"/></font><font><color theme="5"/></font></fonts>' +
                    '<fills><fill><patternFill patternType="none"/></fill></fills><cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="0"/></cellXfs>',
                theme:
                    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="x">' +
                    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
                    '<a:dk2><a:srgbClr val="111111"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>' +
                    '<a:accent1><a:srgbClr val="AA0000"/></a:accent1><a:accent2><a:srgbClr val="00AA00"/></a:accent2>' +
                    "</a:clrScheme></a:themeElements></a:theme>",
                sheet: `<sheetData><row r="1">${text("A1", "x", 1)}</row></sheetData>`,
            })
        );
        expect(sheet.rows[0][0].style?.color).toBe("#00aa00");
    });

    it("keeps a text size between 8 and 48 pixels", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles:
                    '<fonts><font><sz val="11"/></font><font><sz val="400"/></font><font><sz val="1"/></font></fonts>' +
                    '<fills><fill><patternFill patternType="none"/></fill></fills>' +
                    '<cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="0"/><xf fontId="2" fillId="0"/></cellXfs>',
                sheet: `<sheetData><row r="1">${text("A1", "big", 1)}${text("B1", "small", 2)}</row></sheetData>`,
            })
        );
        expect(sheet.rows[0][0].style?.fontSize).toBe(48);
        expect(sheet.rows[0][1].style?.fontSize).toBe(8);
    });

    it("never takes a colour that is not six hex digits", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles:
                    '<fonts><font><sz val="11"/></font><font><color rgb="red;background:url(x)"/></font><font><color rgb="FF00GG00"/></font></fonts>' +
                    '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="expression(alert(1))"/></patternFill></fill></fills>' +
                    '<cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="1"/><xf fontId="2" fillId="0"/></cellXfs>',
                sheet: `<sheetData><row r="1">${text("A1", "x", 1)}${text("B1", "y", 2)}</row></sheetData>`,
            })
        );
        expect(sheet.rows[0][0].style).toBeUndefined();
        expect(sheet.rows[0][1].style).toBeUndefined();
        expect(sheet.styled).toBe(false);
    });

    it("gives the width the file gives a column, scaled to the viewer", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles: STYLES,
                sheet:
                    '<cols><col min="2" max="3" width="20" customWidth="1"/><col min="5" max="5" width="9" hidden="1"/></cols>' +
                    `<sheetData><row r="1">${text("A1", "a", 1)}${text("B1", "b")}${text("C1", "c")}${text(
                        "D1",
                        "d"
                    )}${text("E1", "e")}</row></sheetData>`,
            })
        );
        // 20 characters: 145 pixels in Excel, drawn at 12/14.67 of that.
        expect(sheet.columnWidths[1]).toBe(119);
        expect(sheet.columnWidths[2]).toBe(119);
        expect(sheet.columnWidths[0]).toBeUndefined();
        expect(sheet.columnWidths[4]).toBeUndefined();
    });

    it("draws a sheet plain, with its values, when the style list is damaged or missing", async () => {
        const sheetData = `<sheetData><row r="1">${text("A1", "kept", 1)}</row></sheetData>`;
        for (const styles of ["<fonts><font><b/>", "<cellXfs><xf fontId="]) {
            // eslint-disable-next-line no-await-in-loop
            const [sheet] = await readSpreadsheet(await xlsxBytes({ styles, sheet: sheetData }));
            expect(sheet.rows[0][0].text).toBe("kept");
            expect(sheet.rows[0][0].style).toBeUndefined();
        }
    });

    it("reads a style list with a hundred thousand fonts that never close without taking long", async () => {
        const started = Date.now();
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles: `<fonts>${"<font><b/>".repeat(100_000)}</fonts>`,
                sheet: `<sheetData><row r="1">${text("A1", "kept", 1)}</row></sheetData>`,
            })
        );
        expect(sheet.rows[0][0].text).toBe("kept");
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it("keeps the last row and column that are shown, and ignores cells past them", async () => {
        const [sheet] = await readSpreadsheet(
            await xlsxBytes({
                styles: STYLES,
                sheet:
                    `<sheetData><row r="1">${text("CV1", "last", 1)}${text("CW1", "past", 1)}</row>` +
                    `<row r="1000">${text("A1000", "last row", 1)}</row><row r="1001">${text(
                        "A1001",
                        "past",
                        1
                    )}</row></sheetData>`,
            })
        );
        expect(sheet.rows).toHaveLength(1000);
        expect(sheet.rows[0][99].style?.bold).toBe(true);
        expect(sheet.rows[999][0].style?.bold).toBe(true);
        expect(sheet.columnCount).toBe(100);
    });
});

describe("merged cells", () => {
    function merged(ranges: string[], rows: unknown[][]): ArrayBuffer {
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet["!merges"] = ranges.map((range) => XLSX.utils.decode_range(range));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Merged");
        return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    }

    it("spans the top left cell and leaves out the cells under it", async () => {
        const [sheet] = await readSpreadsheet(
            merged(
                ["A1:C2"],
                [
                    ["Title", "hidden", "hidden"],
                    ["hidden", "hidden", "hidden"],
                    ["a", "b", "c"],
                ]
            )
        );
        expect(sheet.rows[0][0]).toMatchObject({ text: "Title", colSpan: 3, rowSpan: 2 });
        expect(sheet.rows[0][1].covered).toBe(true);
        expect(sheet.rows[1][2].covered).toBe(true);
        expect(sheet.rows[2][0].covered).toBeUndefined();
    });

    it("keeps a range that runs past the columns shown within them", async () => {
        const [sheet] = await readSpreadsheet(merged(["A1:XFD1"], [["wide", 2, 3]]));
        expect(sheet.rows[0][0].colSpan).toBe(3);
    });

    it("leaves a range that overlaps another merged range as it is", async () => {
        const [sheet] = await readSpreadsheet(merged(["A1:B1", "B1:C1"], [["one", "two", "three"]]));
        expect(sheet.rows[0][0].colSpan).toBe(2);
        expect(sheet.rows[0][2]).toMatchObject({ text: "three" });
        expect(sheet.rows[0][2].covered).toBeUndefined();
    });

    it("works in an .xls too, which has no styles to read", async () => {
        const worksheet = XLSX.utils.aoa_to_sheet([
            ["Title", "x"],
            ["a", "b"],
        ]);
        worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Old");
        const [sheet] = await readSpreadsheet(XLSX.write(workbook, { type: "array", bookType: "xls" }) as ArrayBuffer);
        expect(sheet.rows[0][0]).toMatchObject({ text: "Title", colSpan: 2 });
        expect(sheet.styled).toBe(false);
    });
});
