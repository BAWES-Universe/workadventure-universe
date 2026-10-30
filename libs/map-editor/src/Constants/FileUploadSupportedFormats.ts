import { UploadedFileKind } from "@workadventure/messages";

export const fileUploadSupportedFormatForMapStorage = new RegExp(".(pdf|jpg|jpeg|png|gif|webp|bmp|svg)$", "i");
export const FILE_UPLOAD_SUPPORTED_FORMATS_FRONT =
    "application/pdf,image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml";

export type UploadableFileKind = Exclude<UploadedFileKind, UploadedFileKind.UNRECOGNIZED>;

interface UploadedFileFormat {
    /** The map-storage folder the file goes to. Both are private: read with the map's access token. */
    folder: string;
    /** The extensions map-storage accepts. */
    extensions: RegExp;
    /** The formats the front offers, as in the `accept` attribute of a file input. */
    accept: string;
}

/**
 * Files uploaded from the map editor: "Open file" documents and "Play a sound" sounds (#1626). Unlike upstream
 * WorkAdventure, which serves sounds to anyone with the link, sounds are stored like documents.
 */
export const UPLOADED_FILE_FORMATS: Record<UploadableFileKind, UploadedFileFormat> = {
    [UploadedFileKind.Document]: {
        folder: "private/files",
        extensions: fileUploadSupportedFormatForMapStorage,
        accept: FILE_UPLOAD_SUPPORTED_FORMATS_FRONT,
    },
    [UploadedFileKind.Sound]: {
        folder: "private/sounds",
        extensions: /\.(mp3|wav|ogg|m4a)$/i,
        accept: ".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a",
    },
};

/** Undefined for a kind this version does not know, which a client could send. */
export function getUploadedFileFormat(kind: UploadedFileKind): UploadedFileFormat | undefined {
    return kind === UploadedFileKind.UNRECOGNIZED ? undefined : UPLOADED_FILE_FORMATS[kind];
}
