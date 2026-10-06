import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone, test } from "../lib/game";
import { editRoom, openEditor, pickTool, placeAt, pngFile, rail, readWam, SPOT_A } from "../lib/me";

async function uploadGuide(page: Page, testInfo: TestInfo): Promise<string> {
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    await page.getByTestId("objects-add-your-own").click();
    await expect(page.getByTestId("uploadCustomAsset")).toBeAttached();
    return url;
}

/** Uploads a picture as a new object of its own and returns to the picker. */
async function uploadObject(page: Page, name: string, width = 64, height = 64): Promise<void> {
    await page.getByTestId("uploadCustomAsset").setInputFiles(pngFile(`${name}.png`, width, height));
    await page.getByTestId("name").fill(name);
    await page.getByTestId("applyEntityModifications").click();
    await expect(page.getByTestId("objects-search")).toBeVisible({ timeout: 30_000 });
}

test("ME-026 Add your own: the guide with four rules and the drop zone", async ({ page }, testInfo) => {
    await uploadGuide(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    await expect(panel.locator(".em-title").first()).toHaveText("Add your own");
    await expect(panel).toContainText("Make it fit, then check it here");
    for (const rule of ["32 pixels is one tile", "Same angle as the map", "See-through background", "Sides and colours"]) {
        await expect(panel.getByText(rule, { exact: true })).toBeVisible();
    }
    const drop = panel.locator(".em-drop");
    await expect(drop).toBeVisible();
    await expect(drop).toContainText("Choose a picture");
    await expect(drop).toContainText("PNG, JPG or WebP");
    expect(await drop.evaluate((e) => getComputedStyle(e).borderStyle)).toBe("dashed");
});

test("ME-027 Check it: size line for a fitting and an odd picture, errors for a GIF and two files, drop works", async ({ page }, testInfo) => {
    await uploadGuide(page, testInfo);
    const panel = page.getByTestId("edit-panel");
    const input = page.getByTestId("uploadCustomAsset");
    await input.setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(panel.locator(".em-err"), "a GIF shows an error").toHaveText(/File format not supported/);
    if (!isPhone(testInfo)) {
        const two = await page.evaluateHandle((b64) => {
            const dt = new DataTransfer();
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            for (const name of ["a.png", "b.png"]) dt.items.add(new File([bytes], name, { type: "image/png" }));
            return dt;
        }, pngFile("a.png", 64, 64).buffer.toString("base64"));
        await panel.locator(".em-drop").dispatchEvent("drop", { dataTransfer: two });
        await expect(panel.locator(".em-err"), "two files dropped at once show an error").toHaveText(/Multiple file drop is not supported/);
    }
    await input.setInputFiles(pngFile("fits.png", 64, 64));
    await expect(panel.locator(".em-title").first()).toHaveText("Check it");
    await expect(panel).toContainText("You, for size");
    await expect(panel).toContainText("64 × 64 px, 2 × 2 tiles. Fits the grid.");
    await page.getByTestId("edit-panel-back").click();
    await page.getByTestId("uploadCustomAsset").setInputFiles(pngFile("odd.png", 70, 45));
    await expect(panel).toContainText("This won't line up with the tiles. Try 64 × 64.");
    if (!isPhone(testInfo)) {
        await page.getByTestId("edit-panel-back").click();
        const file = pngFile("dropped.png", 32, 32);
        const transfer = await page.evaluateHandle((b64) => {
            const dt = new DataTransfer();
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
            return dt;
        }, file.buffer.toString("base64"));
        await panel.locator(".em-drop").dispatchEvent("drop", { dataTransfer: transfer });
        await expect(panel).toContainText("32 × 32 px, 1 × 1 tiles. Fits the grid.");
    }
});

test("ME-028 Save to my objects: the upload shows in Your uploads and in search", async ({ page }, testInfo) => {
    const url = await uploadGuide(page, testInfo);
    // Uploads outlive the room, so each run uses its own name.
    const name = `Safety planter ${Date.now().toString(36)}`;
    await page.getByTestId("uploadCustomAsset").setInputFiles(pngFile("planter.png", 64, 64, [40, 160, 60, 255]));
    await page.getByTestId("name").fill(name);
    await page.getByTestId("tags").fill("plants2");
    const floats = page.getByTestId("floatingObject");
    if (await floats.isChecked()) await floats.click();
    await expect(floats).not.toBeChecked();
    const cells = page.locator(".em-cell");
    await expect(cells).toHaveCount(4);
    await cells.nth(2).click();
    await cells.nth(3).click();
    await expect(cells.nth(2)).toHaveAttribute("aria-pressed", "true");
    const depth = page.getByTestId("edit-panel").locator("select").last();
    await depth.selectOption({ label: "On the ground" });
    await depth.selectOption({ label: "Custom" });
    await expect(page.locator('input[type="range"]')).toBeVisible();
    await page.getByTestId("applyEntityModifications").click();
    const panel = page.getByTestId("edit-panel");
    await expect(page.getByTestId("objects-search")).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(".em-cat-label"), "the panel returns to the picker, not an empty category").toHaveText("All categories");
    await expect(panel.locator(".em-sech", { hasText: "Your uploads" })).toBeVisible();
    await expect(panel.getByTestId("entity-item").filter({ hasText: name }).first()).toBeVisible();
    await page.getByTestId("objects-search").fill(name);
    await expect(panel.getByTestId("entity-item").filter({ hasText: name })).toHaveCount(1);
    void url;
});

test("ME-029 Edit this upload: change name and save; Delete this upload removes it", async ({ page }, testInfo) => {
    await uploadGuide(page, testInfo);
    // Uploads outlive the room, so each run uses its own name.
    const name = `Safety lamp ${Date.now().toString(36)}`;
    await uploadObject(page, name);
    const panel = page.getByTestId("edit-panel");
    await page.getByTestId("objects-search").fill(name);
    await panel.getByTestId("entity-item").filter({ hasText: name }).first().click();
    if (isPhone(testInfo)) {
        await rail(page, "EntityEditor").click();
    }
    await page.getByTestId("editEntity").click();
    const nameField = panel.locator("input#name, input[placeholder*='name' i]").first();
    await expect(nameField).toBeVisible();
    await nameField.fill(`${name} two`);
    await panel.getByRole("button", { name: /save|apply/i }).first().click();
    await page.getByTestId("objects-search").fill(`${name} two`);
    await expect(panel.getByTestId("entity-item").filter({ hasText: `${name} two` })).toHaveCount(1, { timeout: 15_000 });
    await panel.getByTestId("entity-item").filter({ hasText: `${name} two` }).first().click();
    if (isPhone(testInfo)) {
        await rail(page, "EntityEditor").click();
    }
    await page.getByTestId("editEntity").click();
    await panel.getByRole("button", { name: /delete/i }).first().click();
    const confirm = page.getByRole("button", { name: /^(delete|confirm|yes)/i });
    if (await confirm.first().isVisible().catch(() => false)) await confirm.first().click();
    await page.getByTestId("objects-search").fill(name);
    await expect(panel.getByTestId("entity-item").filter({ hasText: name })).toHaveCount(0, { timeout: 15_000 });
});

test("ME-030 @local Sides and colours: add a side, wrong size error, remove, add a colour, Turn and Place", async ({ page }, testInfo) => {
    const url = await uploadGuide(page, testInfo);
    // Uploads outlive the room, so each run uses its own name: an earlier run's "Safety box" already has a Left side.
    const name = `Safety box ${Date.now().toString(36)}`;
    await uploadObject(page, name);
    const panel = page.getByTestId("edit-panel");
    await page.getByTestId("objects-search").fill(name);
    await panel.getByTestId("entity-item").filter({ hasText: name }).first().click();
    if (isPhone(testInfo)) {
        await rail(page, "EntityEditor").click();
    }
    await page.getByTestId("uploadVariants").click();
    const variants = page.getByTestId("upload-variants");
    await expect(variants).toBeVisible();
    for (const word of ["Sides", "Front", "Left", "Right", "Back", "Colours"]) await expect(variants.getByText(word, { exact: true }).first()).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("variant-add-Left").click();
    await (await chooser).setFiles(pngFile("left.png", 64, 64, [60, 60, 200, 255]));
    await expect(page.getByTestId("variant-side-Left")).toBeVisible({ timeout: 20_000 });
    const chooser2 = page.waitForEvent("filechooser");
    await page.getByTestId("variant-add-Right").click();
    await (await chooser2).setFiles(pngFile("right.png", 32, 48));
    await expect(page.getByTestId("variant-error")).toContainText("This picture is 32 × 48 px; every side must be 64 × 64 px");
    await page.getByTestId("variant-remove-Left").click();
    await expect(page.getByTestId("variant-side-Left")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("variant-add-Left")).toBeVisible();
    const chooser3 = page.waitForEvent("filechooser");
    await page.getByTestId("variant-add-Left").click();
    await (await chooser3).setFiles(pngFile("left2.png", 64, 64, [60, 60, 200, 255]));
    await expect(page.getByTestId("variant-side-Left")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("variant-colour-add").click();
    await page.getByTestId("variant-colour").evaluate((el: HTMLInputElement) => {
        el.value = "#22aa44";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // The new colour's front: the Front slot's testid uses the game's direction name, Down.
    const chooser4 = page.waitForEvent("filechooser");
    await page.getByTestId("variant-add-Down").click();
    await (await chooser4).setFiles(pngFile("green.png", 64, 64, [34, 170, 68, 255]));
    await expect(page.getByTestId("variant-colour-22aa44")).toBeVisible({ timeout: 20_000 });
    await expect(variants.locator(".em-slot.e").first()).toBeVisible();
    await page.getByTestId("variant-colour-original").click();
    await expect(page.getByTestId("variant-turn")).toBeEnabled();
    await page.getByTestId("variant-turn").click();
    await expect(page.getByTestId("variant-side-Left")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("variant-place").click();
    const bar = page.getByTestId("placing-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator(".em-colors button.em-dot")).toHaveCount(2);
    await expect(page.getByTestId("placing-turn")).toBeVisible();
    const id = await placeAt(page, testInfo, url, SPOT_A);
    expect((await readWam(url)).entities[id].prefabRef.id).toBeTruthy();
});
