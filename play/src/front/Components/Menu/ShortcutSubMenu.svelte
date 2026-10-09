<script lang="ts">
    import { onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";

    type GroupedShortcut = {
        description: string;
        keys: string[];
    };

    let groupedShortcuts: GroupedShortcut[] = [];

    onMount(() => {
        const userInputManager = gameManager.getCurrentGameScene().userInputManager;

        const shortcut1 = userInputManager.keysCodeList;
        const shortcut2 = userInputManager.userInputHandler.shortcuts;

        const rawShortcuts = shortcut1.concat(shortcut2);

        const newGroupedShortcuts: GroupedShortcut[] = [];

        rawShortcuts.forEach(({ description, key, ctrlKey, shiftKey, altKey }) => {
            let keys: string[] = [];

            if (ctrlKey || shiftKey || altKey) {
                if (ctrlKey) {
                    keys = ["Ctrl", "+"];
                }
                if (shiftKey) {
                    keys.push("Shift", "+");
                }
                if (altKey) {
                    keys.push("Alt", "+");
                }
            }
            keys.push(key);

            const existing = newGroupedShortcuts.find((item) => item.description === description);
            if (existing) {
                existing.keys = existing.keys.concat([",", ...keys]);
            } else {
                newGroupedShortcuts.push({ description, keys: keys });
            }
        });

        groupedShortcuts = newGroupedShortcuts;
    });
</script>

<!-- Keyboard: one plain row per action, its keys on the right as small ink keys. -->
<div class="u-set-section" data-testid="settings-keyboard">
    {#each groupedShortcuts as shortcut, i (i)}
        <div class="u-set-row" style="cursor: default">
            <span class="u-set-text"><span class="u-set-label">{shortcut.description}</span></span>
            <span class="u-set-keys" aria-label={$LL.menu.shortcuts.keys()}>
                {#each shortcut.keys as key, j (j)}
                    {#if j % 2 === 1}
                        <span>{key}</span>
                    {:else}
                        <kbd>{key}</kbd>
                    {/if}
                {/each}
            </span>
        </div>
    {/each}
</div>
