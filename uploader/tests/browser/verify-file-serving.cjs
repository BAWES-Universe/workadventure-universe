// Run after installing uploader and e2e-test dependencies and Playwright's browsers:
// node uploader/tests/browser/verify-file-serving.cjs
// BROWSER=firefox or BROWSER=webkit selects another engine; CHROMIUM_EXECUTABLE_PATH can select an existing Chromium.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const requireUploader = createRequire(path.resolve(__dirname, "../../package.json"));
const requireTests = createRequire(path.resolve(__dirname, "../../../tests/package.json"));
requireUploader("tsx/cjs");
const express = requireUploader("express");
const engines = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireTests("@playwright/test");
const { HttpResponseDevice } = requireUploader("./src/Controller/HttpResponseDevice.ts");
const { mimeTypeManager } = requireUploader("./src/Service/MimeType.ts");

async function verify() {
    const app = express();
    let executed = 0;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" onload="fetch(\'/executed\')"><style>rect { fill: red; }</style><script>fetch("/executed")</script><rect width="32" height="32"/></svg>');
    const html = Buffer.from('<script>fetch("/executed")</script>');
    const files = new Map([["drawing.svg", svg], ["page.html", html]]);
    app.get("/executed", (_request, response) => { executed++; response.end(); });
    app.get("/fixture", (_request, response) => response.send('<!doctype html><title>Upload preview test</title>'));
    app.get("/upload-file/:id", (request, response) => {
        new HttpResponseDevice(request.params.id, response).copyFromBuffer(files.get(request.params.id));
    });
    // S3/public-CDN metadata does not include the uploader's CSP. Check that attachment alone preserves an <img>
    // preview and prevents document navigation too; SDK metadata and URL signing are checked by S3ServingSecurity.
    app.get("/cdn/:id", (request, response) => {
        response.type(mimeTypeManager.getSafeMimeTypeByFileName(request.params.id));
        response.setHeader("Content-Disposition", mimeTypeManager.getContentDispositionByFileName(request.params.id));
        response.send(files.get(request.params.id));
    });
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    let browser;
    try {
        const engineName = process.env.BROWSER || "chromium";
        const options = { headless: true };
        if (engineName === "chromium" && process.env.CHROMIUM_EXECUTABLE_PATH) {
            options.executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
            options.args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
        }
        browser = await engines[engineName].launch(options);
        const url = `http://127.0.0.1:${server.address().port}`;
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
            const context = await browser.newContext({ viewport, acceptDownloads: true });
            const page = await context.newPage();
            await page.goto(`${url}/fixture`);
            await page.evaluate((base) => {
                for (const source of ["upload-file", "cdn"]) {
                    const image = document.createElement("img");
                    image.id = source;
                    image.src = `${base}/${source}/drawing.svg`;
                    document.body.append(image);
                }
            }, url);
            await page.waitForFunction(() => [...document.images].every((image) => image.naturalWidth === 32));
            const colors = await page.evaluate(() => [...document.images].map((image) => {
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 32;
                const context = canvas.getContext("2d");
                context.drawImage(image, 0, 0);
                return [...context.getImageData(16, 16, 1, 1).data];
            }));
            assert.deepEqual(colors, [[255, 0, 0, 255], [255, 0, 0, 255]], "SVG styles must still render correctly");
            assert.equal(executed, 0, "SVG previews must never execute scripts or onload handlers");
            for (const source of ["upload-file", "cdn"]) {
                for (const id of ["drawing.svg", "page.html"]) {
                    const navigation = await context.newPage();
                    const download = navigation.waitForEvent("download");
                    await navigation.goto(`${url}/${source}/${id}`).catch((error) => {
                        if (!/download/i.test(error.message)) throw error;
                    });
                    assert.equal(await (await download).failure(), null);
                    await navigation.close();
                }
            }
            assert.equal(executed, 0, "Opening an uploaded file must never execute its contents");
            console.log(`${engineName} ${viewport.width}x${viewport.height}: SVG previews render; HTML/SVG download; no script execution`);
            await context.close();
        }
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
