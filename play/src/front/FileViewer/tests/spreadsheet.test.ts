import * as XLSX from "xlsx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bytesMatchKind, badgeOfKind, fileKindOf } from "../fileKinds";
import { columnLetters, readSpreadsheet } from "../spreadsheet";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "../textFiles";

function workbookBytes(
    sheets: Record<string, unknown[][]>,
    bookType: XLSX.BookType = "xlsx",
    hidden: string[] = []
): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    }
    if (hidden.length > 0) {
        workbook.Workbook = {
            Sheets: workbook.SheetNames.map((name) => ({ name, Hidden: hidden.includes(name) ? 1 : 0 })),
        };
    }
    const written = XLSX.write(workbook, { type: "array", bookType }) as ArrayBuffer;
    return written;
}

describe("the spreadsheet reader", () => {
    it("names the columns like Excel does", () => {
        expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetters)).toEqual([
            "A",
            "B",
            "Z",
            "AA",
            "AB",
            "AZ",
            "BA",
            "ZZ",
            "AAA",
        ]);
    });

    it("reads every sheet with its values as text, numbers marked for the right edge", async () => {
        const sheets = await readSpreadsheet(
            workbookBytes({
                Growth: [
                    ["Month", "Visitors"],
                    ["Jan", 1240],
                ],
                Rooms: [["Name"], ["Lobby"]],
            })
        );
        expect(sheets.map((sheet) => sheet.name)).toEqual(["Growth", "Rooms"]);
        expect(sheets[0].rows[0].map((cell) => cell.text)).toEqual(["Month", "Visitors"]);
        expect(sheets[0].rows[1][1]).toEqual({ text: "1240", number: true });
        expect(sheets[0].rows[1][0].number).toBe(false);
        expect(sheets[0].totalRows).toBe(2);
        expect(sheets[0].rowsCut).toBe(false);
    });

    it("keeps a cell with markup as text", async () => {
        const [sheet] = await readSpreadsheet(
            workbookBytes({ A: [['<img src=x onerror="alert(1)"><script>x</script>']] })
        );
        expect(sheet.rows[0][0].text).toBe('<img src=x onerror="alert(1)"><script>x</script>');
    });

    it("shows the first 1,000 rows and says how many there are", async () => {
        const rows = Array.from({ length: 2500 }, (_, index) => [index + 1]);
        const [sheet] = await readSpreadsheet(workbookBytes({ Big: rows }));
        expect(sheet.rows).toHaveLength(1000);
        expect(sheet.rows[999][0].text).toBe("1000");
        expect(sheet.rowsCut).toBe(true);
        expect(sheet.totalRows).toBe(2500);
    });

    it("shows the first 100 columns", async () => {
        const [sheet] = await readSpreadsheet(
            workbookBytes({ Wide: [Array.from({ length: 150 }, (_, index) => index)] })
        );
        expect(sheet.columnCount).toBe(100);
        expect(sheet.rows[0]).toHaveLength(100);
        expect(sheet.columnsCut).toBe(true);
        expect(sheet.rowsCut).toBe(false);
    });

    it("starts at A1 even when the data starts further down", async () => {
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([]);
        XLSX.utils.sheet_add_aoa(sheet, [["x"]], { origin: "B3" });
        XLSX.utils.book_append_sheet(workbook, sheet, "Offset");
        const [read] = await readSpreadsheet(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
        expect(read.rows).toHaveLength(3);
        expect(read.rows[2][1].text).toBe("x");
        expect(read.rows[0][0].text).toBe("");
    });

    it("trusts the cells over a size tag that is wrong", async () => {
        const zip = await JSZip.loadAsync(
            workbookBytes({
                S: [
                    ["a", "b"],
                    ["c", "d"],
                    ["e", "f"],
                ],
            })
        );
        const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
        expect(sheetXml).toContain("<dimension");
        zip.file("xl/worksheets/sheet1.xml", (sheetXml ?? "").replace(/<dimension[^>]*\/>/, '<dimension ref="A1"/>'));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows.map((row) => row.map((cell) => cell.text))).toEqual([
            ["a", "b"],
            ["c", "d"],
            ["e", "f"],
        ]);
        expect(sheet.rowsCut).toBe(false);
    });

    it("counts the rows the cells fill, not the size a file claims for a short sheet", async () => {
        const zip = await JSZip.loadAsync(
            workbookBytes({
                S: [
                    ["a", "b"],
                    ["c", "d"],
                ],
            })
        );
        const sheetXml = (await zip.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
        zip.file(
            "xl/worksheets/sheet1.xml",
            sheetXml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:XFD1048576"/>')
        );
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows).toHaveLength(2);
        expect(sheet.columnCount).toBe(2);
        expect(sheet.totalRows).toBe(2);
        expect(sheet.rowsCut).toBe(false);
        expect(sheet.columnsCut).toBe(false);
    });

    it("shows only the columns that hold cells, however wide the file says the sheet is", async () => {
        const zip = await JSZip.loadAsync(workbookBytes({ S: [["a", "b", "c"]] }));
        const sheetXml = (await zip.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:XFD500"/>'));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.columnCount).toBe(3);
        expect(sheet.columnsCut).toBe(false);
        expect(sheet.rows[0].map((cell) => cell.text)).toEqual(["a", "b", "c"]);
    });

    it.each(["xlsx", "biff8", "ods"] as const)(
        "counts a sheet of exactly one row more than is shown, in %s",
        async (bookType) => {
            const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, (_, index) => [index, "x"]);
            const [sheet] = await readSpreadsheet(workbookBytes({ S: rows }, bookType));
            expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
            expect(sheet.rowsCut).toBe(true);
            expect(sheet.totalRows).toBe(MAX_TABLE_ROWS + 1);
        }
    );

    it.each(["xlsx", "biff8", "ods"] as const)(
        "counts a long sheet from the size the file claims, in %s",
        async (bookType) => {
            const rows = Array.from({ length: 5240 }, (_, index) => [index, "x"]);
            const [sheet] = await readSpreadsheet(workbookBytes({ S: rows }, bookType));
            expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
            expect(sheet.totalRows).toBe(5240);
        }
    );

    it("does not call a long sheet short when the file claims no size", async () => {
        const rows = Array.from({ length: 5240 }, (_, index) => [index, "x"]);
        const zip = await JSZip.loadAsync(workbookBytes({ S: rows }));
        const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
        expect(sheetXml).toMatch(/<dimension [^>]*\/>/);
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension [^>]*\/>/, ""));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
        expect(sheet.rowsCut).toBe(true);
        expect(sheet.totalRows).toBeUndefined();
    });

    it("still counts a sheet of exactly one row more than shown when the file claims no size", async () => {
        const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, (_, index) => [index, "x"]);
        const zip = await JSZip.loadAsync(workbookBytes({ S: rows }));
        const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension [^>]*\/>/, ""));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rowsCut).toBe(true);
        expect(sheet.totalRows).toBe(MAX_TABLE_ROWS + 1);
    });

    it("says only that the first rows are shown, when a sheet that fills every row read cannot be counted", async () => {
        // A file that gives no size and has exactly as many rows as are read looks the same as one that goes on.
        const rows = Array.from({ length: MAX_TABLE_ROWS + 2 }, (_, index) => [index, "x"]);
        const zip = await JSZip.loadAsync(workbookBytes({ S: rows }));
        const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension [^>]*\/>/, ""));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
        expect(sheet.rowsCut).toBe(true);
        expect(sheet.totalRows).toBeUndefined();
    });

    it("ignores the row that is read but not shown when it comes to the width of the sheet", async () => {
        const rows: string[][] = Array.from({ length: MAX_TABLE_ROWS }, () => ["a", "b"]);
        rows.push(Array.from({ length: MAX_TABLE_COLUMNS + 20 }, () => "wide"));
        const [sheet] = await readSpreadsheet(workbookBytes({ S: rows }));
        expect(sheet.columnCount).toBe(2);
        expect(sheet.columnsCut).toBe(false);
    });

    it("leaves out a sheet the file lists but holds no data for, and still shows the others", async () => {
        const zip = await JSZip.loadAsync(workbookBytes({ One: [[1]], Gone: [[2]] }));
        zip.remove("xl/worksheets/sheet2.xml");
        const sheets = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["One"]);
    });

    it("draws a sheet with no cells as an empty A1, like Excel", async () => {
        const [sheet] = await readSpreadsheet(workbookBytes({ Blank: [] }));
        expect(sheet.columnCount).toBe(1);
        expect(sheet.rows).toEqual([[{ text: "", number: false }]]);
        expect(sheet.rowsCut).toBe(false);
    });

    it("leaves a chart sheet out, and still shows the sheets with cells", async () => {
        const zip = await JSZip.loadAsync(workbookBytes({ Data: [[1]] }));
        zip.file(
            "xl/workbook.xml",
            (await zip.file("xl/workbook.xml")!.async("string")).replace(
                "</sheets>",
                '<sheet name="Chart" sheetId="9" r:id="rIdChart"/></sheets>'
            )
        );
        zip.file(
            "xl/_rels/workbook.xml.rels",
            (await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(
                "</Relationships>",
                '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>'
            )
        );
        zip.file(
            "xl/chartsheets/sheet1.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>'
        );
        const sheets = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["Data"]);
    });

    it("leaves hidden sheets out, as Excel does", async () => {
        const sheets = await readSpreadsheet(workbookBytes({ One: [[1]], Secret: [[2]] }, "xlsx", ["Secret"]));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["One"]);
    });

    it.each(["biff8", "ods"] as const)("reads the %s format", async (bookType) => {
        const [sheet] = await readSpreadsheet(workbookBytes({ S: [["a", 2]] }, bookType));
        expect(sheet.rows[0].map((cell) => cell.text)).toEqual(["a", "2"]);
    });

    describe("an OpenDocument sheet that repeats a cell", () => {
        async function odsWithRepeat(columns: number, rows: number): Promise<ArrayBuffer> {
            const zip = await JSZip.loadAsync(workbookBytes({ S: [[1]] }, "ods"));
            const xml = await zip.file("content.xml")!.async("string");
            const cell = `<table:table-cell table:number-columns-repeated="${columns}" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell>`;
            const row = `<table:table-row table:number-rows-repeated="${rows}">${cell}</table:table-row>`;
            zip.file("content.xml", xml.replace(/<table:table-row[\s\S]*<\/table:table-row>/, row));
            return zip.generateAsync({ type: "arraybuffer" });
        }

        it("opens at once when the repeat is a hundred thousand cells wide, and shows the first 100 columns", async () => {
            const started = Date.now();
            const [sheet] = await readSpreadsheet(await odsWithRepeat(100_000, 100));
            expect(Date.now() - started).toBeLessThan(5000);
            expect(sheet.columnCount).toBe(MAX_TABLE_COLUMNS);
            expect(sheet.columnsCut).toBe(true);
            expect(sheet.rows[0].every((cell) => cell.text === "7")).toBe(true);
        });

        it("keeps a repeat that fits in the columns shown", async () => {
            const [sheet] = await readSpreadsheet(await odsWithRepeat(5, 2));
            expect(sheet.columnCount).toBe(5);
            expect(sheet.columnsCut).toBe(false);
            expect(sheet.rows).toHaveLength(2);
        });
    });

    it("refuses a zip that would unpack to far more than any sheet", async () => {
        const bytes = workbookBytes({ A: [[1]] });
        const view = new DataView(bytes);
        for (let at = 0; at < bytes.byteLength - 46; at++) {
            if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 900 * 1024 * 1024, true);
        }
        await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
    });

    it("refuses a zip that would unpack to more than 150 MB, which a very wide sheet can fill with cells", async () => {
        const bytes = workbookBytes({ A: [[1]] });
        const view = new DataView(bytes);
        for (let at = 0; at < bytes.byteLength - 46; at++) {
            if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 200 * 1024 * 1024, true);
        }
        await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
    });

    it("refuses a file that is not a spreadsheet", async () => {
        await expect(readSpreadsheet(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow();
    });
});

describe("spreadsheet files", () => {
    it("are Excel for .xlsx, .xls and .ods, with a badge that matches", () => {
        for (const name of ["a.xlsx", "a.xls", "a.ods"]) expect(fileKindOf(name)).toBe("excel");
        expect(badgeOfKind("excel", "a.xlsx")).toMatchObject({ label: "XLSX", kindName: "Excel" });
        expect(badgeOfKind("excel", "a.xls").label).toBe("XLS");
        expect(badgeOfKind("excel", "a.ods").label).toBe("ODS");
    });

    it("must start like the type they say they are", () => {
        const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]);
        const office = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        const html = new TextEncoder().encode("<html>");
        expect(bytesMatchKind("excel", "a.xlsx", zip)).toBe(true);
        expect(bytesMatchKind("excel", "a.ods", zip)).toBe(true);
        expect(bytesMatchKind("excel", "a.xls", office)).toBe(true);
        expect(bytesMatchKind("excel", "a.xls", zip)).toBe(false);
        // A password-locked .xlsx is an old Office container: it opens as "Can't preview".
        expect(bytesMatchKind("excel", "a.xlsx", office)).toBe(false);
        expect(bytesMatchKind("excel", "a.xlsx", html)).toBe(false);
    });
});
