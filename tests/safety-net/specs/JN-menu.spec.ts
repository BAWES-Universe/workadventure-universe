import { test, expect, isPhone, inRoom, join, newPlayer, roomUrl, wa } from "../lib/game";
import {
    cameraHeading,
    checkedTile,
    continueButton,
    nameInput,
    openMenu,
    inBubble,
    profileButton,
    profileMenu,
    watchBubble,
    wokaTiles,
} from "../lib/jn";

/** Names of the other players this page's scripting API knows about. */
async function playerNames(page: import("@playwright/test").Page): Promise<string[]> {
    return wa(page, async () => {
        await WA.players.configureTracking({ players: true, movement: false });
        return [...WA.players.list()].map((player) => player.name);
    });
}

declare const WA: {
    players: { configureTracking(o: object): Promise<void>; list(): Iterable<{ name: string }> };
    player: { teleport(x: number, y: number): Promise<void> };
    ui: { actionBar: { addButton(o: { id: string; label: string; callback: () => void }): void } };
};

test.describe("Profile menu", () => {
    test("JN-046 Desktop profile pill and opening the menu", async ({ page }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        const longName = "Alexandria Constantinople Smith";
        await join(page, roomUrl(testInfo), longName);
        const pill = page.locator(".profile-pill");
        await expect(pill).toBeVisible();
        await expect(page.locator(".profile-burger")).toBeHidden();
        const name = pill.locator("span.truncate");
        await expect(name).toHaveText(longName);
        await expect(name).toHaveAttribute("title", longName);
        const cut = await name.evaluate((node) => ({ width: node.clientWidth, full: node.scrollWidth }));
        expect(cut.width).toBeLessThanOrEqual(176);
        expect(cut.full).toBeGreaterThan(cut.width);
        await expect(pill.locator("div.rounded-full.h-2")).toHaveCSS("background-color", "rgb(104, 233, 122)");
        await expect(pill.getByText("Online", { exact: true })).toBeVisible();
        const chevron = pill.locator("svg").last();
        await expect(chevron).not.toHaveClass(/rotate-180/);
        await expect(profileButton(page)).toHaveAttribute("aria-expanded", "false");
        await openMenu(page);
        await expect(profileButton(page)).toHaveAttribute("aria-expanded", "true");
        await expect(chevron).toHaveClass(/rotate-180/);
        await expect(pill).toHaveCSS("background-color", "rgba(255, 255, 255, 0.14)");
        const pillBox = await pill.boundingBox();
        const menuBox = await profileMenu(page).boundingBox();
        expect(pillBox && menuBox).toBeTruthy();
        if (pillBox && menuBox) expect(menuBox.y).toBeGreaterThan(pillBox.y + pillBox.height - 1);
        await expect(profileMenu(page).locator(".u-surface-arrow")).toBeAttached();
    });

    test("JN-047 Phone burger opens the menu above the bar and turns into an X", async ({ player }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        const burger = player.locator(".profile-burger");
        await expect(burger).toBeVisible();
        await expect(player.locator(".profile-pill")).toBeHidden();
        const closedIcon = await burger.innerHTML();
        await player.getByTestId("action-user").tap();
        await expect(profileMenu(player)).toBeVisible();
        await expect.poll(() => burger.innerHTML()).not.toBe(closedIcon);
        await expect(burger).toHaveCSS("background-color", "rgba(255, 255, 255, 0.14)");
        const burgerBox = await burger.boundingBox();
        const menuBox = await profileMenu(player).boundingBox();
        expect(burgerBox && menuBox).toBeTruthy();
        if (burgerBox && menuBox) expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(burgerBox.y + 1);
        await player.getByTestId("action-user").locator("button.profile-button").tap();
        await expect(profileMenu(player)).toBeHidden();
        await expect.poll(() => burger.innerHTML()).toBe(closedIcon);
    });

    test("JN-048 Menu sections and rows for an anonymous player", async ({ player }) => {
        await openMenu(player);
        const menu = profileMenu(player);
        await expect(menu.locator(".u-eyebrow")).toHaveText(["Change your status", "Profile", "Settings"]);
        await expect(menu.locator("button.status-button")).toHaveText(["Online", "Busy", "Back in a moment", "Do not disturb"]);
        const rows = ["Edit your name", "Customize your avatar", "Add companion", "Edit cam / mic", "All settings"];
        for (const row of rows) await expect(menu.getByRole("button", { name: row })).toBeVisible();
        const tops: number[] = [];
        for (const row of rows) tops.push((await menu.getByRole("button", { name: row }).boundingBox())?.y ?? -1);
        expect([...tops].sort((a, b) => a - b)).toEqual(tops);
        await expect(menu.getByRole("button", { name: "Walk to my desk" })).toHaveCount(0);
        await expect(menu.getByRole("button", { name: "Unclaim my desk" })).toHaveCount(0);
        await expect(menu.getByRole("button", { name: "Report an issue" })).toHaveCount(0);
        await expect(menu.getByRole("button", { name: "Log out" })).toHaveCount(0);
        await expect(menu.getByRole("button", { name: "Customize your avatar" }).locator("canvas, img").first()).toBeVisible();
    });

    test("JN-049 Menu closes on outside click, pill click and Escape", async ({ player }) => {
        await openMenu(player);
        await player.mouse.click(700 > (player.viewportSize()?.width ?? 0) ? 20 : 300, 200);
        await expect(profileMenu(player)).toBeHidden();
        await openMenu(player);
        await profileButton(player).click();
        await expect(profileMenu(player)).toBeHidden();
        await openMenu(player);
        await player.keyboard.press("Escape");
        await expect(profileMenu(player)).toBeHidden();
        await expect(profileButton(player)).toBeFocused();
    });

    test("JN-050 Keyboard: Tab reaches the profile button, Enter and Space open the menu", async ({ player }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await player.locator("body").click({ position: { x: 300, y: 200 } });
        let focused = false;
        for (let i = 0; i < 60 && !focused; i++) {
            await player.keyboard.press("Tab");
            focused = await profileButton(player).evaluate((node) => node === document.activeElement);
        }
        expect(focused, "Tab reaches the profile button").toBe(true);
        await expect(player.locator(".profile-pill")).toHaveCSS("box-shadow", /rgb\(255, 255, 255\) 0px 0px 0px 2px inset/);
        await player.keyboard.press("Enter");
        await expect(profileMenu(player)).toBeVisible();
        await player.keyboard.press("Escape");
        await expect(profileMenu(player)).toBeHidden();
        await expect(profileButton(player)).toBeFocused();
        await player.keyboard.press("Space");
        await expect(profileMenu(player)).toBeVisible();
    });

    test("JN-051 JN-052 Phone menu in a bubble with music: contextual actions, fits the screen", async ({ browser, page }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        test.setTimeout(180_000);
        const url = roomUrl(testInfo, "tests/E2E/audio.json");
        await join(page, url, "Alice");
        await wa(page, () => WA.player.teleport(256, 128));
        await watchBubble(page);
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        await wa(bob, () => WA.player.teleport(256, 128));
        await expect.poll(() => inBubble(page), { timeout: 30_000 }).toBe(true);
        await expect
            .poll(() => page.evaluate(() => [...document.querySelectorAll("audio")].some((a) => !a.paused && a.src.includes("Audience"))), {
                timeout: 20_000,
                message: "the map's music plays in its area",
            })
            .toBe(true);
        await openMenu(page);
        const menu = profileMenu(page);
        await expect(menu.getByText("Contextual actions", { exact: true })).toBeVisible();
        await expect(menu.getByTestId("music-pause-button")).toBeVisible();
        await expect(menu.getByRole("button", { name: /Ask to follow/ })).toBeVisible();
        await expect(menu.getByRole("button", { name: "Lock conversation" })).toBeVisible();
        await expect(menu.getByRole("button", { name: "Share your screen" })).toBeVisible();
        await expect(menu.getByRole("button", { name: "Picture in picture" })).toBeVisible();
        const tops = await Promise.all(
            ["All settings", "Contextual actions"].map(async (label) =>
                (await menu.getByText(label, { exact: true }).boundingBox())?.y ?? -1
            )
        );
        expect(tops[1]).toBeGreaterThan(tops[0]);
        const box = await menu.boundingBox();
        const bar = await page.getByTestId("action-user").boundingBox();
        expect(box && bar).toBeTruthy();
        if (box && bar) {
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
        }
        const scroll = await menu.locator(".profile-menu-scroll").evaluate((node) => ({
            overflow: getComputedStyle(node).overflowY,
            fits: node.scrollHeight <= node.clientHeight + 1 || getComputedStyle(node).overflowY === "auto",
        }));
        expect(scroll.overflow).toBe("auto");
        expect(scroll.fits).toBe(true);
        await bob.context().close();
    });

    test("JN-052 Desktop menu has no contextual actions section", async ({ browser, page }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        const url = roomUrl(testInfo, "tests/E2E/audio.json");
        await join(page, url, "Alice");
        await wa(page, () => WA.player.teleport(256, 128));
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        await wa(bob, () => WA.player.teleport(256, 128));
        await expect(page.getByTestId("action-bar").or(page.getByTestId("microphone-button"))).toBeVisible();
        await openMenu(page);
        await expect(profileMenu(page).getByText("Contextual actions", { exact: true })).toBeHidden();
        await bob.context().close();
    });

    test("JN-053 Phone: bar items that don't fit are listed in the menu", async ({ player }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        const labels = ["JN first button", "JN second button", "JN third button", "JN fourth button"];
        await wa(player, (names) => {
            for (const name of names) WA.ui.actionBar.addButton({ id: name, label: name, callback: () => undefined });
        }, labels);
        await expect(player.getByText(labels[0]).first()).toBeAttached();
        await openMenu(player);
        const inMenu: string[] = [];
        for (const label of labels) {
            if (await profileMenu(player).getByText(label).isVisible()) inMenu.push(label);
            else await expect(player.getByText(label).first(), `${label} is in the bar`).toBeInViewport();
        }
        expect(inMenu.length, "the buttons that no longer fit the phone bar are menu rows").toBeGreaterThan(0);
    });
});

test.describe("Profile menu: edit name, WOKA, companion, devices", () => {
    test("JN-054 Edit your name opens the name screen with an X back to the room", async ({ player }) => {
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Edit your name" }).click();
        await expect(nameInput(player)).toHaveValue("Alice");
        const back = player.getByTestId("loginSceneBack");
        await expect(back).toHaveAttribute("aria-label", "Back to your room");
        await nameInput(player).fill("Changed");
        await back.click();
        await inRoom(player);
        expect(await player.evaluate(() => localStorage.getItem("playerName"))).toBe("Alice");
    });

    test("JN-055 New name shows on the pill and to the other player", async ({ browser, player, url }, testInfo) => {
        const bob = await newPlayer(browser, testInfo, url, "Bob");
        await expect.poll(() => playerNames(bob), { timeout: 20_000 }).toContain("Alice");
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Edit your name" }).click();
        await nameInput(player).fill("Alice2");
        await continueButton(player).click();
        await inRoom(player);
        if (!isPhone(testInfo)) await expect(player.locator(".profile-pill span.truncate")).toHaveText("Alice2");
        expect(await player.evaluate(() => localStorage.getItem("playerName"))).toBe("Alice2");
        await expect.poll(() => playerNames(bob), { timeout: 30_000 }).toContain("Alice2");
        await bob.context().close();
    });

    test("JN-056 Customize your avatar: X, Esc, and picking another WOKA", async ({ player }) => {
        const before = await player.evaluate(() => localStorage.getItem("characterTextures"));
        const close = player.locator("button.selectCharacterSceneClose");

        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Customize your avatar" }).click();
        await expect(wokaTiles(player).first()).toBeVisible();
        await expect(close).toHaveAttribute("aria-label", "Back to your room");
        const current = JSON.parse(before ?? "[]")[0];
        await expect(checkedTile(player)).toHaveId(`woka-${current}`);
        await close.click();
        await inRoom(player);
        expect(await player.evaluate(() => localStorage.getItem("characterTextures"))).toBe(before);

        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Customize your avatar" }).click();
        await expect(wokaTiles(player).first()).toBeVisible();
        await player.keyboard.press("Escape");
        await inRoom(player);
        expect(await player.evaluate(() => localStorage.getItem("characterTextures"))).toBe(before);

        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Customize your avatar" }).click();
        await expect(wokaTiles(player).first()).toBeVisible();
        await wokaTiles(player).nth(5).click();
        const picked = ((await wokaTiles(player).nth(5).getAttribute("id")) ?? "").replace(/^woka-/, "");
        await player.locator("button.selectCharacterSceneFormSubmit").click();
        await inRoom(player);
        expect(JSON.parse((await player.evaluate(() => localStorage.getItem("characterTextures"))) ?? "[]")).toEqual([picked]);
    });

    test("JN-057 Desktop companion screen", async ({ player }, testInfo) => {
        test.skip(isPhone(testInfo), "desktop only");
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        const scene = player.locator(".selectCompanionScene");
        await expect(scene.getByRole("heading", { name: "Who comes along?" }).last()).toBeVisible();
        await expect(scene.getByText("Add companion", { exact: true }).last()).toBeVisible();
        await expect(scene.locator(".u-join-room")).toBeVisible();
        await expect(player.locator("#companion-none")).toHaveAttribute("aria-checked", "true");
        await expect(scene.locator("b.truncate")).toHaveText("None");
        await expect(scene.getByText("Just you, no companion")).toBeVisible();
        const tiles = scene.locator("[role=radiogroup] [role=radio]");
        await expect(tiles.first()).toHaveId("companion-none");
        await expect(tiles.nth(1)).toBeVisible();
        const columns = await scene.locator("[role=radiogroup]").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(4);
        await expect(scene.locator("footer .u-join-hint")).toContainText("to browse");
        await expect(scene.locator("footer .u-join-hint")).toContainText("to continue");
        await expect(player.locator("button.selectCompanionSceneFormSubmit span:visible")).toHaveText("Continue");
        await expect(player.locator("button.selectCompanionSceneClose")).toHaveAttribute("aria-label", "Back to your room");
        await tiles.nth(1).click();
        const name = (await tiles.nth(1).getAttribute("aria-label")) ?? "";
        await expect(scene.locator("b.truncate")).toHaveText(name);
        await expect(scene.getByText("Follows you everywhere you walk")).toBeVisible();
        await player.locator("button.selectCompanionSceneFormSubmit").click();
        await inRoom(player);
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        await expect(tiles.nth(1)).toHaveAttribute("aria-checked", "true");
    });

    test("JN-058 Phone companion screen", async ({ player }, testInfo) => {
        test.skip(!isPhone(testInfo), "phone only");
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        const scene = player.locator(".selectCompanionScene");
        await expect(scene.getByRole("heading", { name: "Who comes along?" }).first()).toBeVisible();
        const card = await scene.locator(".u-join-card").boundingBox();
        expect(card).not.toBeNull();
        if (card) expect(Math.round(card.width)).toBe(428);
        const columns = await scene.locator("[role=radiogroup]").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(3);
        await expect(scene.getByText("Just you, no companion")).toBeHidden();
        const submit = player.locator("button.selectCompanionSceneFormSubmit");
        await expect(submit.locator("span:visible")).toHaveText("Continue");
        const box = await submit.boundingBox();
        expect(box).not.toBeNull();
        if (box) expect(box.width).toBeGreaterThan(428 - 2 * 24);
        const tile = scene.locator("[role=radiogroup] [role=radio]").nth(1);
        await tile.tap();
        await expect(submit.locator("span:visible")).toHaveText(`Continue with ${await tile.getAttribute("aria-label")}`);
    });

    test("JN-059 Picking a companion and then None", async ({ player }, testInfo) => {
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        const scene = player.locator(".selectCompanionScene");
        const tiles = scene.locator("[role=radiogroup] [role=radio]");
        await expect(tiles.nth(2)).toBeVisible();
        const companionId = ((await tiles.nth(2).getAttribute("id")) ?? "").replace(/^companion-/, "");
        if (isPhone(testInfo)) {
            await tiles.nth(2).tap();
            await player.locator("button.selectCompanionSceneFormSubmit").tap();
        } else {
            await player.keyboard.press("ArrowRight");
            await player.keyboard.press("ArrowRight");
            await expect(tiles.nth(2)).toHaveAttribute("aria-checked", "true");
            await player.keyboard.press("Enter");
        }
        await inRoom(player);
        await expect(scene).toBeHidden();
        expect(await player.evaluate(() => JSON.parse(localStorage.getItem("companion") ?? "null"))).toBe(companionId);
        await player.keyboard.press("Escape");
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        await expect(player.locator(`#companion-${companionId}`)).toHaveAttribute("aria-checked", "true");
        await player.locator("#companion-none").click();
        await player.locator("button.selectCompanionSceneFormSubmit").click();
        await inRoom(player);
        await expect(scene).toBeHidden();
        expect(await player.evaluate(() => JSON.parse(localStorage.getItem("companion") ?? "null"))).toBeNull();
    });

    test("JN-060 Add companion: X and Esc leave the companion unchanged", async ({ player }) => {
        const before = await player.evaluate(() => localStorage.getItem("companion"));
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        const tiles = player.locator(".selectCompanionScene [role=radiogroup] [role=radio]");
        await tiles.nth(1).click();
        await player.locator("button.selectCompanionSceneClose").click();
        await inRoom(player);
        await expect(player.locator(".selectCompanionScene")).toBeHidden();
        expect(await player.evaluate(() => localStorage.getItem("companion"))).toBe(before);
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Add companion" }).click();
        await expect(player.locator("#companion-none")).toHaveAttribute("aria-checked", "true");
        await tiles.nth(1).click();
        await player.keyboard.press("Escape");
        await inRoom(player);
        await expect(player.locator(".selectCompanionScene")).toBeHidden();
        expect(await player.evaluate(() => localStorage.getItem("companion"))).toBe(before);
    });

    test("JN-062 Edit cam / mic: X returns unchanged, Save keeps the new device", async ({ player }) => {
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Edit cam / mic" }).click();
        await expect(cameraHeading(player)).toBeVisible();
        const back = player.locator("button.enableCameraSceneBack");
        await expect(back).toHaveAttribute("aria-label", "Back to your room");
        const mic = player.getByRole("combobox", { name: "Microphone" });
        await expect(mic).toBeEnabled();
        const before = await mic.inputValue();
        await back.click();
        await inRoom(player);
        await expect(player.getByTestId("microphone-button")).toHaveAttribute("data-state", "normal");

        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Edit cam / mic" }).click();
        await expect(mic).toBeEnabled();
        await expect(mic).toHaveValue(before);
        const options = await mic.locator("option").evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value));
        const other = options.find((value) => value !== before) ?? "";
        await mic.selectOption(other);
        await player.getByRole("button", { name: "Save", exact: true }).click();
        await inRoom(player);
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "Edit cam / mic" }).click();
        await expect(mic).toHaveValue(other);
    });

    test("JN-063 Device arrow: Test my settings opens the camera screen with the X", async ({ player }) => {
        await player.locator("button.device-arrow").click();
        await player.getByRole("button", { name: "Test my settings" }).click();
        await expect(cameraHeading(player)).toBeVisible();
        await expect(player.locator("button.enableCameraSceneBack")).toHaveAttribute("aria-label", "Back to your room");
    });

    test("JN-066 All settings opens Settings on General", async ({ player }) => {
        await openMenu(player);
        await profileMenu(player).getByRole("button", { name: "All settings" }).click();
        await expect(profileMenu(player)).toBeHidden();
        await expect(player.getByTestId("settings-window")).toBeVisible();
        await expect(player.getByTestId("settings-general")).toBeVisible();
    });
});
