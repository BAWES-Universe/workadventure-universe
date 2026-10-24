import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the local docker compose setup that lets the bot server act as a Matrix application service on the local
// Synapse. The pieces live in four files and must agree: if one drifts, bot direct messages silently stop working
// for people running the repository locally.
const root = resolve(__dirname, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

const homeserverTemplate = read("synapse/homeserver.template.yaml");
const registrationTemplate = read("synapse/appservice-universe-bots.template.yaml");
const startScript = read("synapse/start.sh");
const compose = read("docker-compose.yaml");
const composeBots = read("docker-compose.bots.yaml");
const gitignore = read(".gitignore");

function defaultOf(source: string, variable: string): string {
    const match = new RegExp(`${variable}: "?\\$\\{${variable}:-([^}"]+)\\}"?`).exec(source);
    if (!match) {
        throw new Error(`${variable} has no default in the compose file`);
    }
    return match[1];
}

describe("local Synapse registration of the bot server", () => {
    it("loads the registration file from the data folder that start.sh fills in", () => {
        expect(homeserverTemplate).toMatch(/^app_service_config_files:\n {2}- \/data\/appservice-universe-bots\.yaml$/m);
        expect(startScript).toContain(
            "envsubst < /data/appservice-universe-bots.template.yaml > /data/appservice-universe-bots.yaml"
        );
    });

    it("checks that the variables of the registration template are set before starting", () => {
        expect(startScript).toContain("/data/appservice-universe-bots.template.yaml");
        expect(startScript).toMatch(/for template in [^\n]*appservice-universe-bots\.template\.yaml/);
    });

    it("keeps the generated file out of git", () => {
        expect(gitignore).toMatch(/^synapse\/appservice-universe-bots\.yaml$/m);
    });

    it("gives tokens only as variables, never written into the template", () => {
        expect(registrationTemplate).toContain('as_token: "${MATRIX_AS_TOKEN}"');
        expect(registrationTemplate).toContain('hs_token: "${MATRIX_HS_TOKEN}"');
    });

    it("hands Synapse and the bot server the same two tokens", () => {
        const asToken = defaultOf(compose, "MATRIX_AS_TOKEN");
        const hsToken = defaultOf(compose, "MATRIX_HS_TOKEN");
        expect(defaultOf(composeBots, "MATRIX_AS_TOKEN")).toBe(asToken);
        expect(defaultOf(composeBots, "MATRIX_HS_TOKEN")).toBe(hsToken);
        expect(asToken).not.toBe(hsToken);
        for (const token of [asToken, hsToken]) {
            expect(token).toMatch(/^[A-Za-z0-9._~-]{32,}$/);
        }
    });

    it("points the bot server at the local Synapse and the registration at the bot server", () => {
        const serverName = /^server_name: "([^"]+)"$/m.exec(homeserverTemplate)?.[1];
        expect(serverName).toBe("matrix.workadventure.localhost");
        expect(defaultOf(composeBots, "MATRIX_DOMAIN")).toBe(serverName);
        expect(defaultOf(composeBots, "MATRIX_HOMESERVER_URL")).toBe("http://synapse:8008");

        const botPort = /BOT_SERVER_PORT: (\d+)/.exec(composeBots)?.[1];
        expect(registrationTemplate).toContain(`url: http://bot-server:${botPort}`);
    });

    it("claims exactly the @bot_ accounts of the local server", () => {
        const regex = /regex: '([^']+)'/.exec(registrationTemplate)?.[1];
        expect(regex).toBeDefined();
        const pattern = new RegExp(`^${regex}$`);
        expect(pattern.test("@bot_abc123:matrix.workadventure.localhost")).toBe(true);
        expect(pattern.test("@alice:matrix.workadventure.localhost")).toBe(false);
        expect(pattern.test("@bot_abc123:matrixXworkadventure.localhost")).toBe(false);
        expect(pattern.test("@bot_abc123:chat.example.com")).toBe(false);
        expect(registrationTemplate).toContain("sender_localpart: universe-bots");
        expect(registrationTemplate).toContain("rate_limited: false");
    });
});
