import { describe, expect, it } from "vitest";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, decodeText, indentJson, parseCsv, renderMarkdown } from "../textFiles";
import { badgeOfKind, bytesMatchKind, chatFileOpensInViewer, fileKindOf } from "../fileKinds";

const encode = (text: string) => new TextEncoder().encode(text);

function render(markdown: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(markdown);
    return host;
}

describe("picking the reader for a text file", () => {
    it("knows the four text types", () => {
        expect(fileKindOf("notes.md")).toBe("markdown");
        expect(fileKindOf("log.TXT")).toBe("text");
        expect(fileKindOf("data.json")).toBe("json");
        expect(fileKindOf("sheet.csv")).toBe("csv");
    });

    it("opens them from a chat card", () => {
        for (const name of ["a.md", "a.txt", "a.json", "a.csv"]) {
            expect(chatFileOpensInViewer(name)).toBe(true);
        }
    });

    it("leaves every other file as a download", () => {
        for (const name of ["a.zip", "a.pptx", "a.html", "a.js", "a.xml"]) {
            expect(chatFileOpensInViewer(name)).toBe(false);
        }
    });

    it("gives each type its badge", () => {
        expect(badgeOfKind("markdown")).toMatchObject({ label: "MD", kindName: "Markdown" });
        expect(badgeOfKind("csv").label).toBe("CSV");
    });

    it("takes text, with or without a byte order mark, and refuses binary files named as text", () => {
        expect(bytesMatchKind("text", "a.txt", encode("hello"))).toBe(true);
        expect(bytesMatchKind("text", "a.txt", new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe(true);
        expect(bytesMatchKind("csv", "a.csv", new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe(true);
        expect(bytesMatchKind("text", "a.txt", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
        expect(bytesMatchKind("markdown", "a.md", new Uint8Array(0))).toBe(false);
    });

    it("refuses text in an older code page, which would show as broken letters", () => {
        // "café" in Windows-1252, and Arabic in Windows-1256: neither is UTF-8.
        expect(bytesMatchKind("csv", "a.csv", new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe(false);
        expect(bytesMatchKind("csv", "a.csv", new Uint8Array([0xc7, 0xe1, 0xe3, 0xd3, 0xc7, 0xed]))).toBe(false);
    });

    it("accepts UTF-8 text with accents and Arabic, even when the part checked ends inside a letter", () => {
        expect(bytesMatchKind("text", "a.txt", encode("café مرحبا"))).toBe(true);
        // 'a' then two-byte letters: the 64 KB cut falls in the middle of one.
        expect(bytesMatchKind("text", "a.txt", encode(`a${"é".repeat(40000)}`))).toBe(true);
    });
});

describe("decoding", () => {
    it("reads UTF-8, UTF-8 with a mark and UTF-16", () => {
        expect(decodeText(encode("héllo ✓")).text).toBe("héllo ✓");
        expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])).text).toBe("hi");
        expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])).text).toBe("hi");
        expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69])).text).toBe("hi");
    });

    it("shows the first part only and says there is more, without a broken letter at the end", () => {
        // "é" is two bytes: a limit of 3 cuts the second one in half.
        const result = decodeText(encode("aéé"), 4);
        expect(result.truncated).toBe(true);
        expect(result.text).toBe("aé");
        expect(decodeText(encode("abc"), 3).truncated).toBe(false);
    });
});

describe("JSON layout", () => {
    it("lays a one-line text over lines, keeping every value exactly", () => {
        expect(indentJson('{"a":1,"b":[true,null,"x,y"],"c":{},"n":12345678901234567890}')).toBe(
            [
                "{",
                '  "a": 1,',
                '  "b": [',
                "    true,",
                "    null,",
                '    "x,y"',
                "  ],",
                '  "c": {},',
                '  "n": 12345678901234567890',
                "}",
            ].join("\n")
        );
    });

    it("keeps quotes and braces inside strings", () => {
        expect(indentJson('{"s":"a \\" } {"}')).toBe('{\n  "s": "a \\" } {"\n}');
    });

    it("leaves a text that already has lines, or that is not JSON, readable", () => {
        const pretty = '{\n  "a": 1\n}\n';
        expect(indentJson(pretty)).toBe(pretty);
        expect(indentJson("not json at all")).toBe("not json at all");
    });

    it("leaves a text that nests so deep its indents would fill memory as it is", () => {
        const deep = "[".repeat(50_000) + "]".repeat(50_000);
        const started = Date.now();
        expect(indentJson(deep)).toBe(deep);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe("tables from CSV", () => {
    it("reads quotes, doubled quotes, commas and line breaks inside cells", () => {
        const table = parseCsv('Name,Note\r\n"Lee, Sam","said ""hi""\nthen left"\nOmar,\n', true);
        expect(table.rows).toEqual([
            ["Name", "Note"],
            ["Lee, Sam", 'said "hi"\nthen left'],
            ["Omar", ""],
        ]);
        expect(table.totalRows).toBe(3);
    });

    it("uses a semicolon or a tab when that is what the first line uses", () => {
        expect(parseCsv("a;b;c\n1;2;3", true).rows[1]).toEqual(["1", "2", "3"]);
        expect(parseCsv("a\tb\n1\t2", true).rows[1]).toEqual(["1", "2"]);
    });

    it("reads the separator from the first line of a file whose lines end with a lone carriage return", () => {
        // Commas in the later rows would outweigh the header's semicolons if the first line ran on past the return.
        expect(parseCsv("a;b\r1,2,3,4\r5,6,7,8", true).rows[0]).toEqual(["a", "b"]);
    });

    it("skips blank lines and keeps the last row without a final line break", () => {
        expect(parseCsv("a,b\n\n1,2", true).rows).toEqual([
            ["a", "b"],
            ["1", "2"],
        ]);
    });

    it("keeps a quoted empty value in a one-column file, which is not a blank line", () => {
        const parsed = parseCsv('name\n"Ann"\n""\n\n"Bo"\n""', true);
        expect(parsed.rows).toEqual([["name"], ["Ann"], [""], ["Bo"], [""]]);
        expect(parsed.totalRows).toBe(5);
        // Blank lines are still not rows; a delimiter alone makes a row of two empty cells.
        expect(parseCsv("a\n\n\nb", true).rows).toEqual([["a"], ["b"]]);
        expect(parseCsv("a,b\n,\n", true).rows).toEqual([
            ["a", "b"],
            ["", ""],
        ]);
    });

    it("shows the first rows and columns only, and counts the rows", () => {
        const manyRows = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, index) => `r${index},x`).join("\n");
        const rows = parseCsv(manyRows, true);
        expect(rows.rows).toHaveLength(MAX_TABLE_ROWS);
        expect(rows.rowsCut).toBe(true);
        expect(rows.totalRows).toBe(MAX_TABLE_ROWS + 5);
        expect(parseCsv(manyRows, false).totalRows).toBeUndefined();

        const manyColumns = Array.from({ length: MAX_TABLE_COLUMNS + 3 }, (_, index) => `c${index}`).join(",");
        const columns = parseCsv(manyColumns, true);
        expect(columns.rows[0]).toHaveLength(MAX_TABLE_COLUMNS);
        expect(columns.columnsCut).toBe(true);
    });

    it("keeps a cell that looks like a web page as text", () => {
        expect(parseCsv('a\n"<script>alert(1)</script>"', true).rows[1][0]).toBe("<script>alert(1)</script>");
    });
});

describe("Markdown", () => {
    it("formats headings, lists, tables and code like chat messages", () => {
        const host = render("# Title\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n");
        expect(host.querySelector("h1")?.textContent).toBe("Title");
        expect(host.querySelectorAll("li")).toHaveLength(2);
        expect(host.querySelector("table th")?.textContent).toBe("A");
        expect(host.querySelector("pre code")?.textContent).toContain("code");
    });

    it("shows task list items as ticked and unticked signs, never as form fields", () => {
        const host = render("- [x] done\n- [ ] todo\n");
        const items = Array.from(host.querySelectorAll("li")).map((item) => item.textContent?.trim());
        expect(items).toEqual(["\u2611 done", "\u2610 todo"]);
        expect(host.querySelector("input")).toBeNull();
    });

    it("takes no class or id from the file, so the page's own styles cannot be borrowed", () => {
        const host = render('<div class="fixed inset-0 z-50" id="menu">hello</div>\n\n```js\nlet a = 1;\n```\n');
        expect(host.querySelector("[class]")).toBeNull();
        expect(host.querySelector("[id]")).toBeNull();
        expect(host.textContent).toContain("hello");
        expect(host.querySelector("pre code")?.textContent).toContain("let a = 1;");
    });

    it("has no picture maps, whose areas would be links that skip the link rules", () => {
        const host = render(
            '<img src="data:image/png;base64,iVBORw0KGgo=" usemap="#m"><map name="m"><area shape="rect" coords="0,0,9,9" href="https://evil.example"></map>\n'
        );
        expect(host.querySelector("map, area")).toBeNull();
        expect(host.innerHTML).not.toMatch(/usemap|evil\.example/);
    });

    it("runs nothing from HTML inside the file", () => {
        const host = render(
            [
                "<script>window.__ran = true</script>",
                '<img src="x" onerror="window.__ran = true">',
                '<a href="javascript:window.__ran = true">click</a>',
                '<iframe src="https://evil.example"></iframe>',
                '<form action="https://evil.example"><input name="pw"><button>Send</button></form>',
                '<div style="background:url(https://evil.example/track)" onclick="window.__ran = true">box</div>',
                "<style>body{background:url(https://evil.example/track)}</style>",
                '<video src="https://evil.example/v.mp4"></video>',
            ].join("\n\n")
        );
        expect(host.querySelector("script, iframe, form, input, button, style, video, object, embed")).toBeNull();
        expect(host.innerHTML).not.toMatch(/onerror|onclick|javascript:|style=/i);
        expect(host.textContent).toContain("click");
        expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined();
    });

    it("turns pictures from other sites into links, so opening the file does not tell those sites", () => {
        const host = render(
            '![Team photo](https://tracker.example/pixel.png)\n\n<img src="http://tracker.example/a.png" alt="">'
        );
        expect(host.querySelector("img")).toBeNull();
        const links = host.querySelectorAll("a");
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute("href")).toBe("https://tracker.example/pixel.png");
        expect(links[0].textContent).toBe("Team photo");
    });

    it("keeps a picture that is inside the file, and drops other addresses to their description", () => {
        const inline = render("![dot](data:image/png;base64,iVBORw0KGgo=)");
        expect(inline.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
        const other = render("![secret](file:///etc/passwd)\n\n![svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)");
        expect(other.querySelector("img")).toBeNull();
        expect(other.textContent).toContain("secret");
    });

    it("opens links in a new tab without handing over the page", () => {
        const link = render("[docs](https://example.com/a)").querySelector("a");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("keeps a picture that is itself a link as one link, not a link inside a link", () => {
        const html = render("[![Build](https://img.example.com/b.svg)](https://ci.example.com/run)");
        const links = html.querySelectorAll("a");
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe("https://ci.example.com/run");
        expect(links[0].textContent).toBe("Build");
    });

    it("leaves links that point inside the file or the game with nowhere to go", () => {
        const links = render("[top](#top) [next](other.md) [mail](mailto:a@b.c) [call](tel:+1234)").querySelectorAll(
            "a"
        );
        expect([...links].map((link) => link.getAttribute("href"))).toEqual([null, null, "mailto:a@b.c", "tel:+1234"]);
        expect(links[0].getAttribute("target")).toBeNull();
    });
});
