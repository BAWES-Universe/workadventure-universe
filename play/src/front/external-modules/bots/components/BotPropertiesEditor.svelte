<script lang="ts">
    interface BotData {
        name?: string;
        description?: string;
        x?: number;
        y?: number;
        characterTexture?: string;
        [key: string]: unknown;
    }

    export let bot: BotData | null = null;

    let name = "";
    let description = "";
    let x = 0;
    let y = 0;
    let characterTexture = "";

    $: if (bot) {
        name = bot.name || "";
        description = bot.description || "";
        x = bot.x || 0;
        y = bot.y || 0;
        characterTexture = bot.characterTexture || "";
    }

    function handlePickPosition() {
        // TODO: Implement position picker from map
        console.log("Pick position from map");
    }
</script>

<div class="space-y-4">
    <div>
        <label class="block text-sm font-medium mb-1">Bot Name</label>
        <input type="text" class="w-full px-3 py-2 border rounded" bind:value={name} placeholder="Enter bot name" />
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Description</label>
        <textarea
            class="w-full px-3 py-2 border rounded"
            bind:value={description}
            placeholder="Enter bot description"
            rows="3"
        />
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Position</label>
        <div class="flex gap-2">
            <input type="number" class="w-24 px-3 py-2 border rounded" bind:value={x} placeholder="X" />
            <input type="number" class="w-24 px-3 py-2 border rounded" bind:value={y} placeholder="Y" />
            <button class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300" on:click={handlePickPosition}>
                Pick from Map
            </button>
        </div>
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Character Texture</label>
        <input
            type="text"
            class="w-full px-3 py-2 border rounded"
            bind:value={characterTexture}
            placeholder="Character texture ID"
        />
    </div>
</div>
