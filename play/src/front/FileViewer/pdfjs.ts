// PDF.js is loaded only when a PDF opens: the reader, its viewer parts and styles are separate chunks, and the
// worker and its font, character and image files are copied from node_modules at build time (see vite.config.mts)
// and served by the game itself, never fetched from a CDN.
import type * as PdfJsLibModule from "pdfjs-dist/legacy/build/pdf.mjs";
import type * as PdfJsViewerModule from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

export type PdfJsLib = typeof PdfJsLibModule;
export type PdfJsViewer = typeof PdfJsViewerModule;

export interface PdfJs {
    lib: PdfJsLib;
    viewer: PdfJsViewer;
}

/** Where the build copies the files PDF.js reads at run time. */
export const PDFJS_ASSETS_PATH = "/static/pdfjs/";

function assetUrl(file: string): string {
    return new URL(PDFJS_ASSETS_PATH + file, window.location.origin).toString();
}

let loading: Promise<PdfJs> | undefined;

export function loadPdfJs(): Promise<PdfJs> {
    loading ??= (async () => {
        const [lib] = await Promise.all([
            import("pdfjs-dist/legacy/build/pdf.mjs"),
            import("pdfjs-dist/web/pdf_viewer.css"),
        ]);
        lib.GlobalWorkerOptions.workerSrc = assetUrl("pdf.worker.min.mjs");
        // The viewer parts read the reader from the page, so they load after it.
        const viewer = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
        return { lib, viewer };
    })().catch((error) => {
        // A failed load (offline for a moment) is tried again the next time a PDF opens.
        loading = undefined;
        throw error;
    });
    return loading;
}

/**
 * The options every document opens with. PDF scripts never run: scripting is off (no scripting manager is ever
 * created, and the script sandbox's files are not even copied), and this version has no eval-based font path.
 */
export function pdfDocumentOptions(data: Uint8Array): Parameters<PdfJsLib["getDocument"]>[0] {
    return {
        data,
        cMapUrl: assetUrl("cmaps/"),
        cMapPacked: true,
        standardFontDataUrl: assetUrl("standard_fonts/"),
        wasmUrl: assetUrl("wasm/"),
        iccUrl: assetUrl("iccs/"),
        enableXfa: false,
    };
}
