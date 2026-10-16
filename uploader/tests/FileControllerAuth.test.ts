import { AddressInfo } from "net";
import http from "http";
import axios from "axios";
import express from "express";
import bodyParser from "body-parser";
import FormData from "form-data";
import Jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

const SECRET = "test-secret-key";
const BOT_TOKEN = "bot-service-secret";

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
const deleteFileById = jest.fn<(id: string) => Promise<void>>();
jest.mock("../src/Service/UploaderService", () => ({
  uploaderService: {
    uploadFile: (name: string) => uploadFile(name),
    deleteFileById: (id: string) => deleteFileById(id),
  },
  CdnNotConfiguredError: class CdnNotConfiguredError extends Error {},
}));
jest.mock("../src/Service/StorageProviderService", () => ({
  getCdnProvider: () => undefined,
  isCdnConfigured: () => false,
}));

import { FileController } from "../src/Controller/FileController";

function sessionToken(payload: Record<string, unknown>, secret = SECRET, options = {}) {
  return Jwt.sign(payload, secret, options);
}

function body(files: { name: string; contents: string }[]) {
  const form = new FormData();
  files.forEach((file) => form.append("file", Buffer.from(file.contents), file.name));
  form.append("userRoomToken", "room-token");
  return form;
}

describe("chat file uploads, who may upload and delete", () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
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
    deleteFileById.mockReset();
    deleteFileById.mockResolvedValue(undefined);
  });

  function post(files: { name: string; contents: string }[], headers: Record<string, string> = {}) {
    const form = body(files);
    return axios.post(`${url}/upload-file`, form.getBuffer(), {
      headers: { ...form.getHeaders(), ...headers },
      validateStatus: () => true,
    });
  }

  const one = [{ name: "a.txt", contents: "hello" }];

  it("lets a signed-in player upload", async () => {
    const token = sessionToken({ identifier: "user@example.com", accessToken: "oidc" });
    const response = await post(one, { Authorization: token });
    expect(response.status).toBe(200);
    expect(response.data[0].name).toBe("a.txt");
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("lets a guest upload (a guest has a game session without a sign-in)", async () => {
    const token = sessionToken({ identifier: "3f1c2b8e-guest-uuid" });
    const response = await post(one, { Authorization: token });
    expect(response.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it("lets the bot server upload with its service token and no session", async () => {
    const response = await post(one, { "x-bot-service-token": BOT_TOKEN });
    expect(response.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["nothing", {}],
    ["a wrong service token", { "x-bot-service-token": "nope" }],
    ["a token signed with another key", { Authorization: sessionToken({ identifier: "x" }, "another-key") }],
    ["an expired token", { Authorization: sessionToken({ identifier: "x" }, SECRET, { expiresIn: -10 }) }],
    ["a token without an identifier", { Authorization: sessionToken({ accessToken: "oidc" }) }],
    ["some text that is not a token", { Authorization: "hello" }],
  ])("refuses an upload that comes with %s, and stores nothing", async (_name, headers) => {
    const response = await post(one, headers as Record<string, string>);
    expect(response.status).toBe(401);
    expect(response.data).toEqual({ message: "not-logged" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses a file over the size limit before storing anything, with the same answer as before", async () => {
    const token = sessionToken({ identifier: "guest" });
    const response = await post([{ name: "big.txt", contents: "x".repeat(500) }], { Authorization: token });
    expect(response.status).toBe(413);
    expect(response.data).toEqual({ message: "file-too-big", maxFileSize: "100" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("accepts ten files and refuses an eleventh, with the same answer as before", async () => {
    const token = sessionToken({ identifier: "guest" });
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `f${index}.txt`, contents: "hi" }));

    expect((await post(files(10), { Authorization: token })).status).toBe(200);
    expect(uploadFile).toHaveBeenCalledTimes(10);

    uploadFile.mockClear();
    const tooMany = await post(files(11), { Authorization: token });
    expect(tooMany.status).toBe(400);
    expect(tooMany.data).toEqual({ message: "too-many-files" });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("still refuses a blocked file type", async () => {
    const token = sessionToken({ identifier: "guest" });
    const response = await post([{ name: "run.exe", contents: "x" }], { Authorization: token });
    expect(response.status).toBe(500);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  describe("deleting", () => {
    it("is refused to a player, even with a real session", async () => {
      const token = sessionToken({ identifier: "user@example.com", accessToken: "oidc" });
      const response = await axios.delete(`${url}/upload-file/stored.txt`, {
        headers: { Authorization: token },
        validateStatus: () => true,
      });
      expect(response.status).toBe(401);
      expect(deleteFileById).not.toHaveBeenCalled();
    });

    it("is refused to anybody without the service token", async () => {
      const response = await axios.delete(`${url}/upload-file/stored.txt`, { validateStatus: () => true });
      expect(response.status).toBe(401);
      expect(deleteFileById).not.toHaveBeenCalled();
    });

    it("works for our own services", async () => {
      const response = await axios.delete(`${url}/upload-file/stored.txt`, {
        headers: { "x-bot-service-token": BOT_TOKEN },
        validateStatus: () => true,
      });
      expect(response.status).toBe(200);
      expect(deleteFileById).toHaveBeenCalledWith("stored.txt");
    });
  });
});
