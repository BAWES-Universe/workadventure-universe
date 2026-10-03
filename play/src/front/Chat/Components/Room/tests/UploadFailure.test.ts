import { describe, expect, it } from "vitest";
import { mainUploadFailure, UploadFailure, uploadFailureReason } from "../UploadFailure";

describe("chat upload failure reason", () => {
    it("reads the uploader's answers", () => {
        expect(uploadFailureReason(413, "file-too-big")).toBe("tooBig");
        expect(uploadFailureReason(413, undefined)).toBe("tooBig");
        expect(uploadFailureReason(401, "disabled")).toBe("disabled");
        expect(uploadFailureReason(401, "not-logged")).toBe("refused");
        expect(uploadFailureReason(423, undefined)).toBe("refused");
        expect(uploadFailureReason(500, "Internal server error")).toBe("other");
        expect(uploadFailureReason(undefined, undefined)).toBe("other");
    });

    it("names the reason the user can act on first", () => {
        const refused = new UploadFailure("refused", 401, "not-logged");
        const tooBig = new UploadFailure("tooBig", 413, "file-too-big", 10485760);
        expect(mainUploadFailure([refused, tooBig])).toBe(tooBig);
        expect(mainUploadFailure([refused])).toBe(refused);
        expect(mainUploadFailure([])).toBeUndefined();
    });
});
