<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import type { BotData } from "../types";
    import type { WokaData } from "../../../Components/Woka/WokaTypes";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";
    import { selectedBotStore, upsertBot } from "../stores/BotEditorStore";
    import BotTexturePicker from "./BotTexturePicker.svelte";
    import BotBehaviorEditor from "./BotBehaviorEditor.svelte";
    import BotInstructionsEditor from "./BotInstructionsEditor.svelte";
    import { IconChevronLeft } from "@wa-icons";

    export let bot: BotData | null = null;
    export let onBack: () => void;
    export let onSave: () => void;
    export let onDelete: () => void;
    export let onLocate: (() => void) | undefined = undefined;

    let currentBot: BotData;
    let isSaving = false;
    let saveError: string | null = null;
    let wokaData: WokaData | null = null;
    let assetsDirection: number = 0;

    // Editing states
    let editingName = false;
    let editingDescription = false;
    let editingTexture = false;
    let editingBehavior = false;
    let editingInstructions = false;

    // Subscribe to store for real-time updates from map
    const unsubscribe = selectedBotStore.subscribe((storeBot) => {
        if (storeBot && storeBot.id === currentBot?.id) {
            // Update position and radius from store (map changes)
            if (storeBot.behaviorConfig?.assignedSpace) {
                if (!currentBot.behaviorConfig) {
                    currentBot.behaviorConfig = { assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } };
                }
                currentBot.behaviorConfig.assignedSpace = { ...storeBot.behaviorConfig.assignedSpace };
                currentBot = currentBot; // Trigger reactivity
            }
        }
    });

    onDestroy(() => {
        unsubscribe();
    });

    // Initialize from prop
    $: if (bot && bot.id !== currentBot?.id) {
        currentBot = {
            ...bot,
            behaviorConfig: bot.behaviorConfig || {
                assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
            },
        };
        if (!currentBot.behaviorConfig.assignedSpace) {
            currentBot.behaviorConfig.assignedSpace = { center: { x: 0, y: 0 }, radius: 0 };
        }
    }

    // Auto-save when currentBot changes
    function autoSave() {
        if (currentBot?.id) {
            upsertBot(currentBot);
            onSave();
        }
    }

    function getTextureUrl(relativeUrl: string): string {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl;
        }
        return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
    }

    async function loadWokaData() {
        try {
            let roomUrl: string;
            if (gameManager?.currentStartedRoom?.href) {
                roomUrl = gameManager.currentStartedRoom.href;
            } else if (window.location.href) {
                roomUrl = window.location.href;
            } else {
                return;
            }

            const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
                headers: {
                    Authorization: localUserStore.getAuthToken() || "",
                },
                credentials: "include",
            });

            if (response.ok) {
                wokaData = await response.json();
            }
        } catch (err) {
            console.warn("Could not load woka data:", err);
        }
    }

    function handleDelete() {
        if (!currentBot.botId) {
            onBack();
            return;
        }

        if (!confirm(`Are you sure you want to delete "${currentBot.name}"? This cannot be undone.`)) {
            return;
        }

        try {
            // TODO: Replace with actual API call
            // await botApiService.deleteBot(currentBot.botId);
            console.log("Deleting bot:", currentBot.botId);
            onDelete();
        } catch (e) {
            console.error("Error deleting bot:", e);
            alert("Failed to delete bot. Please try again.");
        }
    }

    function getBehaviorLabel(type?: string): string {
        switch (type) {
            case "idle":
                return "Idle (Stand in place)";
            case "patrol":
                return "Patrol (Follow waypoints)";
            case "social":
                return "Social (Seek conversations)";
            default:
                return "Unknown";
        }
    }

    function formatDate(dateString?: string): string {
        if (!dateString) return "Unknown";
        try {
            const date = new Date(dateString);
            return date.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            });
        } catch {
            return dateString;
        }
    }

    function handleTextureSelect(textureId: string) {
        currentBot.characterTexture = textureId;
        currentBot.characterTextureIds = [textureId];
        editingTexture = false;
        autoSave();
    }

    onMount(() => {
        void loadWokaData();
    });
</script>

<div class="bot-detail-view flex flex-col h-full min-h-0">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-4 pb-4 border-b border-white/20 flex-shrink-0">
        <button class="p-2 hover:bg-white/10 rounded transition-colors" on:click={onBack} title="Back to list">
            <IconChevronLeft font-size="20" />
        </button>
        <div class="flex-1">
            <h2 class="text-base text-white">Bot details</h2>
        </div>
        {#if onLocate}
            <button
                class="p-2 hover:bg-white/10 rounded transition-colors text-white/60 hover:text-white"
                on:click={onLocate}
                title="Locate on map"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                </svg>
            </button>
        {/if}
        <button
            class="px-4 py-2 text-red-400 hover:bg-red-500/20 rounded transition-colors"
            on:click={handleDelete}
            disabled={isSaving}
        >
            Delete Bot
        </button>
    </div>

    <!-- Content -->
    <div class="scrollable-content">
        <div class="space-y-4 pb-4">
            <!-- Woka and Name Section -->
            <div class="flex items-start gap-6 pb-4 border-b border-white/10">
                <div class="flex-shrink-0">
                    <div
                        class="w-32 h-32 bg-white/5 rounded-lg border border-white/20 flex items-center justify-center overflow-hidden"
                    >
                        {#if currentBot.characterTexture && wokaData}
                            <WokaImage
                                selectedTextures={{ woka: currentBot.characterTexture }}
                                {wokaData}
                                {getTextureUrl}
                                canvasSize={96}
                                direction={assetsDirection}
                            />
                        {:else}
                            <div class="text-white/40 text-xs">No texture</div>
                        {/if}
                    </div>
                    <button
                        class="w-32 mt-2 px-3 py-2 text-sm bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                        on:click={() => (editingTexture = true)}
                    >
                        Change Woka
                    </button>
                </div>
                <div class="flex-1">
                    {#if editingName}
                        <div class="space-y-2">
                            <input
                                type="text"
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-2xl font-semibold"
                                bind:value={currentBot.name}
                                placeholder="Enter bot name"
                                autofocus
                                on:input={() => autoSave()}
                                on:keydown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        editingName = false;
                                    }
                                }}
                            />
                            <button
                                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                on:click={() => (editingName = false)}
                            >
                                Close
                            </button>
                        </div>
                    {:else}
                        <div class="flex items-center gap-2 mb-3">
                            <h1 class="text-2xl font-semibold text-white">{currentBot.name || "Unnamed Bot"}</h1>
                            <button
                                class="text-sm text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
                                on:click={() => (editingName = true)}
                            >
                                Edit
                            </button>
                        </div>
                    {/if}

                    <!-- Description -->
                    <div class="mb-4">
                        {#if editingDescription}
                            <div class="space-y-2">
                                <textarea
                                    class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    bind:value={currentBot.description}
                                    placeholder="Enter bot description"
                                    rows="3"
                                    on:input={() => autoSave()}
                                />
                                <button
                                    class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                    on:click={() => (editingDescription = false)}
                                >
                                    Close
                                </button>
                            </div>
                        {:else}
                            <div class="flex items-center gap-2">
                                <p class="text-sm text-white/70 flex-1">{currentBot.description || "No description"}</p>
                                <button
                                    class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
                                    on:click={() => (editingDescription = true)}
                                >
                                    Edit
                                </button>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- Behavior -->
            <div class="border-b border-white/10">
                <div class="flex items-center gap-2 mb-3">
                    <h3 class="text-base text-white/80 normal-case">Behavior</h3>
                    <button
                        class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
                        on:click={() => (editingBehavior = true)}
                    >
                        Edit
                    </button>
                </div>
                {#if editingBehavior}
                    <div class="p-4 bg-white/5 rounded-lg border border-white/20">
                        <BotBehaviorEditor
                            bind:bot={currentBot}
                            on:locate={() => {
                                if (onLocate) onLocate();
                            }}
                            on:editWaypoints={() => {
                                if (onLocate) onLocate();
                            }}
                            on:change={() => {
                                autoSave();
                            }}
                        />
                        <div class="flex gap-2 mt-4 pt-4 border-t border-white/10">
                            <button
                                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                on:click={() => {
                                    editingBehavior = false;
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                {:else}
                    <div class="space-y-2">
                        <p class="text-sm text-white/70">{getBehaviorLabel(currentBot.behaviorType)}</p>
                        {#if currentBot.behaviorConfig?.assignedSpace}
                            <p class="text-xs text-white/50">
                                Location: ({currentBot.behaviorConfig.assignedSpace.center?.x || 0}, {currentBot
                                    .behaviorConfig.assignedSpace.center?.y || 0})
                                {#if currentBot.behaviorType === "idle" && currentBot.behaviorConfig.assignedSpace.radius === 0}
                                    (stationary)
                                {:else}
                                    radius {currentBot.behaviorConfig.assignedSpace.radius || 0}
                                {/if}
                            </p>
                        {/if}
                        {#if currentBot.behaviorType === "patrol" && currentBot.behaviorConfig?.patrolWaypoints && Array.isArray(currentBot.behaviorConfig.patrolWaypoints)}
                            <p class="text-xs text-white/50">
                                {currentBot.behaviorConfig.patrolWaypoints.length} waypoint{currentBot.behaviorConfig
                                    .patrolWaypoints.length !== 1
                                    ? "s"
                                    : ""}
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Instructions -->
            <div>
                <div class="flex items-center gap-2 mb-3">
                    <h3 class="text-base text-white/80 normal-case">Instructions</h3>
                    <button
                        class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
                        on:click={() => (editingInstructions = true)}
                    >
                        Edit
                    </button>
                </div>
                {#if editingInstructions}
                    <div class="p-4 bg-white/5 rounded-lg border border-white/20">
                        <BotInstructionsEditor bind:bot={currentBot} on:change={() => autoSave()} />
                        <div class="flex gap-2 mt-4 pt-4 border-t border-white/10">
                            <button
                                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                on:click={() => {
                                    editingInstructions = false;
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                {:else}
                    <div class="space-y-4">
                        <div>
                            <p class="text-sm text-white/80 font-semibold mb-2">Chat instructions</p>
                            <p class="text-sm text-white/70 whitespace-pre-wrap">
                                {currentBot.chatInstructions || "No chat instructions set"}
                            </p>
                        </div>
                        <div>
                            <p class="text-sm text-white/80 font-semibold mb-2">Movement instructions</p>
                            <p class="text-sm text-white/70 whitespace-pre-wrap">
                                {currentBot.movementInstructions || "No movement instructions set"}
                            </p>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Metadata (Audit Trail) -->
            {#if currentBot.createdAt || currentBot.updatedAt}
                <div class="mt-6 pt-6 border-t border-white/10">
                    <h3 class="text-base text-white/80 normal-case mb-3">Metadata</h3>
                    <div class="space-y-2 text-sm text-white/60">
                        {#if currentBot.createdAt}
                            <div class="flex items-center gap-2">
                                <span class="text-white/40">Created:</span>
                                <span>{formatDate(currentBot.createdAt)}</span>
                                {#if currentBot.createdBy?.name}
                                    <span class="text-white/40">by</span>
                                    <span class="text-white/70">{currentBot.createdBy.name}</span>
                                {/if}
                            </div>
                        {/if}
                        {#if currentBot.updatedAt}
                            <div class="flex items-center gap-2">
                                <span class="text-white/40">Last updated:</span>
                                <span>{formatDate(currentBot.updatedAt)}</span>
                                {#if currentBot.updatedBy?.name && currentBot.updatedBy.id !== currentBot.createdBy?.id}
                                    <span class="text-white/40">by</span>
                                    <span class="text-white/70">{currentBot.updatedBy.name}</span>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>

    {#if saveError}
        <div class="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
            {saveError}
        </div>
    {/if}
</div>

<!-- Texture Picker Modal -->
{#if editingTexture && wokaData}
    <div
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        on:click={() => (editingTexture = false)}
        role="dialog"
        aria-modal="true"
    >
        <div
            class="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 border border-white/20"
            on:click|stopPropagation
        >
            <h3 class="text-xl font-semibold text-white mb-4">Select Character Texture</h3>
            <BotTexturePicker selectedTextureId={currentBot.characterTexture || ""} onSelect={handleTextureSelect} />
            <div class="flex justify-end mt-4">
                <button
                    class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                    on:click={() => (editingTexture = false)}
                >
                    Cancel
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .bot-detail-view {
        color: white;
        height: 100%;
        min-height: 0;
    }

    .bot-detail-view .scrollable-content {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }
</style>
