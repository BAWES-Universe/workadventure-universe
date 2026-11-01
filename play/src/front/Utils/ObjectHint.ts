/** Makes text show as typed when it goes through Markdown: a backslash before every punctuation mark. */
export function escapeMarkdown(text: string): string {
    return text.replace(/\s+/g, " ").replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/** The parts of one of an object's settings that decide its hint. */
export type HintSetting = {
    type: string;
    triggerMessage?: string;
    buttonLabel?: string;
    link?: string | null;
    startsOn?: string;
};

/** Whether a click does something for this setting: opens its link or file, plays its sound (not one set to play in range). */
export function isClickSetting(setting: HintSetting): boolean {
    switch (setting.type) {
        case "openWebsite":
        case "openFile":
            return Boolean(setting.link);
        case "playAudio":
            // A sound that plays when someone is in range starts by itself (see ObjectSounds)
            return setting.startsOn !== "range";
        default:
            return false;
    }
}

/**
 * The hint over an object when you walk near it (game #1740). The game and the editor's Toast Message preview both
 * use this, so the preview is what the game shows.
 *  - A Toast Message set on any of its settings wins.
 *  - Else an object that does ONE thing on a click, with a Button Label, shows "[SPACE] <label>": the key chip and the
 *    label as typed, never a sentence around it (a link picked from Orbit fills the label with the artifact's title).
 *  - Else the usual "Press [SPACE] to interact with it" (`fallback`).
 *
 * @param settings the object's settings (a description is not one that can carry a Toast Message)
 * @param spaceToken the [SPACE] token the hint renders as the Space key chip, "Tap" on a touch screen
 * @param asMarkdown the hint goes through Markdown (over the object), so the label is escaped; the editor's preview
 *   shows it as plain text instead
 */
export function getObjectNearHint(
    settings: HintSetting[],
    spaceToken: string,
    fallback: string,
    asMarkdown = true
): string {
    for (const setting of settings) {
        if (setting.type === "entityDescriptionProperties") continue;
        if (setting.triggerMessage) return setting.triggerMessage;
    }
    const clickSettings = settings.filter(isClickSetting);
    if (clickSettings.length === 1) {
        const label = (clickSettings[0].buttonLabel ?? "").trim();
        if (label !== "") return `${spaceToken} ${asMarkdown ? escapeMarkdown(label) : label}`;
    }
    return fallback;
}
