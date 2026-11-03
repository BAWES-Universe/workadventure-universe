(window as unknown as { env: Record<string, unknown> }).env = {};
import "../src/front/style/index.scss";
import { loadLocale } from "../src/i18n/i18n-util.sync";
import { setLocale } from "../src/i18n/i18n-svelte";
import BotDetailView from "../src/front/external-modules/bots/components/BotDetailView.svelte";
import { state } from "./stubs/state";

loadLocale("en-US");
setLocale("en-US");
const q = new URLSearchParams(location.search);
if (q.get("desk")) document.body.classList.add("desk");
const moved = state.viewer !== "sara" ? state.on === "key-khalid" : false;
const bot = {
    id: "b1",
    name: state.bot ?? "Linear SH",
    description: "Answers questions about our Linear board",
    characterTexture: "",
    behaviorType: "idle",
    behaviorConfig: { behaviorType: "idle", assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } },
    aiProviderRef: state.on,
    aiModel: state.on === "key-khalid" ? "claude-sonnet-5-5" : state.on === "key-sara" ? "deepseek-chat" : null,
    chatInstructions: "You help the team find and update Linear issues.",
    enabled: true,
    createdAt: "2026-10-12T09:00:00Z",
    updatedAt: "2026-10-28T21:00:00Z",
    createdBy: { id: "sara", name: "Sara" },
    updatedBy: moved || new URLSearchParams(location.search).get("s") === "sara-moved" ? { id: "khalid", name: "Khalid" } : { id: "sara", name: "Sara" },
};
new BotDetailView({
    target: document.getElementById("app")!,
    props: { bot, onSave: () => {}, onDelete: () => {}, onLocate: () => {} },
});
