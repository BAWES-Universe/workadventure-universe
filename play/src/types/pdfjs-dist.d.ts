// The package declares its builds through "exports", which this project's "node" module resolution doesn't read.
// Vite resolves them at build time; these lines give TypeScript the same types. The "legacy" build is the one for
// older phones and browsers.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
    export * from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/web/pdf_viewer.mjs" {
    export * from "pdfjs-dist/types/web/pdf_viewer.component";
}
