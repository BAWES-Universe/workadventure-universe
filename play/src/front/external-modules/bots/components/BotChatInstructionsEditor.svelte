<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    const dispatch = createEventDispatcher<{ change: void }>();

    let chatInstructions = "";

    onMount(() => {
        if (bot) {
            chatInstructions = bot.chatInstructions || "";
        }
    });

    // Watch for bot ID changes (only sync when bot changes, not on every prop update)
    let lastBotId: string | undefined = undefined;
    $: if (bot && bot.id !== lastBotId) {
        lastBotId = bot.id;
        chatInstructions = bot.chatInstructions || "";
    }

    function updateChatInstructions() {
        if (bot) {
            bot.chatInstructions = chatInstructions;
            dispatch("change");
        } else {
            console.warn("[BotChatInstructionsEditor] updateChatInstructions called but bot is null");
        }
    }
</script>

<div>
    <label for="chat-instructions" class="block text-sm text-white/80 mb-2 font-semibold">
        Chat instructions
        <span class="text-white/50 text-xs font-normal ml-2">
            (What the bot should say and how it should communicate)
        </span>
    </label>
    <textarea
        id="chat-instructions"
        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        bind:value={chatInstructions}
        on:input={updateChatInstructions}
        placeholder="Example: You are a friendly greeter bot named 'WelcomeBot'. Your job is to welcome new visitors to the lobby. Be cheerful and helpful. Answer questions about the space. Don't repeat the same greeting to someone you've already greeted today."
        rows="8"
    />
</div>
