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
import { readReceipt, receiptKey, sha256Hex, signReceipt } from "../src/Service/UploadReceipt";

function sessionToken(payload: Record<string, unknown>, secret = SECRET, options = {}) {
  return Jwt.sign(payload, secret, options);
}

function body(files: { name: string; contents: string }[]) {
  const form = new FormData();
  files.forEach((file) => form.append("file", Buffer.from(file.contents), file.name));
  form.append("userRoomToken", "room-token");
  return form;
}


describe("upload receipts (voice notes for every bot, plan v3 section 5)", () => {
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
    uploadFile.mockResolvedValue("stored.ogg");
  });

  function post(headers: Record<string, string>, purpose?: string) {
    const form = new FormData();
    form.append("file", Buffer.from("the note"), "note.ogg");
    form.append("userRoomToken", "room-token");
    if (purpose) form.append("purpose", purpose);
    return axios.post(`${url}/upload-file`, form.getBuffer(), {
      headers: { ...form.getHeaders(), ...headers },
      validateStatus: () => true,
    });
  }

  const guest = "3f1c2b8e-0000-4000-8000-000000000001";

  it("gives a guest's upload a receipt naming the guest, the file and its hash", async () => {
    const response = await post({ Authorization: sessionToken({ identifier: guest }) }, "guest-brick");
    expect(response.status).toBe(200);
    const claims = readReceipt(response.data[0].receipt, SECRET);
    expect(claims).toMatchObject({
      iss: "uploader",
      sub: guest,
      aud: "guest-brick",
      fid: "stored.ogg",
      bkt: null,
      loc: "http://uploader.test/upload-file/stored.ogg",
      sha256: sha256Hex(Buffer.from("the note")),
      size: 8,
      len: "unmeasured",
    });
    expect(claims!.exp).toBeGreaterThan(Date.now());
  });

  it("calls an upload with no purpose, or one it does not know, a chat file", async () => {
    const token = sessionToken({ identifier: guest });
    expect(readReceipt((await post({ Authorization: token })).data[0].receipt, SECRET)?.aud).toBe("chat-file");
    expect(readReceipt((await post({ Authorization: token }, "admin")).data[0].receipt, SECRET)?.aud).toBe("chat-file");
  });

  it("gives the bot server's own uploads no receipt", async () => {
    const response = await post({ "x-bot-service-token": BOT_TOKEN });
    expect(response.status).toBe(200);
    expect(response.data[0].receipt).toBeUndefined();
  });

  it("signs with a key of its own, never the game's secret", () => {
    expect(receiptKey(SECRET).equals(Buffer.from(SECRET))).toBe(false);
    const token = signReceipt(
      { sub: guest, aud: "chat-file", fid: "f", bkt: null, loc: "l", sha256: "h", name: "n", type: "t", size: 1, len: "unmeasured", iat: 1, exp: Date.now() + 1000 },
      SECRET
    );
    // The same claims signed with the plain secret are refused
    const [body] = token.split(".");
    const plain = require("crypto").createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(readReceipt(`${body}.${plain}`, SECRET)).toBeNull();
    expect(readReceipt(token, "another-secret")).toBeNull();
    expect(readReceipt(token, SECRET)?.sub).toBe(guest);
  });

  it("refuses a receipt whose claims were changed", () => {
    const token = signReceipt(
      { sub: guest, aud: "chat-file", fid: "f", bkt: null, loc: "l", sha256: "h", name: "n", type: "t", size: 1, len: "unmeasured", iat: 1, exp: Date.now() + 1000 },
      SECRET
    );
    const [body, mac] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: "someone-else" })).toString("base64url");
    expect(readReceipt(`${forged}.${mac}`, SECRET)).toBeNull();
  });

  function refresh(receipt: string, identifier: string) {
    return axios.post(`${url}/receipt/refresh`, { receipt }, { headers: { Authorization: sessionToken({ identifier }) }, validateStatus: () => true });
  }

  const expired = (sub: string, endedAgoMs: number) =>
    signReceipt(
      { sub, aud: "guest-brick", fid: "stored.ogg", bkt: null, loc: "old", sha256: "abc", name: "note.ogg", type: "audio/ogg", size: 8, len: "unmeasured", iat: 1, exp: Date.now() - endedAgoMs },
      SECRET
    );

  it("renews an expired receipt for the one who uploaded the file, with the same hash", async () => {
    const response = await refresh(expired(guest, 60_000), guest);
    expect(response.status).toBe(200);
    const claims = readReceipt(response.data.receipt, SECRET);
    expect(claims).toMatchObject({ sub: guest, fid: "stored.ogg", sha256: "abc", loc: "http://uploader.test/upload-file/stored.ogg" });
    expect(claims!.exp).toBeGreaterThan(Date.now());
  });

  it("never renews another guest's receipt, a forged one or one that ran out long ago", async () => {
    expect((await refresh(expired(guest, 60_000), "3f1c2b8e-0000-4000-8000-000000000002")).status).toBe(403);
    expect((await refresh("forged.receipt", guest)).status).toBe(403);
    expect((await refresh(expired(guest, 8 * 24 * 60 * 60 * 1000), guest)).status).toBe(403);
    const anonymous = await axios.post(`${url}/receipt/refresh`, { receipt: expired(guest, 1) }, { validateStatus: () => true });
    expect(anonymous.status).toBe(401);
  });
});
