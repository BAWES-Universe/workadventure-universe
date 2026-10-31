import { UPLOADED_FILE_FORMATS } from "@workadventure/map-editor";
import { UploadedFileKind } from "@workadventure/messages";
import type { MapStorageJwtAnswer } from "@workadventure/messages";

const SOUNDS_FOLDER = `/${UPLOADED_FILE_FORMATS[UploadedFileKind.Sound].folder}/`;

/**
 * Where an uploaded sound is stored: the map-storage root, like "Open file" uploads (#1626). The name is encoded, so a
 * "#", "?" or "%" in it stays part of the file's path.
 */
export function uploadedSoundLink(mapStorageUrl: URL, fileName: string, propertyId: string): string {
    const lastDot = fileName.lastIndexOf(".");
    const name = fileName.slice(0, lastDot);
    const ext = fileName.slice(lastDot + 1);
    return new URL(
        `${SOUNDS_FOLDER.slice(1)}${encodeURIComponent(`${name}-${propertyId}.${ext}`)}`,
        `${mapStorageUrl.protocol}//${mapStorageUrl.host}`
    ).toString();
}

/** The link is a sound uploaded to map-storage, which is read only with the map's access token. */
export function isUploadedSoundLink(link: string, mapStorageUrl: URL | undefined): boolean {
    if (!mapStorageUrl) {
        return false;
    }
    try {
        const url = new URL(link);
        return url.host === mapStorageUrl.host && url.pathname.startsWith(SOUNDS_FOLDER);
    } catch {
        return false;
    }
}

/**
 * The link to play: an uploaded sound gets the map's access token, any other link stays as it is (so a pasted link
 * never waits for a token).
 */
export async function playableSoundLink(
    link: string,
    mapStorageUrl: URL | undefined,
    queryToken: (() => Promise<MapStorageJwtAnswer>) | undefined
): Promise<string> {
    if (!queryToken || !isUploadedSoundLink(link, mapStorageUrl)) {
        return link;
    }
    const answer = await queryToken();
    const url = new URL(link);
    url.searchParams.set("token", answer.jwt);
    return url.toString();
}
