import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { fileNameOf, hasTable, markdownFile, markdownTables, sheetNamesOf, spreadsheetFile } from "./artifactDownload";

const DOC = [
    "# Calendar notes",
    "",
    "Some words.",
    "",
    "## Buckets",
    "",
    "| Bucket | Rows | What it holds |",
    "|---|---|---|",
    "| **Vision** | 12 | The [big picture](https://example.com) & `ideas` |",
    "| Task | =1+1 | @SUM(A1) |",
    "",
    "## Buckets",
    "",
    "| A | B |",
    "|---|---|",
    "| 1 | 2 |",
].join("\n");

describe("markdownTables", () => {
    it("reads each table as plain text with the heading above it", () => {
        const tables = markdownTables(DOC);
        expect(tables).toHaveLength(2);
        expect(tables[0].title).toBe("Buckets");
        expect(tables[0].rows[0]).toEqual(["Bucket", "Rows", "What it holds"]);
        // Marks are gone, the text stays
        expect(tables[0].rows[1]).toEqual(["Vision", "12", "The big picture & ideas"]);
        expect(tables[0].rows[2]).toEqual(["Task", "=1+1", "@SUM(A1)"]);
    });

    it("finds no table in a document without one, and no table in a code block", () => {
        expect(hasTable("# Packing list\n\n- one\n- two")).toBe(false);
        expect(hasTable("```\n| a | b |\n|---|---|\n| 1 | 2 |\n```")).toBe(false);
        expect(hasTable(DOC)).toBe(true);
    });
});

describe("file names", () => {
    it("keeps a name that is safe everywhere and says which version it is", () => {
        expect(fileNameOf("Calendar notes — Oct 28 to Dec 28", "md")).toBe("Calendar notes — Oct 28 to Dec 28.md");
        expect(fileNameOf('a/b\\c:d*e?"f<g>h|i', "md")).toBe("a b c d e f g h i.md");
        expect(fileNameOf("..hidden", "xlsx")).toBe("hidden.xlsx");
        expect(fileNameOf("   ", "md")).toBe("Document.md");
        expect(fileNameOf("Notes", "md", 1)).toBe("Notes (version 1).md");
        expect(fileNameOf("x".repeat(500), "md").length).toBeLessThanOrEqual(104);
    });
});

describe("sheetNamesOf", () => {
    it("names a tab after its heading, within the limits, each once", () => {
        const names = sheetNamesOf(
            [
                { title: "Buckets", rows: [] },
                { title: "buckets", rows: [] },
                { title: "", rows: [] },
                { title: "A very long heading that goes on well past the limit of a tab", rows: [] },
                { title: "What: is [this]?", rows: [] },
            ],
            (n) => `Table ${n}`
        );
        expect(names[0]).toBe("Buckets");
        expect(names[1]).toBe("buckets 2");
        expect(names[2]).toBe("Table 3");
        expect(names[3].length).toBeLessThanOrEqual(31);
        expect(names[4]).toBe("What is this");
        expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    });
});

describe("files", () => {
    it("gives the Markdown file exactly as it is", async () => {
        expect(await markdownFile(DOC).text()).toBe(DOC);
    });

    it("makes a spreadsheet with one tab for each table, every cell plain text", async () => {
        const blob = await spreadsheetFile(markdownTables(DOC), (n) => `Table ${n}`);
        const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
        expect(book.SheetNames).toEqual(["Buckets", "Buckets 2"]);
        const sheet = book.Sheets["Buckets"];
        // "=1+1" is the words, never a formula: a string cell with no formula
        expect(sheet["B3"].t).toBe("s");
        expect(sheet["B3"].v).toBe("=1+1");
        expect(sheet["B3"].f).toBeUndefined();
        // A number-like text stays as written
        expect(sheet["B2"].t).toBe("s");
        expect(sheet["B2"].v).toBe("12");
        expect(sheet["C2"].v).toBe("The big picture & ideas");
    });
});
