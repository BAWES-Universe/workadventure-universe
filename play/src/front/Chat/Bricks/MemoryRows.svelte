<script lang="ts">
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { sayItem, type MemoryItem } from "./BotMemory";
    import { IconLock } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * The things a bot remembers about the person, one to a row, each with its own Forget (game #2003). It is the same
     * list on a Brick's page and in the sheet a bot's chat menu opens. A thing said privately says so: the bot knows it
     * everywhere, and keeps it out of group chats.
     */
    export let items: MemoryItem[];
    export let onForget: (item: MemoryItem) => void;
    export let disabled = false;
</script>

{#each items as item (item.id)}
    {@const said = sayItem(item, $LL, $locale)}
    <div class="bkg-tap" data-testid="memoryRow">
        <span class="bkg-mtx">
            <span class="bkg-t">{said.text}</span>
            <span class="bkg-cn" class:priv={said.private}
                >{#if said.private}<IconLock font-size="12" />{/if}{said.note}</span
            >
        </span>
        <PageButton {disabled} testId="memoryForget" on:click={() => onForget(item)}
            >{$LL.chat.brick.memory.forget()}</PageButton
        >
    </div>
{/each}
