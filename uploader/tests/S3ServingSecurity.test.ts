import AWS from "aws-sdk";
import { beforeAll, afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { S3StorageProvider } from "../src/Service/S3StorageProvider";

describe("S3 and public CDN file-serving policy", () => {
    const upload = jest.fn<(params: AWS.S3.PutObjectRequest) => AWS.S3.ManagedUpload>();

    function provider(bucket = "user-refs") {
        return new S3StorageProvider(bucket, "us-east-1", "http://s3.test", "test-key", "test-secret");
    }

    beforeAll(() => {
        // Keep the actual AWS client and signing code; avoid network I/O for object storage and CORS setup.
        const OriginalS3 = AWS.S3;
        upload.mockReturnValue({
            promise: () => Promise.resolve({}),
        } as unknown as AWS.S3.ManagedUpload);
        jest.spyOn(AWS, "S3").mockImplementation((options) => {
            const client = new OriginalS3(options);
            jest.spyOn(client, "putBucketCors").mockReturnValue({
                promise: () => Promise.resolve({}),
            } as AWS.Request<Record<string, never>, AWS.AWSError>);
            jest.spyOn(client, "upload").mockImplementation(upload);
            return client;
        });
    });

    beforeEach(() => { upload.mockClear(); });
    afterAll(() => { jest.restoreAllMocks(); });

    it.each([
        ["a.html", "text/html", "application/octet-stream", "attachment"],
        ["a.HTML", "image/png", "application/octet-stream", "attachment"],
        ["a.svg", "image/svg+xml", "image/svg+xml", "attachment"],
        ["a.svgz", "image/png", "image/svg+xml", "attachment"],
        ["a", "text/html", "application/octet-stream", "attachment"],
        ["a.unknown", "image/png", "application/octet-stream", "attachment"],
        ["a.PNG", "text/html", "image/png", "inline"],
        ["a.mp3", "image/svg+xml", "audio/mpeg", "inline"],
        ["a.mp4", undefined, "video/mp4", "inline"],
    ])("stores safe public metadata and signs safe overrides for %s", async (key, suppliedType, safeType, disposition) => {
        for (const bucket of ["default-storage", "user-refs", "bot-gens"]) {
            const storage = provider(bucket);
            const bytes = Buffer.from("unchanged upload contents");
            expect(await storage.upload(key, bytes, suppliedType)).toBe(key);
            expect(upload.mock.calls[upload.mock.calls.length - 1][0]).toEqual({
                Bucket: bucket,
                Key: key,
                Body: bytes,
                ContentType: safeType,
                ContentDisposition: disposition,
            });

            // A real AWS v4 signed URL, including override parameters for objects with unsafe legacy metadata.
            const url = new URL(await storage.getSignedUrl(key));
            expect(url.pathname).toBe(`/${bucket}/${key}`);
            expect(url.searchParams.get("response-content-type")).toBe(safeType);
            expect(url.searchParams.get("response-content-disposition")).toBe(disposition);
            expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    it("protects a legacy object redirect without uploading it again", async () => {
        const redirect = jest.fn<(url: string) => void>();
        await provider().copyFile("old.html", { copyFromLink: redirect, copyFromBuffer: () => undefined });
        const url = new URL(redirect.mock.calls[0][0]);
        expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
        expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
        expect(upload).not.toHaveBeenCalled();
    });

    it("keeps an explicitly selected upload bucket", async () => {
        await provider().upload("a.png", Buffer.from("image"), "image/png", "bot-gens");
        expect(upload.mock.calls[0][0].Bucket).toBe("bot-gens");
    });
});
