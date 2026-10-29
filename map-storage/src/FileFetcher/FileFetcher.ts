import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { mapPath } from "../Services/PathMapper";
import type { FileSystemInterface } from "../Upload/FileSystemInterface";
import { CACHE_CONTROL } from "../Enum/EnvironmentVariable";

const staticFileExtensions = ["png", "css", "js", "jpg", "jpeg", "ico", "svg", "html", "htm", "jpeg"];

// An SVG opened as a page (a map's "Open file", a new tab) could run code on this address. This rule only stops code:
// the picture draws the same, and browsers ignore it where an SVG is used as a picture.
export const SVG_NO_CODE_POLICY = "script-src 'none'; object-src 'none'";

export function proxyFiles(fileSystem: FileSystemInterface) {
    return (req: Request, res: Response, next: NextFunction) => {
        const unescapedPath = decodeURIComponent(req.path.replace(/\+/g, " "));
        const virtualPath = mapPath(unescapedPath, req);

        const fileName = req.path.split("/").pop();

        if (fileName) {
            // Use a regular expression to check if the file has a unique alphanumeric identifier of length between 6 and 32 characters in its name, and capture the file extension
            const regex = /[.-]([a-f0-9]{8})\.([a-z]{2,4})$/i;
            const match = fileName.match(regex);

            // Regular expression to match a UUID (used by WorkAdventure uploaded assets)
            const regexUuid = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}).*\.([a-z]{2,4})/i;
            const matchUuid = fileName.match(regexUuid);

            // Check if the regular expression matched and the file extension is one of the common static file extensions
            if (match && staticFileExtensions.includes(match[2])) {
                // Set the cache-control header to cache the file forever
                res.set("Cache-Control", "public, max-age=31536000, immutable");
            } else if (matchUuid && staticFileExtensions.includes(matchUuid[2])) {
                // Set the cache-control header to cache the file forever
                res.set("Cache-Control", "public, max-age=31536000, immutable");
            } else {
                res.set("Cache-control", CACHE_CONTROL);
            }
        }

        // The file system resolves "x.svg/", "x.svg/." and "dir/../x.svg" to the SVG: so the rule looks at that form.
        const resolvedPath = path.posix.normalize(unescapedPath).replace(/\/+$/, "");
        if (/\.svgz?$/i.test(resolvedPath)) {
            res.set("Content-Security-Policy", SVG_NO_CODE_POLICY);
        }

        fileSystem.serveStaticFile(virtualPath, res, next);
    };
}

// Last in the chain: nothing served the request, so it ends in "not found". proxyFiles may already have marked it
// "keep for a year"; a file that is not there yet, like a new upload asked for before it is written, must not keep
// its "not found" for a year, or the browser never asks again.
export function noStoreWhenNotServed(req: Request, res: Response, next: NextFunction): void {
    res.set("Cache-Control", "no-store");
    next();
}

// The same for a request that ended in an error.
export function noStoreOnError(err: unknown, req: Request, res: Response, next: NextFunction): void {
    if (!res.headersSent) {
        res.set("Cache-Control", "no-store");
    }
    next(err);
}
