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

    it("shows every row the cells fill when the size tag claims fewer rows", async () => {
        const rows = [
            ["a", "b"],
            ["c", "d"],
            ["e", "f"],
            ["g", "h"],
        ];
        const zip = await JSZip.loadAsync(workbookBytes({ S: rows }));
        const sheetXml = (await zip.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:B2"/>'));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows.map((row) => row.map((cell) => cell.text))).toEqual(rows);
        expect(sheet.totalRows).toBe(4);
        expect(sheet.rowsCut).toBe(false);
    });

    it("says a long sheet is cut when the size tag claims a short one", async () => {
        const rows = Array.from({ length: MAX_TABLE_ROWS + 500 }, (_, index) => [`row ${index}`]);
        const zip = await JSZip.loadAsync(workbookBytes({ S: rows }));
        const sheetXml = (await zip.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
        zip.file("xl/worksheets/sheet1.xml", sheetXml.replace(/<dimension[^>]*\/>/, '<dimension ref="A1:A2"/>'));
        const [sheet] = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
        expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
        expect(sheet.rowsCut).toBe(true);
        expect(sheet.totalRows).toBeUndefined();
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

    /** Adds a visible chart sheet, which holds no cells, to a workbook. */
    async function withChartSheet(bytes: ArrayBuffer): Promise<ArrayBuffer> {
        const zip = await JSZip.loadAsync(bytes);
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
        return zip.generateAsync({ type: "arraybuffer" });
    }

    it("leaves a chart sheet out, and still shows the sheets with cells", async () => {
        const sheets = await readSpreadsheet(await withChartSheet(workbookBytes({ Data: [[1]] })));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["Data"]);
    });

    it("shows the data sheets when every one of them is hidden and a visible chart sheet is the only other", async () => {
        const sheets = await readSpreadsheet(await withChartSheet(workbookBytes({ Data: [[1]] }, "xlsx", ["Data"])));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["Data"]);
    });

    describe("a cell with a very long text", () => {
        it("is drawn up to 1,024 characters, then an ellipsis, like Excel", async () => {
            const [sheet] = await readSpreadsheet(workbookBytes({ S: [["x".repeat(5000), "short"]] }));
            expect(sheet.rows[0][0].text).toBe(`${"x".repeat(1024)}…`);
            expect(sheet.rows[0][1].text).toBe("short");
            expect(sheet.textCut).toBe(true);
        });

        it("is cut between characters, never in the middle of an emoji", async () => {
            // 1,023 letters then an emoji of two code units: the cut at 1,024 would split it.
            const [sheet] = await readSpreadsheet(workbookBytes({ S: [[`${"x".repeat(1023)}😀tail`]] }));
            expect(sheet.rows[0][0].text).toBe(`${"x".repeat(1023)}…`);
        });

        it("is not reported as cut when every cell is drawn in full", async () => {
            const [sheet] = await readSpreadsheet(workbookBytes({ S: [["x".repeat(1024), "short"]] }));
            expect(sheet.textCut).toBe(false);
        });

        it("shares a budget of text across the sheet, so many cells that point at one long text stay small", async () => {
            const long = "y".repeat(1100);
            const rows = Array.from({ length: 120 }, () => Array.from({ length: 100 }, () => long));
            const [sheet] = await readSpreadsheet(workbookBytes({ S: rows }));
            const drawn = sheet.rows.flat().reduce((total, cell) => total + cell.text.length, 0);
            expect(drawn).toBeLessThanOrEqual(2_000_000 + 12_000);
            expect(sheet.rows.flat()).toHaveLength(12_000);
            expect(drawn).toBeGreaterThan(1_000_000);
            expect(sheet.textCut).toBe(true);
        });
    });

    it("leaves hidden sheets out, as Excel does", async () => {
        const sheets = await readSpreadsheet(workbookBytes({ One: [[1]], Secret: [[2]] }, "xlsx", ["Secret"]));
        expect(sheets.map((sheet) => sheet.name)).toEqual(["One"]);
    });

    it.each(["biff8", "ods"] as const)("reads the %s format", async (bookType) => {
        const [sheet] = await readSpreadsheet(workbookBytes({ S: [["a", 2]] }, bookType));
        expect(sheet.rows[0].map((cell) => cell.text)).toEqual(["a", "2"]);
    });

    describe("a workbook of many sheets", () => {
        function sparseSheet(): XLSX.WorkSheet {
            // A cell in A1 and one far down and to the right: the grid drawn for it is 1000 rows of 100 columns.
            return {
                A1: { t: "s", v: "x" },
                CV1000: { t: "s", v: "y" },
                "!ref": "A1:CV1000",
            };
        }
        function workbookOf(sheets: XLSX.WorkSheet[]): ArrayBuffer {
            const workbook = XLSX.utils.book_new();
            sheets.forEach((sheet, index) => XLSX.utils.book_append_sheet(workbook, sheet, `S${index}`));
            return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
        }

        it("opens a few sparse sheets", async () => {
            const sheets = await readSpreadsheet(workbookOf(Array.from({ length: 10 }, sparseSheet)));
            expect(sheets).toHaveLength(10);
            expect(sheets[9].rows[999][99].text).toBe("y");
        });

        it("refuses sparse sheets whose grids add up to far more than a sheet can draw", async () => {
            const bytes = workbookOf(Array.from({ length: 30 }, sparseSheet));
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("shares the text drawn between the sheets, and says so on the sheet that is cut", async () => {
            const longRows = (): XLSX.WorkSheet =>
                XLSX.utils.aoa_to_sheet(
                    Array.from({ length: 1000 }, (_, row) =>
                        row === 999 ? ["42", "43", "44"] : [1, 2, 3].map(() => "x".repeat(1000))
                    )
                );
            const sheets = await readSpreadsheet(workbookOf(Array.from({ length: 7 }, longRows)));
            const drawn = sheets.reduce(
                (sum, sheet) => sum + sheet.rows.flat().reduce((n, c) => n + c.text.length, 0),
                0
            );
            expect(drawn).toBeLessThan(10_100_000);
            expect(sheets[0].textCut).toBe(true);
            expect(sheets[6].textCut).toBe(true);
            // Short values stay readable once the budget is spent; long text is the part that is cut.
            expect(sheets[6].rows[999].map((cell) => cell.text)).toEqual(["42", "43", "44"]);
            expect(sheets[6].rows[0][0].text).toBe("…");
        });
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

        it("opens at once when a wide row is repeated a million times, and shows the first 1,000 rows", async () => {
            const started = Date.now();
            const [sheet] = await readSpreadsheet(await odsWithRepeat(50, 1_000_000));
            expect(Date.now() - started).toBeLessThan(5000);
            expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
            expect(sheet.rowsCut).toBe(true);
            expect(sheet.columnCount).toBe(50);
        });

        async function odsWithRows(rows: string): Promise<ArrayBuffer> {
            const zip = await JSZip.loadAsync(workbookBytes({ S: [[1]] }, "ods"));
            const xml = await zip.file("content.xml")!.async("string");
            zip.file("content.xml", xml.replace(/<table:table-row[\s\S]*<\/table:table-row>/, rows));
            return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
        }
        const valueCell = (repeated: number) =>
            `<table:table-cell table:number-columns-repeated="${repeated}" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell>`;

        it("refuses a file whose repeated cells add up to millions, before the reader builds them", async () => {
            // 40,000 cells of 101 repeats in one row: four million cells from 5 MB of text.
            const bytes = await odsWithRows(`<table:table-row>${valueCell(101).repeat(40_000)}</table:table-row>`);
            const started = Date.now();
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
            expect(Date.now() - started).toBeLessThan(5000);
        });

        it("counts a repeated row too: a row of 150,000 cells repeated a thousand times is refused", async () => {
            const bytes = await odsWithRows(
                `<table:table-row table:number-rows-repeated="1000">${valueCell(101).repeat(1500)}</table:table-row>`
            );
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("reads a wide sheet of a few hundred thousand repeated cells", async () => {
            const bytes = await odsWithRows(`<table:table-row>${valueCell(101).repeat(2000)}</table:table-row>`);
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.columnCount).toBe(MAX_TABLE_COLUMNS);
            expect(sheet.rows[0].every((cell) => cell.text === "7")).toBe(true);
        });

        it("does not count empty repeated cells, such as the blank tail LibreOffice writes on every row", async () => {
            const tail = `<table:table-cell table:number-columns-repeated="1024"/>`;
            const row = `<table:table-row table:number-rows-repeated="1000">${tail.repeat(5000)}${valueCell(
                1
            )}</table:table-row>`;
            const [sheet] = await readSpreadsheet(await odsWithRows(row));
            expect(sheet.rowsCut).toBe(false);
        });

        it.each(["+1000000", "1000000x", " 1000000", "1000000.5", "01000000", "1000000'"])(
            "cuts a repeat the file writes as %j, the way the reader would read it",
            async (written) => {
                const started = Date.now();
                const [sheet] = await readSpreadsheet(
                    await odsWithRows(
                        `<table:table-row><table:table-cell table:number-columns-repeated="${written}" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row>`
                    )
                );
                expect(Date.now() - started).toBeLessThan(5000);
                expect(sheet.columnCount).toBe(MAX_TABLE_COLUMNS);
            }
        );

        it("cuts a row repeat the reader reads as a number, such as 1e6", async () => {
            const row = `<table:table-row table:number-rows-repeated="1e6">${valueCell(50)}</table:table-row>`;
            const started = Date.now();
            const [sheet] = await readSpreadsheet(await odsWithRows(row));
            expect(Date.now() - started).toBeLessThan(5000);
            expect(sheet.rows).toHaveLength(MAX_TABLE_ROWS);
        });

        it("counts repeats whatever prefix the file gives the tags", async () => {
            const cell = `<x:table-cell x:number-columns-repeated="101" o:value-type="float" o:value="7"><p:p>7</p:p></x:table-cell>`;
            const bytes = await odsWithRows(`<x:table-row>${cell.repeat(40_000)}</x:table-row>`);
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("does not add empty rows at the end of a sheet to its length when they are cut", async () => {
            const data = Array.from({ length: 1001 }, () => `<table:table-row>${valueCell(1)}</table:table-row>`).join(
                ""
            );
            const tail = `<table:table-row table:number-rows-repeated="5000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>`;
            const [sheet] = await readSpreadsheet(await odsWithRows(data + tail));
            expect(sheet.rowsCut).toBe(true);
            expect(sheet.totalRows).toBe(1001);
        });

        it("still says how many rows the sheet has when a repeated row is cut", async () => {
            const [sheet] = await readSpreadsheet(await odsWithRepeat(3, 5000));
            expect(sheet.rowsCut).toBe(true);
            expect(sheet.totalRows).toBe(5000);
        });

        it("adds up every repeated row that is cut, empty ones before the last row with a value too", async () => {
            const bytes = await odsWithRows(
                `<table:table-row table:number-rows-repeated="5000"><table:table-cell/></table:table-row>` +
                    `<table:table-row table:number-rows-repeated="3000">${valueCell(1)}</table:table-row>` +
                    `<table:table-row table:number-rows-repeated="4000">${valueCell(1)}</table:table-row>`
            );
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.rowsCut).toBe(true);
            expect(sheet.totalRows).toBe(12000);
        });

        it("cuts a run of billions of spaces in a cell's text, which the reader would build one by one", async () => {
            const bytes = await odsWithRows(
                `<table:table-row><table:table-cell office:value-type="string"><text:p>a<text:s text:c="2000000000"/>b</text:p></table:table-cell></table:table-row>`
            );
            const started = Date.now();
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.rows[0][0].text).toBe(`a${" ".repeat(32)}b`);
            expect(Date.now() - started).toBeLessThan(5000);
        });

        it.each([
            `<text:s text:c='2000000000'/>`,
            `<text:s text:c="2000000000" />`,
            `<text:s text:c="2000000000"></text:s>`,
            `<x:s text:c="2000000000"/>`,
            `<text:s text:style-name="a" text:c="2000000000"/>`,
        ])("does not build spaces for a run written as %s, which the reader does not expand", async (run) => {
            const bytes = await odsWithRows(
                `<table:table-row><table:table-cell office:value-type="string"><text:p>a${run}b</text:p></table:table-cell></table:table-row>`
            );
            const started = Date.now();
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.rows[0][0].text.length).toBeLessThan(40);
            expect(Date.now() - started).toBeLessThan(5000);
        });

        it.each([
            `<text:s  text:c="2000000000"/>`,
            `<text:s\ttext:c="2000000000"/>`,
            `<text:s\n text:c="2000000000"/>`,
        ])("cuts a run of billions of spaces written as %j, which the reader reads the same way", async (run) => {
            const bytes = await odsWithRows(
                `<table:table-row><table:table-cell office:value-type="string"><text:p>a${run}b</text:p></table:table-cell></table:table-row>`
            );
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.rows[0][0].text).toBe(`a${" ".repeat(32)}b`);
        });

        it("reads covered cells (the rest of a merged cell) without building them, however often they repeat", async () => {
            const covered = `<table:covered-table-cell table:number-columns-repeated="2000000000"/>`;
            const bytes = await odsWithRows(
                `<table:table-row table:number-rows-repeated="1000"><table:table-cell office:value-type="string"><text:p>a</text:p></table:table-cell>${covered.repeat(
                    20_000
                )}</table:table-row>`
            );
            const started = Date.now();
            const [sheet] = await readSpreadsheet(bytes);
            expect(sheet.rows[0][0].text).toBe("a");
            expect(Date.now() - started).toBeLessThan(5000);
        });

        it("keeps the cell limit after rows written as one tag, which the reader does not move on past", async () => {
            const bytes = await odsWithRows(
                `<table:table-row table:number-rows-repeated="5000"/>` +
                    `<table:table-row>${valueCell(101).repeat(40_000)}</table:table-row>`
            );
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("keeps the cell limit when a sheet's name holds a '>'", async () => {
            const zip = await JSZip.loadAsync(
                await odsWithRows(`<table:table-row>${valueCell(101).repeat(40_000)}</table:table-row>`)
            );
            const xml = await zip.file("content.xml")!.async("string");
            zip.file("content.xml", xml.replace(/table:name="S"/, 'table:name="a>b"'));
            const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("does not let a comment stand in for a sheet", async () => {
            const bytes = await odsWithRows(
                `<!-- <table:table> --><table:table-row>${valueCell(101).repeat(40_000)}</table:table-row>`
            );
            await expect(readSpreadsheet(bytes)).rejects.toThrow("too big");
        });

        it("keeps a repeat that fits in the columns shown", async () => {
            const [sheet] = await readSpreadsheet(await odsWithRepeat(5, 2));
            expect(sheet.columnCount).toBe(5);
            expect(sheet.columnsCut).toBe(false);
            expect(sheet.rows).toHaveLength(2);
        });
    });

    describe("an OpenDocument sheet that is hidden", () => {
        /** The way LibreOffice hides a sheet: the sheet names a table style whose properties say "display false". */
        async function odsWithHidden(hiddenName: string, sheetNames: string[]): Promise<ArrayBuffer> {
            const sheets = Object.fromEntries(sheetNames.map((name) => [name, [[name]]]));
            const zip = await JSZip.loadAsync(workbookBytes(sheets, "ods"));
            let xml = await zip.file("content.xml")!.async("string");
            const shown = /<style:style style:name="ta1"[\s\S]*?<\/style:style>/.exec(xml)![0];
            const secret = shown.replace('"ta1"', '"ta9"').replace(/table:display="true"/, 'table:display="false"');
            xml = xml.replace(shown, shown + secret);
            const escaped = hiddenName.replace(/&/g, "&amp;");
            xml = xml.replace(
                `table:name="${escaped}" table:style-name="ta1"`,
                `table:name="${escaped}" table:style-name="ta9"`
            );
            zip.file("content.xml", xml);
            return zip.generateAsync({ type: "arraybuffer" });
        }

        it("is left out of the tabs, like a hidden Excel sheet", async () => {
            const sheets = await readSpreadsheet(await odsWithHidden("Secret", ["Shown", "Secret"]));
            expect(sheets.map((sheet) => sheet.name)).toEqual(["Shown"]);
        });

        it("is found without slowing down on a file with a million unclosed style tags", async () => {
            const zip = await JSZip.loadAsync(await odsWithHidden("Secret", ["Shown", "Secret"]));
            const xml = await zip.file("content.xml")!.async("string");
            zip.file(
                "content.xml",
                xml.replace(
                    "<office:automatic-styles>",
                    `<office:automatic-styles>${"<style:style ".repeat(1_000_000)}`
                )
            );
            const started = Date.now();
            const sheets = await readSpreadsheet(await zip.generateAsync({ type: "arraybuffer" }));
            expect(Date.now() - started).toBeLessThan(5000);
            expect(sheets.length).toBeGreaterThan(0);
        });

        it("is found by its name when the name has an ampersand", async () => {
            const sheets = await readSpreadsheet(await odsWithHidden("Q&A", ["Shown", "Q&A"]));
            expect(sheets.map((sheet) => sheet.name)).toEqual(["Shown"]);
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

    it("refuses a zip that would unpack to more than 50 MB, which a very wide sheet can fill with cells", async () => {
        const bytes = workbookBytes({ A: [[1]] });
        const view = new DataView(bytes);
        for (let at = 0; at < bytes.byteLength - 46; at++) {
            if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 60 * 1024 * 1024, true);
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
