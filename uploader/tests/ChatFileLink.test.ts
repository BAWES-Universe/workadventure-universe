import { AddressInfo } from "net";
import http from "http";
import axios from "axios";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../src/Enum/EnvironmentVariable", () => ({
  get ADMIN_API_URL() {
    return "http://admin.test";
  },
  get ENABLE_CHAT_UPLOAD() {
    return true;
  },
  get UPLOAD_MAX_FILESIZE() {
    return "100";
  },
  get SECRET_KEY() {
    return "test-secret-key";
  },
  get BOT_SERVICE_TOKEN() {
    return "bot-service-secret";
  },
  get UPLOADER_URL() {
    return "http://uploader.test";
  },
  // The players' bucket has no public link (its links are signed), the bots' bucket has one.
  get S3_CDN_USER_REFS_PUBLIC_URL() {
    return undefined;
  },
  get S3_CDN_BOT_GENS_PUBLIC_URL() {
    return "https://bots.cdn.test";
  },
  get S3_CDN_USER_REFS_BUCKET() {
    return "user-refs";
  },
  get S3_CDN_BOT_GENS_BUCKET() {
    return "bot-gens";
  },
}));

const getSignedUrl = jest.fn<(key: string) => Promise<string>>();
jest.mock("../src/Service/UploaderService", () => ({
  uploaderService: {},
  CdnNotConfiguredError: class CdnNotConfiguredError extends Error {},
}));
jest.mock("../src/Service/StorageProviderService", () => ({
  getCdnProvider: (bucket: string) =>
    bucket === "user-refs" ? { getSignedUrl } : null,
  isCdnConfigured: () => true,
}));

import { FileController } from "../src/Controller/FileController";

const ID = "0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.png";

describe("a lasting link to a chat file", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    new FileController(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    getSignedUrl.mockReset();
    getSignedUrl.mockResolvedValue(
      `https://s3.test/user-refs/${ID}?X-Amz-Signature=fresh`
    );
  });

  const open = (path: string) =>
    axios.get(`${url}${path}`, { maxRedirects: 0, validateStatus: () => true });

  it("sends a player's file on to a fresh signed link, never cached", async () => {
    const response = await open(`/chat-file/user-refs/${ID}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      `https://s3.test/user-refs/${ID}?X-Amz-Signature=fresh`
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(getSignedUrl).toHaveBeenCalledWith(ID);
  });

  it("sends a file from a bucket with a public link straight to it", async () => {
    const response = await open(`/chat-file/bot-gens/${ID}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`https://bots.cdn.test/${ID}`);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("opens a file with any extension the uploader stores, up to 16 characters", async () => {
    const long = ID.replace(".png", ".webmanifest");
    const response = await open(`/chat-file/bot-gens/${long}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`https://bots.cdn.test/${long}`);
    const tooLong = ID.replace(".png", ".abcdefghijklmnopq");
    expect((await open(`/chat-file/bot-gens/${tooLong}`)).status).toBe(404);
  });

  it("looks up nothing outside the chat buckets or for an id the uploader never makes", async () => {
    expect((await open(`/chat-file/other-bucket/${ID}`)).status).toBe(404);
    expect((await open(`/chat-file/user-refs/secret.txt`)).status).toBe(404);
    expect(
      (await open(`/chat-file/user-refs/${encodeURIComponent("../" + ID)}`))
        .status
    ).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 500, without a link, when signing fails", async () => {
    getSignedUrl.mockRejectedValue(new Error("S3 down"));
    const response = await open(`/chat-file/user-refs/${ID}`);
    expect(response.status).toBe(500);
    expect(response.headers.location).toBeUndefined();
  });
});
