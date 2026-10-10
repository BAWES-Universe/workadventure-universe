import {Response} from "express";
import {mimeTypeManager} from "../Service/MimeType";
import {TargetDevice} from "../Service/TargetDevice";

export class HttpResponseDevice implements TargetDevice {
    constructor(private id: string, private response: Response) {
        this.response.setHeader("X-Content-Type-Options", "nosniff");
        this.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    }

    copyFromLink(link: string): void {
        this.response.redirect(link);
    }

    copyFromBuffer(buffer: Buffer | undefined | null): void {
        if (buffer == undefined) {
            this.response.status(404).send("Cannot find file");
            return;
        }

        this.response.status(200);

        const disposition = mimeTypeManager.getContentDispositionByFileName(this.id);
        this.response.type(mimeTypeManager.getSafeMimeTypeByFileName(this.id));
        this.response.setHeader("Content-Disposition", disposition);
        if (disposition === "inline") {
            // Browser-generated media viewers reload their own URL with CORS. Keeping the origin avoids an opaque
            // "null" origin that configured game-only CORS would refuse. Script and other resources stay blocked.
            this.response.setHeader("Content-Security-Policy",
                "default-src 'none'; img-src 'self'; media-src 'self'; sandbox allow-same-origin");
        }

        this.response.send(buffer);
    }
}
