import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { WORD_PAGE_POLICY, cleanPages, renderWordDocument } from "../wordDocument";
import { badgeOfKind, bytesMatchKind, chatFileOpensInViewer, fileKindOf } from "../fileKinds";

const PNG = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
    (char) => char.charCodeAt(0)
);

const NAMESPACES =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function picture(attribute: string, id: number): string {
    return `<w:r><w:drawing><wp:inline><wp:extent cx="900000" cy="900000"/><wp:docPr id="${id}" name="p${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="p${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip ${attribute}/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="900000" cy="900000"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** A small .docx: two pages, a table, a stored picture, pictures linked from another site and two links. */
async function makeDocx(): Promise<ArrayBuffer> {
    const body = [
        "<w:p><w:r><w:t>Hello Word</w:t></w:r></w:p>",
        `<w:p>${picture('r:embed="rIdImage"', 1)}${picture('r:link="rIdOutside"', 2)}${picture(
            'r:embed="rIdOutside"',
            3
        )}</w:p>`,
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
        '<w:p><w:hyperlink r:id="rIdWeb"><w:r><w:t>web link</w:t></w:r></w:hyperlink></w:p>',
        '<w:p><w:hyperlink r:id="rIdScript"><w:r><w:t>script link</w:t></w:r></w:hyperlink></w:p>',
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
        "<w:p><w:r><w:t>Second page</w:t></w:r></w:p>",
    ].join("");
    const relationship = (id: string, type: string, target: string, external = false) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${
            external ? ' TargetMode="External"' : ""
        }/>`;
    const zip = new JSZip();
    zip.file(
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    );
    zip.file(
        "_rels/.rels",
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    );
    zip.file(
        "word/document.xml",
        `<?xml version="1.0"?><w:document ${NAMESPACES}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
    );
    zip.file(
        "word/_rels/document.xml.rels",
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[
            relationship("rIdImage", "image", "media/image1.png"),
            relationship("rIdOutside", "image", "https://tracker.example/pixel.png", true),
            relationship("rIdWeb", "hyperlink", "https://example.com/page", true),
            relationship("rIdScript", "hyperlink", "javascript:window.__ran=true", true),
        ].join("")}</Relationships>`
    );
    zip.file("word/media/image1.png", PNG);
    return zip.generateAsync({ type: "arraybuffer" });
}

function pagesOf(srcdoc: string): Document {
    return new DOMParser().parseFromString(srcdoc, "text/html");
}

describe("picking the reader for Word files", () => {
    it("opens .docx and the old .doc from a chat card", () => {
        expect(fileKindOf("Plan.DOCX")).toBe("word");
        expect(fileKindOf("old.doc")).toBe("oldword");
        expect(chatFileOpensInViewer("plan.docx")).toBe(true);
        expect(chatFileOpensInViewer("old.doc")).toBe(true);
        expect(badgeOfKind("word")).toMatchObject({ label: "DOCX", kindName: "Word" });
    });

    it("takes a zip named .docx, and refuses anything else", () => {
        expect(bytesMatchKind("word", "a.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
        expect(bytesMatchKind("word", "a.docx", new TextEncoder().encode("<html>"))).toBe(false);
        expect(bytesMatchKind("oldword", "a.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(false);
    });
});

describe("drawing a Word file", () => {
    it("draws the pages and counts them", async () => {
        const result = await renderWordDocument(await makeDocx());

        expect(result.pageCount).toBe(2);
        expect(result.pageWidth).toBeGreaterThan(600);
        const page = pagesOf(result.srcdoc);
        expect(page.body.textContent).toContain("Hello Word");
        expect(page.body.textContent).toContain("Second page");
        expect(page.querySelector("table")?.textContent).toContain("Cell");
    });

    it("seals the page: nothing can be fetched and no script is there", async () => {
        const { srcdoc } = await renderWordDocument(await makeDocx());
        const page = pagesOf(srcdoc);

        expect(page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(
            WORD_PAGE_POLICY
        );
        expect(WORD_PAGE_POLICY).toContain("default-src 'none'");
        expect(WORD_PAGE_POLICY).not.toMatch(/https?:|\*/);
        expect(page.querySelector("script, iframe, object, embed, form, link")).toBeNull();
        expect(srcdoc).not.toMatch(/https?:\/\/tracker/);
    });

    it("keeps the picture stored in the file and loads none from other sites", async () => {
        const { srcdoc } = await renderWordDocument(await makeDocx());
        const sources = Array.from(pagesOf(srcdoc).querySelectorAll("img")).map((image) => image.getAttribute("src"));

        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatch(/^data:image\/png;base64,/);
    });

    it("keeps web links as links for a new tab and drops other addresses", async () => {
        const { srcdoc } = await renderWordDocument(await makeDocx());
        const links = Array.from(pagesOf(srcdoc).querySelectorAll("a"));

        const web = links.find((link) => link.textContent === "web link");
        expect(web?.getAttribute("href")).toBe("https://example.com/page");
        expect(web?.getAttribute("target")).toBe("_blank");
        expect(web?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(links.find((link) => link.textContent === "script link")?.hasAttribute("href")).toBe(false);
        expect(srcdoc).not.toContain("javascript:");
    });

    it("refuses files that are not Word files", async () => {
        await expect(
            renderWordDocument(new TextEncoder().encode("<html>no</html>").buffer as ArrayBuffer)
        ).rejects.toThrow();
        const zip = new JSZip();
        zip.file("hello.txt", "just a zip");
        await expect(renderWordDocument(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow();
    });
});

describe("cleaning the drawn pages", () => {
    it("removes everything that could run or load something", () => {
        const cleaned = cleanPages(
            [
                "<script>window.__ran = true</script>",
                '<iframe src="https://evil.example"></iframe>',
                '<img src="https://evil.example/a.png" onerror="window.__ran = true">',
                '<img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://evil.example/b.png 2x">',
                '<img src="data:text/html;base64,PHNjcmlwdD4=">',
                '<a href="javascript:window.__ran = true" onclick="window.__ran = true">x</a>',
                '<p style="color:red" onmouseover="window.__ran = true">text</p>',
                '<object data="https://evil.example"></object><embed src="https://evil.example"><link rel="stylesheet" href="https://evil.example/c.css">',
                '<form action="https://evil.example"><input name="a"></form>',
            ].join("")
        );
        const host = document.createElement("div");
        host.innerHTML = cleaned;

        expect(host.querySelector("script, iframe, object, embed, link, form, input")).toBeNull();
        expect(cleaned).not.toMatch(/evil\.example|onerror|onclick|onmouseover|javascript:|srcset|text\/html/);
        expect(host.querySelectorAll("img")).toHaveLength(1);
        expect(host.querySelector("p")?.getAttribute("style")).toBe("color:red");
        expect(host.querySelector("a")?.hasAttribute("href")).toBe(false);
    });
});
