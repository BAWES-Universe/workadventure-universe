<script context="module" lang="ts">
    // The group left open, so the next bot opens on the same one
    let lastOpenGroup: string | undefined;
</script>

<script lang="ts">
    // The bot page: the bot with its on/off switch, then six groups (Moves, People, Mind, Chat instructions, Tools,
    // About) that open one at a time. Changes save on their own.
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
    import { botModel } from "../behaviorModel";
    import BotTexturePicker from "./BotTexturePicker.svelte";
    import PageSwitch from "./page/PageSwitch.svelte";
    import MovesGroup from "./page/MovesGroup.svelte";
    import PeopleGroup from "./page/PeopleGroup.svelte";
    import MindGroup from "./page/MindGroup.svelte";
    import SayGroup from "./page/SayGroup.svelte";
    import ToolsGroup from "./page/ToolsGroup.svelte";
    import AboutGroup from "./page/AboutGroup.svelte";
    import { IconCurrentLocation } from "@wa-icons";

    export let bot: BotData | null = null;
    export let onSave: () => void;
    export let onDelete: () => void;
    export let onLocate: (() => void) | undefined = undefined;

    let currentBot: BotData | null = null;
    let editingTexture = false;
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

    onMount(() => {
        void ensureBotWokaCatalog();
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
    $: model = botModel(currentBot);
    $: subtitle = `${currentBot?.enabled === false ? page.off() : page.on()} · ${page.headerMoves[model.moves]()}`;
</script>

<svelte:window on:keydown={handleTextureKeydown} />

{#if currentBot}
    <div class="bot-page" data-testid="bot-page">
        <div class="bp-hd">
            <span class="bp-woka">
                {#if currentBot.characterTexture && $botWokaCatalogStore}
                    <WokaImage
                        selectedTextures={{ woka: currentBot.characterTexture }}
                        wokaData={$botWokaCatalogStore}
                        {getTextureUrl}
                        canvasSize={40}
                        direction={0}
                    />
                {/if}
            </span>
            <div class="bp-hd-tx">
                <div class="bp-name">{currentBot.name || "Bot"}</div>
                <div class="bp-sub">{subtitle}</div>
            </div>
            {#if onLocate}
                <button
                    type="button"
                    class="bp-circle"
                    aria-label={page.locate()}
                    title={page.locate()}
                    data-testid="bot-locate"
                    on:click={onLocate}
                >
                    <IconCurrentLocation font-size="18" />
                </button>
            {/if}
            <PageSwitch
                checked={currentBot.enabled !== false}
                label={page.switchOn()}
                disabled={switching}
                testId="bot-switch"
                onChange={switchOnOff}
            />
        </div>
        {#if switchError}
            <p class="bp-error" role="alert">{switchError}</p>
        {/if}

        <div class="bp-groups">
            <MovesGroup
                bot={currentBot}
                open={openGroup === "moves"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
                onEditRoute={editRoute}
            />
            <PeopleGroup
                bot={currentBot}
                open={openGroup === "people"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
            />
            <MindGroup
                bot={currentBot}
                open={openGroup === "mind"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
            />
            <SayGroup bot={currentBot} open={openGroup === "say"} onToggle={toggleGroup} onChange={apply} />
            <ToolsGroup
                bot={currentBot}
                open={openGroup === "tools"}
                onToggle={toggleGroup}
                onChange={(next) => apply(next)}
                wide={!$mobileLayoutStore}
            />
            <AboutGroup
                bot={currentBot}
                open={openGroup === "about"}
                onToggle={toggleGroup}
                onChange={apply}
                onRename={rename}
                onChangeLooks={() => (editingTexture = true)}
                {onDelete}
            />
        </div>
    </div>
{/if}

<!-- Texture Picker Modal -->
{#if editingTexture && $botWokaCatalogStore && currentBot}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
        role="presentation"
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        tabindex="-1"
        on:click={() => (editingTexture = false)}
    >
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
            role="dialog"
            aria-modal="true"
            aria-label={page.changeLooks()}
            class="bp-dialog u-surface max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
            on:click|stopPropagation
        >
            <h3 class="text-xl font-semibold text-white mb-4">{page.changeLooks()}</h3>
            <BotTexturePicker
                selectedTextureId={currentBot.characterTexture || ""}
                botId={currentBot.id}
                onSelect={handleTextureSelect}
            />
            <div class="flex justify-end mt-4">
                <button type="button" class="bp-pill" on:click={() => (editingTexture = false)}>
                    {$LL.actionbar.close()}
                </button>
            </div>
        </div>
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
        align-items: center;
        gap: 8px;
    }
    .bp-woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        overflow: hidden;
    }
    .bp-hd-tx {
        flex: 1;
        min-width: 0;
    }
    .bp-name,
    .bp-sub {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bp-name {
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
    }
    .bp-sub {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-circle {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-circle:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .bp-circle:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
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
    .bp-dialog {
        border-radius: 24px;
    }
    .bp-pill {
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
