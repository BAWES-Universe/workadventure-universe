import { describe, expect, it } from "vitest";
import {
    ENTITIES_FOLDER_PATH,
    ENTITIES_FOLDER_PATH_NO_PREFIX,
    ENTITY_COLLECTION_FILE,
} from "../src/Constants/CustomEntityCollectionConstants";

describe("CustomEntityCollectionConstants", () => {
    it("ENTITIES_FOLDER_PATH should not have a leading slash to avoid double slashes in URL construction", () => {
        expect(ENTITIES_FOLDER_PATH.startsWith("/")).toBe(false);
        expect(ENTITIES_FOLDER_PATH).toBe("assets/entities");
    });

    it("ENTITIES_FOLDER_PATH_NO_PREFIX should match ENTITIES_FOLDER_PATH without leading slash", () => {
        expect(ENTITIES_FOLDER_PATH_NO_PREFIX).toBe("assets/entities");
    });

    it("should construct valid paths without double slashes", () => {
        const universeWorldPath = "universe/world/";
        const entityCollectionPath = `${universeWorldPath}${ENTITIES_FOLDER_PATH}/${ENTITY_COLLECTION_FILE}`;
        expect(entityCollectionPath).toBe("universe/world/assets/entities/entities.json");
        expect(entityCollectionPath).not.toContain("//");

        const baseUrl = "http://host.docker.internal:3000/";
        const fullUrl = new URL(entityCollectionPath, baseUrl).toString();
        expect(fullUrl).toBe("http://host.docker.internal:3000/universe/world/assets/entities/entities.json");
        expect(fullUrl).not.toContain("world//assets");
    });
});
