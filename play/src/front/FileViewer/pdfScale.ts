/**
 * The zoom preset to apply again after the panel changes size, or undefined when there is nothing to do. A preset such
 * as "auto" or "page-width" follows the panel's width. A panel that is hidden (another side panel is shown) is 0 wide,
 * and a preset applied at that width gives a wrong zoom: it waits until the panel is shown and measured again.
 */
export function presetToApplyAgain(
    scaleValue: string | number | undefined,
    containerWidth: number
): string | undefined {
    if (containerWidth <= 0) return undefined;
    if (scaleValue === undefined || scaleValue === "" || typeof scaleValue === "number") return undefined;
    return Number.isNaN(Number(scaleValue)) ? scaleValue : undefined;
}
