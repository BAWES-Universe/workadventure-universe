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
      // Leading slash required: map-storage builds the URL it uses to clear its in-memory copy of each
      // uploaded map as `${host}${directory}/${file}`. Without it, the edited map outlives the reset.
      directory: `/${e2e_wam_directory}`,
    },
  });
  expect(uploadFile1.ok()).toBeTruthy();
}
