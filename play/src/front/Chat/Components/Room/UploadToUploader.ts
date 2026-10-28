import { UPLOADER_URL } from "../../../Enum/EnvironmentVariable";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { UploadFailure, uploadFailureReason } from "./UploadFailure";

export interface UploadedFile {
    location: string;
    name: string;
    type: string;
}

function numberField(data: unknown, key: string): number | undefined {
    if (typeof data !== "object" || data === null || !(key in data)) return undefined;
    const value: unknown = (data as Record<string, unknown>)[key];
    return typeof value === "number" ? value : undefined;
}

function stringField(data: unknown, key: string): string | undefined {
    if (typeof data !== "object" || data === null || !(key in data)) return undefined;
    const value: unknown = (data as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

/**
 * Sends one file to the uploader (our R2 bucket) for the nearby chat, which has no Matrix room to host it.
 * Throws an UploadFailure saying why when the uploader cannot be reached or turns the file down.
 */
export async function uploadToUploader(file: File, userToken: string | undefined): Promise<UploadedFile> {
    const formData = new FormData();
    formData.append("file", file);
    if (userToken) {
        formData.append("userRoomToken", userToken);
    }
    let response: Response;
    try {
        response = await fetch(`${UPLOADER_URL}/upload-file`, {
            method: "POST",
            // The game session, so the uploader knows the file comes from somebody in the game.
            headers: { Authorization: localUserStore.getAuthToken() ?? "" },
            body: formData,
        });
    } catch {
        throw new UploadFailure("other", undefined, "network-error");
    }
    if (!response.ok) {
        const errData: unknown = await response.json().catch(() => ({}));
        const serverMessage = stringField(errData, "message");
        throw new UploadFailure(
            uploadFailureReason(response.status, serverMessage),
            response.status,
            serverMessage,
            numberField(errData, "maxFileSize")
        );
    }
    const data = await response.json();
    if (!data || data.length === 0) {
        throw new UploadFailure("other", response.status, "no-data");
    }
    return { location: data[0].location, name: data[0].name, type: file.type };
}
