<script lang="ts">
    /**
     * How a bot and you stand (#1790), in place of the five bars of BotEmotionsDisplay: the same numbers and the same
     * words, as one small table under one title line. Each word once (closeness was said twice), Frustration only when
     * it is there (as today, above 5). A bar's colour says how it is going: green good, amber so-so, coral low; closeness
     * runs from grey to blue as you get to know each other; frustration runs amber, orange, red.
     */
    export let botName: string;
    export let emotions: {
        botEmotion: { anger: number; happiness: number; trust: number; familiarity: number };
        personEmotion: { anger: number; happiness: number; trust: number };
    } | null = null;

    type Kind = "anger" | "happiness" | "trust" | "familiarity";

    function word(value: number, type: Kind): string {
        if (type === "anger") return value >= 75 ? "Furious" : value >= 50 ? "Annoyed" : value >= 25 ? "Irritated" : "Calm";
        if (type === "happiness")
            return value >= 75 ? "Delighted" : value >= 50 ? "Content" : value >= 25 ? "Neutral" : "Unhappy";
        if (type === "trust") return value >= 75 ? "Deep trust" : value >= 50 ? "Trusting" : value >= 25 ? "Cautious" : "Wary";
        return value >= 75 ? "Close friend" : value >= 50 ? "Acquaintance" : value >= 25 ? "Getting to know" : "Stranger";
    }

    /** The colour for this level: the same four steps as the words. */
    function tone(value: number, type: Kind): string {
        const step = value >= 75 ? 3 : value >= 50 ? 2 : value >= 25 ? 1 : 0;
        if (type === "anger") return ["#fbbf24", "#fbbf24", "#fb923c", "#f43f5e"][step];
        if (type === "familiarity") return ["#94a3b8", "#7dd3fc", "#38bdf8", "#60a5fa"][step];
        return ["#fb7185", "#fbbf24", "#4ade80", "#22c55e"][step];
    }

    $: rows = emotions
        ? [
              {
                  emoji: "😊",
                  label: "Happiness",
                  bot: emotions.botEmotion.happiness,
                  you: emotions.personEmotion.happiness,
                  type: "happiness" as const,
              },
              {
                  emoji: "🤝",
                  label: "Trust",
                  bot: emotions.botEmotion.trust,
                  you: emotions.personEmotion.trust,
                  type: "trust" as const,
              },
              {
                  emoji: "💫",
                  label: "Familiarity",
                  bot: emotions.botEmotion.familiarity,
                  you: undefined,
                  type: "familiarity" as const,
              },
              ...(emotions.botEmotion.anger > 5 || emotions.personEmotion.anger > 5
                  ? [
                        {
                            emoji: "😤",
                            label: "Frustration",
                            bot: emotions.botEmotion.anger,
                            you: emotions.personEmotion.anger,
                            type: "anger" as const,
                        },
                    ]
                  : []),
          ]
        : [];
</script>

<section class="feelings" data-bot-emotions>
    {#if emotions}
        <table>
            <thead>
                <tr>
                    <th scope="col" class="title">{botName} and you</th>
                    <th scope="col">Feels</th>
                    <th scope="col">Thinks you feel</th>
                </tr>
            </thead>
            <tbody>
                {#each rows as row (row.label)}
                    <tr>
                        <th scope="row"><span aria-hidden="true">{row.emoji}</span>{row.label}</th>
                        {#each [row.bot, row.you] as value, i (i)}
                            <td>
                                {#if value !== undefined && (row.type !== "anger" || value > 5)}
                                    <span class="word" style:color={tone(value, row.type)}>{word(value, row.type)}</span>
                                    <span class="meter"
                                        ><i style:width="{value}%" style:background={tone(value, row.type)} /></span
                                    >
                                {:else}<span class="none">–</span>{/if}
                            </td>
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>
    {:else}
        <p class="title">{botName} and you</p>
        <p class="empty">
            <span aria-hidden="true">👋</span>You haven't met yet. Feelings start with your first chat.
        </p>
    {/if}
</section>

<style lang="scss">
    .feelings {
        margin: 0 18px 12px;
    }
    table {
        width: 100%;
        margin: 0;
        border: 0;
        border-collapse: collapse;
        table-layout: fixed;
    }
    th,
    td {
        background: none;
        border: 0;
        margin: 0;
        text-transform: none;
        letter-spacing: 0;
        font-size: 13px;
        line-height: 1.25;
    }
    thead th {
        padding: 0 8px 5px 0;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        text-align: start;
        vertical-align: bottom;
    }
    thead th:first-child {
        width: 36%;
    }
    .title,
    thead th.title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        overflow-wrap: anywhere;
    }
    tbody th {
        padding: 6px 8px 6px 0;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.72);
        text-align: start;
        white-space: nowrap;
    }
    tbody th span {
        margin-inline-end: 6px;
    }
    td {
        padding: 6px 8px 6px 0;
        vertical-align: middle;
    }
    tbody tr > * {
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
        height: 4px;
        margin-top: 4px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }
    .meter i {
        display: block;
        height: 100%;
        border-radius: 99px;
    }
    .none {
        color: rgba(255, 255, 255, 0.3);
    }
    .empty {
        display: flex;
        gap: 8px;
        align-items: baseline;
        margin: 6px 0 0;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 13px;
        color: rgba(255, 255, 255, 0.65);
    }
</style>
