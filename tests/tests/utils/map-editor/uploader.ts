import fs from "fs";
import type { APIRequestContext} from "@playwright/test";
import { expect } from "@playwright/test";
import { e2e_wam_directory, map_storage_url } from "../urls";

/**
 * Reset the map storage to the default WAM maps
 */
export async function resetWamMaps(request: APIRequestContext) {
  const uploadFile1 = await request.post(new URL("upload", map_storage_url).toString(), {
    multipart: {
      file: fs.createReadStream("../map-storage/tests/assets.zip"),
      directory: e2e_wam_directory,
    },
  });
  expect(uploadFile1.ok()).toBeTruthy();
}
