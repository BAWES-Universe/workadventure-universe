import { WAMFileFormat } from "../types";
import type { Migrations } from "./EntitiesFileMigration";

/**
 * Eslint rules are disabled here, because we don't want to type for all possible version of the file.
 * Only the last version has his own type
 */
/* eslint-disable @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-return,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * This class takes a representation of any wam file (whatever the version of the file)
 * and will return a version of that file updated to the latest version.
 */
class WamFileMigration {
    private readonly migrations: Migrations;

    constructor() {
        this.migrations = {
            "1.0.0": (fileContent: any) => this.migrate_v1_to_v2(fileContent),
            "2.0.0": (fileContent) => fileContent,
        };
    }

    public migrate(wamFileContent: any): WAMFileFormat {
        for (const [version, migrationFunction] of Object.entries(this.migrations)) {
            const fileVersion = wamFileContent.version ?? "1.0.0";
            if (fileVersion === version) {
                try {
                    wamFileContent = migrationFunction(wamFileContent);
                } catch (error) {
                    // Remove this when tsconfig target is ES2022 (only supported on ES2022)
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    //@ts-ignore
                    throw new Error(
                        `Unable to parse entity file content in EntityCollectionRaw format migration version : ${version}`,
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        //@ts-ignore
                        {
                            cause: error,
                        }
                    );
                }
            }
        }

        return WAMFileFormat.parse(this.dropJitsi(wamFileContent));
    }

    /**
     * Jitsi is no longer supported (game #1688): our meeting rooms and bubbles replace it. An area or an object that
     * still has a Jitsi setting keeps everything else; only that setting is dropped, so the map loads as before and
     * the file loses it the next time it is saved. The Jitsi type stays readable in the schema so that code reading a
     * file without this migration still opens it.
     */
    private dropJitsi(fileContent: any): any {
        if (!fileContent || typeof fileContent !== "object") {
            return fileContent;
        }
        const withoutJitsi = (properties: any): any =>
            Array.isArray(properties)
                ? properties.filter((property: any) => property?.type !== "jitsiRoomProperty")
                : properties;

        const result = { ...fileContent };
        if (Array.isArray(fileContent.areas)) {
            result.areas = fileContent.areas.map((area: any) =>
                area && typeof area === "object" ? { ...area, properties: withoutJitsi(area.properties) } : area
            );
        }
        if (fileContent.entities && typeof fileContent.entities === "object") {
            result.entities = Object.fromEntries(
                Object.entries(fileContent.entities as Record<string, unknown>).map(([id, entity]: [string, any]) => [
                    id,
                    entity && typeof entity === "object" && "properties" in entity
                        ? { ...entity, properties: withoutJitsi(entity.properties) }
                        : entity,
                ])
            );
        }
        return result;
    }

    private migrate_v1_to_v2(fileContent: any): any {
        // Version 2 moved the Jitsi moderator tag out of the Jitsi config. Jitsi settings are now dropped altogether
        // (see dropJitsi), so nothing else changes here.
        return {
            ...fileContent,
            version: "2.0.0",
        };
    }

    public getLatestVersion(): string {
        return Object.keys(this.migrations)[Object.keys(this.migrations).length - 1];
    }
}

export const wamFileMigration = new WamFileMigration();
