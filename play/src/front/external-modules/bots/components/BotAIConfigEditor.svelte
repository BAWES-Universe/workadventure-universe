<script lang="ts">
    interface BotData {
        aiProvider?: "lmstudio" | "ultravox" | "gpt-voice";
        chatInstructions?: string;
        movementInstructions?: string;
        apiEndpoint?: string;
        modelName?: string;
        apiKey?: string;
        [key: string]: unknown;
    }

    export let bot: BotData | null = null;

    let aiProvider: "lmstudio" | "ultravox" | "gpt-voice" = "lmstudio";
    let chatInstructions = "";
    let movementInstructions = "";
    let apiEndpoint = "";
    let modelName = "";
    let apiKey = "";

    $: if (bot) {
        aiProvider = bot.aiProvider || "lmstudio";
        chatInstructions = bot.chatInstructions || "";
        movementInstructions = bot.movementInstructions || "";
        apiEndpoint = bot.apiEndpoint || "";
        modelName = bot.modelName || "";
        apiKey = bot.apiKey || "";
    }

    function testConnection() {
        // TODO: Implement connection test
        console.log("Testing AI connection...");
    }
</script>

<div class="space-y-4">
    <div>
        <label class="block text-sm font-medium mb-1">AI Provider</label>
        <select class="w-full px-3 py-2 border rounded" bind:value={aiProvider}>
            <option value="lmstudio">LMStudio</option>
            <option value="ultravox">Ultravox</option>
            <option value="gpt-voice">GPT Voice</option>
        </select>
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Chat Instructions</label>
        <textarea
            class="w-full px-3 py-2 border rounded font-mono text-sm"
            bind:value={chatInstructions}
            placeholder="You are a helpful bot. Be friendly and welcoming..."
            rows="8"
        />
        <p class="text-xs text-gray-500 mt-1">
            Instructions for how the bot should behave in conversations. This is stored securely in Admin API.
        </p>
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Movement Instructions</label>
        <textarea
            class="w-full px-3 py-2 border rounded font-mono text-sm"
            bind:value={movementInstructions}
            placeholder="Your job is to welcome visitors. Only welcome visitors entering the lobby..."
            rows="6"
        />
        <p class="text-xs text-gray-500 mt-1">
            Instructions for bot movement and decision-making. This is stored securely in Admin API.
        </p>
    </div>

    <div class="border-t pt-4">
        <h3 class="text-sm font-semibold mb-2">API Configuration</h3>
        <div class="space-y-2">
            <div>
                <label class="block text-sm font-medium mb-1">API Endpoint</label>
                <input
                    type="text"
                    class="w-full px-3 py-2 border rounded"
                    bind:value={apiEndpoint}
                    placeholder="http://localhost:1234/v1"
                />
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">Model Name</label>
                <input
                    type="text"
                    class="w-full px-3 py-2 border rounded"
                    bind:value={modelName}
                    placeholder="model-name"
                />
            </div>
            <div>
                <label class="block text-sm font-medium mb-1">API Key</label>
                <input
                    type="password"
                    class="w-full px-3 py-2 border rounded"
                    bind:value={apiKey}
                    placeholder="••••••••"
                />
                <p class="text-xs text-gray-500 mt-1">
                    This is stored securely in Admin API and never exposed publicly.
                </p>
            </div>
        </div>
    </div>

    <div>
        <button class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700" on:click={testConnection}>
            Test Connection
        </button>
    </div>
</div>
