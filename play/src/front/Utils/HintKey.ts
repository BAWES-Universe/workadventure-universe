/** The key chip of a hint pill: "Space" on a computer, "Tap" on a touch screen. The label is plain text, never user input. */
export function hintKeyHtml(label: string): string {
    return `<kbd class="u-hint-key">${label}</kbd>`;
}

/** Shows every [SPACE] in a hint as the key chip. */
export function replaceSpaceToken(html: string, token: string, keyLabel: string): string {
    if (token === "") return html;
    return html.split(token).join(hintKeyHtml(keyLabel));
}

/** The plain white sound icon (volume), drawn on a 24 x 24 grid, as the menus draw their icons. */
export const SOUND_ICON_PATHS = [
    "M15 8a5 5 0 0 1 0 8",
    "M17.7 5a9 9 0 0 1 0 14",
    "M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5",
];
