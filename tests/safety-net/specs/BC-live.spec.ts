import type { Page } from "@playwright/test";
import { test, expect, wamRoom, join, isPhone, newPlayer, wa } from "../lib/game";
import {
    goLive,
    openBroadcast,
    openGoLive,
    otherWamRoom,
    panel,
    primeCard,
    saveSettings,
    turnOnBroadcast,
} from "../lib/bc";

async function setBar(page: Page, testId: "microphone-button" | "camera-button", on: boolean) {
    const button = page.getByTestId(testId);
    await expect(button).toHaveAttribute("data-state", /normal|forbidden/);
    if ((await button.getAttribute("data-state")) !== (on ? "normal" : "forbidden")) await button.click();
    await expect(button).toHaveAttribute("data-state", on ? "normal" : "forbidden");
}

async function setStatus(page: Page, status: "Online" | "Do not disturb") {
    await page.getByTestId("action-user").getByRole("button").first().click();
    await page.getByTestId("profile-menu").getByText(status, { exact: true }).click();
    if (await page.getByTestId("profile-menu").isVisible()) await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-menu")).toBeHidden();
}

/** Alice in a fresh room with broadcasting on (This room), and Bob in the same room far from her. */
async function speakerAndListener(
    page: Page,
    browser: Parameters<typeof newPlayer>[0],
    testInfo: Parameters<typeof wamRoom>[0]
) {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(page, () => WA.player.teleport(16, 16));
    await wa(bob, () => WA.player.teleport(300, 300));
    await openBroadcast(page);
    await turnOnBroadcast(page);
    return { url, bob };
}

function videosOutsidePanel(page: Page) {
    return page.locator("video").evaluateAll(
        (all) =>
            all.filter((video) => {
                const box = video.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && !video.closest('[data-testid="broadcast-panel"]');
            }).length
    );
}

test("BC-054 Go live: preview, You chip, mic/camera/screen buttons, mic and camera untouched at open, notice and Go live", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await setBar(page, "microphone-button", false);
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    // Go live never switches the mic or camera (Khalid 6 Oct 14:51Z, #627): the mic that was off stays off.
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");
    await expect(page.getByTestId("broadcast-live-mic")).toHaveAttribute("aria-pressed", "false");
    const preview = panel(page).locator(".aspect-\\[16\\/10\\]");
    const cameraOn = (await page.getByTestId("camera-button").getAttribute("data-state")) === "normal";
    if (cameraOn) {
        await expect(preview.locator("video")).toBeVisible();
        await expect(preview.locator("video")).toHaveCSS("transform", "matrix(-1, 0, 0, 1, 0, 0)");
    } else {
        await expect(preview.locator("svg").first()).toBeVisible();
    }
    await expect(preview.getByText("You", { exact: true })).toBeVisible();
    await expect(panel(page).getByText("Mic off", { exact: true })).toBeVisible();
    await expect(panel(page).getByText(cameraOn ? "Camera on" : "Camera off", { exact: true })).toBeVisible();
    await expect(panel(page).getByText("Share screen", { exact: true })).toBeVisible();
    for (const id of ["broadcast-live-mic", "broadcast-live-camera", "broadcast-live-screen"]) {
        await expect(page.getByTestId(id)).toHaveCSS("border-radius", /^(9999|26|50)/);
    }
    await expect(page.getByTestId("broadcast-go-live")).toHaveText("Go live");
    if (!cameraOn) {
        // Nothing is on yet: the notice says so and Go live waits.
        await expect(panel(page).locator("p.text-center")).toHaveText("Turn on your mic, camera or screen to go live.");
        await expect(page.getByTestId("broadcast-go-live")).toBeDisabled();
    }
    // The player turns the mic on here: the label, the bar and the notice follow, and Go live is ready.
    await page.getByTestId("broadcast-live-mic").click();
    await expect(page.getByTestId("broadcast-live-mic")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
    await expect(panel(page).getByText("Mic on", { exact: true })).toBeVisible();
    await expect(panel(page).locator("p.text-center")).toHaveText(/sees and hears you until you press End\.$/);
    await expect(page.getByTestId("broadcast-go-live")).toBeEnabled();
});

test("BC-055 Go live's mic and camera are the bar's mic and camera, with the violet ring when on", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await setBar(page, "camera-button", true);
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    const mic = page.getByTestId("broadcast-live-mic");
    const camera = page.getByTestId("broadcast-live-camera");
    await expect(mic).toHaveAttribute("data-live", "true");
    await expect(camera).toHaveAttribute("data-live", "true");
    await mic.click();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(mic).not.toHaveAttribute("data-live", "true");
    await camera.click();
    await expect(page.getByTestId("camera-button")).toHaveAttribute("data-state", "forbidden");
    await expect(camera).toHaveAttribute("aria-pressed", "false");
    await expect(camera).not.toHaveAttribute("data-live", "true");
    await mic.click();
    await camera.click();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
    await expect(page.getByTestId("camera-button")).toHaveAttribute("data-state", "normal");
    await expect(mic).toHaveAttribute("data-live", "true");
    await expect(camera).toHaveAttribute("data-live", "true");

    await page.getByTestId("microphone-button").click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
});

test("BC-056 Go live with the camera on shows one preview only (KNOWN GAP)", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await setBar(page, "camera-button", true);
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    await expect(panel(page).locator("video")).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await videosOutsidePanel(page)).toBe(0);
});

test("BC-057 With mic, camera and screen all off, Go live is disabled and says why", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    for (const id of ["broadcast-live-mic", "broadcast-live-camera", "broadcast-live-screen"] as const) {
        const button = page.getByTestId(id);
        if ((await button.getAttribute("aria-pressed")) === "true") await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.getByTestId("broadcast-go-live")).toBeDisabled();
    await expect(panel(page).locator("p.text-center")).toHaveText("Turn on your mic, camera or screen to go live.");
});

test("BC-058 Leaving Go live without touching the mic leaves it off; a mic turned on in the step stays on", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await setBar(page, "microphone-button", false);
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    // Go live never switched the mic on (Khalid 6 Oct 14:51Z, #627), so leaving has nothing to switch back.
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");

    await openGoLive(page);
    await page.getByTestId("broadcast-close").click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");

    await openBroadcast(page);
    await openGoLive(page);
    await page.getByTestId("broadcast-live-mic").click();
    await expect(page.getByTestId("broadcast-live-mic")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
    await page.getByTestId("broadcast-close").click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
});

test("BC-059 Desktop: going live with the screen only", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await openGoLive(page);
    for (const id of ["broadcast-live-mic", "broadcast-live-camera"] as const) {
        const button = page.getByTestId(id);
        if ((await button.getAttribute("aria-pressed")) === "true") await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "false");
    }
    await page.getByTestId("broadcast-live-screen").click();
    await expect(page.getByTestId("broadcast-live-screen")).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).getByText("Sharing", { exact: true })).toBeVisible();
    await page.getByTestId("broadcast-go-live").click();
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "forbidden");
});

test("BC-060 Go live closes the card and shows the Live pill with timer, reach and End", async ({ page }, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await expect(panel(page)).toBeHidden();
    const pill = page.getByTestId("broadcast-live-pill");
    await expect(pill.locator(".u-live-coral-dot")).toBeVisible();
    await expect(pill.getByText("Live", { exact: true })).toHaveCSS("text-transform", "uppercase");
    const timer = pill.locator(".tabular-nums");
    await expect(timer).toHaveText(/^0:0\d$/);
    await expect(timer).not.toHaveText("0:00", { timeout: 5_000 });
    await expect(pill).toContainText("This room · ");
    await expect(page.getByTestId("broadcast-end-live")).toHaveText("End");
    await expect(page.getByTestId("broadcast-end-live")).toHaveClass(/u-cta-coral/);
    const box = await pill.boundingBox();
    if (!box) throw new Error("no pill box");
    if (isPhone(testInfo)) {
        expect(Math.round(box.x)).toBe(12);
        expect(Math.round(box.y)).toBe(12);
        expect(Math.round(box.width)).toBe(428 - 24);
    } else {
        expect(Math.round(box.x)).toBe(16);
        expect(Math.round(box.y)).toBe(80);
        expect(Math.round(box.width)).toBe(380);
    }
});

test("BC-061 While live: own tile with the violet ring and LIVE tag, bar mic and camera ringed", async ({
    page,
}, testInfo) => {
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await setBar(page, "camera-button", true);
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await expect(page.locator(".u-live-tile").first()).toBeVisible();
    await expect(page.getByTestId("live-tag").first()).toHaveText(/live/i);
    await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-live", "true");
    await expect(page.getByTestId("camera-button")).toHaveAttribute("data-live", "true");
});

test("BC-062 A listener in the room gets the Announcement and A's live tile", async ({ page, browser }, testInfo) => {
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await expect(bob.getByTestId("live-tag")).toHaveCount(0);
    await goLive(page);
    await expect(bob.locator(".notification-playing")).toContainText("Announcement", { timeout: 30_000 });
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await expect(bob.locator(".u-live-tile").filter({ has: bob.getByTestId("live-tag") })).toHaveCount(1);
    const tile = bob
        .locator("div")
        .filter({ has: bob.getByTestId("live-tag") })
        .filter({ hasText: "Alice" });
    await expect(tile.first()).toBeVisible();
});

test("BC-063 Players in a bubble elsewhere see the live tile next to their bubble", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    await wa(page, () => WA.player.teleport(16, 16));
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    const carol = await newPlayer(browser, testInfo, url, "Carol");
    await wa(bob, () => WA.player.teleport(288, 288));
    await wa(carol, () => WA.player.teleport(288, 288));
    await expect(bob.getByText("Carol").first()).toBeVisible({ timeout: 30_000 });
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    for (const [listener, other] of [
        [bob, "Carol"],
        [carol, "Bob"],
    ] as const) {
        await expect(listener.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
        await expect(
            listener
                .locator("div")
                .filter({ has: listener.getByTestId("live-tag") })
                .filter({ hasText: "Alice" })
                .first()
        ).toBeVisible();
        await expect(listener.getByText(other).first()).toBeVisible();
    }
});

test("BC-064 Going live keeps your bubble", async ({ page, browser }, testInfo) => {
    test.setTimeout(240_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const sara = await newPlayer(browser, testInfo, url, "Sara");
    await wa(page, () => WA.player.teleport(160, 160));
    await wa(sara, () => WA.player.teleport(176, 160));
    await expect(page.getByText("Sara").first()).toBeVisible({ timeout: 30_000 });
    await expect(sara.getByText("Alice").first()).toBeVisible({ timeout: 30_000 });
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await page.waitForTimeout(2_000);
    await expect(page.getByText("Sara").first()).toBeVisible();
    await expect(sara.getByText("Alice").first()).toBeVisible();
});

test("BC-065 World reach: a player in another room of the world sees the live tile", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const first = await wamRoom(testInfo, "empty");
    const second = await otherWamRoom(testInfo, "b");
    await join(page, first, "Alice");
    const bob = await newPlayer(browser, testInfo, second, "Bob");
    await openBroadcast(bob);
    await turnOnBroadcast(bob, { far: "WORLD" });
    await bob.getByTestId("broadcast-close").click();
    await openBroadcast(page);
    await turnOnBroadcast(page, { far: "WORLD" });
    await goLive(page, "WORLD");
    await expect(page.getByTestId("broadcast-live-pill")).toContainText("This world");
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
});

test("BC-067 End stops the broadcast: pill, ring and the listener's tile go", async ({ page, browser }, testInfo) => {
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await goLive(page);
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("broadcast-end-live")).toHaveAttribute("title", "End the live broadcast");
    await page.getByTestId("broadcast-end-live").click();
    await expect(page.getByTestId("broadcast-live-pill")).toBeHidden();
    await expect(page.getByTestId("live-tag")).toHaveCount(0);
    await expect(bob.getByTestId("live-tag")).toHaveCount(0, { timeout: 30_000 });
});

test("BC-068 Turning mic, camera and screen off from the bar ends the broadcast", async ({
    page,
    browser,
}, testInfo) => {
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await goLive(page);
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await setBar(page, "microphone-button", false);
    await setBar(page, "camera-button", false);
    await expect(page.getByTestId("broadcast-live-pill")).toBeHidden();
    await expect(bob.getByTestId("live-tag")).toHaveCount(0, { timeout: 30_000 });
});

test("BC-069 Narrowing How far to This room while live on This world ends the broadcast", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180_000);
    const url = await wamRoom(testInfo, "empty");
    await join(page, url, "Alice");
    const bob = await newPlayer(browser, testInfo, url, "Bob");
    await wa(page, () => WA.player.teleport(16, 16));
    await wa(bob, () => WA.player.teleport(300, 300));
    await openBroadcast(page);
    await turnOnBroadcast(page, { far: "WORLD" });
    await goLive(page, "WORLD");
    await expect(page.getByTestId("broadcast-live-pill")).toContainText("This world");
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await openBroadcast(bob);
    await saveSettings(bob, { who: "everyone", far: "ROOM" });
    await expect(page.getByTestId("broadcast-live-pill")).toBeHidden({ timeout: 30_000 });
    await expect(bob.getByTestId("live-tag")).toHaveCount(0, { timeout: 30_000 });
});

test("BC-070 A listener on Do not disturb loses the live tile and gets it back on Online", async ({
    page,
    browser,
}, testInfo) => {
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await goLive(page);
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await setStatus(bob, "Do not disturb");
    await expect(bob.getByTestId("live-tag")).toHaveCount(0, { timeout: 30_000 });
    await setStatus(bob, "Online");
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
});

test("BC-071 The speaker setting Do not disturb stays live", async ({ page, browser }, testInfo) => {
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await goLive(page);
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await setStatus(page, "Do not disturb");
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
    await expect(bob.getByTestId("live-tag")).toBeVisible();
});

test("BC-072 Reloading while live ends the broadcast", async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const { bob } = await speakerAndListener(page, browser, testInfo);
    await goLive(page);
    await expect(bob.getByTestId("live-tag")).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "commit" });
    await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("broadcast-live-pill")).toHaveCount(0);
    await expect(page.getByTestId("live-tag")).toHaveCount(0);
    await expect(bob.getByTestId("live-tag")).toHaveCount(0, { timeout: 30_000 });
});

test("BC-074 @local Phone: a received card stacks below the Live pill", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    await join(page, await wamRoom(testInfo, "empty"), "Alice");
    await openBroadcast(page);
    await turnOnBroadcast(page);
    await goLive(page);
    await primeCard(page, { senderName: "Khalid", reach: "room", reachLabel: "Main Hall", html: "<p>Hello</p>" });
    const inbox = page.getByTestId("broadcast-inbox");
    await expect(inbox).toBeVisible();
    const inboxBox = await inbox.boundingBox();
    const pillBox = await page.getByTestId("broadcast-live-pill").boundingBox();
    if (!inboxBox || !pillBox) throw new Error("missing boxes");
    expect(Math.round(inboxBox.y)).toBe(80);
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(inboxBox.y);
});
