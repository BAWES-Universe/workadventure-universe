/** Makes text show as typed when it goes through Markdown: a backslash before every punctuation mark. */
export function escapeMarkdown(text: string): string {
    return text.replace(/\s+/g, " ").replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/**
 * The hint over an object when you walk near it (game #1740).
 *  - A Toast Message set on any of its settings wins.
 *  - Else an object that does ONE thing on a click, with a Button Label, shows "[SPACE] <label>": the key chip and the
 *    label as typed, never a sentence around it (a link picked from Orbit fills the label with the artifact's title).
 *  - Else the usual "Press [SPACE] to interact with it" (`fallback`).
 *
 * @param settings the object's settings (a description is not one that can carry a Toast Message)
 * @param clickActionLabels the Button Label of each thing a click does, in order (a sound in range is not one)
 * @param spaceToken the [SPACE] token the hint renders as the Space key chip, "Tap" on a touch screen
 */
export function getObjectNearHint(
    settings: { type: string; triggerMessage?: string }[],
    clickActionLabels: string[],
    spaceToken: string,
    fallback: string
): string {
    for (const setting of settings) {
        if (setting.type === "entityDescriptionProperties") continue;
        if (setting.triggerMessage) return setting.triggerMessage;
    }
    if (clickActionLabels.length === 1) {
        const label = clickActionLabels[0].trim();
        if (label !== "") return `${spaceToken} ${escapeMarkdown(label)}`;
    }
    return fallback;
}
