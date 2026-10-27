import { loadLocale } from "../src/i18n/i18n-util.sync";
import { setLocale } from "../src/i18n/i18n-svelte";
import ToolsGroup from "../src/front/external-modules/bots/components/page/ToolsGroup.svelte";
import PageGroup from "../src/front/external-modules/bots/components/page/PageGroup.svelte";
import { IconMessageCircle2, IconSparkles } from "@wa-icons";

loadLocale("en-US");
setLocale("en-US");
const target = document.getElementById("app")!;
const bot = { id: "b1", name: "Tinyfish Researcher", aiProviderRef: "universe-ai", toolTimeoutSeconds: 90 } as any;
new PageGroup({ target, props: { id: "mind", icon: IconSparkles, title: "Mind", brief: "Universe AI", open: false, onToggle: () => {} } });
new PageGroup({ target, props: { id: "say", icon: IconMessageCircle2, title: "Personality", brief: "Sharp researcher", open: false, onToggle: () => {} } });
const aiOptions = { current: "universe-ai", universeAi: { available: true, limits: { reply: 32000, steps: 30 } }, maker: null, viewerIsMaker: true, keys: [], currentKey: null, providers: null };
const tools = new ToolsGroup({ target, props: { bot, open: true, wide: false, onToggle: () => {}, onChange: (next: any) => tools.$set({ bot: next }), aiOptions } as any });
