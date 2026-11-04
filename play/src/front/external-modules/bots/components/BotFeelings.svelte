<script lang="ts">
    /**
     * How a bot and you stand (#1790), in place of the five bars of BotEmotionsDisplay: the same numbers and the same
     * words, as one small table. Each word once (closeness was said twice), Frustration only when it is there (as
     * today, above 5), and one bar colour: the words carry the meaning.
     */
    export let botName: string;
    export let emotions: {
        botEmotion: { anger: number; happiness: number; trust: number; familiarity: number };
        personEmotion: { anger: number; happiness: number; trust: number };
    } | null = null;

    function word(value: number, type: "anger" | "happiness" | "trust" | "familiarity"): string {
        if (type === "anger") return value >= 75 ? "Furious" : value >= 50 ? "Annoyed" : value >= 25 ? "Irritated" : "Calm";
        if (type === "happiness") return value >= 75 ? "Delighted" : value >= 50 ? "Content" : value >= 25 ? "Neutral" : "Unhappy";
        if (type === "trust") return value >= 75 ? "Deep trust" : value >= 50 ? "Trusting" : value >= 25 ? "Cautious" : "Wary";
        return value >= 75 ? "Close friend" : value >= 50 ? "Acquaintance" : value >= 25 ? "Getting to know" : "Stranger";
    }

    $: rows = emotions
        ? [
              { emoji: "😊", label: "Happiness", bot: emotions.botEmotion.happiness, you: emotions.personEmotion.happiness, type: "happiness" as const },
              { emoji: "🤝", label: "Trust", bot: emotions.botEmotion.trust, you: emotions.personEmotion.trust, type: "trust" as const },
              { emoji: "💫", label: "Familiarity", bot: emotions.botEmotion.familiarity, you: undefined, type: "familiarity" as const },
              ...(emotions.botEmotion.anger > 5 || emotions.personEmotion.anger > 5
                  ? [{ emoji: "😤", label: "Frustration", bot: emotions.botEmotion.anger, you: emotions.personEmotion.anger, type: "anger" as const }]
                  : []),
          ]
        : [];
</script>

<section class="feelings" data-bot-emotions>
    <h4 class="u-eyebrow">{botName} and you</h4>
    {#if emotions}
        <table>
            <thead>
                <tr>
                    <th />
                    <th scope="col">Feels</th>
                    <th scope="col">Thinks you feel</th>
                </tr>
            </thead>
            <tbody>
                {#each rows as row (row.label)}
                    <tr class:anger={row.type === "anger"}>
                        <th scope="row"><span aria-hidden="true">{row.emoji}</span>{row.label}</th>
                        <td>
                            {#if row.type !== "anger" || row.bot > 5}
                                <span class="word">{word(row.bot, row.type)}</span>
                                <span class="meter"><i style:width="{row.bot}%" /></span>
                            {:else}<span class="none">–</span>{/if}
                        </td>
                        <td>
                            {#if row.you !== undefined && (row.type !== "anger" || row.you > 5)}
                                <span class="word">{word(row.you, row.type)}</span>
                                <span class="meter"><i style:width="{row.you}%" /></span>
                            {:else}<span class="none">–</span>{/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {:else}
        <p class="empty">No feelings yet. Start a chat to build a bond.</p>
    {/if}
</section>

<style lang="scss">
    .feelings {
        display: grid;
        gap: 10px;
        margin: 2px 18px 12px;
    }
    h4 {
        margin: 0;
    }
    table {
        width: 100%;
        border: 0;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 13px;
    }
    th,
    td {
        background: none;
        border: 0;
        margin: 0;
        text-transform: none;
        letter-spacing: 0;
        font-size: 13px;
        line-height: 1.3;
    }
    thead th {
        padding: 0 0 6px;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.55);
        text-align: start;
    }
    thead th:first-child {
        width: 34%;
    }
    tbody th {
        padding: 7px 8px 7px 0;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.75);
        text-align: start;
        white-space: nowrap;
    }
    tbody th span {
        margin-inline-end: 6px;
    }
    td {
        padding: 7px 8px 7px 0;
        vertical-align: middle;
    }
    tbody tr + tr > * {
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .word {
        display: block;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .meter {
        display: block;
        height: 3px;
        margin-top: 4px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .meter i {
        display: block;
        height: 100%;
        border-radius: 99px;
        background: #a78bfa;
    }
    .anger .meter i {
        background: #e96d51;
    }
    .none {
        color: rgba(255, 255, 255, 0.35);
    }
    .empty {
        margin: 0;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.6);
    }
</style>
