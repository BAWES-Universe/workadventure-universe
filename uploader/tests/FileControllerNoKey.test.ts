import { AddressInfo } from "net";
import http from "http";
import axios from "axios";
import express from "express";
import bodyParser from "body-parser";
import FormData from "form-data";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

// A server started without SECRET_KEY has nothing to check a player's session against.
jest.mock("../src/Enum/EnvironmentVariable", () => ({
  get ADMIN_API_URL() {
    return undefined;
  },
  get ENABLE_CHAT_UPLOAD() {
    return true;
  },
  get UPLOAD_MAX_FILESIZE() {
    return "100";
  },
  get SECRET_KEY() {
    return undefined;
  },
  get BOT_SERVICE_TOKEN() {
    return "bot-service-secret";
  },
  get UPLOADER_URL() {
    return "http://uploader.test";
  },
  get S3_CDN_USER_REFS_PUBLIC_URL() {
    return undefined;
  },
  get S3_CDN_BOT_GENS_PUBLIC_URL() {
    return undefined;
  },
  get S3_CDN_USER_REFS_BUCKET() {
    return undefined;
  },
  get S3_CDN_BOT_GENS_BUCKET() {
    return undefined;
  },
}));

const uploadFile = jest.fn<(name: string) => Promise<string>>();
const uploadTempFile = jest.fn<() => Promise<void>>();
jest.mock("../src/Service/UploaderService", () => ({
  uploaderService: {
    uploadFile: (name: string) => uploadFile(name),
    uploadTempFile: () => uploadTempFile(),
  },
  CdnNotConfiguredError: class CdnNotConfiguredError extends Error {},
}));
jest.mock("../src/Service/StorageProviderService", () => ({
  getCdnProvider: () => undefined,
  isCdnConfigured: () => false,
}));

import { FileController } from "../src/Controller/FileController";

describe("uploads when SECRET_KEY is not set", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = express();
    app.use(bodyParser.json());
    new FileController(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    uploadFile.mockReset();
    uploadFile.mockResolvedValue("stored.txt");
    uploadTempFile.mockReset();
  });

  function post(path: string, field: string, headers: Record<string, string> = {}) {
    const form = new FormData();
    form.append(field, Buffer.from("hello"), "a.txt");
    return axios.post(`${url}${path}`, form.getBuffer(), {
      headers: { ...form.getHeaders(), ...headers },
      validateStatus: () => true,
    });
  }

  it("refuses a file from anybody, and stores nothing", async () => {
    const response = await post("/upload-file", "file");
    expect(response.status).toBe(503);
    expect(response.data).toEqual({ message: "uploads-not-configured" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a file that comes with a made-up session", async () => {
    const response = await post("/upload-file", "file", { Authorization: "anything" });
    expect(response.status).toBe(503);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses an audio message from anybody, and stores nothing", async () => {
    const response = await post("/upload-audio-message", "file");
    expect(response.status).toBe(503);
    expect(uploadTempFile).not.toHaveBeenCalled();
  });

  it("still lets the bot server upload with its service token", async () => {
    const response = await post("/upload-file", "file", { "x-bot-service-token": "bot-service-secret" });
    expect(response.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });
});
