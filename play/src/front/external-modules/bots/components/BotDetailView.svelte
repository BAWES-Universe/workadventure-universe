<script lang="ts">
    import { onMount } from "svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import type { BotData } from "../types";
    import type { WokaData } from "../../../Components/Woka/WokaTypes";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";
    import BotTexturePicker from "./BotTexturePicker.svelte";
    import BotBehaviorEditor from "./BotBehaviorEditor.svelte";
    import BotInstructionsEditor from "./BotInstructionsEditor.svelte";
    import { IconChevronLeft } from "@wa-icons";

    export let bot: BotData | null = null;
    export let onBack: () => void;
    export let onSave: () => void;
    export let onDelete: () => void;

    let currentBot: BotData;
    let isSaving = false;
    let saveError: string | null = null;
    let wokaData: WokaData | null = null;
    let assetsDirection: number = 0;
    let lastBotId: string | null = null;

    // Editing states
    let editingName = false;
    let editingDescription = false;
    let editingTexture = false;
    let editingBehavior = false;
    let editingInstructions = false;

    // Initialize bot data - only update when bot prop changes (different bot or first load)
    $: {
        if (bot) {
            // Only update if it's a different bot or we don't have currentBot yet
            if (bot.botId !== lastBotId || !currentBot) {
                currentBot = { ...bot };
                lastBotId = bot.botId ?? null;
                // Ensure assignedSpace exists
                if (!currentBot.behaviorConfig) {
                    currentBot.behaviorConfig = {
                        assignedSpace: {
                            center: { x: 0, y: 0 },
                            radius: currentBot.behaviorType === "idle" ? 0 : 50,
                        },
                    };
                } else if (!currentBot.behaviorConfig.assignedSpace) {
                    currentBot.behaviorConfig.assignedSpace = {
                        center: { x: 0, y: 0 },
                        radius: currentBot.behaviorType === "idle" ? 0 : 50,
                    };
                }
            }
        } else if (!bot && lastBotId !== null) {
            currentBot = {
                name: "",
                description: "",
                behaviorType: "idle",
                enabled: true,
                behaviorConfig: {
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: 0,
                    },
                },
                chatInstructions: "",
                movementInstructions: "",
            };
            lastBotId = null;
        } else if (!currentBot) {
            currentBot = {
                name: "",
                description: "",
                behaviorType: "idle",
                enabled: true,
                behaviorConfig: {
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: 0,
                    },
                },
                chatInstructions: "",
                movementInstructions: "",
            };
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

    function handleSave() {
        isSaving = true;
        saveError = null;

        try {
            if (!currentBot.name || currentBot.name.trim() === "") {
                saveError = "Bot name is required";
                isSaving = false;
                return;
            }

            // Update the bot prop with currentBot changes
            if (bot) {
                // Copy all properties from currentBot to bot
                // This mutates the bot object, which is the same reference as selectedBot in parent
                Object.assign(bot, currentBot);
                bot.updatedAt = new Date().toISOString();
            }

            // TODO: Replace with actual API call
            // await botApiService.updateBot(currentBot.botId, currentBot);

            console.log("Saving bot:", currentBot);
            onSave();
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to save bot";
            console.error("Error saving bot:", e);
        } finally {
            isSaving = false;
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

    function handleTextureSelect(textureId: string) {
        currentBot.characterTexture = textureId;
        currentBot.characterTextureIds = [textureId];
        editingTexture = false;
        handleSave();
        // Stay on detail page - don't navigate away
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
                                on:keydown={(e) => {
                                    // Prevent event from bubbling if needed
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        editingName = false;
                                        handleSave();
                                    }
                                }}
                            />
                            <div class="flex gap-2">
                                <button
                                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                                    on:click={() => {
                                        editingName = false;
                                        handleSave();
                                    }}
                                >
                                    Save
                                </button>
                                <button
                                    class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                    on:click={() => {
                                        editingName = false;
                                        if (bot) {
                                            currentBot = { ...bot };
                                        }
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
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
                                />
                                <div class="flex gap-2">
                                    <button
                                        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                                        on:click={() => {
                                            editingDescription = false;
                                            handleSave();
                                        }}
                                    >
                                        Save
                                    </button>
                                    <button
                                        class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                        on:click={() => {
                                            editingDescription = false;
                                            if (bot) {
                                                currentBot = { ...bot };
                                            }
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
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
                        <BotBehaviorEditor bind:bot={currentBot} />
                        <div class="flex gap-2 mt-4 pt-4 border-t border-white/10">
                            <button
                                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                                on:click={() => {
                                    editingBehavior = false;
                                    handleSave();
                                }}
                            >
                                Save
                            </button>
                            <button
                                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                on:click={() => {
                                    editingBehavior = false;
                                    if (bot) {
                                        currentBot = { ...bot };
                                    }
                                }}
                            >
                                Cancel
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
                        {#if currentBot.behaviorType === "patrol" && currentBot.behaviorConfig?.waypoints}
                            <p class="text-xs text-white/50">
                                {currentBot.behaviorConfig.waypoints.length} waypoint{currentBot.behaviorConfig
                                    .waypoints.length !== 1
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
                        <BotInstructionsEditor bind:bot={currentBot} />
                        <div class="flex gap-2 mt-4 pt-4 border-t border-white/10">
                            <button
                                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                                on:click={() => {
                                    editingInstructions = false;
                                    handleSave();
                                }}
                            >
                                Save
                            </button>
                            <button
                                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm"
                                on:click={() => {
                                    editingInstructions = false;
                                    if (bot) {
                                        currentBot = { ...bot };
                                    }
                                }}
                            >
                                Cancel
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
