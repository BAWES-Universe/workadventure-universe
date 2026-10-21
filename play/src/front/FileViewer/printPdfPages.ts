import type { PDFDocumentProxy } from "pdfjs-dist";

/** Print resolution: 150 dots per inch, from PDF.js' 72 units per inch. */
const PRINT_SCALE = 150 / 72;
/** Pages are drawn smaller when this would make a canvas too large for the browser. */
const MAX_PIXELS_PER_PAGE = 16_000_000;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Could not draw a page"))),
            "image/jpeg",
            0.92
        );
    });
}

/**
 * Prints a PDF the way a browser's own viewer does: the pages are drawn as pictures into a hidden frame that has
 * nothing else in it, and that frame is printed. No script of the file runs, and nothing leaves the page.
 */
export async function printPdfPages(pdf: PDFDocumentProxy): Promise<void> {
    const frame = document.createElement("iframe");
    // "allow-same-origin" lets this page fill the frame; "allow-modals" lets the frame open the print dialog. There
    // is no "allow-scripts": nothing inside the frame can run code.
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);

    const urls: string[] = [];
    const cleanUp = () => {
        frame.remove();
        for (const url of urls) URL.revokeObjectURL(url);
    };

    try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (!doc || !win) throw new Error("Could not prepare the pages to print");
        const style = doc.createElement("style");
        style.textContent =
            "@page{margin:0}html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}";
        doc.head.appendChild(style);
        doc.title = "";

        // One page at a time: a long file never holds more than one big picture in memory.
        /* eslint-disable no-await-in-loop */
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const base = page.getViewport({ scale: PRINT_SCALE });
            const shrink = Math.min(1, Math.sqrt(MAX_PIXELS_PER_PAGE / (base.width * base.height)));
            const viewport = page.getViewport({ scale: PRINT_SCALE * shrink });
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            // The print intent draws what a printer would get; the page's white sheet is PDF.js' default background.
            await page.render({ canvas, viewport, intent: "print" }).promise;
            const blob = await canvasToBlob(canvas);
            canvas.width = 0;
            canvas.height = 0;
            page.cleanup();
            const url = URL.createObjectURL(blob);
            urls.push(url);
            const image = doc.createElement("img");
            image.src = url;
            doc.body.appendChild(image);
            await image.decode().catch(() => undefined);
        }
        /* eslint-enable no-await-in-loop */

        // The frame must stay until the print dialog is done with it, which some browsers do not wait for. The
        // viewer is free again as soon as the dialog is open: the frame goes away when printing ends.
        let cleaned = false;
        const cleanUpOnce = () => {
            if (cleaned) return;
            cleaned = true;
            cleanUp();
        };
        win.addEventListener("afterprint", cleanUpOnce, { once: true });
        // Some browsers print without ever telling the page: the frame goes away after a while either way.
        setTimeout(cleanUpOnce, 10 * 60_000);
        win.focus();
        win.print();
    } catch (error) {
        cleanUp();
        throw error;
    }
}
