import type { PushAvailability, PushDeviceInfo } from "./PushDevice";

/** What the notifications card shows. */
export type CardState = "ask" | "asking" | "on" | "blocked" | "failed" | "iphone";

/** The first thing the card shows: the iPhone way in, the steps to unblock, or the question. */
export function cardStartState(
    availability: PushAvailability,
    permission: NotificationPermission | undefined
): CardState {
    if (availability === "iphone-tab") return "iphone";
    if (permission === "denied") return "blocked";
    return "ask";
}

export type StepGroup = "android" | "desktop" | "firefox" | "safari" | "iphoneApp";

/** The three steps that undo "Block", in the words of this browser or app. */
export function blockedSteps(device: PushDeviceInfo): Array<{ group: StepGroup; key: "step1" | "step2" | "step3" }> {
    let group: StepGroup;
    if (device.installed && (device.os === "iphone" || device.os === "ipad")) group = "iphoneApp";
    else if (device.browser === "firefox") group = "firefox";
    else if (device.os === "android") group = "android";
    else if (device.browser === "safari") group = "safari";
    else group = "desktop";
    return (["step1", "step2", "step3"] as const).map((key) => ({ group, key }));
}
