import { test, expect, roomUrl, isPhone, inRoom, join } from "../lib/game";
import {
    activeTiles,
    blockMedia,
    builderSelection,
    cameraHeading,
    canvasPicture,
    deviceSelect,
    deviceShown,
    checkedTile,
    continueButton,
    nameInput,
    openCameraScreen,
    openDeviceList,
    openMenu,
    profileMenu,
    openNameScreen,
    openWokaBuilder,
    openWokaPicker,
    pickOtherDevice,
    playedSounds,
    recordSounds,
    serveManyCollections,
    swipe,
    wokaTiles,
} from "../lib/jn";

test.describe("Join: name", () => {
    test("JN-001 Desktop name card on first visit", async ({ page }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await openNameScreen(page, roomUrl(testInfo));
        const card = page.locator(".u-join-card");
        await expect(page.locator(".u-join-card img.main-logo")).toBeVisible();
        await expect(card.locator(".u-join-spot")).toBeVisible();
        await expect(card.getByText("Edit your name", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "What should people call you?" })).toBeVisible();
        await expect(nameInput(page)).toBeFocused();
        await expect(nameInput(page)).toHaveAttribute("placeholder", "Enter your name");
        await expect(card.locator(".name-count")).toHaveText("0/32");
        await expect(card.getByText("Everyone in the room sees this above your WOKA.")).toBeVisible();
        await expect(page.locator("button.loginSceneFormSubmit")).toHaveText("Continue");
        await expect(page.getByTestId("loginSceneBack")).toHaveCount(0);
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        if (!box) return;
        expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(4);
        expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(10);
        expect(Math.round(box.width)).toBe(440);
    });

    test("JN-002 Phone name card pinned near the top", async ({ page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openNameScreen(page, roomUrl(testInfo));
        const card = page.locator(".u-join-card");
        await expect(page.getByRole("heading", { name: "What should people call you?" })).toBeVisible();
        await expect(card.locator(".name-count")).toHaveText("0/32");
        await expect(page.getByTestId("loginSceneBack")).toHaveCount(0);
        const box = await card.boundingBox();
        const logo = await card.locator("img.main-logo").boundingBox();
        const submit = await page.locator("button.loginSceneFormSubmit").boundingBox();
        expect(box && logo && submit).toBeTruthy();
        if (!box || !logo || !submit) return;
        expect(Math.abs(box.y - 60)).toBeLessThan(3);
        expect(box.width).toBeGreaterThan(428 - 2 * 16 - 2);
        expect(Math.round(logo.width)).toBe(150);
        expect(submit.width).toBeGreaterThan(box.width - 2 * 24);
    });

    test("JN-003 Counter follows typing and Enter goes to the WOKA picker", async ({ page }, testInfo) => {
        await openNameScreen(page, roomUrl(testInfo));
        await nameInput(page).pressSequentially("Alice");
        await expect(page.locator(".name-count")).toHaveText("5/32");
        await nameInput(page).press("Enter");
        await expect(page.locator("button.selectCharacterSceneFormSubmit")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
    });

    test("JN-004 Empty name shows the error and disables Continue", async ({ page }, testInfo) => {
        await openNameScreen(page, roomUrl(testInfo));
        const submit = page.locator("button.loginSceneFormSubmit");
        await submit.click();
        const error = page.locator("p.u-join-error");
        await expect(error).toHaveText("The name is empty");
        await expect(error.locator("svg")).toBeVisible();
        await expect(page.getByText("Everyone in the room sees this above your WOKA.")).toBeHidden();
        await expect(nameInput(page)).toHaveAttribute("aria-invalid", "true");
        await expect(page.locator(".u-join-field-error")).toHaveCount(1);
        await expect(submit).toBeDisabled();
        await nameInput(page).pressSequentially("B");
        await expect(error).toBeHidden();
        await expect(nameInput(page)).toHaveAttribute("aria-invalid", "false");
        await expect(submit).toBeEnabled();
        await nameInput(page).fill("");
        await nameInput(page).pressSequentially("   ");
        await expect(error).toHaveText("The name is empty");
        await expect(submit).toBeDisabled();
    });

    test("JN-005 Name stops at 32 characters", async ({ page }, testInfo) => {
        await openNameScreen(page, roomUrl(testInfo));
        await expect(nameInput(page)).toHaveAttribute("maxlength", "32");
        await nameInput(page).pressSequentially("abcdefghij".repeat(4));
        await expect(nameInput(page)).toHaveValue("abcdefghij".repeat(4).slice(0, 32));
        await expect(page.locator(".name-count")).toHaveText("32/32");
    });
});

test.describe("Join: WOKA picker", () => {
    test("JN-008 Desktop WOKA picker card", async ({ page }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await openWokaPicker(page, roomUrl(testInfo));
        const card = page.locator(".u-join-card");
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        if (!box) return;
        expect(Math.round(box.width)).toBe(1000);
        expect(Math.round(box.height)).toBe(680);
        await expect(card.getByText("Customize your avatar", { exact: true }).filter({ visible: true })).toHaveCount(1);
        await expect(card.getByRole("button", { name: "Rotate" })).toBeVisible();
        await expect(card.getByRole("button", { name: "Randomize" })).toBeVisible();
        await expect(card.locator("p.u-join-hint")).toContainText("to browse");
        await expect(card.locator("p.u-join-hint")).toContainText("Enter");
        await expect(card.locator("p.u-join-hint")).toContainText("to save");
        await expect(checkedTile(page)).toHaveCount(1);
        await expect(checkedTile(page).locator(".u-join-tile-check")).toBeVisible();
        const columns = await page
            .locator("#woka-grid")
            .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(6);
        await expect(page.locator("button.wokaBuildButton span:visible")).toHaveText("Build your WOKA");
        await expect(page.locator("button.wokaBuildButton svg")).toBeVisible();
        await expect(page.locator("button.selectCharacterSceneFormSubmit")).toHaveText("Continue");
        // One collection on the local stack: no pills.
        await expect(page.getByRole("tab")).toHaveCount(0);
        const tile = wokaTiles(page).first().locator("canvas");
        // Khalid 10-06 (dev findings, item 21): the preview no longer turns on its own, only when you press Rotate.
        // (The row still describes the old 2.4 s loop.) Wait two turns' worth, then check nothing moved.
        const before = await canvasPicture(tile);
        await page.waitForTimeout(5_000);
        expect(await canvasPicture(tile), "tiles must not turn on their own").toBe(before);
        await card.getByRole("button", { name: "Rotate" }).click();
        await expect.poll(() => canvasPicture(tile), { message: "Rotate turns the tiles" }).not.toBe(before);
    });

    test("JN-008 JN-013 Collection pills with counts, switching and the More arrow", async ({ page }, testInfo) => {
        await serveManyCollections(page);
        await openWokaPicker(page, roomUrl(testInfo));
        const tabs = page.getByRole("tab");
        await expect(tabs).toHaveCount(9);
        await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
        await expect(tabs.first().locator("b.woka-count")).toHaveText(String(await wokaTiles(page).count()));
        await expect(tabs.nth(1).locator("b.woka-count")).toHaveText("3");
        await activeTiles(page).evaluate((node) => (node.scrollTop = node.scrollHeight));
        await expect.poll(() => activeTiles(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
        await tabs.nth(1).click();
        await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
        await expect(tabs.first()).toHaveAttribute("aria-selected", "false");
        await expect(wokaTiles(page)).toHaveCount(3);
        await expect(wokaTiles(page).first()).toHaveAttribute("id", /^woka-copy-1-/);
        await expect.poll(() => activeTiles(page).evaluate((node) => node.scrollTop)).toBe(0);
        const more = page.getByRole("button", { name: "More" });
        await expect(more).toBeVisible();
        await expect(page.locator(".woka-pills-more")).toHaveCount(1);
        const pills = page.locator(".woka-pills");
        const scrollBefore = await pills.evaluate((node) => node.scrollLeft);
        await more.click();
        await expect.poll(() => pills.evaluate((node) => node.scrollLeft)).toBeGreaterThan(scrollBefore);
    });

    test("JN-009 Phone WOKA picker card", async ({ page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openWokaPicker(page, roomUrl(testInfo));
        await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
        await expect(page.getByText("Customize your avatar", { exact: true }).first()).toBeVisible();
        const card = await page.locator(".u-join-card").boundingBox();
        expect(card).not.toBeNull();
        if (!card) return;
        expect(Math.round(card.x)).toBe(0);
        expect(Math.round(card.width)).toBe(428);
        const columns = await page
            .locator("#woka-grid")
            .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(4);
        await expect(page.locator("button.wokaBuildButton span:visible")).toHaveText("Build");
        await expect(page.locator("button.wokaBuildButton").getByText("Build your WOKA")).toBeHidden();
        await expect(page.locator("button.selectCharacterSceneFormSubmit")).toHaveText("Continue");
        await expect(page.locator(".u-join-card p.u-join-hint")).toBeHidden();
        await expect(page.getByRole("button", { name: "Rotate" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Randomize" })).toBeVisible();
    });

    test("JN-009 Phone swipe changes the collection", async ({ page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await serveManyCollections(page);
        await openWokaPicker(page, roomUrl(testInfo));
        await expect(page.locator(".woka-swipe-hint")).toHaveText("swipe the tiles for the next collection");
        const tabs = page.getByRole("tab");
        await swipe(activeTiles(page), -120);
        await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
        await swipe(activeTiles(page), 120);
        await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
        await swipe(activeTiles(page), -40);
        await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    });

    test("JN-010 Picking a tile, arrow keys and Enter", async ({ page }, testInfo) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openWokaPicker(page, roomUrl(testInfo));
        const preview = page.locator(".woka-spot canvas");
        await expect(checkedTile(page)).toHaveId((await wokaTiles(page).first().getAttribute("id")) ?? "");
        const previewBefore = await canvasPicture(preview);
        await wokaTiles(page).nth(2).click();
        await expect(wokaTiles(page).nth(2)).toHaveAttribute("aria-checked", "true");
        await expect(wokaTiles(page).nth(2).locator(".u-join-tile-check")).toBeVisible();
        await expect(checkedTile(page)).toHaveCount(1);
        await expect
            .poll(() => canvasPicture(preview), { message: "preview shows the picked WOKA" })
            .not.toBe(previewBefore);
        if (isPhone(testInfo)) return;
        await page.keyboard.press("ArrowRight");
        await expect(wokaTiles(page).nth(3)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("ArrowDown");
        await expect(wokaTiles(page).nth(9)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("ArrowUp");
        await expect(wokaTiles(page).nth(3)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("ArrowLeft");
        await expect(wokaTiles(page).nth(2)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("Enter");
        await expect(cameraHeading(page)).toBeVisible();
    });

    test("JN-011 Rotate turns the tiles a quarter and stops the automatic turning", async ({ page }, testInfo) => {
        await openWokaPicker(page, roomUrl(testInfo));
        const tile = wokaTiles(page).first().locator("canvas");
        const rotate = page.getByRole("button", { name: "Rotate" });
        await rotate.click();
        const pictures = [await canvasPicture(tile)];
        for (let i = 1; i <= 4; i++) {
            await rotate.click();
            if (i < 4) {
                await expect.poll(() => canvasPicture(tile)).not.toBe(pictures[i - 1]);
                pictures.push(await canvasPicture(tile));
            }
        }
        expect(new Set(pictures).size).toBe(4);
        await expect
            .poll(() => canvasPicture(tile), { message: "four turns come back to the start" })
            .toBe(pictures[0]);
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(3_000);
        expect(await canvasPicture(tile), "no automatic turn after Rotate").toBe(pictures[0]);
    });

    test("JN-012 Randomize picks a WOKA from any collection", async ({ page }, testInfo) => {
        await serveManyCollections(page);
        await openWokaPicker(page, roomUrl(testInfo));
        const randomize = page.getByRole("button", { name: "Randomize" });
        const tabs = page.getByRole("tab");
        const seenTabs = new Set<string>();
        const seenTiles = new Set<string>();
        for (let i = 0; i < 12; i++) {
            await randomize.click();
            await expect(checkedTile(page)).toHaveCount(1);
            await expect(checkedTile(page)).toBeInViewport();
            seenTiles.add((await checkedTile(page).getAttribute("id")) ?? "");
            seenTabs.add((await page.locator("[role=tab][aria-selected=true]").innerText()).trim());
        }
        await expect(tabs.first()).toBeVisible();
        expect(seenTiles.size).toBeGreaterThan(1);
        expect(seenTabs.size, "the active pill follows the random pick").toBeGreaterThan(0);
        const active = page.locator("[role=tab][aria-selected=true]");
        const activeIndex = await tabs.evaluateAll((all) =>
            all.findIndex((t) => t.getAttribute("aria-selected") === "true")
        );
        const id = (await checkedTile(page).getAttribute("id")) ?? "";
        if (activeIndex === 0) expect(id).not.toMatch(/^woka-copy-[1-8]-/);
        else expect(id).toMatch(new RegExp(`^woka-copy-${activeIndex}-`));
        await expect(active).toHaveCount(1);
    });

    test("JN-014 Long tile list is cut half way through a row, with a fade and scroll bar", async ({
        page,
    }, testInfo) => {
        await openWokaBuilder(page, roomUrl(testInfo));
        await page.getByRole("tab", { name: "Hair" }).click();
        await expect(wokaTiles(page)).toHaveCount(74);
        const box = page.locator(".woka-tiles");
        await expect(box).toHaveClass(/woka-tiles-more/);
        await expect(page.locator(".woka-scrollbar")).toBeVisible();
        const fraction = await activeTiles(page).evaluate((scroller) => {
            const grid = scroller.firstElementChild as HTMLElement;
            const tile = grid.firstElementChild as HTMLElement;
            const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
            const padding = parseFloat(getComputedStyle(grid).paddingTop) || 0;
            const rows = (scroller.clientHeight - padding + gap) / (tile.offsetHeight + gap);
            return rows - Math.floor(rows);
        });
        expect(fraction).toBeGreaterThanOrEqual(0.2);
        expect(fraction).toBeLessThanOrEqual(0.8);
        await activeTiles(page).evaluate((node) => (node.scrollTop = node.scrollHeight));
        await expect(box).not.toHaveClass(/woka-tiles-more/);
        await expect(wokaTiles(page).last()).toBeInViewport();
    });

    test("JN-015 WOKA list failure shows Retry, which reloads it", async ({ page }, testInfo) => {
        let block = true;
        await page.route("**/woka/list*", (route) => (block ? route.abort() : route.continue()));
        await openNameScreen(page, roomUrl(testInfo));
        await nameInput(page).fill("Alice");
        await continueButton(page).click();
        await expect(page.getByText("The WOKAs didn't load.")).toBeVisible();
        await expect(wokaTiles(page)).toHaveCount(0);
        block = false;
        await page.getByRole("button", { name: "Retry" }).click();
        await expect(wokaTiles(page).first()).toBeVisible();
        await expect(page.getByText("The WOKAs didn't load.")).toBeHidden();
    });

    test("JN-016 Continue saves the WOKA and opens the camera screen", async ({ page }, testInfo) => {
        await openWokaPicker(page, roomUrl(testInfo));
        await wokaTiles(page).nth(4).click();
        const id = ((await wokaTiles(page).nth(4).getAttribute("id")) ?? "").replace(/^woka-/, "");
        await page.locator("button.selectCharacterSceneFormSubmit").click();
        await expect(cameraHeading(page)).toBeVisible();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("characterTextures") ?? "null"));
        expect(saved).toEqual([id]);
    });
});

test.describe("Join: Build your WOKA", () => {
    test("JN-017 Build your WOKA card", async ({ page }, testInfo) => {
        await openWokaBuilder(page, roomUrl(testInfo));
        const card = page.locator(".u-join-card");
        await expect(card.getByText("Build your WOKA", { exact: true }).filter({ visible: true })).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Make it yours" }).first()).toBeVisible();
        await expect(page.getByRole("tab")).toHaveText(["Body", "Eyes", "Hair", "Clothes", "Hat", "Accessory"]);
        for (const tab of await page.getByRole("tab").all()) await expect(tab.locator("svg")).toHaveCount(1);
        await expect(page.getByRole("tab", { name: "Body" })).toHaveAttribute("aria-selected", "true");
        // Khalid 10-06 (dev findings, item 21): this button is not a "Back", Build and the ready-made picker are two
        // modes. The build relabels it "Ready-made WOKAs" (phone: "Ready-made"), with a grid icon. The row still says "Back".
        await expect(page.locator("button.wokaBuildBack span:visible")).toHaveText(
            isPhone(testInfo) ? "Ready-made" : "Ready-made WOKAs"
        );
        await expect(page.locator("button.wokaBuildBack svg")).toBeVisible();
        await expect(page.locator("button.selectCharacterSceneFormSubmit")).toHaveText("Finish");
        if (!isPhone(testInfo)) {
            await expect(card.locator("p.u-join-hint")).toContainText("Part 1 of 6");
            await expect(card.locator("p.u-join-hint")).toContainText("next part");
        }
    });

    test("JN-018 Picking a part changes only that part; Enter walks the parts and saves", async ({
        page,
    }, testInfo) => {
        await openWokaBuilder(page, roomUrl(testInfo));
        const before = await builderSelection(page);
        await page.getByRole("tab", { name: "Hair" }).click();
        const hairTile = wokaTiles(page).nth(5);
        await hairTile.click();
        await expect(hairTile).toHaveAttribute("aria-checked", "true");
        const hairId = (await hairTile.getAttribute("id")) ?? "";
        expect(hairId).not.toBe(before.Hair);
        const after = await builderSelection(page);
        expect(after).toEqual({ ...before, Hair: hairId });
        if (isPhone(testInfo)) return;
        await page.getByRole("tab", { name: "Hair" }).click();
        await page.keyboard.press("ArrowRight");
        await expect(wokaTiles(page).nth(6)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("ArrowDown");
        await expect(wokaTiles(page).nth(12)).toHaveAttribute("aria-checked", "true");
        await wokaTiles(page).nth(4).click();
        await expect(wokaTiles(page).nth(4)).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tab", { name: "Clothes" })).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tab", { name: "Hat" })).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Enter");
        await expect(page.getByRole("tab", { name: "Accessory" })).toHaveAttribute("aria-selected", "true");
        await expect(page.locator(".u-join-card p.u-join-hint")).toContainText("Part 6 of 6");
        await page.keyboard.press("Enter");
        await expect(cameraHeading(page)).toBeVisible();
        const saved: string[] = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("characterTextures") ?? "[]")
        );
        expect(saved).toHaveLength(6);
    });

    test("JN-019 Build: Randomize changes the parts, Rotate turns the tiles", async ({ page }, testInfo) => {
        await openWokaBuilder(page, roomUrl(testInfo));
        const before = await builderSelection(page);
        await page.getByRole("button", { name: "Randomize" }).click();
        const after = await builderSelection(page);
        const changed = Object.keys(before).filter((part) => before[part] !== after[part]);
        expect(changed.length).toBeGreaterThanOrEqual(3);
        const tile = wokaTiles(page).first().locator("canvas");
        await page.getByRole("button", { name: "Rotate" }).click();
        const turned = await canvasPicture(tile);
        await page.getByRole("button", { name: "Rotate" }).click();
        await expect.poll(() => canvasPicture(tile)).not.toBe(turned);
    });

    test("JN-020 Phone: swiping the tiles opens the next part", async ({ page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openWokaBuilder(page, roomUrl(testInfo));
        await expect(page.locator(".woka-swipe-hint")).toHaveText("swipe the tiles for the next part");
        await swipe(activeTiles(page), -120);
        await expect(page.getByRole("tab", { name: "Eyes" })).toHaveAttribute("aria-selected", "true");
        const pills = page.locator(".woka-pills");
        const overflows = await pills.evaluate((node) => node.scrollWidth > node.clientWidth + 2);
        expect(overflows, "six parts do not fit across a phone").toBe(true);
        await expect(page.locator(".woka-pills-more")).toHaveCount(1);
        await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    });

    test("JN-021 Back and Esc return to the picker with nothing saved", async ({ page }, testInfo) => {
        await openWokaPicker(page, roomUrl(testInfo));
        const picked = (await checkedTile(page).getAttribute("id")) ?? "";
        await page.locator("button.wokaBuildButton").click();
        await expect(page.getByRole("heading", { name: "Make it yours" }).first()).toBeVisible();
        await page.getByRole("tab", { name: "Hair" }).click();
        await wokaTiles(page).nth(3).click();
        await page.locator("button.wokaBuildBack").click();
        await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
        await expect(checkedTile(page)).toHaveId(picked);
        expect(await page.evaluate(() => localStorage.getItem("characterTextures"))).toBeNull();
        await page.locator("button.wokaBuildButton").click();
        await expect(page.getByRole("heading", { name: "Make it yours" }).first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("heading", { name: "Pick your WOKA" }).first()).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem("characterTextures"))).toBeNull();
    });

    test("JN-022 Finish saves the layered WOKA; Customize reopens on Build your WOKA", async ({ page }, testInfo) => {
        await openWokaBuilder(page, roomUrl(testInfo));
        await page.getByRole("tab", { name: "Hair" }).click();
        await wokaTiles(page).nth(7).click();
        const hairId = (await wokaTiles(page).nth(7).getAttribute("id")) ?? "";
        await page.locator("button.selectCharacterSceneFormSubmit").click();
        await expect(cameraHeading(page)).toBeVisible();
        const saved: string[] = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("characterTextures") ?? "[]")
        );
        expect(saved).toHaveLength(6);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await inRoom(page);
        await openMenu(page);
        await profileMenu(page).getByRole("button", { name: "Customize your avatar" }).click();
        await expect(page.getByRole("heading", { name: "Make it yours" }).first()).toBeVisible();
        await page.getByRole("tab", { name: "Hair" }).click();
        await expect(checkedTile(page)).toHaveId(hairId);
    });
});

test.describe("Join: camera and microphone", () => {
    test("JN-023 Desktop camera screen", async ({ page }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await openCameraScreen(page, roomUrl(testInfo));
        await expect(page.getByText("Before you join", { exact: true })).toBeVisible();
        await expect(page.getByText("Pick your devices, then check how you look and sound.")).toBeVisible();
        const video = page.locator("video.myCamVideoSetup");
        await expect(video).toBeVisible();
        await expect(video).toHaveClass(/scale-x-\[-1\]/);
        await expect(page.locator(".camera-name-chip")).toHaveText("Alice");
        await expect(page.getByRole("switch", { name: "Camera" })).toHaveAttribute("aria-checked", "true");
        await expect(page.getByRole("switch", { name: "Microphone" })).toHaveAttribute("aria-checked", "true");
        await expect(page.locator(".device-state")).toHaveText(["On", "On"]);
        await expect(deviceSelect(page, "Camera")).toBeEnabled();
        await expect(deviceSelect(page, "Microphone")).toBeEnabled();
        await expect(page.locator(".horizontal-sound-meter > div")).toHaveCount(30);
        await expect(page.getByText("Say something: the bars should move.")).toBeVisible();
        await expect(deviceSelect(page, "Speaker")).toBeVisible();
        await expect(page.getByRole("button", { name: "Play a test sound" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await expect(page.locator("button.enableCameraSceneBack")).toHaveCount(0);
    });

    test("JN-024 Phone camera screen", async ({ page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openCameraScreen(page, roomUrl(testInfo));
        await expect(page.locator("video.myCamVideoSetup")).toBeVisible();
        await expect(page.getByText("Pick your devices, then check how you look and sound.")).toBeHidden();
        await expect(page.getByText("Say something: the bars should move.")).toBeHidden();
        const preview = await page.locator(".camera-preview").boundingBox();
        const card = await page.locator(".u-join-card").boundingBox();
        const save = page.getByRole("button", { name: "Save", exact: true });
        const saveBox = await save.boundingBox();
        expect(preview && card && saveBox).toBeTruthy();
        if (!preview || !card || !saveBox) return;
        expect(Math.round(card.width)).toBe(428);
        expect(Math.abs(preview.width / preview.height - 4 / 3)).toBeLessThan(0.02);
        expect(saveBox.width).toBeGreaterThan(428 - 2 * 16 - 2);
        await save.scrollIntoViewIfNeeded();
        const footer = await page.locator(".enable-camera-footer").boundingBox();
        expect(footer).not.toBeNull();
        if (footer) expect(saveBox.y).toBeGreaterThan(preview.y + preview.height);
        await expect(page.locator(".enable-camera-footer button[type=submit]")).toBeVisible();
    });

    test("JN-025 Camera switch off and on", async ({ page }, testInfo) => {
        await openCameraScreen(page, roomUrl(testInfo));
        const cameraSwitch = page.getByRole("switch", { name: "Camera" });
        const select = deviceSelect(page, "Camera");
        await expect(page.locator("video.myCamVideoSetup")).toBeVisible();
        await expect(select).toBeEnabled();
        const device = await deviceShown(select).innerText();
        expect(device.trim()).not.toBe("");
        await cameraSwitch.click();
        await expect(cameraSwitch).toHaveAttribute("aria-checked", "false");
        await expect(page.getByText("Camera is off")).toBeVisible();
        await expect(page.getByText("People see your WOKA instead.")).toBeVisible();
        await expect(page.locator(".device-state").first()).toHaveText("Off");
        await expect(select).toBeDisabled();
        await expect(page.locator("video.myCamVideoSetup")).toHaveCount(0);
        await cameraSwitch.click();
        await expect(cameraSwitch).toHaveAttribute("aria-checked", "true");
        await expect(page.locator(".device-state").first()).toHaveText("On");
        await expect(page.locator("video.myCamVideoSetup")).toBeVisible();
        await expect(select).toBeEnabled();
        await expect(deviceShown(select)).toHaveText(device);
    });

    test("JN-026 Microphone switch off and on", async ({ page }, testInfo) => {
        await openCameraScreen(page, roomUrl(testInfo));
        const micSwitch = page.getByRole("switch", { name: "Microphone" });
        const select = deviceSelect(page, "Microphone");
        await expect(page.locator(".horizontal-sound-meter")).toBeVisible();
        await micSwitch.click();
        await expect(micSwitch).toHaveAttribute("aria-checked", "false");
        await expect(page.getByText("Microphone is off. Nobody hears you until you turn it on.")).toBeVisible();
        await expect(page.locator(".horizontal-sound-meter")).toHaveCount(0);
        await expect(select).toBeDisabled();
        await expect(page.locator(".device-state").nth(1)).toHaveText("Off");
        await micSwitch.click();
        await expect(micSwitch).toHaveAttribute("aria-checked", "true");
        await expect(page.locator(".horizontal-sound-meter")).toBeVisible();
        await expect(select).toBeEnabled();
    });

    test("JN-027 Chosen microphone is saved as preferred and used", async ({ page }, testInfo) => {
        await openCameraScreen(page, roomUrl(testInfo));
        const select = deviceSelect(page, "Microphone");
        await expect(select).toBeEnabled();
        const preferred = () =>
            page.evaluate(() => Object.entries(localStorage).find(([k]) => /preferredAudioInputDevice/i.test(k))?.[1]);
        const current = (await deviceShown(select).innerText()).trim();
        const list = await openDeviceList(page, select, "Microphone");
        await expect(list.getByRole("option")).toHaveCount(3);
        await expect(list.getByRole("option", { selected: true })).toHaveText(current);
        await page.keyboard.press("Escape");
        await expect(list).toBeHidden();
        const before = await preferred();
        const other = await pickOtherDevice(page, select, "Microphone");
        expect(other).not.toBe(current);
        await expect(deviceShown(select)).toHaveText(other);
        await expect.poll(preferred).not.toBe(before);
        const preferredId = await preferred();
        expect(preferredId).toBeTruthy();
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await inRoom(page);
        // Chromium's fake devices get new ids on every page load, so the next visit itself is a hand check.
        await openMenu(page);
        await profileMenu(page).getByRole("button", { name: "Edit cam / mic" }).click();
        await expect(cameraHeading(page)).toBeVisible();
        await expect(deviceShown(deviceSelect(page, "Microphone"))).toHaveText(other);
        expect(await preferred()).toBe(preferredId);
    });

    test("JN-028 Speaker change and test button play the join chime", async ({ page }, testInfo) => {
        await recordSounds(page);
        await openCameraScreen(page, roomUrl(testInfo));
        const speaker = deviceSelect(page, "Speaker");
        await expect(speaker).toBeVisible();
        // The build plays the game's real bubble sound (webrtc-in-ding.mp3 by default); the 6 Oct fix for issue 24.
        const chimes = async () => (await playedSounds(page)).filter((src) => /webrtc-in-ding\.mp3/.test(src)).length;
        await page.getByRole("button", { name: "Play a test sound" }).click();
        await expect.poll(chimes).toBe(1);
        const other = await pickOtherDevice(page, speaker, "Speaker");
        await expect.poll(chimes).toBe(2);
        await expect(deviceShown(speaker)).toHaveText(other);
    });

    test("JN-029 JN-030 Blocked camera and mic: screen texts and the access card", async ({ page }, testInfo) => {
        await blockMedia(page);
        await openCameraScreen(page, roomUrl(testInfo));
        await expect(page.getByText("Your browser blocked the camera")).toBeVisible();
        await expect(
            page.locator(".camera-preview").getByText("Allow it in the address bar, then try again.")
        ).toBeVisible();
        await expect(page.locator(".camera-preview svg").first()).toBeVisible();
        await expect(page.locator("p.u-join-error")).toHaveText(
            "Your browser blocked the microphone. Allow it in the address bar, then try again."
        );
        const help = page.locator("form.helpCameraSettings");
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1_500);
        await expect(help, "the access card does not open by itself here").toHaveCount(0);

        await page.getByRole("button", { name: "How to allow" }).click();
        await expect(help).toBeVisible();
        await expect(help.getByText("Camera / Microphone access needed")).toBeVisible();
        await expect(help.getByText("So people you walk up to can see and hear you.", { exact: false })).toBeVisible();
        await help.getByRole("button", { name: "Allow camera and mic" }).click();
        await expect(help.getByText("Permission denied")).toBeVisible();
        await expect(help.getByText("You must allow camera and microphone access in your browser.")).toBeVisible();
        if (!isPhone(testInfo)) await expect(help.getByRole("img", { name: "help camera setup" })).toBeVisible();
        await help.getByRole("button", { name: "Continue without webcam" }).click();
        await expect(help).toHaveCount(0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const asks = () => page.evaluate(() => (window as any).__jnMediaAsks as number);
        const asked = await asks();
        await page.getByRole("button", { name: "Try again" }).click();
        await expect.poll(asks, { message: "Try again asks the browser again" }).toBeGreaterThan(asked);
    });
});

test.describe("Join: enter room", () => {
    test("JN-031 Save enters the room with mic and camera on", async ({ page }, testInfo) => {
        await openCameraScreen(page, roomUrl(testInfo));
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await inRoom(page);
        await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
        await expect(page.getByTestId("camera-button")).toHaveAttribute("data-state", "normal");
    });

    test("JN-032 Camera off on the camera screen: bar matches, access card shows once", async ({ page }, testInfo) => {
        await openCameraScreen(page, roomUrl(testInfo));
        await page.getByRole("switch", { name: "Camera" }).click();
        await expect(page.getByRole("switch", { name: "Camera" })).toHaveAttribute("aria-checked", "false");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await inRoom(page);
        await expect(page.getByTestId("camera-button")).toHaveAttribute("data-state", "forbidden");
        await expect(page.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");
        const help = page.locator("form.helpCameraSettings");
        await expect(help).toBeVisible();
        await expect(help.getByText("Camera / Microphone access needed")).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem("helpCameraSettingsShown"))).toBe("1");
        await help.getByRole("button", { name: "Continue without webcam" }).click();
        await expect(help).toHaveCount(0);
        await page.reload();
        await inRoom(page);
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(2_000);
        await expect(help, "shown only once per browser").toHaveCount(0);
    });

    test("JN-033 Camera blocked when entering the room shows the access card", async ({ page }, testInfo) => {
        await blockMedia(page, true);
        await join(page, roomUrl(testInfo), "Alice");
        await page.evaluate(() => sessionStorage.setItem("jn-block-media", "1"));
        await page.reload();
        await inRoom(page);
        const help = page.locator("form.helpCameraSettings");
        await expect(help).toBeVisible();
        await help.getByRole("button", { name: "Continue without webcam" }).click();
        await expect(help).toHaveCount(0);
    });

    test("JN-034 Return visit goes straight into the room", async ({ page }, testInfo) => {
        await join(page, roomUrl(testInfo), "Alice");
        await page.addInitScript(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__jnSawJoinScreen = false;
            new MutationObserver(() => {
                if (document.querySelector("[data-testid=loginSceneNameInput], #woka-grid, .enableCameraScene"))
                    w.__jnSawJoinScreen = true;
            }).observe(document, { childList: true, subtree: true });
        });
        await page.reload();
        await expect(page.getByTestId("microphone-button")).toBeVisible({ timeout: 120_000 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(await page.evaluate(() => (window as any).__jnSawJoinScreen)).toBe(false);
    });
});

test.describe("Join: errors", () => {
    test("JN-038 Error screens: unsupported URL, missing map, missing resource", async ({ page }, testInfo) => {
        await page.goto("/@/not/supported");
        await expect(page.getByText("Unsupported URL format")).toBeVisible();

        await join(page, roomUrl(testInfo, "does/not/exist.json"), "Alice").catch(() => undefined);
        await expect(page.getByText("An error occurred")).toBeVisible();
        await expect(page.getByText(/Code : /)).toBeVisible();

        await page.goto(roomUrl(testInfo, "tests/MapWithError/error.json"));
        await expect(page.getByText("An error occurred")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText("NETWORK_ERROR")).toBeVisible();
        await expect(page.getByText("not_exists.png")).toBeVisible();
    });

    test("JN-039 Browser without structuredClone gets the Not Supported page", async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            delete (window as unknown as { structuredClone?: unknown }).structuredClone;
        });
        await page.goto(roomUrl(testInfo));
        await expect(page.locator("h2:has-text('Browser Not Supported')")).toBeVisible({ timeout: 20_000 });
        await expect(page.locator("h2:has-text('Browser Not Supported')")).toContainText("😢");
        await expect(page.getByText("What can you do?")).toBeVisible();
        await expect(page.getByTestId("update-browser-button")).toContainText("Update Browser");
        await expect(page.getByTestId("leave-button")).toContainText("Leave");
        await expect(nameInput(page)).toBeHidden();
        await expect(page.locator("#game")).toBeHidden();
    });
});
