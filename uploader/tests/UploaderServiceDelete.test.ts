import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const defaultDelete = jest.fn<(id: string) => Promise<void>>();
const userRefsDelete = jest.fn<(id: string) => Promise<void>>();
const botGensDelete = jest.fn<(id: string) => Promise<void>>();

jest.mock("../src/Enum/EnvironmentVariable", () => ({
  get S3_CDN_USER_REFS_BUCKET() {
    return "user-refs";
  },
  get S3_CDN_BOT_GENS_BUCKET() {
    return "bot-gens";
  },
}));
jest.mock("../src/Service/StorageProviderService", () => ({
  storageProviderService: { deleteFileById: (id: string) => defaultDelete(id) },
  tempProviderService: {},
  isCdnConfigured: () => true,
  getCdnProvider: (bucket: string) => ({
    deleteFileById: (id: string) => (bucket === "user-refs" ? userRefsDelete(id) : botGensDelete(id)),
  }),
}));

import { uploaderService } from "../src/Service/UploaderService";

describe("deleting an uploaded file", () => {
  beforeEach(() => {
    [defaultDelete, userRefsDelete, botGensDelete].forEach((fn) => {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    });
  });

  it("removes it from the default storage and from every chat bucket, since the id does not say where it is", async () => {
    await uploaderService.deleteFileById("a.png");
    expect(defaultDelete).toHaveBeenCalledWith("a.png");
    expect(userRefsDelete).toHaveBeenCalledWith("a.png");
    expect(botGensDelete).toHaveBeenCalledWith("a.png");
  });

  it("does not say it worked when one storage failed, and still tries the others", async () => {
    userRefsDelete.mockRejectedValue(new Error("bucket unreachable"));
    await expect(uploaderService.deleteFileById("a.png")).rejects.toThrow("bucket unreachable");
    expect(defaultDelete).toHaveBeenCalled();
    expect(botGensDelete).toHaveBeenCalled();
  });
});
