<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { BotData } from "../types";
    import { hoveredBotIdStore } from "../stores/BotEditorStore";
    import { setBotEnabled } from "../services/botEnabled";
    import { ensureBotWokaCatalog } from "../stores/BotWokaCatalogStore";
    import LL from "../../../../i18n/i18n-svelte";
    import BotRow from "./BotRow.svelte";
    import { IconChevronDown, IconPlus, IconRobot } from "@wa-icons";

    export let bots: BotData[] = [];
    export let onSelectBot: (bot: BotData | null) => void;
    export let onCreateBot: () => void;

    $: page = $LL.mapEditor.edit.bots.page;

    let loading = true;
    let error: string | null = null;

    type Section = "active" | "inactive";
    const COLLAPSED_STORAGE_KEY = "botEditor.collapsedSections";

    // Which section each bot is shown in. It is fixed when the bot first appears in the list,
    // so toggling a bot does not move it away from under the cursor. It settles into the
    // right section the next time the list opens.
    let placement = new Map<string, Section>();
    let togglingIds = new Set<string>();
    let collapsed: Record<Section, boolean> = readCollapsed();

    function readCollapsed(): Record<Section, boolean> {
        try {
            const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<Record<Section, boolean>>;
                return { active: parsed.active === true, inactive: parsed.inactive === true };
            }
        } catch {
            // Storage unavailable; fall back to defaults
        }
        return { active: false, inactive: false };
    }

    function toggleSection(section: Section) {
        collapsed = { ...collapsed, [section]: !collapsed[section] };
        try {
            localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
        } catch {
            // Storage unavailable; the choice lasts until the list closes
        }
    }

    $: {
        const next = new Map<string, Section>();
        for (const bot of bots) {
            next.set(bot.id, placement.get(bot.id) ?? (bot.enabled === false ? "inactive" : "active"));
        }
        placement = next;
    }

    $: sections = (["active", "inactive"] as const).map((key) => ({
        key,
        title: key === "active" ? page.list.active() : page.list.inactive(),
        bots: bots.filter((bot) => placement.get(bot.id) === key),
    }));

    // Load bots from API
    function loadBots() {
        loading = true;
        error = null;
        try {
            // TODO: Replace with actual API call
            // const response = await botApiService.getBots();
            // bots = response.data;
            // Don't overwrite bots if they're already loaded
            // The parent component manages the bots list
            // This function is mainly for retry scenarios
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load bots";
            console.error("Error loading bots:", e);
        } finally {
            loading = false;
        }
    }

    async function handleToggleBot(bot: BotData, enabled: boolean) {
        if (togglingIds.has(bot.id)) return;

        // Flip the switch right away and lock it until the API answers
        togglingIds = new Set(togglingIds).add(bot.id);

        try {
            await setBotEnabled(bot, enabled);
        } catch (e) {
            console.error("Error toggling bot:", e);

            // Check if it's an authentication error
            const errorWithAuth = e as Error & { isAuthError?: boolean; isSessionExpired?: boolean };
            const isAuthError = errorWithAuth?.isAuthError === true;
            const isSessionExpired = errorWithAuth?.isSessionExpired === true;

            if (isAuthError) {
                // Show user-friendly error message
                error = isSessionExpired
                    ? "Your session has expired. Please re-authenticate to continue managing bots."
                    : "Authentication failed. Please ensure you are logged in.";

                // Clear error after 5 seconds
                setTimeout(() => {
                    error = null;
                }, 5000);
            }
        } finally {
            const next = new Set(togglingIds);
            next.delete(bot.id);
            togglingIds = next;
        }
    }

    function handleHoverBot(botId: string | undefined) {
        hoveredBotIdStore.set(botId);
    }

    onMount(() => {
        // The rows draw each bot's WOKA from the room's catalogue, so it is loaded here too, not only on a bot's page
        void ensureBotWokaCatalog();
        // Only load if bots array is empty
        // If bots are already provided via prop, skip loading
        if (bots.length === 0) {
            void loadBots();
        } else {
            loading = false;
        }
    });

    onDestroy(() => {
        // Clear hover state when component is destroyed
        hoveredBotIdStore.set(undefined);
    });
</script>

<div class="bl" data-testid="bot-list">
    {#if loading}
        <p class="bl-note">Loading…</p>
    {:else if error}
        <p class="bl-note bl-bad">{error}</p>
        <button type="button" class="bl-pill" on:click={loadBots}>Retry</button>
    {:else if bots.length === 0}
        <div class="bl-empty">
            <span class="bl-empty-ico"><IconRobot font-size="36" /></span>
            <p class="bl-empty-t">{page.list.empty()}</p>
            <p class="bl-note">{page.list.emptyHint()}</p>
            <button type="button" class="bl-pill bl-cta" data-testid="bot-new" on:click={onCreateBot}>
                <IconPlus font-size="18" />
                {page.list.newBot()}
            </button>
        </div>
    {:else}
        <button type="button" class="bl-pill bl-cta" data-testid="bot-new" on:click={onCreateBot}>
            <IconPlus font-size="18" />
            {page.list.newBot()}
        </button>
        <div class="bl-scroll">
            {#each sections as section (section.key)}
                {#if section.bots.length > 0}
                    <button
                        type="button"
                        class="bl-sec"
                        aria-expanded={!collapsed[section.key]}
                        on:click={() => toggleSection(section.key)}
                    >
                        <span>{section.title} · {section.bots.length}</span>
                        <span class="bl-chev" class:closed={collapsed[section.key]}
                            ><IconChevronDown font-size="16" /></span
                        >
                    </button>
                    {#if !collapsed[section.key]}
                        {#each section.bots as bot (bot.id)}
                            {@const botId = bot.id}
                            <BotRow
                                {bot}
                                toggling={togglingIds.has(bot.id)}
                                onSelect={() => {
                                    // Look up bot by ID to ensure we get the latest data
                                    const latestBot = bots.find((b) => b.id === botId);
                                    onSelectBot(latestBot ?? bot);
                                }}
                                onToggle={handleToggleBot}
                                onHover={handleHoverBot}
                            />
                        {/each}
                    {/if}
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .bl {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        color: #fff;
    }
    .bl-scroll {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .bl-sec {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        min-height: 44px;
        margin: 4px 0 0;
        padding: 0 8px;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
        cursor: pointer;
    }
    .bl-chev {
        display: grid;
        place-items: center;
        transition: transform 0.15s;
    }
    .bl-chev.closed {
        transform: rotate(-90deg);
    }
    .bl-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .bl-cta {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
    }
    .bl-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bl-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 40px 12px;
        text-align: center;
    }
    .bl-empty-ico {
        color: rgba(255, 255, 255, 0.85);
    }
    .bl-empty-t {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }
    .bl-note {
        margin: 0;
        padding: 0 8px;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .bl-bad {
        color: #ff8a7a;
    }
</style>
