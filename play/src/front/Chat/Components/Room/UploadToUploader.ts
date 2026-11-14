import { UPLOADER_URL } from "../../../Enum/EnvironmentVariable";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { UploadFailure, uploadFailureReason } from "./UploadFailure";

export interface UploadedFile {
    location: string;
    name: string;
    type: string;
    size?: number;
    /** The uploader's receipt: who uploaded which bytes. The Brick for guests takes a file only by it. */
    receipt?: string;
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
export async function uploadToUploader(
    file: File,
    userToken: string | undefined,
    purpose?: "guest-brick"
): Promise<UploadedFile> {
    const formData = new FormData();
    formData.append("file", file);
    if (userToken) {
        formData.append("userRoomToken", userToken);
    }
    if (purpose) {
        formData.append("purpose", purpose);
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
    return {
        location: data[0].location,
        name: data[0].name,
        type: file.type,
        ...(typeof data[0].size === "number" ? { size: data[0].size } : {}),
        ...(typeof data[0].receipt === "string" ? { receipt: data[0].receipt } : {}),
    };
}

/** Renews an upload's receipt that ran out, for the one who uploaded it (the same game session). */
export async function refreshUploadReceipt(receipt: string): Promise<{ receipt: string; location: string }> {
    const response = await fetch(`${UPLOADER_URL}/receipt/refresh`, {
        method: "POST",
        headers: { Authorization: localUserStore.getAuthToken() ?? "", "Content-Type": "application/json" },
        body: JSON.stringify({ receipt }),
    });
    const data: unknown = await response.json().catch(() => ({}));
    const fresh = stringField(data, "receipt");
    const location = stringField(data, "location");
    if (!response.ok || !fresh || !location)
        throw new UploadFailure("other", response.status, stringField(data, "message"));
    return { receipt: fresh, location };
}
