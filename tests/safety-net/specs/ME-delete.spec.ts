import type { Page, TestInfo } from "@playwright/test";
import { expect, isPhone, test } from "../lib/game";
import {
    areaCentre,
    backToAreaList,
    drag,
    editRoom,
    entityOnScreen,
    newArea,
    openEditor,
    pickObject,
    pickTool,
    placeAt,
    playerPosition,
    rail,
    readWam,
    SPOT_A,
    SPOT_B,
    toScreen,
} from "../lib/me";

async function withObjects(page: Page, testInfo: TestInfo, count: number): Promise<{ url: string; ids: string[] }> {
    const url = await editRoom(page, testInfo);
    await openEditor(page, testInfo);
    await pickTool(page, "EntityEditor");
    await pickObject(page, "Basic Wood Table");
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await placeAt(page, testInfo, url, [SPOT_A, SPOT_B][i]));
    await page.getByTestId("placing-done").click();
    await expect(page.getByTestId("placing-bar")).toBeHidden();
    return { url, ids };
}

test("ME-059 @local Desktop Delete tool: hint, red hover with 'Click to remove', one click removes, toast Undo restores", async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), "desktop only");
    const { url, ids } = await withObjects(page, testInfo, 1);
    await pickTool(page, "AreaEditor");
    const area = await newArea(page, url, "Bin");
    await backToAreaList(page);
    await rail(page, "TrashEditor").click();
    await expect(rail(page, "TrashEditor")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("edit-panel")).toBeHidden();
    await expect(page.getByTestId("edit-delete-hint")).toHaveText(/Tap what you want to remove/);
    const target = await entityOnScreen(page, url, ids[0]);
    await page.mouse.move(target.x - 5, target.y);
    await page.mouse.move(target.x, target.y);
    await expect(page.getByTestId("delete-hover-hint")).toHaveText(/Click to remove/);
    await page.mouse.click(target.x, target.y);
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length).toBe(0);
    const toast = page.getByTestId("edit-undo-toast");
    await expect(toast).toContainText("Basic Wood Table removed");
    await expect(page.getByTestId("edit-undo-toast-undo")).toHaveText(/Undo/);
    await page.getByTestId("edit-undo-toast-undo").click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Undo restores the object" }).toBe(1);
    const a = (await readWam(url)).areas.find((x) => x.id === area)!;
    const inArea = await toScreen(page, a.x + 10, a.y + a.height - 10);
    await page.mouse.move(inArea.x - 3, inArea.y);
    await page.mouse.move(inArea.x, inArea.y);
    await page.mouse.click(inArea.x, inArea.y);
    await expect.poll(async () => (await readWam(url)).areas.length, { message: "a click on an area removes it" }).toBe(0);
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 10_000 });
});

test("ME-060 @local Phone Delete tool: first tap marks, tap elsewhere keeps, second tap or Remove deletes, Undo toast", async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), "phone only");
    const { url, ids } = await withObjects(page, testInfo, 2);
    await rail(page, "TrashEditor").click();
    await expect(rail(page, "TrashEditor")).toHaveAttribute("aria-pressed", "true");
    const one = await entityOnScreen(page, url, ids[0]);
    await page.touchscreen.tap(one.x, one.y);
    await expect(page.getByTestId("delete-mark")).toBeVisible();
    await expect(page.getByTestId("delete-mark-remove")).toHaveText(/Remove/);
    await expect(page.getByTestId("delete-mark-hint")).toHaveText("Tap again to remove · tap elsewhere to keep");
    const elsewhere = await toScreen(page, (await playerPosition(page)).x + 64, (await playerPosition(page)).y - 64);
    await page.touchscreen.tap(elsewhere.x, elsewhere.y);
    await expect(page.getByTestId("delete-mark")).toBeHidden();
    expect(Object.keys((await readWam(url)).entities)).toHaveLength(2);
    await page.touchscreen.tap(one.x, one.y);
    await expect(page.getByTestId("delete-mark")).toBeVisible();
    await page.touchscreen.tap(one.x, one.y);
    await expect.poll(async () => Object.keys((await readWam(url)).entities)).toEqual([ids[1]]);
    await expect(page.getByTestId("edit-undo-toast")).toContainText("removed");
    const two = await entityOnScreen(page, url, ids[1]);
    await page.touchscreen.tap(two.x, two.y);
    await page.getByTestId("delete-mark-remove").click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities)).toHaveLength(0);
    // The row asks for the Undo toast; that its Undo brings the object back is ME-022's check.
    await expect(page.getByTestId("edit-undo-toast")).toContainText("Basic Wood Table removed");
    await expect(page.getByTestId("edit-undo-toast-undo")).toBeVisible();
});

test("ME-061 @local Undo and Redo: the pill buttons and Ctrl+Z / Ctrl+Shift+Z undo and redo", async ({ page }, testInfo) => {
    const { url } = await withObjects(page, testInfo, 1);
    const undo = page.getByTestId("edit-undo");
    const redo = page.getByTestId("edit-redo");
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Undo removes the placement" }).toBe(0);
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect.poll(async () => Object.keys((await readWam(url)).entities).length, { message: "Redo puts it back" }).toBe(1);
    if (isPhone(testInfo)) return;
    await pickTool(page, "AreaEditor");
    const id = await newArea(page, url);
    const before = (await readWam(url)).areas.find((a) => a.id === id)!;
    const areaX = async () => (await readWam(url)).areas.find((a) => a.id === id)?.x ?? "the area is gone";
    const from = await areaCentre(page, url, id);
    await drag(page, testInfo, from, { x: from.x + 160, y: from.y }, 15);
    await expect.poll(async () => Number(await areaX())).toBeGreaterThan(before.x + 32);
    await page.locator("canvas").first().hover({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(areaX, { message: "Ctrl+Z undoes the move (and only the move)" }).toBe(before.x);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => Number(await areaX()), { message: "Ctrl+Shift+Z redoes it" }).toBeGreaterThan(before.x + 32);
});
