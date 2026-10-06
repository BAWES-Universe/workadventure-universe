import type { Page } from "@playwright/test";
import { test, expect, wamRoom, join, isPhone, wa } from "../lib/game";
import { openBroadcast, panel, primeAdmin, wavBuffer } from "../lib/bc";

const WAVE_COLOURS = ["rgb(52, 211, 153)", "rgb(251, 191, 36)", "rgb(248, 113, 113)"];

async function openCompose(page: Page, kind: "message" | "voice", testInfo: Parameters<typeof wamRoom>[0]) {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await primeAdmin(page);
    await page.getByTestId(`broadcast-kind-${kind}`).click();
    await page.getByTestId("broadcast-reach-ROOM").click();
    await page.getByTestId("broadcast-next").click();
}

/** Starts a voice take: presses Record when the step has one, then waits until it records. */
async function record(page: Page) {
    const recordButton = panel(page).getByRole("button", { name: "Record", exact: true });
    if (await recordButton.isVisible()) await recordButton.click();
    await expect(page.getByTestId("broadcast-voice-stop")).toBeEnabled();
}

async function recordTake(page: Page, seconds: number) {
    await record(page);
    await expect(panel(page).locator(".text-3xl")).toHaveText(`0:0${seconds}`, { timeout: 10_000 });
    await page.getByTestId("broadcast-voice-stop").click();
    await expect(panel(page).getByText("Listen before you send")).toBeVisible();
}

const wav = (seconds: number) => ({ name: "tone.wav", mimeType: "audio/wav", buffer: wavBuffer(seconds) });

test("BC-037 @local Write a message: the rich editor with its full toolbar, focused, keys stay out of the game", async ({
    page,
}, testInfo) => {
    await openCompose(page, "message", testInfo);
    const editor = page.getByTestId("broadcast-text-editor");
    await expect(editor).toBeVisible();
    const toolbar = editor.locator(".ql-toolbar");
    for (const selector of [
        ".ql-bold",
        ".ql-italic",
        ".ql-underline",
        ".ql-strike",
        ".ql-blockquote",
        ".ql-code-block",
        'button.ql-header[value="1"]',
        'button.ql-header[value="2"]',
        '.ql-list[value="ordered"]',
        '.ql-list[value="bullet"]',
        '.ql-script[value="sub"]',
        '.ql-script[value="super"]',
        '.ql-indent[value="-1"]',
        '.ql-indent[value="+1"]',
        ".ql-direction",
        ".ql-picker.ql-size",
        ".ql-picker.ql-header",
        ".ql-picker.ql-color",
        ".ql-picker.ql-background",
        ".ql-picker.ql-font",
        ".ql-picker.ql-align",
        ".ql-clean",
        ".ql-link",
        ".ql-image",
        ".ql-video",
    ]) {
        await expect(toolbar.locator(selector).first(), selector).toBeVisible();
    }
    const field = editor.locator(".ql-editor");
    await expect(field).toHaveAttribute("data-placeholder", "Write your message");
    await expect(field).toBeFocused();

    const start = await wa(page, () => WA.player.getPosition());
    await page.keyboard.type("hello world");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowRight");
    await expect(field).toContainText("hello world");
    const end = await wa(page, () => WA.player.getPosition());
    expect(end).toEqual(start);
});

test("BC-038 @local Sending an empty message shows Write something first. and keeps the card", async ({
    page,
}, testInfo) => {
    await openCompose(page, "message", testInfo);
    await page.getByTestId("broadcast-send").click();
    const error = panel(page).getByRole("alert");
    await expect(error).toHaveText("Write something first.");
    await error.getByRole("button", { name: "Close" }).click();
    await expect(error).toBeHidden();
    await page.locator(".ql-editor").click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("   ");
    await page.getByTestId("broadcast-send").click();
    await expect(panel(page).getByRole("alert")).toHaveText("Write something first.");
    await expect(page.getByTestId("broadcast-text-editor")).toBeVisible();
});

test("BC-042 @local Voice note: nothing records until Record is pressed (KNOWN GAP)", async ({ page }, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await expect(panel(page).getByRole("dialog", { name: "Voice note" })).toBeVisible();
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("broadcast-voice-stop")).not.toBeEnabled();
    await expect(panel(page).getByRole("button", { name: "Record", exact: true })).toBeVisible();
});

test("BC-043 @local While recording: timer, coloured wave, coral stop, Use a file", async ({ page }, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await record(page);
    await expect(panel(page).locator(".text-3xl")).toHaveText(/^\d+:\d\d$/);
    await expect(panel(page).locator(".text-3xl")).not.toHaveText("0:00", { timeout: 5_000 });
    const stop = page.getByTestId("broadcast-voice-stop");
    await expect(stop).toHaveAttribute("aria-label", "Recording. Tap to stop.");
    await expect(stop).toHaveClass(/u-cta-coral/);
    await expect(stop).toHaveCSS("border-radius", /^(9999|44|50)/);
    const bars = panel(page).locator(".text-3xl + div > span");
    await expect.poll(() => bars.count()).toBeGreaterThan(5);
    const colours = await bars.evaluateAll((all) => all.map((bar) => getComputedStyle(bar).backgroundColor));
    for (const colour of colours) expect(WAVE_COLOURS).toContain(colour);
    await expect(panel(page).getByText("Recording. Tap to stop.", { exact: true })).toBeVisible();
    await expect(panel(page).getByText("Have something ready?")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Use a file" })).toBeVisible();
});

test("BC-044 BC-045 @local Review: listen, play/pause, record again, caption, Send to <reach>", async ({
    page,
}, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await recordTake(page, 2);
    const play = page.getByTestId("broadcast-voice-play");
    await expect(play).toHaveAttribute("aria-label", "Play");
    await expect(panel(page).locator(".tabular-nums").last()).toHaveText(/^0:0[1-3]$/);
    await expect(panel(page).getByRole("button", { name: "Record again" })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Use a file" })).toBeVisible();
    const caption = page.getByTestId("broadcast-voice-caption");
    await expect(caption).toHaveAttribute("placeholder", "Add a line of text (optional)");
    await expect(caption).toHaveAttribute("maxlength", "200");
    await expect(page.getByTestId("broadcast-send")).toHaveText("Send to This room");

    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Pause");
    const playing = await panel(page)
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => !audio.paused);
    expect(playing).toBe(true);
    await play.click();
    await expect(play).toHaveAttribute("aria-label", "Play");
    expect(
        await panel(page)
            .locator("audio")
            .evaluate((audio: HTMLAudioElement) => audio.paused)
    ).toBe(true);
});

test("BC-046 @local Recording stops by itself at 3:00 and goes to review", async ({ page }, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await page.clock.install();
    await record(page);
    await page.clock.fastForward(181_000);
    await expect(panel(page).getByText("Listen before you send")).toBeVisible({ timeout: 30_000 });
});

test("BC-047 @local A blocked microphone says so and offers Record again and Use a file", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await page.evaluate(() => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) =>
            constraints?.audio && !constraints.video
                ? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
                : original(constraints);
    });
    await openBroadcast(page);
    await primeAdmin(page);
    await page.getByTestId("broadcast-kind-voice").click();
    await page.getByTestId("broadcast-reach-ROOM").click();
    await page.getByTestId("broadcast-next").click();
    const recordButton = panel(page).getByRole("button", { name: "Record", exact: true });
    if (await recordButton.isVisible()) await recordButton.click();
    await expect(
        panel(page).getByText("Your microphone is blocked. Allow it in your browser, or use a file.")
    ).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Record again" })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Use a file" })).toBeVisible();
});

test("BC-048 @local Use a file: an audio file goes to review with its wave and duration, and plays", async ({
    page,
}, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await page.getByTestId("broadcast-voice-file").setInputFiles(wav(4));
    await expect(panel(page).getByText("Listen before you send")).toBeVisible();
    await expect(panel(page).locator(".tabular-nums").last()).toHaveText("0:04");
    await expect(panel(page).locator("h3 + div span.rounded-full")).not.toHaveCount(0);
    await page.getByTestId("broadcast-voice-play").click();
    await expect(page.getByTestId("broadcast-voice-play")).toHaveAttribute("aria-label", "Pause");
});

test("BC-049 @local A text file or an audio file over 10 MiB is refused and the step stays", async ({
    page,
}, testInfo) => {
    await openCompose(page, "voice", testInfo);
    const input = page.getByTestId("broadcast-voice-file");
    const before = await panel(page).getByText("Listen before you send").count();
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not audio") });
    await expect(panel(page).getByRole("alert")).toHaveText("That isn't an audio file. Use an MP3, WAV or OGG.");
    expect(await panel(page).getByText("Listen before you send").count()).toBe(before);
    await panel(page).getByRole("alert").getByRole("button", { name: "Close" }).click();

    await input.setInputFiles({
        name: "big.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1024),
    });
    await expect(panel(page).getByRole("alert")).toHaveText("That isn't an audio file. Use an MP3, WAV or OGG.");
    expect(await panel(page).getByText("Listen before you send").count()).toBe(before);
});

test("BC-050 @local Desktop: an audio file dropped on the Voice step is taken like Use a file", async ({
    page,
}, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await openCompose(page, "voice", testInfo);
    await expect(panel(page).getByRole("button", { name: "Use a file" })).toBeVisible();
    const bytes = [...wavBuffer(3)];
    await page.getByTestId("broadcast-voice-drop").evaluate((wrapper, data) => {
        const target = wrapper.querySelector("button, p, span") ?? wrapper;
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(data)], "dropped.wav", { type: "audio/wav" }));
        target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    await expect(panel(page).getByText("Listen before you send")).toBeVisible();
    await expect(panel(page).locator(".tabular-nums").last()).toHaveText("0:03");
});

test("BC-051 @local Record again replaces the take once the new recording stops", async ({ page }, testInfo) => {
    await openCompose(page, "voice", testInfo);
    await page.getByTestId("broadcast-voice-file").setInputFiles(wav(5));
    await expect(panel(page).locator(".tabular-nums").last()).toHaveText("0:05");
    await panel(page).getByRole("button", { name: "Record again" }).click();
    await expect(page.getByTestId("broadcast-voice-stop")).toBeEnabled();
    await expect(panel(page).locator(".text-3xl")).toHaveText("0:01", { timeout: 10_000 });
    await page.getByTestId("broadcast-voice-stop").click();
    await expect(panel(page).getByText("Listen before you send")).toBeVisible();
    await expect(panel(page).locator(".tabular-nums").last()).toHaveText(/^0:0[1-2]$/);
});
