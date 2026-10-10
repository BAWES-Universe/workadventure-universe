import { AddressInfo } from "net";
import http from "http";
import axios from "axios";
import express from "express";
import FormData from "form-data";
import Jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { TargetDevice } from "../src/Service/TargetDevice";

const files = new Map<string, Buffer>();
const token = Jwt.sign({ identifier: "test-player" }, "test-secret");
const activeContent = Buffer.from('<script>window.uploadScriptRan = true</script>');

jest.mock("../src/Enum/EnvironmentVariable", () => ({
    SECRET_KEY: "test-secret",
    ENABLE_CHAT_UPLOAD: true,
    UPLOAD_MAX_FILESIZE: "10485760",
    UPLOADER_URL: "http://uploader.test",
}));
// Exercise the real controller, UUID generation, service and HTTP device; only persistence is in memory.
jest.mock("../src/Service/StorageProviderService", () => ({
    storageProviderService: {
        upload: (id: string, buffer: Buffer) => {
            files.set(id, buffer);
            return Promise.resolve(id);
        },
        copyFile: (id: string, target: TargetDevice) => {
            target.copyFromBuffer(files.get(id));
            return Promise.resolve();
        },
    },
    tempProviderService: {
        uploadTempFile: (id: string, buffer: Buffer) => {
            files.set(id, buffer);
            return Promise.resolve();
        },
        get: (id: string) => Promise.resolve(files.get(id)),
    },
    getCdnProvider: () => null,
    isCdnConfigured: () => false,
}));

import { FileController } from "../src/Controller/FileController";

describe("uploaded files are inert, while media stays inline", () => {
    let server: http.Server;
    let url: string;

    beforeAll(async () => {
        const app = express();
        new FileController(app);
        server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        url = `http://localhost:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    async function upload(name: string, contentType: string, contents = activeContent) {
        const form = new FormData();
        form.append("file", contents, { filename: name, contentType });
        const response = await axios.post(`${url}/upload-file`, form.getBuffer(), {
            headers: { ...form.getHeaders(), Authorization: token },
        });
        expect(response.status).toBe(200);
        expect(response.data[0].name).toBe(name);
        return response.data[0] as { id: string; location: string; size: number; type: string };
    }

    it.each([
        ["page.html", "text/html"],
        ["page.HTML", "image/png"],
        ["page.xhtml", "application/xhtml+xml"],
        ["page.xml", "application/xml"],
        ["script.js", "application/javascript"],
        ["document.pdf", "application/pdf"],
        ["notes.txt", "text/plain"],
        ["README", "text/html"],
        ["unknown.weird", "image/png"],
    ])("downloads %s without letting its contents run", async (name, type) => {
        const file = await upload(name, type);
        expect(file.location).toBe(`http://uploader.test/upload-file/${file.id}`);
        expect(file.size).toBe(activeContent.length);
        expect(file.type).toBe(type);
        const response = await axios.get(`${url}/upload-file/${file.id}`, { responseType: "arraybuffer" });
        expect(response.headers["content-type"]).toBe("application/octet-stream");
        expect(response.headers["content-disposition"]).toBe("attachment");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
        expect(response.headers["content-security-policy"]).toContain("sandbox");
        expect(Buffer.from(response.data)).toEqual(activeContent);
    });

    it.each([
        ["photo.PNG", "image/png"],
        ["photo.jpeg", "image/jpeg"],
        ["animation.gif", "image/gif"],
        ["photo.webp", "image/webp"],
        ["photo.avif", "image/avif"],
        ["clip.mp4", "video/mp4"],
        ["clip.webm", "video/webm"],
        ["sound.mp3", "audio/mpeg"],
        ["sound.ogg", "audio/ogg"],
        ["sound.wav", "audio/wave"],
    ])("keeps %s available to chat previews and players", async (name, expectedType) => {
        // A misleading multipart type must not influence the download type.
        const file = await upload(name, "text/html", Buffer.from("media bytes"));
        expect(file.type).toBe("text/html");
        const response = await axios.get(`${url}/upload-file/${file.id}`, { responseType: "arraybuffer" });
        expect(response.headers["content-type"]).toBe(expectedType);
        expect(response.headers["content-disposition"]).toBe("inline");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(Buffer.from(response.data)).toEqual(Buffer.from("media bytes"));
    });

    it("also protects a dangerous file stored before the fix", async () => {
        files.set("existing.svg", activeContent);
        const response = await axios.get(`${url}/upload-file/existing.svg`);
        expect(response.headers["content-type"]).toBe("image/svg+xml");
        expect(response.headers["content-disposition"]).toBe("attachment");
    });

    it("keeps SVG previews and original bytes, while forcing standalone downloads", async () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="32" height="32"/></svg>');
        const file = await upload("drawing.svg", "text/html", svg);
        expect(file.type).toBe("text/html");
        const response = await axios.get(`${url}/upload-file/${file.id}`, { responseType: "arraybuffer" });
        expect(response.headers["content-type"]).toBe("image/svg+xml");
        expect(response.headers["content-disposition"]).toBe("attachment");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
        expect(Buffer.from(response.data)).toEqual(svg);
    });

    it("keeps missing-file recovery", async () => {
        const response = await axios.get(`${url}/upload-file/missing.png`, { validateStatus: () => true });
        expect(response.status).toBe(404);
        expect(response.data).toBe("Cannot find file");
    });

    it("keeps signed-in voice messages inline with their existing URL and headers", async () => {
        const bytes = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WAVEfmt ")]);
        const form = new FormData();
        form.append("file", bytes, { filename: "message.wav", contentType: "audio/wav" });
        const signedInToken = Jwt.sign({ identifier: "test-player", accessToken: "test-oidc" }, "test-secret");
        const uploaded = await axios.post(`${url}/upload-audio-message`, form.getBuffer(), {
            headers: { ...form.getHeaders(), Authorization: signedInToken },
        });
        expect(uploaded.data.path).toBe(`/download-audio-message/${uploaded.data.id}`);
        const downloaded = await axios.get(`${url}${uploaded.data.path}`, { responseType: "arraybuffer" });
        expect(downloaded.headers["content-type"]).toBe("audio/wav");
        expect(downloaded.headers["content-disposition"]).toBe('inline; filename="audio.wav"');
        expect(downloaded.headers["x-content-type-options"]).toBe("nosniff");
        expect(Buffer.from(downloaded.data)).toEqual(bytes);
    });
});
