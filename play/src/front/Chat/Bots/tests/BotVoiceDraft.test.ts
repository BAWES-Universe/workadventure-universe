import { describe, expect, it } from "vitest";
import {
    MAX_VOICE_DRAFTS,
    afterTypedSend,
    applyDraftEvent,
    cardToShow,
    discardDraft,
    editDraft,
    parseBotVoiceDraft,
    sendDraft,
    splitTentativeWord,
    type BotVoiceDraft,
    type VoiceDraftEvent,
} from "../BotVoiceDraft";

const ids = { botId: "b-1", botName: "Nora" };
const live = (turnId: string, text: string): VoiceDraftEvent => ({ kind: "live", ...ids, turnId, text });
const final = (turnId: string, text: string): VoiceDraftEvent => ({ kind: "final", ...ids, turnId, text });
const lost = (turnId: string, text: string): VoiceDraftEvent => ({ kind: "lost", ...ids, turnId, text });
const cleared = (turnId: string): VoiceDraftEvent => ({ kind: "cleared", ...ids, turnId });
const draft = (turnId: string, state: BotVoiceDraft["state"], text: string): BotVoiceDraft => ({
    ...ids,
    turnId,
    state,
    text,
});

describe("what a bot says it hears", () => {
    it("is read from the bot's event, with the bot's own name", () => {
        expect(
            parseBotVoiceDraft(
                { botId: "b-1", turnId: "3-1", state: "live", text: "Actually which", reason: "" },
                " Nora "
            )
        ).toEqual({
            kind: "live",
            botId: "b-1",
            botName: "Nora",
            turnId: "3-1",
            text: "Actually which",
        });
        expect(parseBotVoiceDraft({ botId: "b-1", turnId: "3-1", state: "cleared", text: "" }, "Nora")).toEqual({
            kind: "cleared",
            botId: "b-1",
            botName: "Nora",
            turnId: "3-1",
        });
    });

    it("is refused when any part is missing or not one we know", () => {
        const ok = { botId: "b-1", turnId: "3-1", state: "live", text: "hi" };
        expect(parseBotVoiceDraft(undefined, "Nora")).toBeUndefined();
        expect(parseBotVoiceDraft({ ...ok, botId: "" }, "Nora")).toBeUndefined();
        expect(parseBotVoiceDraft({ ...ok, turnId: 3 }, "Nora")).toBeUndefined();
        expect(parseBotVoiceDraft({ ...ok, state: "sent" }, "Nora")).toBeUndefined();
        expect(parseBotVoiceDraft({ ...ok, text: undefined }, "Nora")).toBeUndefined();
        expect(parseBotVoiceDraft({ ...ok, text: "x".repeat(9000) }, "Nora")).toBeUndefined();
    });
});

describe("words filling in while someone talks", () => {
    it("shows each new set of words in place of the last, for one stretch of speech", () => {
        let drafts = applyDraftEvent([], live("1", "Actually")).drafts;
        drafts = applyDraftEvent(drafts, live("1", "Actually which of them")).drafts;
        expect(drafts).toEqual([draft("1", "live", "Actually which of them")]);
    });

    it("sends nothing while it is live", () => {
        expect(applyDraftEvent([], live("1", "Actually")).send).toBeUndefined();
    });

    it("sends one line, and removes the draft, when every word came through", () => {
        const change = applyDraftEvent(
            [draft("1", "live", "Actually which")],
            final("1", "Actually which of them replied")
        );
        expect(change.drafts).toEqual([]);
        expect(change.send).toEqual({ botId: "b-1", turnId: "1", text: "Actually which of them replied" });
    });

    it("clears the draft when there was nothing to keep", () => {
        expect(applyDraftEvent([draft("1", "live", "um")], cleared("1")).drafts).toEqual([]);
    });

    it("keeps drafts of different stretches apart, and a bounded few", () => {
        let drafts: BotVoiceDraft[] = [];
        for (let i = 0; i < MAX_VOICE_DRAFTS + 2; i++) drafts = applyDraftEvent(drafts, live(`t${i}`, "words")).drafts;
        expect(drafts).toHaveLength(MAX_VOICE_DRAFTS);
        expect(drafts[drafts.length - 1].turnId).toBe(`t${MAX_VOICE_DRAFTS + 1}`);
    });
});

describe("words that did not come through", () => {
    it("are only offered back: no line is sent for them", () => {
        const change = applyDraftEvent([draft("1", "live", "one two")], lost("1", "one two three"));
        expect(change.drafts).toEqual([draft("1", "lost", "one two three")]);
        expect(change.send).toBeUndefined();
    });

    it("show even when nothing was on screen yet", () => {
        expect(applyDraftEvent([], lost("1", "one two")).drafts).toEqual([draft("1", "lost", "one two")]);
    });

    it("stay lost: late words or a late finish of that stretch do not send or change them", () => {
        const drafts = [draft("1", "lost", "one two")];
        expect(applyDraftEvent(drafts, live("1", "one two three")).drafts).toEqual(drafts);
        const late = applyDraftEvent(drafts, final("1", "one two three four"));
        expect(late.drafts).toEqual(drafts);
        expect(late.send).toBeUndefined();
    });

    it("Send makes their words the person's line, once", () => {
        const change = sendDraft([draft("1", "lost", "one two three")], "1");
        expect(change.send).toEqual({ botId: "b-1", turnId: "1", text: "one two three" });
        expect(change.drafts).toEqual([]);
        expect(sendDraft(change.drafts, "1").send).toBeUndefined();
    });

    it("Discard drops the words and sends nothing", () => {
        expect(discardDraft([draft("1", "lost", "one two"), draft("2", "lost", "other")], "1")).toEqual([
            draft("2", "lost", "other"),
        ]);
    });

    it("Edit hands the words over to the message box and drops the draft", () => {
        expect(editDraft([draft("1", "lost", "one two")], "1")).toEqual({ drafts: [], text: "one two" });
        expect(editDraft([], "1")).toEqual({ drafts: [] });
    });

    it("never send, discard or edit words still being heard", () => {
        const drafts = [draft("1", "live", "one two")];
        expect(sendDraft(drafts, "1").send).toBeUndefined();
        expect(discardDraft(drafts, "1")).toEqual(drafts);
        expect(editDraft(drafts, "1").text).toBeUndefined();
    });

    it("never send blank words", () => {
        expect(sendDraft([draft("1", "lost", "  ")], "1").send).toBeUndefined();
    });
});

describe("a line typed while still talking", () => {
    it("wins: the words are no longer shown, and go to the message box when the stretch ends, not sent", () => {
        const held = afterTypedSend([draft("1", "live", "Actually which")]);
        expect(held).toEqual([draft("1", "held", "Actually which")]);
        expect(cardToShow(held)).toBeUndefined();
        // They finish talking: the final words go to the message box, and nothing is sent
        const change = applyDraftEvent(held, final("1", "Actually which of them replied"));
        expect(change.drafts).toEqual([]);
        expect(change.toComposer).toBe("Actually which of them replied");
        expect(change.send).toBeUndefined();
    });

    it("keeps the words up to date while the person goes on speaking, and also hands over lost words", () => {
        const held = afterTypedSend([draft("1", "live", "Actually")]);
        expect(applyDraftEvent(held, live("1", "Actually which")).drafts).toEqual([
            draft("1", "held", "Actually which"),
        ]);
        const change = applyDraftEvent(held, lost("1", "Actually which of"));
        expect(change.drafts).toEqual([]);
        expect(change.toComposer).toBe("Actually which of");
    });

    it("drops words that are cleared on purpose, and hands over nothing blank", () => {
        const held = [draft("1", "held", "Actually")];
        expect(applyDraftEvent(held, cleared("1"))).toEqual({ drafts: [] });
        expect(applyDraftEvent(held, final("1", "  ")).toComposer).toBeUndefined();
    });

    it("changes nothing when nothing is being said, and leaves words already offered back alone", () => {
        const drafts = [draft("1", "lost", "one two")];
        expect(afterTypedSend(drafts)).toBe(drafts);
        expect(afterTypedSend([])).toEqual([]);
    });

    it("has no Send, Edit or Discard for held words", () => {
        const held = [draft("1", "held", "Actually which")];
        expect(sendDraft(held, "1").send).toBeUndefined();
        expect(editDraft(held, "1").text).toBeUndefined();
        expect(discardDraft(held, "1")).toEqual(held);
    });
});

describe("the one card shown", () => {
    it("is the newest draft that is not held", () => {
        const drafts = [draft("1", "lost", "old"), { ...draft("2", "live", "new"), botId: "b-2", botName: "Max" }];
        expect(cardToShow(drafts)?.turnId).toBe("2");
        expect(cardToShow([draft("1", "lost", "old"), draft("2", "held", "typed over")])?.turnId).toBe("1");
        expect(cardToShow([])).toBeUndefined();
    });
});

describe("the quieter newest word", () => {
    it("splits off the last word", () => {
        expect(splitTentativeWord("Actually which of them replied this week")).toEqual({
            settled: "Actually which of them replied this ",
            tentative: "week",
        });
        expect(splitTentativeWord("Actually")).toEqual({ settled: "", tentative: "Actually" });
        expect(splitTentativeWord("")).toEqual({ settled: "", tentative: "" });
        expect(splitTentativeWord("one two  ")).toEqual({ settled: "one ", tentative: "two" });
    });
});
