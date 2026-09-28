import { createQuestProofController } from "./QuestProofController";
// Vite folds DEV to false in production. No URL or storage setting can override that.
export const questsProofEnabled =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("questProof") === "1";
export const questProofController = createQuestProofController(
    questsProofEnabled
        ? (() => {
              try {
                  return window.localStorage;
              } catch {
                  return undefined;
              }
          })()
        : undefined
);
