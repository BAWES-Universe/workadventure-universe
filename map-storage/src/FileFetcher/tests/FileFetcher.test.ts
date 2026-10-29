import type { NextFunction, Request, Response } from "express";
import { describe, it, vi, expect } from "vitest";

vi.hoisted(() => {
    process.env.API_URL = "localhost:50051";
    process.env.PUSHER_URL = "http://localhost";
    process.env.MAP_STORAGE_API_TOKEN = "test";
    process.env.AUTHENTICATION_TOKEN = "test";
});

import type { FileSystemInterface } from "../../Upload/FileSystemInterface";
import { noStoreOnError, noStoreWhenNotServed, proxyFiles, SVG_NO_CODE_POLICY } from "../FileFetcher";

function serve(path: string, found = true): { headers: Record<string, string>; served: string[] } {
    const headers: Record<string, string> = {};
    const served: string[] = [];
    const fileSystem = {
        serveStaticFile: (virtualPath: string, _res: Response, next: NextFunction) => {
            served.push(virtualPath);
            // Nothing else in the chain serves it: the request ends in "not found", as in index.ts.
            if (!found) noStoreWhenNotServed(req, res, () => undefined);
        },
    } as unknown as FileSystemInterface;
    const req = { path, hostname: "localhost", headers: {} } as unknown as Request;
    const res = {
        headersSent: false,
        set: (name: string, value: string) => {
            headers[name.toLowerCase()] = value;
        },
    } as unknown as Response;
    proxyFiles(fileSystem)(req, res, (() => undefined) as NextFunction);
    return { headers, served };
}

describe("proxyFiles", () => {
    it("serves an SVG with a rule that stops its code", () => {
        const { headers, served } = serve("/private/files/logo-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0.svg");
        expect(headers["content-security-policy"]).toBe(SVG_NO_CODE_POLICY);
        expect(served).toEqual(["private/files/logo-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0.svg"]);
    });

    it("finds the SVG whatever the case of its extension or an encoded dot", () => {
        expect(serve("/private/files/Logo.SVG").headers["content-security-policy"]).toBe(SVG_NO_CODE_POLICY);
        expect(serve("/private/files/logo%2Esvg").headers["content-security-policy"]).toBe(SVG_NO_CODE_POLICY);
        expect(serve("/maps/drawing.svgz").headers["content-security-policy"]).toBe(SVG_NO_CODE_POLICY);
    });

    it.each([
        "/maps/x.svg/",
        "/maps/x.svg//",
        "/maps/x.svg/.",
        "/maps/x.svg/./",
        "/maps/dir/../x.svg",
        "/maps/x%2Esvg%2F",
    ])("finds the SVG asked for as %s", (path) => {
        expect(serve(path).headers["content-security-policy"]).toBe(SVG_NO_CODE_POLICY);
    });

    it.each([
        "/private/files/notes-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0.pdf",
        "/private/files/photo.png",
        "/maps/office/map.wam",
        "/maps/office/script.js",
        "/maps/office/page.html",
        "/maps/office/tiles.svg.png",
    ])("leaves %s exactly as before", (path) => {
        const { headers } = serve(path);
        expect(headers["content-security-policy"]).toBeUndefined();
    });

    it("caches an uploaded picture for a year once it is there", () => {
        const { headers } = serve("/u/w/entities/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-arcade.png");
        expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    });

    it("does not cache a picture that is not there yet, so the browser asks again", () => {
        const { headers } = serve("/u/w/entities/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-arcade.png", false);
        expect(headers["cache-control"]).toBe("no-store");
    });

    it("does not cache a request that ended in an error", () => {
        const headers: Record<string, string> = {};
        const res = {
            headersSent: false,
            set: (name: string, value: string) => {
                headers[name.toLowerCase()] = value;
            },
        } as unknown as Response;
        const error = new Error("storage down");
        let passedOn: unknown;
        noStoreOnError(error, {} as Request, res, ((err: unknown) => (passedOn = err)) as NextFunction);
        expect(headers["cache-control"]).toBe("no-store");
        expect(passedOn).toBe(error);
    });
});
