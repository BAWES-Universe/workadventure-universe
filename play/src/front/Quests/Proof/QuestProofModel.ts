/** An isolated UX fixture. Nothing here detects gameplay, grants a reward or writes an account. */
export type QuestPath = "meet" | "explore" | "build";
export type QuestScenario = "bot" | "area" | "none" | "empty";
export type QuestSurface = "invitation" | "options" | "pill" | "card" | "log" | "payoff" | "hidden";
export type QuestProgress = { accepted: boolean; done: boolean };
export type QuestProofState = {
    version: 1;
    scenario: QuestScenario;
    surface: QuestSurface;
    declined: boolean;
    hidden: boolean;
    tracked: QuestPath | null;
    quests: Record<QuestPath, QuestProgress>;
    pending: QuestPath[];
    payoff: QuestPath | null;
    participantPresent: boolean;
    targetAvailable: boolean;
    session: number;
    exchange: { session: number; sent: boolean; received: boolean };
    guidance: QuestPath | null;
    appointment: boolean;
};
export type ProofEvent =
    | { type: "options" | "decline" | "log" | "close" | "hide" | "restore" | "untrack" | "show" | "settle" }
    | { type: "accept"; path: QuestPath }
    | { type: "message"; direction: "sent" | "received"; session: number }
    | {
          type:
              | "area-entered"
              | "safe-build-placed"
              | "participant-left"
              | "participant-returned"
              | "target-removed"
              | "reconnect";
      }
    | { type: "appointment"; value: boolean }
    | { type: "reset"; scenario: QuestScenario };
export const PATHS: QuestPath[] = ["meet", "explore", "build"];
export function initialProofState(scenario: QuestScenario = "bot"): QuestProofState {
    return {
        version: 1,
        scenario,
        surface: scenario === "empty" ? "hidden" : "invitation",
        declined: false,
        hidden: false,
        tracked: null,
        quests: {
            meet: { accepted: false, done: false },
            explore: { accepted: false, done: false },
            build: { accepted: false, done: false },
        },
        pending: [],
        payoff: null,
        participantPresent: scenario !== "empty",
        targetAvailable: scenario !== "empty",
        session: 1,
        exchange: { session: 1, sent: false, received: false },
        guidance: null,
        appointment: false,
    };
}
export function availablePaths(state: QuestProofState): QuestPath[] {
    if (state.scenario === "empty") return [];
    return PATHS.filter((path) => {
        if (state.quests[path].done) return false;
        if (path === "meet") return state.participantPresent;
        if (path === "explore") return state.targetAvailable;
        // Only this explicitly safe fixture has a build target. Editor rights alone are not enough.
        return state.scenario === "bot" && state.targetAvailable;
    });
}
function finish(state: QuestProofState, path: QuestPath): void {
    if (!state.quests[path].accepted || state.quests[path].done) return;
    state.quests[path].done = true;
    // An accepted but untracked quest finishes quietly in the log.
    if (state.tracked === path) state.pending.push(path);
    state.guidance = null;
}
export function reduceProof(previous: QuestProofState, event: ProofEvent): QuestProofState {
    if (event.type === "reset") return initialProofState(event.scenario);
    const state: QuestProofState = JSON.parse(JSON.stringify(previous));
    switch (event.type) {
        case "options":
            state.surface = "options";
            break;
        case "decline":
            state.declined = true;
            state.surface = "hidden";
            state.guidance = null;
            break;
        case "log":
            state.surface = "log";
            state.guidance = null;
            break;
        case "close":
            state.guidance = null;
            state.surface =
                state.surface === "options" && !state.declined && !PATHS.some((path) => state.quests[path].accepted)
                    ? "invitation"
                    : state.tracked && !state.hidden && !state.quests[state.tracked].done
                    ? "pill"
                    : "hidden";
            break;
        case "hide":
            state.hidden = true;
            state.surface = "hidden";
            state.guidance = null;
            break;
        case "restore":
            state.hidden = false;
            state.surface = "log";
            break;
        case "accept":
            if (!state.quests[event.path].accepted && !availablePaths(state).includes(event.path)) break;
            if (state.quests[event.path].done) break;
            state.quests[event.path].accepted = true;
            state.tracked = event.path;
            state.hidden = false;
            state.surface = "pill";
            break;
        case "untrack":
            state.tracked = null;
            state.surface = "hidden";
            state.guidance = null;
            break;
        case "show":
            state.surface = "card";
            state.guidance = state.tracked;
            break;
        case "message":
            if (!state.participantPresent || !state.quests.meet.accepted || event.session !== state.session) break;
            state.exchange[event.direction] = true;
            if (state.exchange.sent && state.exchange.received) finish(state, "meet");
            break;
        case "area-entered":
            if (state.targetAvailable) finish(state, "explore");
            break;
        case "safe-build-placed":
            if (state.scenario === "bot" && state.targetAvailable) finish(state, "build");
            break;
        case "participant-left":
            state.participantPresent = false;
            state.session++;
            state.exchange = { session: state.session, sent: false, received: false };
            state.guidance = null;
            break;
        case "participant-returned":
            state.participantPresent = state.scenario !== "empty";
            break;
        case "target-removed":
            state.targetAvailable = false;
            state.guidance = null;
            break;
        case "reconnect":
            state.session++;
            state.exchange = { session: state.session, sent: false, received: false };
            state.guidance = null;
            // Accepted progress survives; a partial exchange does not cross conversation sessions.
            break;
        case "appointment":
            state.appointment = event.value;
            if (event.value) state.guidance = null;
            break;
        case "settle":
            state.payoff = null;
            state.surface = state.tracked && !state.hidden && !state.quests[state.tracked].done ? "pill" : "hidden";
            break;
    }
    return state;
}
/** Called only when automatic UI is allowed. Opening the log never forces a celebration. */
export function revealPending(state: QuestProofState, suppressed: boolean): QuestProofState {
    // The player may choose a different quest while a completion waits for a quiet moment.
    // Keep that completion in the log; it must not take over their new selection.
    const currentPending = state.pending.filter((path) => path === state.tracked);
    if (currentPending.length !== state.pending.length) state = { ...state, pending: currentPending };
    if (
        suppressed ||
        state.hidden ||
        state.appointment ||
        state.surface === "log" ||
        state.surface === "payoff" ||
        !state.pending.length
    )
        return state;
    const [payoff, ...pending] = state.pending;
    return { ...state, payoff, pending, surface: "payoff", tracked: state.tracked === payoff ? null : state.tracked };
}
export function effectiveSurface(state: QuestProofState, suppressed: boolean): QuestSurface {
    if (state.surface === "log") return "log";
    if (suppressed || state.appointment || state.hidden) return "hidden";
    return state.surface;
}
export function restoreProof(raw: string | null): QuestProofState | null {
    if (!raw) return null;
    try {
        const saved = JSON.parse(raw) as Partial<QuestProofState>;
        if (saved.version !== 1 || !["bot", "area", "none", "empty"].includes(saved.scenario ?? "")) return null;
        const state = initialProofState(saved.scenario);
        state.declined = saved.declined === true;
        state.hidden = saved.hidden === true;
        for (const path of PATHS) {
            state.quests[path] = {
                accepted: saved.quests?.[path]?.accepted === true,
                done: saved.quests?.[path]?.done === true,
            };
        }
        state.tracked =
            saved.tracked &&
            PATHS.includes(saved.tracked) &&
            state.quests[saved.tracked].accepted &&
            !state.quests[saved.tracked].done
                ? saved.tracked
                : null;
        state.pending = Array.isArray(saved.pending)
            ? [...new Set(saved.pending.filter((path) => PATHS.includes(path) && state.quests[path].done))]
            : [];
        state.surface =
            state.hidden || state.declined || PATHS.some((path) => state.quests[path].accepted)
                ? "hidden"
                : state.surface;
        if (state.tracked && !state.hidden) state.surface = "pill";
        return state;
    } catch {
        return null;
    }
}
