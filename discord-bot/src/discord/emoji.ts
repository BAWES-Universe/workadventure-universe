import axios from "axios";
import type { AxiosInstance } from "axios";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as Sentry from "@sentry/node";
import type { IconKey, ReportIcons } from "./report";

/**
 * Orbit's icons for the report (#1389), as the Discord app's own emoji: Discord lets an app keep emoji of its own,
 * usable in every server it is in. On first use the bot lists them and adds any that are missing from
 * assets/emoji/<name>.png. If Discord says no, the report goes out with words only and tries again next time.
 */
export const REPORT_EMOJI: Record<IconKey, string> = {
    universe: "universe_planet",
    world: "universe_world",
    room: "universe_room",
    people: "universe_people",
    clock: "universe_clock",
};

const EMOJI_DIR = path.join(__dirname, "..", "..", "assets", "emoji");

type Http = Pick<AxiosInstance, "get" | "post">;

export class AppEmoji {
    private icons: ReportIcons | undefined;
    private reported = false;

    constructor(
        private readonly botToken: string,
        private readonly http: Http = axios,
        private readonly dir: string = EMOJI_DIR,
        private readonly baseUrl = "https://discord.com/api/v10"
    ) {}

    /** The icons, once they are set up; none while Discord refuses (the failure goes to Sentry once). */
    async get(): Promise<ReportIcons> {
        if (this.icons) return this.icons;
        try {
            this.icons = await this.setUp();
            return this.icons;
        } catch (error) {
            console.warn("Could not set up the report's emoji, sending it without icons:", describe(error));
            if (!this.reported) {
                this.reported = true;
                Sentry.captureException(error);
            }
            return {};
        }
    }

    private async setUp(): Promise<ReportIcons> {
        const headers = { Authorization: `Bot ${this.botToken}` };
        const app = await this.http.get<{ id: string }>(`${this.baseUrl}/applications/@me`, { headers });
        const emojiUrl = `${this.baseUrl}/applications/${app.data.id}/emojis`;
        const listed = await this.http.get<{ items: Array<{ id: string; name: string }> }>(emojiUrl, { headers });
        const existing = new Map(listed.data.items.map((emoji) => [emoji.name, emoji.id]));

        const icons: ReportIcons = {};
        for (const [key, name] of Object.entries(REPORT_EMOJI) as Array<[IconKey, string]>) {
            let id = existing.get(name);
            if (!id) {
                const image = (await readFile(path.join(this.dir, `${name}.png`))).toString("base64");
                const created = await this.http.post<{ id: string }>(
                    emojiUrl,
                    { name, image: `data:image/png;base64,${image}` },
                    { headers: { ...headers, "Content-Type": "application/json" } }
                );
                id = created.data.id;
                console.log(`Added the ${name} emoji to the Discord app`);
            }
            icons[key] = { id, name };
        }
        return icons;
    }
}

function describe(error: unknown): string {
    if (axios.isAxiosError(error)) return `${error.response?.status ?? ""} ${error.message}`.trim();
    return error instanceof Error ? error.message : String(error);
}
