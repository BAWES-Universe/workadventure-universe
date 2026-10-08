<script context="module" lang="ts">
    // The group left open, so the next bot opens on the same one
    let lastOpenGroup: string | undefined;
</script>

<script lang="ts">
    // The bot page, like a GPT or Discord bot's settings: the bot itself on top (its WOKA in a circle, its name and
    // description edited in place, its on/off switch, a Show on map button), then Mind, Personality, Behavior, Skills
    // and Companion, one open at a time, then who made it and Delete. Changes save on their own.
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import type { BotData } from "../types";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";
    import { botPreviewsStore, selectedBotStore, startWaypointEditing, upsertBot } from "../stores/BotEditorStore";
    import { botApiService } from "../services/BotApiService";
    import { setBotEnabled } from "../services/botEnabled";
    import { botWokaCatalogStore, ensureBotWokaCatalog } from "../stores/BotWokaCatalogStore";
    import {
        botCompanionCatalogStore,
        ensureBotCompanionCatalog,
        findCompanion,
    } from "../stores/BotCompanionCatalogStore";
    import BotWokaPicker from "./BotWokaPicker.svelte";
    import BotCompanionPicker from "./BotCompanionPicker.svelte";
    import PageSwitch from "./page/PageSwitch.svelte";
    import PageGroup from "./page/PageGroup.svelte";
    import BehaviorGroup from "./page/BehaviorGroup.svelte";
    import MindGroup from "./page/MindGroup.svelte";
    import SayGroup from "./page/SayGroup.svelte";
    import ToolsGroup from "./page/ToolsGroup.svelte";
    import BotFooter from "./page/BotFooter.svelte";
    import { IconCurrentLocation, IconPaw, IconPencil } from "@wa-icons";

    export let bot: BotData | null = null;
    export let onSave: () => void;
    export let onDelete: () => void;
    export let onLocate: (() => void) | undefined = undefined;

    let currentBot: BotData | null = null;
    /** The WOKA picker fills the panel in place of the page, as the companion picker does */
    export let editingTexture = false;
    /** The companion picker fills the panel in place of the page (BotEditor puts its title and back circle up) */
    export let editingCompanion = false;
    let switching = false;
    let switchError: string | null = null;
    let openGroup: string | undefined = lastOpenGroup;

    function toggleGroup(id: string) {
        openGroup = openGroup === id ? undefined : id;
        lastOpenGroup = openGroup;
    }

    function handleTextureKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            editingTexture = false;
            editingCompanion = false;
        }
    }

    // Subscribe to store for real-time updates from map
    const unsubscribe = selectedBotStore.subscribe((storeBot) => {
        if (storeBot && currentBot && storeBot.id === currentBot.id && storeBot.behaviorConfig) {
            // Take the whole behavior config from the store, not just the assigned space: the map also changes the
            // detection range and waypoints, and autoSave() writes currentBot back to the store, so any field left
            // stale here would undo the map change on the next edit (e.g. typing chat instructions)
            currentBot.behaviorConfig = {
                ...storeBot.behaviorConfig,
                assignedSpace: storeBot.behaviorConfig.assignedSpace
                    ? { ...storeBot.behaviorConfig.assignedSpace }
                    : currentBot.behaviorConfig?.assignedSpace ?? { center: { x: 0, y: 0 }, radius: 0 },
            };
            currentBot = currentBot; // Trigger reactivity
        }
    });

    onDestroy(() => {
        unsubscribe();
        // Leaving the view right after an edit would otherwise lose it. When the whole editor closes, BotEditor
        // calls flushPendingSaves() itself first: Svelte runs a parent's onDestroy before its children's, so by now
        // BotEditor would no longer be listening for the store update this makes.
        flushPendingSaves();
    });

    /** Run pending debounced saves now rather than dropping them */
    export function flushPendingSaves() {
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
            flushAutoSave();
        }
        if (nameSaveTimeout) {
            clearTimeout(nameSaveTimeout);
            nameSaveTimeout = null;
            flushNameSave();
        }
    }

    // Initialize from prop - handle both bot changes and bot becoming null
    $: if (bot) {
        if (bot.id !== currentBot?.id) {
            // Another bot: its page opens, not the last one's pickers
            editingCompanion = false;
            editingTexture = false;
            // Ensure behaviorType is never undefined - check both top-level and behaviorConfig
            const behaviorType = bot.behaviorType || bot.behaviorConfig?.behaviorType || "idle";

            currentBot = {
                ...bot,
                aiProviderRef: bot.aiProviderRef,
                behaviorType, // Guaranteed to be set
                behaviorConfig: bot.behaviorConfig || {
                    behaviorType,
                    assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
                },
            };
            if (!currentBot.behaviorConfig.assignedSpace) {
                currentBot.behaviorConfig.assignedSpace = { center: { x: 0, y: 0 }, radius: 0 };
            }
            // Ensure behaviorConfig also has behaviorType set
            if (!currentBot.behaviorConfig.behaviorType) {
                currentBot.behaviorConfig.behaviorType = behaviorType;
            }
            // Reset last saved name when bot changes
            lastSavedName = bot.name || null;
        }
    } else {
        // Bot prop became null - clear currentBot to prevent errors
        currentBot = null;
        lastSavedName = null;
    }

    // Debounced auto-save to prevent API calls on every keystroke
    let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
    let nameSaveTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastSavedName: string | null = null;

    // Auto-save when currentBot changes (debounced) - for AI config and behavior config only
    function autoSave() {
        if (!currentBot || !currentBot.id) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.warn("[BotDetailView] autoSave called but currentBot is null or has no id");
            }
            return;
        }

        // Clear any pending auto-save
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
        }

        // Debounce store update (wait 500ms after last change)
        // This prevents triggering the subscription in BotEditor.svelte on every keystroke
        autoSaveTimeout = setTimeout(() => {
            autoSaveTimeout = null;
            flushAutoSave();
        }, 500);
    }

    function flushAutoSave() {
        if (!currentBot || !currentBot.id) {
            return; // currentBot became null during debounce
        }
        if (!get(botPreviewsStore).has(currentBot.id)) {
            return; // The bot was deleted: upserting it would bring it back
        }
        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
            console.log("[BotDetailView] autoSave debounced, updating store");
            console.log("[BotDetailView] currentBot.chatInstructions:", currentBot.chatInstructions?.substring(0, 50));
            console.log("[BotDetailView] currentBot.aiProviderRef:", currentBot.aiProviderRef);
        }
        // Update the store to trigger subscription in BotEditor.svelte
        upsertBot({ ...currentBot }); // Create a new object to ensure reactivity
        // Don't call onSave() here - let the subscription in BotEditor handle the API call
        // onSave() is for manual saves and might interfere with auto-save
    }

    // Handle name changes separately - direct API call with immediate respawn
    function handleNameChange() {
        if (!currentBot || !currentBot.id || !botApiService.isInitialized()) {
            return;
        }

        const newName = currentBot.name?.trim() || "";
        if (newName === lastSavedName) {
            return; // No change
        }

        // Clear any pending name save
        if (nameSaveTimeout) {
            clearTimeout(nameSaveTimeout);
        }

        // Debounce name save (wait 1 second after last keystroke)
        nameSaveTimeout = setTimeout(() => {
            nameSaveTimeout = null;
            flushNameSave();
        }, 1000);
    }

    function flushNameSave() {
        const botId = currentBot?.id;
        const newName = currentBot?.name?.trim() || "";
        if (
            !currentBot ||
            !botId ||
            !botApiService.isInitialized() ||
            newName === lastSavedName ||
            !get(botPreviewsStore).has(botId)
        ) {
            return;
        }
        void (async () => {
            try {
                // Save name to API - this will trigger respawn on the server
                await botApiService.updateBot(botId, {
                    name: newName,
                });

                // The bot may have been deleted while the request was pending (the view can be gone by now):
                // upserting it would bring it back
                const latestPreview = get(botPreviewsStore).get(botId);
                if (!latestPreview) {
                    return;
                }

                // Update last saved name
                lastSavedName = newName;

                // Update store with the saved name. The server will have respawned the bot with the new name
                upsertBot({ ...latestPreview, name: newName });
            } catch (error) {
                console.error("[BotDetailView] Failed to save bot name:", error);
                // Revert name on error
                if (currentBot && currentBot.id === botId) {
                    currentBot.name = lastSavedName || "";
                    currentBot = currentBot; // Trigger reactivity
                }
            }
        })();
    }

    function getTextureUrl(relativeUrl: string): string {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl;
        }
        return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
    }

    // The bot's WOKA sheet, for the companion picker's room
    $: botSheetUrl = (() => {
        const id = currentBot?.characterTexture;
        if (!id || !$botWokaCatalogStore) return undefined;
        for (const collection of $botWokaCatalogStore.woka?.collections ?? []) {
            const texture = collection.textures.find((t) => t.id === id);
            if (texture) return getTextureUrl(texture.url);
        }
        return undefined;
    })();

    async function handleTextureSelect(textureId: string) {
        if (!currentBot) {
            console.warn("[BotDetailView] Cannot select texture: currentBot is null");
            return;
        }

        currentBot.characterTexture = textureId;
        currentBot.characterTextureIds = [textureId];
        editingTexture = false;

        // Update store immediately for UI reactivity
        upsertBot(currentBot);

        // Save to API immediately (no debounce for texture changes)
        if (currentBot.id && botApiService.isInitialized()) {
            try {
                // Save to Admin API
                await botApiService.updateBot(currentBot.id, {
                    characterTextureId: textureId,
                });

                // Despawn and respawn bot to apply texture change
                // Texture is set during spawn, so we need to respawn for it to take effect
                const despawnResult = await botApiService.despawnBot(currentBot.id);
                if (despawnResult.despawned) {
                    // Wait a brief moment before respawning
                    await new Promise<void>((resolve) => {
                        setTimeout(() => {
                            resolve();
                        }, 100);
                    });
                    const spawnResult = await botApiService.spawnBot(currentBot.id);
                    if (!spawnResult.spawned) {
                        console.warn("[BotDetailView] Failed to respawn bot after texture change:", spawnResult.reason);
                    }
                } else {
                    console.warn("[BotDetailView] Failed to despawn bot for texture change:", despawnResult.reason);
                }
            } catch (e) {
                console.error("[BotDetailView] Failed to save texture change:", e);
            }
        }

        // Also trigger the onSave callback for consistency
        onSave();
    }

    /**
     * The companion that walks with the bot: picked (or cleared) on the page and saved right away. A companion
     * joins the bot when it connects, and the bot server respawns a running bot itself when the companion
     * changes, so nothing more is needed here.
     */
    async function handleCompanionSelect(companionTextureId: string | null) {
        if (!currentBot) return;
        editingCompanion = false;
        if ((currentBot.companionTextureId ?? null) === companionTextureId) return;

        currentBot = { ...currentBot, companionTextureId };
        upsertBot(currentBot);

        if (currentBot.id && botApiService.isInitialized()) {
            try {
                await botApiService.updateBot(currentBot.id, { companionTextureId });
            } catch (e) {
                console.error("[BotDetailView] Failed to save companion change:", e);
            }
        }
        onSave();
    }

    /**
     * What the Companion row says: the companion's name, None yet, or that this room's list lacks it. An ellipsis
     * holds the line while the room's list is still loading, so the row is never blank.
     */
    function companionBrief(
        id: string | null | undefined,
        catalog: typeof $botCompanionCatalogStore,
        text: typeof page.companion
    ): string {
        if (!id) return text.none();
        if (!catalog) return "…";
        return findCompanion(catalog, id)?.name ?? text.notHere();
    }
    $: companionLine = currentBot
        ? companionBrief(currentBot.companionTextureId, $botCompanionCatalogStore, page.companion)
        : "";

    onMount(() => {
        void ensureBotWokaCatalog();
        void ensureBotCompanionCatalog();
    });

    /** A change from a group: switches and choices save right away, typing once it stops. */
    function apply(next: BotData, typing = false) {
        currentBot = next;
        if (typing) {
            autoSave();
            return;
        }
        if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
        }
        flushAutoSave();
    }

    function rename(name: string) {
        if (!currentBot) return;
        currentBot = { ...currentBot, name };
        handleNameChange();
    }

    function editRoute() {
        flushPendingSaves();
        onLocate?.();
        startWaypointEditing();
    }

    function switchOnOff(enabled: boolean) {
        const target = currentBot ? get(botPreviewsStore).get(currentBot.id) : undefined;
        if (!currentBot || !target || switching) return;
        // Save edits first: the switch saves the bot as the store has it
        flushPendingSaves();
        switching = true;
        switchError = null;
        currentBot = { ...currentBot, enabled };
        setBotEnabled(get(botPreviewsStore).get(target.id) ?? target, enabled)
            .catch((e) => {
                console.error("[BotDetailView] Failed to turn the bot on or off:", e);
                if (currentBot?.id === target.id) {
                    currentBot = { ...currentBot, enabled: target.enabled };
                }
                switchError = e instanceof Error ? e.message : String(e);
            })
            .finally(() => {
                switching = false;
            });
    }

    $: page = $LL.mapEditor.edit.bots.page;
    /** The description grows with what it holds, so it reads as text rather than a box. */
    function autoHeight(node: HTMLTextAreaElement) {
        const fit = () => {
            node.style.height = "auto";
            node.style.height = `${node.scrollHeight}px`;
        };
        fit();
        node.addEventListener("input", fit);
        // The page can open while the panel is tucked away (the box is then off the page and measures 0), and the
        // panel can be resized: measure again whenever the box's width changes
        let width = node.clientWidth;
        const resizeObserver = new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            fit();
        });
        resizeObserver.observe(node);
        return {
            update: fit,
            destroy: () => {
                node.removeEventListener("input", fit);
                resizeObserver.disconnect();
            },
        };
    }
</script>

<svelte:window on:keydown={handleTextureKeydown} />

{#if currentBot && editingTexture}
    <BotWokaPicker
        selectedId={currentBot.characterTexture || ""}
        onSave={(textureId) => {
            if (textureId && textureId !== currentBot?.characterTexture) {
                void handleTextureSelect(textureId);
            } else {
                editingTexture = false;
            }
        }}
        onCancel={() => (editingTexture = false)}
    />
{:else if currentBot && editingCompanion}
    <BotCompanionPicker
        selectedId={currentBot.companionTextureId ?? null}
        botUrl={botSheetUrl}
        onSave={handleCompanionSelect}
        onCancel={() => (editingCompanion = false)}
    />
{:else if currentBot}
    <div class="bot-page" data-testid="bot-page">
        <div class="bp-hd">
            <button
                type="button"
                class="bp-woka"
                aria-label={page.changeLooks()}
                title={page.changeLooks()}
                data-testid="bot-change-looks"
                on:click={() => (editingTexture = true)}
            >
                {#if currentBot.characterTexture && $botWokaCatalogStore}
                    <WokaImage
                        selectedTextures={{ woka: currentBot.characterTexture }}
                        wokaData={$botWokaCatalogStore}
                        {getTextureUrl}
                        canvasSize={44}
                        direction={0}
                    />
                {/if}
            </button>
            <div class="bp-hd-tx">
                <label class="bp-name-wrap">
                    <input
                        class="bp-name"
                        type="text"
                        value={currentBot.name ?? ""}
                        maxlength="64"
                        placeholder="Bot"
                        aria-label={page.about.name()}
                        data-testid="bot-name"
                        on:input={(e) => rename(e.currentTarget.value)}
                    />
                    <span class="bp-pen" aria-hidden="true"><IconPencil font-size="14" /></span>
                </label>
                <textarea
                    class="bp-desc"
                    rows="1"
                    value={currentBot.description ?? ""}
                    placeholder={page.about.descriptionPlaceholder()}
                    aria-label={page.about.description()}
                    data-testid="bot-description"
                    use:autoHeight
                    on:input={(e) => currentBot && apply({ ...currentBot, description: e.currentTarget.value }, true)}
                />
            </div>
            <PageSwitch
                checked={currentBot.enabled !== false}
                label={page.switchOn()}
                disabled={switching}
                testId="bot-switch"
                onChange={switchOnOff}
            />
        </div>
        {#if onLocate}
            <div class="bp-actions">
                <button type="button" class="bp-pill" data-testid="bot-locate" on:click={onLocate}>
                    <IconCurrentLocation font-size="16" />
                    {page.locate()}
                </button>
            </div>
        {/if}
        {#if switchError}
            <p class="bp-error" role="alert">{switchError}</p>
        {/if}

        <div class="bp-groups">
            <MindGroup
                bot={currentBot}
                open={openGroup === "mind"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
            />
            <SayGroup bot={currentBot} open={openGroup === "say"} onToggle={toggleGroup} onChange={apply} />
            <BehaviorGroup
                bot={currentBot}
                open={openGroup === "behavior"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
                onEditRoute={editRoute}
            />
            <ToolsGroup
                bot={currentBot}
                open={openGroup === "tools"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
                wide={!$mobileLayoutStore}
            />
            <!-- An extra, after the bot's own parts: the pet that walks with it -->
            <PageGroup
                id="companion"
                icon={IconPaw}
                title={page.companion.title()}
                brief={companionLine}
                link
                onToggle={() => (editingCompanion = true)}
            />
        </div>
        <BotFooter bot={currentBot} {onDelete} />
    </div>
{/if}

<style>
    .bot-page {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #fff;
    }
    .bp-hd {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }
    /* The WOKA in a circle, as in the people list and the join screens: tap it to change how the bot looks */
    .bp-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 56px;
        height: 56px;
        margin: 0;
        padding: 0;
        border: 0;
        position: relative;
        border-radius: 50%;
        background: radial-gradient(
            circle at 50% 42%,
            rgba(134, 41, 252, 0.35),
            rgba(65, 86, 246, 0.12) 58%,
            rgba(255, 255, 255, 0.03) 72%
        );
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-woka:hover {
            box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.7);
        }
    }
    .bp-woka:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-hd-tx {
        flex: 1;
        min-width: 0;
    }
    /* The name is the title, and typing on it renames the bot: no box until it has focus */
    .bp-name-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 44px;
        margin: 0 0 1px -6px;
        padding: 1px 6px;
        border-radius: 8px;
        cursor: text;
    }
    .bp-name-wrap:focus-within {
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-name {
        flex: 1;
        min-width: 0;
        width: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.25;
        color: #fff;
        outline: none;
        text-overflow: ellipsis;
    }
    /* The box around the name is the purple one above: no second (blue) focus ring from the page's form styles */
    .bp-name:focus {
        box-shadow: none;
    }
    .bp-pen {
        flex: none;
        color: rgba(255, 255, 255, 0.5);
    }
    .bp-name-wrap:focus-within .bp-pen {
        display: none;
    }
    /* What the bot is for, under its name, edited in place */
    .bp-desc {
        display: block;
        /* One line at least, so it never shows clipped, even when it was measured off the page */
        min-height: calc(13.5px * 1.45 + 12px);
        width: calc(100% + 8px);
        margin: -6px 0 0 -8px;
        padding: 6px 8px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        font: inherit;
        font-size: 13.5px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.82);
        resize: none;
        overflow: hidden;
        outline: none;
    }
    .bp-desc::placeholder {
        color: rgba(244, 242, 250, 0.42);
    }
    @media (hover: hover) {
        .bp-desc:hover {
            background: rgba(255, 255, 255, 0.04);
        }
    }
    .bp-desc:focus {
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    /* Under the name, lined up with it */
    .bp-actions {
        display: flex;
        gap: 8px;
        padding-left: 66px;
    }
    .bp-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .bp-groups {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .bp-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 40px;
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
    @media (hover: hover) {
        .bp-pill:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
