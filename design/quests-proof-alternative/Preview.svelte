<script lang="ts">
  import QuestProof from "../../play/src/front/Quests/Proof/QuestProof.svelte";
  import { createQuestProofController } from "../../play/src/front/Quests/Proof/QuestProofController";
  const controller = createQuestProofController(sessionStorage);
  let distraction = "";
  let controls = false;
  const toggle = (name: string) =>
    (distraction = distraction === name ? "" : name);
</script>

<svelte:head><meta name="theme-color" content="#111a2b" /></svelte:head>
<main>
  <header class="brand">
    <span class="wordmark"><i>✦</i> universe</span><span class="place"
      ><b>The Atrium</b><span>Design proof · simulated world</span></span
    ><button class="proof-tools" on:click={() => (controls = !controls)}
      >{controls ? "Hide controls" : "Proof controls"}</button
    >
  </header>
  <section class="world" aria-label="Simulated world backdrop">
    <div class="map" />
    <div class="namecard guide">
      <span class="pixel">✦</span><b>Welcome guide</b><small
        >Fixture resident</small
      >
    </div>
    <div class="namecard you"><span class="pixel human">●</span><b>You</b></div>
    <div class="room-label">THE ATRIUM <span>Make yourself at home.</span></div>
    {#if distraction}
      <aside class="distraction" aria-label="Simulated interruption">
        <button
          on:click={() => (distraction = "")}
          aria-label="Close simulated interruption">×</button
        >
        <small>SIMULATED INTERRUPTION</small>
        <h2>{distraction}</h2>
        <p>The quest steps aside. Your place is kept.</p>
        {#if distraction === "Typing"}<input
            placeholder="Type here…"
            aria-label="Simulated chat input"
          />{/if}
      </aside>
    {/if}
    <div class="quest-layer">
      <QuestProof
        {controller}
        suppressed={!!distraction}
        showScenarios={controls}
        embedded={false}
        bottomClearance={16}
      />
    </div>
  </section>
  <footer class="bar">
    <button
      class:active={distraction === "Chat"}
      on:click={() => toggle("Chat")}><span>▤</span>Chat</button
    ><button
      class:active={distraction === "Video"}
      on:click={() => toggle("Video")}><span>◉</span>Video</button
    ><button
      class:active={distraction === "Express"}
      on:click={() => toggle("Express")}><span>☺</span>Express</button
    ><button
      class:active={distraction === "Typing"}
      on:click={() => toggle("Typing")}><span>⌨</span>Typing</button
    ><button class="journal" on:click={() => controller.openLog()}
      ><span>✧</span>Quests</button
    >
  </footer>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: #111a2b;
    color: #edf1fb;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  :global(button),
  :global(input) {
    font: inherit;
  }
  main {
    height: 100dvh;
    min-height: 400px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .brand {
    height: 76px;
    flex-shrink: 0;
    background: #111a2b;
    display: flex;
    align-items: center;
    gap: 34px;
    padding: 0 28px;
    border-bottom: 1px solid #ffffff12;
    z-index: 2;
  }
  .wordmark {
    font-size: 25px;
    font-weight: 650;
    letter-spacing: -1px;
  }
  .wordmark i {
    font-style: normal;
    color: #cab8ff;
    margin-right: 8px;
  }
  .place {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #9daac2;
  }
  .place b {
    font-weight: 500;
    color: #e7eaf2;
    font-size: 14px;
  }
  .proof-tools {
    margin-left: auto;
    min-height: 44px;
    background: #ffffff08;
    border: 1px solid #ffffff18;
    border-radius: 12px;
    color: #b5c0d7;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 12px;
  }
  .world {
    position: relative;
    flex: 1;
    min-height: 0;
    isolation: isolate;
    background: #344747;
  }
  .map {
    position: absolute;
    inset: 0;
    background: url("./map.png") center/cover;
    image-rendering: pixelated;
    filter: brightness(0.75) saturate(0.75);
  }
  .world:after {
    position: absolute;
    content: "";
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: linear-gradient(
      180deg,
      #101a2733 0%,
      transparent 35%,
      #08101b80 100%
    );
  }
  .namecard {
    position: absolute;
    z-index: 1;
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 5px;
    filter: drop-shadow(0 3px 7px #0008);
    font-size: 12px;
  }
  .namecard b {
    border: 1px solid #ffffff25;
    background: #142337dd;
    border-radius: 6px;
    padding: 4px 9px;
    font-weight: 500;
  }
  .namecard small {
    font-size: 10px;
    color: #d6e3e5;
    background: #142337dd;
    padding: 3px 7px;
    border-radius: 6px;
  }
  .pixel {
    display: grid;
    place-items: center;
    background: #7958c9;
    color: #e9d57d;
    width: 30px;
    height: 40px;
    border: 3px solid #d6c7fa;
    box-shadow: 0 3px #39255f;
    border-radius: 8px 8px 3px 3px;
    font-size: 21px;
  }
  .pixel.human {
    background: #468595;
    border-color: #cae7e6;
    color: #eed0a6;
  }
  .guide {
    left: 56%;
    top: 29%;
  }
  .you {
    left: 48%;
    top: 45%;
  }
  .room-label {
    position: absolute;
    top: 24px;
    left: 26px;
    z-index: 1;
    font-size: 11px;
    letter-spacing: 0.16em;
    color: #f1eddf;
    font-weight: 600;
  }
  .room-label span {
    display: block;
    font-size: 12px;
    letter-spacing: 0;
    color: #d6dfdf;
    font-weight: 400;
    margin-top: 7px;
  }
  .quest-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  .bar {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 9px 20px;
    background: #111a2b;
    z-index: 5;
    border-top: 1px solid #ffffff14;
  }
  .bar button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid transparent;
    background: #ffffff06;
    color: #b6c2d8;
    border-radius: 11px;
    min-height: 44px;
    min-width: 86px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
  }
  .bar button span {
    font-size: 19px;
    color: #c4cbe3;
  }
  .bar .journal {
    color: #e1d5ff;
    background: #7c58c92b;
    border-color: #9872e043;
  }
  .bar button.active {
    background: #6b52ab45;
    border-color: #a78fe4;
  }
  .distraction {
    position: absolute;
    z-index: 6;
    right: 22px;
    top: 22px;
    width: min(330px, calc(100% - 44px));
    border: 1px solid #71658d;
    background: #182237;
    border-radius: 20px;
    padding: 28px;
    box-shadow: 0 14px 60px #0006;
  }
  .distraction button {
    float: right;
    background: none;
    border: 0;
    color: white;
    font-size: 26px;
    width: 44px;
    height: 44px;
    margin: -16px -16px 0 0;
    cursor: pointer;
  }
  .distraction small {
    font-size: 10px;
    letter-spacing: 0.1em;
    color: #b2a6cd;
  }
  .distraction h2 {
    font-size: 25px;
    margin: 22px 0 10px;
  }
  .distraction p {
    line-height: 1.5;
    color: #bfcadc;
    font-size: 14px;
  }
  .distraction input {
    width: 100%;
    padding: 12px;
    background: #0c1422;
    border: 1px solid #667087;
    border-radius: 9px;
    color: white;
    font-size: 16px;
    min-width: 0;
  }
  @media (max-width: 600px) {
    .brand {
      height: 66px;
      padding: 0 16px;
      gap: 12px;
    }
    .wordmark {
      font-size: 21px;
    }
    .place {
      display: none;
    }
    .proof-tools {
      font-size: 11px;
      padding: 8px 10px;
    }
    .bar {
      gap: 4px;
      padding: 8px 5px;
      padding-bottom: max(8px, env(safe-area-inset-bottom));
    }
    .bar button {
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      flex: 1;
      padding: 4px;
      font-size: 10px;
    }
    .bar button span {
      font-size: 20px;
    }
    .map {
      background-size: auto 100%;
      background-position: 48% center;
    }
    .room-label {
      left: 16px;
      top: 18px;
      font-size: 9px;
    }
    .guide {
      left: 63%;
      top: 22%;
    }
    .you {
      left: 47%;
      top: 38%;
    }
    .namecard {
      font-size: 10px;
    }
    .namecard small {
      display: none;
    }
  }
</style>
