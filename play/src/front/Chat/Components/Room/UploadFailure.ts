/** Why the uploader turned a chat file down, read from its answer (uploader/src/Controller/FileController.ts). */
export type UploadFailureReason = "tooBig" | "disabled" | "refused" | "other";

export function uploadFailureReason(status: number | undefined, serverMessage: unknown): UploadFailureReason {
    if (status === 413 || serverMessage === "file-too-big") return "tooBig";
    // "disabled" also comes back as a 401, so it is told apart before the other refusals.
    if (serverMessage === "disabled") return "disabled";
    if (status === 401 || status === 403 || status === 423) return "refused";
    return "other";
}

export class UploadFailure extends Error {
    constructor(
        readonly reason: UploadFailureReason,
        readonly status?: number,
        readonly serverMessage?: string,
        readonly maxFileSize?: number
    ) {
        super(serverMessage || `Upload failed (${status ?? "network"})`);
    }
}

const PRIORITY: UploadFailureReason[] = ["tooBig", "disabled", "refused", "other"];

/** With files failing for different reasons, the error line names the one the user can act on first. */
export function mainUploadFailure(failures: UploadFailure[]): UploadFailure | undefined {
    return [...failures].sort((a, b) => PRIORITY.indexOf(a.reason) - PRIORITY.indexOf(b.reason))[0];
}
