/**
 * What an audio file in chat is called. A name a person gave it is shown tidied ("Desert Drive"); a name a machine
 * made (a random id, a long run of digits) says nothing, so the file is named after who sent it instead.
 * The real name is only for Download.
 */
export function audioFileStem(fileName: string): string {
    return fileName.replace(/\.[a-z0-9]{2,5}$/i, "").trim();
}

export function isMachineMadeName(fileName: string): boolean {
    const stem = audioFileStem(fileName);
    return (
        stem === "" ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem) ||
        /^[0-9a-f]{16,}$/i.test(stem) ||
        /\d{8,}/.test(stem) ||
        /^[A-Za-z0-9_-]{24,}$/.test(stem)
    );
}

/** The title shown above the player; undefined when the sender's name has to stand in for it. */
export function audioFileTitle(fileName: string | undefined): string | undefined {
    if (!fileName || isMachineMadeName(fileName)) return undefined;
    return audioFileStem(fileName).replace(/_+/g, " ").replace(/\s+/g, " ");
}

/** The file's type as people know it ("MP3"), from its name. */
export function audioFileKind(fileName: string | undefined): string | undefined {
    return fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
}
