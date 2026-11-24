import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Waits for the hint a Woka shows when it stands by something it can interact with (`span.characterTriggerAction`).
 *
 * The check is the same as `expect(...).toBeVisible()` and waits the same time. Only when the hint never shows does it
 * say what the page looked like, so a failure in CI tells more than "element(s) not found": what sat under the click,
 * which dialogs were open, where the map and the chat were, and a picture. It attaches the same to the test report.
 */
export async function expectTriggerHint(page: Page, testInfo: TestInfo, click: { x: number; y: number }): Promise<void> {
  try {
    await expect(page.locator("span.characterTriggerAction")).toBeVisible();
  } catch (error) {
    await reportMissingTriggerHint(page, testInfo, click);
    throw error;
  }
}

async function reportMissingTriggerHint(page: Page, testInfo: TestInfo, click: { x: number; y: number }): Promise<void> {
  try {
    const found = await page.evaluate((point) => {
      const summarise = (element: Element | null) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || undefined,
          testId: element.getAttribute("data-testid") || undefined,
          class: element.getAttribute("class")?.slice(0, 120) || undefined,
          position: style.position,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          box: [box.left, box.top, box.width, box.height].map(Math.round),
        };
      };
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height].map(Math.round);
      };
      const hints = Array.from(document.querySelectorAll("span.characterTriggerAction")).map((element) => ({
        text: element.textContent?.slice(0, 80),
        visible: element.getBoundingClientRect().width > 0,
        opacity: getComputedStyle(element.closest("div") ?? element).opacity,
      }));
      const openDialogs = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], dialog[open]"))
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => summarise(element));
      const stack = document
        .elementsFromPoint(point.x, point.y)
        .slice(0, 6)
        .map((element) => summarise(element));
      return {
        viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
        click: [point.x, point.y],
        underClick: stack,
        hints,
        openDialogs,
        canvas: rect("#game canvas") ?? rect("canvas"),
        chat: rect("#chat"),
        activeElement: summarise(document.activeElement),
      };
    }, click);
    const report = JSON.stringify(found, null, 2);
    console.log(`[trigger hint missing] ${JSON.stringify(found)}`);
    await testInfo.attach("trigger-hint-missing", { body: report, contentType: "application/json" });
    await testInfo.attach("trigger-hint-missing-screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } catch (reportError) {
    // The report must never hide the real failure
    console.log(`[trigger hint missing] could not summarise the page: ${String(reportError)}`);
  }
}
