import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { fileNameOf, hasTable, markdownFile, markdownTables, sheetNamesOf, spreadsheetFile } from "./artifactDownload";

/** A file's bytes, read the way a browser page reads them (jsdom's Blob has no text() or arrayBuffer()). */
function readBlob<T extends string | ArrayBuffer>(blob: Blob, as: "text" | "buffer"): Promise<T> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as T);
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
        if (as === "text") reader.readAsText(blob);
        else reader.readAsArrayBuffer(blob);
    });
}

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

    it("reads a table inside a quote or a list, in order with the others, and none inside a code block", () => {
        const doc = [
            "# One",
            "",
            "> | A | B |",
            "> |---|---|",
            "> | 1 | 2 |",
            "",
            "## Two",
            "",
            "- item",
            "",
            "  | C |",
            "  |---|",
            "  | 3 |",
            "",
            "1. > | D |",
            "   > |---|",
            "   > | 4 |",
            "",
            "```",
            "| X |",
            "|---|",
            "| 9 |",
            "```",
            "",
            "## Three",
            "",
            "| E |",
            "|---|",
            "| 5 |",
        ].join("\n");
        const tables = markdownTables(doc);
        expect(tables.map((t) => [t.title, t.rows[0][0]])).toEqual([
            ["One", "A"],
            ["Two", "C"],
            ["Two", "D"],
            ["Three", "E"],
        ]);
        expect(hasTable("> | A |\n> |---|\n> | 1 |")).toBe(true);
    });

    it("writes every character reference as the text it stands for, once", () => {
        const doc = "| Ref | Code |\n|---|---|\n| &#65; &euro; &amp; &#x42; &lt;b&gt; | `&#65; &amp;` |";
        const row = markdownTables(doc)[0].rows[1];
        expect(row[0]).toBe("A € & B <b>");
        // A code span shows its text as written: its references are not read
        expect(row[1]).toBe("&#65; &amp;");
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

    it("never cuts a two-unit character in half", () => {
        // The cut falls between the two units of the emoji: the whole character goes, no broken mark stays
        const name = fileNameOf("a".repeat(99) + "😀" + "b", "md");
        expect(name).toBe("a".repeat(99) + ".md");
        const tabs = sheetNamesOf([{ title: "a".repeat(30) + "😀 end", rows: [["x"]] }], (n) => `Table ${n}`);
        expect(tabs).toEqual(["a".repeat(30)]);
        expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(name + tabs[0])).toBe(false);
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

    it("never gives a name a spreadsheet refuses: no apostrophe at either end, not even after the cut, and never History", () => {
        const names = sheetNamesOf(
            [
                { title: "'Quoted'", rows: [] },
                // The 31st character is an apostrophe: the cut must not leave it at the end
                { title: `${"a".repeat(30)}'tail`, rows: [] },
                { title: "History", rows: [] },
                { title: "history", rows: [] },
                { title: "''", rows: [] },
            ],
            (n) => `Table ${n}`
        );
        expect(names[0]).toBe("Quoted");
        expect(names[1]).toBe("a".repeat(30));
        // A name the workbook keeps for itself becomes the plain "Table N", each one once
        expect(names[2]).toBe("Table 3");
        expect(names[3]).toBe("Table 4");
        expect(names[4]).toBe("Table 5");
        for (const name of names) {
            expect(name.length).toBeLessThanOrEqual(31);
            expect(name).not.toMatch(/^'|'$/);
            expect(name.toLowerCase()).not.toBe("history");
        }
        expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    });

    it("keeps a repeated name unique even when the suffix pushes it over the cut", () => {
        const long = "b".repeat(40);
        const names = sheetNamesOf(
            [
                { title: long, rows: [] },
                { title: long, rows: [] },
                { title: long, rows: [] },
            ],
            (n) => `Table ${n}`
        );
        expect(names).toEqual(["b".repeat(31), `${"b".repeat(29)} 2`, `${"b".repeat(29)} 3`]);
    });
});

describe("files", () => {
    it("puts every table of a long document in the spreadsheet, with no cut", async () => {
        const tables = Array.from({ length: 70 }, (_, n) => ({
            title: `Part ${n + 1}`,
            rows: [["a"], [String(n + 1)]],
        }));
        const blob = await spreadsheetFile(tables, (n) => `Table ${n}`);
        const book = XLSX.read(new Uint8Array(await readBlob<ArrayBuffer>(blob, "buffer")), { type: "array" });
        expect(book.SheetNames).toHaveLength(70);
        expect(book.SheetNames[69]).toBe("Part 70");
    });

    it("gives the Markdown file exactly as it is", async () => {
        expect(await readBlob<string>(markdownFile(DOC), "text")).toBe(DOC);
    });

    it("makes a spreadsheet with one tab for each table, every cell plain text", async () => {
        const blob = await spreadsheetFile(markdownTables(DOC), (n) => `Table ${n}`);
        const book = XLSX.read(new Uint8Array(await readBlob<ArrayBuffer>(blob, "buffer")), { type: "array" });
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
