<script lang="ts">
    import { onMount } from "svelte";
    import { tweened } from "svelte/motion";
    import { cubicOut } from "svelte/easing";

    export let emotions: {
        botEmotion: {
            anger: number;
            happiness: number;
            trust: number;
            familiarity: number;
        };
        personEmotion: {
            anger: number;
            happiness: number;
            trust: number;
        };
    } | null = null;
    export let botName: string = "Bot";
    export let loading: boolean = false;

    // Tweened values for smooth animations
    const botHappiness = tweened(50, { duration: 800, easing: cubicOut });
    const botTrust = tweened(50, { duration: 800, easing: cubicOut });
    const botFamiliarity = tweened(0, { duration: 800, easing: cubicOut });
    const botAnger = tweened(0, { duration: 800, easing: cubicOut });
    const playerHappiness = tweened(50, { duration: 800, easing: cubicOut });
    const playerTrust = tweened(50, { duration: 800, easing: cubicOut });
    const playerAnger = tweened(0, { duration: 800, easing: cubicOut });

    $: if (emotions) {
        void botHappiness.set(emotions.botEmotion.happiness);
        void botTrust.set(emotions.botEmotion.trust);
        void botFamiliarity.set(emotions.botEmotion.familiarity);
        void botAnger.set(emotions.botEmotion.anger);
        void playerHappiness.set(emotions.personEmotion.happiness);
        void playerTrust.set(emotions.personEmotion.trust);
        void playerAnger.set(emotions.personEmotion.anger);
    }

    function getGradient(value: number, type: "positive" | "negative" | "familiarity"): string {
        if (type === "positive") {
            if (value >= 75) return "from-emerald-500 to-green-400";
            if (value >= 50) return "from-green-500 to-lime-400";
            if (value >= 25) return "from-yellow-500 to-amber-400";
            return "from-gray-500 to-gray-400";
        } else if (type === "negative") {
            if (value >= 75) return "from-red-600 to-rose-500";
            if (value >= 50) return "from-orange-500 to-amber-500";
            if (value >= 25) return "from-yellow-500 to-orange-400";
            return "from-gray-500 to-gray-400";
        } else {
            // Familiarity - purple/blue theme
            if (value >= 75) return "from-violet-500 to-purple-400";
            if (value >= 50) return "from-indigo-500 to-blue-400";
            if (value >= 25) return "from-blue-500 to-cyan-400";
            return "from-gray-500 to-gray-400";
        }
    }

    function getStatusText(value: number, type: string): string {
        if (type === "anger") {
            if (value >= 75) return "Furious";
            if (value >= 50) return "Annoyed";
            if (value >= 25) return "Irritated";
            if (value > 5) return "Calm";
            return "Peaceful";
        } else if (type === "happiness") {
            if (value >= 75) return "Delighted";
            if (value >= 50) return "Content";
            if (value >= 25) return "Neutral";
            return "Unhappy";
        } else if (type === "trust") {
            if (value >= 75) return "Deep Trust";
            if (value >= 50) return "Trusting";
            if (value >= 25) return "Cautious";
            return "Wary";
        } else if (type === "familiarity") {
            if (value >= 75) return "Close Friend";
            if (value >= 50) return "Acquaintance";
            if (value >= 25) return "Getting to Know";
            return "Stranger";
        }
        return "";
    }

    function getGlowColor(value: number, type: "positive" | "negative" | "familiarity"): string {
        if (type === "positive") {
            if (value >= 50) return "shadow-green-500/30";
            return "shadow-gray-500/20";
        } else if (type === "negative") {
            if (value >= 50) return "shadow-red-500/30";
            return "shadow-gray-500/20";
        } else {
            if (value >= 50) return "shadow-purple-500/30";
            return "shadow-gray-500/20";
        }
    }

    let mounted = false;
    onMount(() => {
        setTimeout(() => (mounted = true), 100);
    });
</script>

<div
    class="bot-emotions-panel {mounted
        ? 'opacity-100 translate-y-0'
        : 'opacity-0 translate-y-2'} transition-all duration-500"
>
    <!-- Header with pulse effect -->
    <div class="flex items-center gap-2 mb-3">
        <div class="relative">
            <div class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <div class="absolute inset-0 w-2 h-2 rounded-full bg-cyan-400 animate-ping opacity-75" />
        </div>
        <h4
            class="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 uppercase tracking-wider"
        >
            Emotional Bond
        </h4>
    </div>

    {#if loading}
        <div class="flex items-center justify-center py-6">
            <div class="relative w-12 h-12">
                <div class="absolute inset-0 rounded-full border-2 border-cyan-500/30" />
                <div class="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
                <div
                    class="absolute inset-2 rounded-full border-2 border-transparent border-t-purple-400 animate-spin"
                    style="animation-direction: reverse; animation-duration: 0.8s;"
                />
            </div>
        </div>
    {:else if emotions}
        <!-- Bot's Feelings Section -->
        <div class="mb-4">
            <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <span class="text-xs font-medium text-white/80">How {botName} feels about you</span>
            </div>

            <div class="space-y-2">
                <!-- Happiness -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-1.5">
                            <span class="text-base">😊</span>
                            <span class="text-xs text-white/70">Happiness</span>
                        </div>
                        <span class="text-xs font-medium text-white/90"
                            >{getStatusText($botHappiness, "happiness")}</span
                        >
                    </div>
                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                        <div
                            class="h-full rounded-full bg-gradient-to-r {getGradient(
                                $botHappiness,
                                'positive'
                            )} transition-all duration-300 shadow-lg {getGlowColor($botHappiness, 'positive')}"
                            style="width: {$botHappiness}%"
                        />
                    </div>
                </div>

                <!-- Trust -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-1.5">
                            <span class="text-base">🤝</span>
                            <span class="text-xs text-white/70">Trust</span>
                        </div>
                        <span class="text-xs font-medium text-white/90">{getStatusText($botTrust, "trust")}</span>
                    </div>
                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                        <div
                            class="h-full rounded-full bg-gradient-to-r {getGradient(
                                $botTrust,
                                'positive'
                            )} transition-all duration-300 shadow-lg {getGlowColor($botTrust, 'positive')}"
                            style="width: {$botTrust}%"
                        />
                    </div>
                </div>

                <!-- Familiarity -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-1.5">
                            <span class="text-base">💫</span>
                            <span class="text-xs text-white/70">Familiarity</span>
                        </div>
                        <span class="text-xs font-medium text-white/90"
                            >{getStatusText($botFamiliarity, "familiarity")}</span
                        >
                    </div>
                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                        <div
                            class="h-full rounded-full bg-gradient-to-r {getGradient(
                                $botFamiliarity,
                                'familiarity'
                            )} transition-all duration-300 shadow-lg {getGlowColor($botFamiliarity, 'familiarity')}"
                            style="width: {$botFamiliarity}%"
                        />
                    </div>
                </div>

                <!-- Anger (only show if > 5) -->
                {#if $botAnger > 5}
                    <div class="group">
                        <div class="flex justify-between items-center mb-1">
                            <div class="flex items-center gap-1.5">
                                <span class="text-base">😤</span>
                                <span class="text-xs text-white/70">Frustration</span>
                            </div>
                            <span class="text-xs font-medium text-white/90">{getStatusText($botAnger, "anger")}</span>
                        </div>
                        <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                            <div
                                class="h-full rounded-full bg-gradient-to-r {getGradient(
                                    $botAnger,
                                    'negative'
                                )} transition-all duration-300 shadow-lg {getGlowColor($botAnger, 'negative')}"
                                style="width: {$botAnger}%"
                            />
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Divider with gradient -->
        <div class="relative py-2">
            <div class="absolute inset-0 flex items-center">
                <div class="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
        </div>

        <!-- Player's Feelings Section -->
        <div>
            <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                </svg>
                <span class="text-xs font-medium text-white/80">How {botName} perceives your feelings</span>
            </div>

            <div class="space-y-2">
                <!-- Player Happiness -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-1.5">
                            <span class="text-base">😊</span>
                            <span class="text-xs text-white/70">Happiness</span>
                        </div>
                        <span class="text-xs font-medium text-white/90"
                            >{getStatusText($playerHappiness, "happiness")}</span
                        >
                    </div>
                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                        <div
                            class="h-full rounded-full bg-gradient-to-r {getGradient(
                                $playerHappiness,
                                'positive'
                            )} transition-all duration-300 shadow-lg {getGlowColor($playerHappiness, 'positive')}"
                            style="width: {$playerHappiness}%"
                        />
                    </div>
                </div>

                <!-- Player Trust -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center gap-1.5">
                            <span class="text-base">🤝</span>
                            <span class="text-xs text-white/70">Trust</span>
                        </div>
                        <span class="text-xs font-medium text-white/90">{getStatusText($playerTrust, "trust")}</span>
                    </div>
                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                        <div
                            class="h-full rounded-full bg-gradient-to-r {getGradient(
                                $playerTrust,
                                'positive'
                            )} transition-all duration-300 shadow-lg {getGlowColor($playerTrust, 'positive')}"
                            style="width: {$playerTrust}%"
                        />
                    </div>
                </div>

                <!-- Player Anger (only show if > 5) -->
                {#if $playerAnger > 5}
                    <div class="group">
                        <div class="flex justify-between items-center mb-1">
                            <div class="flex items-center gap-1.5">
                                <span class="text-base">😤</span>
                                <span class="text-xs text-white/70">Frustration</span>
                            </div>
                            <span class="text-xs font-medium text-white/90">{getStatusText($playerAnger, "anger")}</span
                            >
                        </div>
                        <div class="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                            <div
                                class="h-full rounded-full bg-gradient-to-r {getGradient(
                                    $playerAnger,
                                    'negative'
                                )} transition-all duration-300 shadow-lg {getGlowColor($playerAnger, 'negative')}"
                                style="width: {$playerAnger}%"
                            />
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Relationship Summary Badge -->
        <div class="mt-3 pt-3 border-t border-white/10">
            <div class="flex items-center justify-center gap-2">
                <div
                    class="px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30"
                >
                    <span
                        class="text-xs font-medium text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-purple-300"
                    >
                        {#if $botFamiliarity >= 75}
                            ✨ Close Bond
                        {:else if $botFamiliarity >= 50}
                            🌟 Growing Connection
                        {:else if $botFamiliarity >= 25}
                            🔄 Getting Acquainted
                        {:else}
                            👋 New Encounter
                        {/if}
                    </span>
                </div>
            </div>
        </div>
    {:else}
        <!-- No data state -->
        <div class="text-center py-4">
            <div class="text-2xl mb-2">🤔</div>
            <p class="text-xs text-white/50">No emotional data yet</p>
            <p class="text-xs text-white/30 mt-1">Start a conversation to build a bond</p>
        </div>
    {/if}
</div>

<style>
    .bot-emotions-panel {
        background: linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, rgba(147, 51, 234, 0.08) 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 12px;
        margin: 8px 16px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    .bot-emotions-panel::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.5), rgba(147, 51, 234, 0.5), transparent);
    }
</style>
