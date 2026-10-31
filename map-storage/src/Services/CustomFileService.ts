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
        let folder: string;
        if (property.type === "openFile") {
            name = property.name ?? undefined;
            folder = UPLOADED_FILE_FORMATS[UploadedFileKind.Document].folder;
        } else if (property.type === "playAudio") {
            name = property.audioName ?? undefined;
            folder = UPLOADED_FILE_FORMATS[UploadedFileKind.Sound].folder;
        } else {
            throw new Error("Property is not a file");
        }

        if (!name) {
            throw new Error("Property is missing name. Can't find file to delete.");
        }

        const { name: filename, ext: fileExtension } = path.parse(name);

        const mapPath = mapPathUsingDomainWithPrefix(
            `/${folder}/${filename}-${property.id}${fileExtension}`,
            this.hostname
        );

        await fileSystem.deleteFiles(mapPath);
        return;
    }
}
