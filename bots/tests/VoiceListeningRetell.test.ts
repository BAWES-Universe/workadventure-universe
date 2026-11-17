/**
 * Listening status follows the daily limit and spoken-reply holds. Setup copied from VoiceGroupListening.test.ts.
 * Listening in a group (round 8): with two or more people in the bubble, the bot takes a person's microphone only after they asked it to
 * keep listening, for this visit. The worker confirms each change, and the person is told only what is confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateEventPusherToFront } from "@workadventure/messages";
import {
  LISTEN_CONFIRM_MS,
  VoiceCalls,
  type GameSide,
  type LinkHandlers,
} from "../voice/VoiceCalls";
import type {
  FromWorker,
  ListenInfo,
  ToWorker,
  VoiceStatus,
} from "../voice/protocol";
import type { VoiceLink } from "../voice/VoiceLink";

const SPACE = "proximity-1";
const BOT = "room_9";

type ModeSet = Extract<ToWorker, { type: "mode.set" }>;

function setup(gate = true) {
  const budget = {
    spent: false,
    isSpent: () => budget.spent,
    check: async () => undefined,
  } as unknown as import("../voice/VoiceListening").ListeningBudget & {
    spent: boolean;
  };
  const sent: ToWorker[] = [];
  const told: { to: string; status: VoiceStatus; listen?: ListenInfo }[] = [];
  let handlers!: LinkHandlers;
  const link: VoiceLink = {
    isUp: () => true,
    send: (m) => (sent.push(m), true),
    close: vi.fn(),
  };
  const game: GameSide = {
    botSpaceUserId: (space) => (space === SPACE ? BOT : undefined),
    sendSignal: () => undefined,
    sendDisconnect: () => undefined,
    sendStart: () => undefined,
    sendDraft: () => undefined,
    sendStatus: (_space, to, status, _left, listen) =>
      told.push({ to, status, listen }),
  };
  const calls = new VoiceCalls(
    "bot-1",
    game,
    (h) => ((handlers = h), link),
    undefined,
    undefined,
    undefined,
    budget
  );
  calls.groupGate = gate;
  const granted: [string, string][] = [];
  calls.onListenGranted = (space, person) => granted.push([space, person]);
  const person = (id: string) =>
    ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id } as never);
  const fromPerson = (who: string, event: object): PrivateEventPusherToFront =>
    ({
      spaceName: SPACE,
      receiverUserId: BOT,
      sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who },
      spaceEvent: { event },
    } as never);
  const start = (who: string) =>
    calls.handlePrivateEvent(
      fromPerson(who, {
        $case: "webRtcStartMessage",
        webRtcStartMessage: { userId: who, initiator: false },
      })
    );
  const choose = (who: string, mode: string, listen = "") =>
    calls.handlePrivateEvent(
      fromPerson(who, {
        $case: "voiceModeChoice",
        voiceModeChoice: { mode, listen },
      })
    );
  const lane = (who: string) =>
    [...sent]
      .reverse()
      .find(
        (m) => m.type === "lane.open" && m.participantId === who
      ) as Extract<ToWorker, { type: "lane.open" }>;
  const connected = (who: string) => {
    const l = lane(who);
    handlers.onMessage({
      type: "participant.join",
      sessionId: l.sessionId,
      participantId: who,
      epoch: l.epoch,
    });
  };
  const modeSets = (who?: string) =>
    (sent.filter((m) => m.type === "mode.set") as ModeSet[]).filter(
      (m) => !who || m.participantId === who
    );
  const lastRequest = (who: string) =>
    modeSets(who)
      .filter((m) => m.requestId)
      .pop()!;
  const ack = (
    who: string,
    overrides: Partial<Extract<FromWorker, { type: "mode.ack" }>> = {}
  ) => {
    const request = lastRequest(who);
    const l = lane(who);
    handlers.onMessage({
      type: "mode.ack",
      sessionId: request.sessionId,
      participantId: who,
      requestId: request.requestId!,
      mode: request.mode,
      path: "lane",
      epoch: l.epoch,
      ...overrides,
    });
  };
  const listenOf = (who: string) =>
    [...told].reverse().find((t) => t.to === who)?.listen ?? {
      state: "",
      reason: "",
    };
  /** Alice alone with the bot and heard hands-free, then Bob joins. */
  const aliceThenBob = () => {
    calls.spaceUsers(SPACE, [person("alice")]);
    start("alice");
    connected("alice");
    calls.spaceUserJoined(SPACE, person("bob"));
    start("bob");
    connected("bob");
  };
  const stopSpeaking = (who: string, responseId: string, mode = "talk") =>
    calls.handlePrivateEvent(
      fromPerson(who, {
        $case: "voiceModeChoice",
        voiceModeChoice: { mode, listen: "", stopSpeaking: responseId },
      })
    );
  return {
    budget,
    calls,
    sent,
    told,
    granted,
    person,
    start,
    choose,
    stopSpeaking,
    connected,
    modeSets,
    lastRequest,
    ack,
    listenOf,
    aliceThenBob,
    onMessage: (m: FromWorker) => handlers.onMessage(m),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("listening status follows the limit and the hold", () => {
  it("tells someone who asked to keep listening when the daily listening runs out, and when it starts again", () => {
    const t = setup();
    t.aliceThenBob();
    t.choose("alice", "talk", "keep");
    t.ack("alice");
    expect(t.listenOf("alice")).toEqual({ state: "on", reason: "" });
    t.budget.spent = true;
    t.calls.listeningChanged();
    expect(t.listenOf("alice")).toEqual({ state: "on", reason: "limit" });
    t.budget.spent = false;
    t.calls.listeningChanged();
    expect(t.listenOf("alice")).toEqual({ state: "on", reason: "" });
  });
});
