import path from "path";
import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";
import { getUploadedFileFormat, UPLOADED_FILE_FORMATS } from "@workadventure/map-editor";
import type { UploadFileMessage } from "@workadventure/messages";
import { UploadedFileKind } from "@workadventure/messages";
import { fileSystem } from "../fileSystem";
import { mapPathUsingDomainWithPrefix } from "./PathMapper";

export class CustomFileService {
    private readonly hostname: string;

    constructor(hostname: string) {
        this.hostname = hostname;
    }

    public async uploadFile(uploadFileMessage: UploadFileMessage) {
        const { file } = uploadFileMessage;
        const { name: filename, ext: fileExtension } = path.parse(uploadFileMessage.name);
        const format = getUploadedFileFormat(uploadFileMessage.kind);
        if (!format) {
            throw new Error("Unknown kind of file");
        }

        const errorm = "File extension is not a supported format :" + fileExtension + uploadFileMessage.name;

        if (!fileExtension.match(format.extensions)) {
            throw new Error(errorm);
        }

        // The property id becomes part of the storage path, so it must not be able to leave the files folder
        if (!/^[A-Za-z0-9_-]+$/.test(uploadFileMessage.propertyId)) {
            throw new Error("Invalid property id");
        }

        const mapPath = mapPathUsingDomainWithPrefix(
            `/${format.folder}/${filename}-${uploadFileMessage.propertyId}${fileExtension}`,
            this.hostname
        );
        console.info("Uploading file to: ", mapPath);
        await fileSystem.writeByteArrayAsFile(mapPath, file);
        return;
    }

    public async deleteFile(property: AreaDataProperty | EntityDataProperty) {
        let name: string | undefined;
        let format: (typeof UPLOADED_FILE_FORMATS)[keyof typeof UPLOADED_FILE_FORMATS];
        if (property.type === "openFile") {
            name = property.name ?? undefined;
            format = UPLOADED_FILE_FORMATS[UploadedFileKind.Document];
        } else if (property.type === "playAudio") {
            name = property.audioName ?? undefined;
            format = UPLOADED_FILE_FORMATS[UploadedFileKind.Sound];
        } else {
            throw new Error("Property is not a file");
        }

        if (!name) {
            throw new Error("Property is missing name. Can't find file to delete.");
        }

        const { name: filename, ext: fileExtension } = path.parse(name);

        // The id and the extension become part of the storage path, so they must not be able to leave the files
        // folder. Same rules as when the file was uploaded.
        if (!/^[A-Za-z0-9_-]+$/.test(property.id)) {
            throw new Error("Invalid property id");
        }
        if (!fileExtension.match(format.extensions)) {
            throw new Error("File extension is not a supported format :" + fileExtension);
        }

        const mapPath = mapPathUsingDomainWithPrefix(
            `/${format.folder}/${filename}-${property.id}${fileExtension}`,
            this.hostname
        );

        await fileSystem.deleteFiles(mapPath);
        return;
    }
}
