import mime from "mime-types";

export const DEFAULT_MIME_TYPE = "application/octet-stream";

// The extension becomes a storage key, a URL and a response type. Keep it short and free of path/header syntax.
const EXTENSION_REGEXP = /^[a-z0-9]{1,16}$/i;

class MimeTypeManager {
    getExtensionByFileName(name: string): string | undefined {
        const parts = name.split(".");
        const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
        return extension && EXTENSION_REGEXP.test(extension) ? extension : undefined;
    }

    getMimeTypeByFileName(name: string): string | false {
        const extension = this.getExtensionByFileName(name);
        if (!extension) {
            return false;
        }
        return mime.contentType(extension);
    }

    getSafeMimeTypeByFileName(name: string): string {
        const mimeType = this.getMimeTypeByFileName(name);
        if (!mimeType) {
            return DEFAULT_MIME_TYPE;
        }
        const type = mimeType.split(";")[0].trim().toLowerCase();
        if (!/^(image|audio|video)\//.test(type)) {
            return DEFAULT_MIME_TYPE;
        }
        return type;
    }

    getContentDispositionByFileName(name: string): "attachment" | "inline" {
        const type = this.getSafeMimeTypeByFileName(name);
        // SVG previews in <img> cannot execute script. Preserve them, but never navigate to an SVG document:
        // a standalone SVG can run script, so its link must download instead of opening on the upload origin.
        return type === DEFAULT_MIME_TYPE || type === "image/svg+xml" ? "attachment" : "inline";
    }
}

export const mimeTypeManager = new MimeTypeManager();
