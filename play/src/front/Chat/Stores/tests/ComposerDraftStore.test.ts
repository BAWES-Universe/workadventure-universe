import { describe, expect, it } from "vitest";
import { ComposerDraftStore } from "../ComposerDraftStore";

describe("ComposerDraftStore", () => {
    it("keeps one draft per conversation", () => {
        const drafts = new ComposerDraftStore();
        drafts.save("!room-a", { message: "hello A", replyingToMessageId: null });
        drafts.save("!room-b", { message: "hello B", replyingToMessageId: "$event" });

        expect(drafts.load("!room-a")).toEqual({ message: "hello A", replyingToMessageId: null });
        expect(drafts.load("!room-b")).toEqual({ message: "hello B", replyingToMessageId: "$event" });
        expect(drafts.load("!room-c")).toBeUndefined();
    });

    it("forgets an empty draft", () => {
        const drafts = new ComposerDraftStore();
        drafts.save("!room-a", { message: "hello", replyingToMessageId: null });
        drafts.save("!room-a", { message: " <br> ", replyingToMessageId: null });
        expect(drafts.load("!room-a")).toBeUndefined();
    });

    it("keeps an empty message that replies to something", () => {
        const drafts = new ComposerDraftStore();
        drafts.save("!room-a", { message: "", replyingToMessageId: "$event" });
        expect(drafts.load("!room-a")?.replyingToMessageId).toBe("$event");
    });

    it("keeps each tab's drafts apart: two stores never overwrite each other", () => {
        const tab1 = new ComposerDraftStore();
        const tab2 = new ComposerDraftStore();
        tab1.save("!room-a", { message: "from tab 1", replyingToMessageId: null });
        tab2.save("!room-a", { message: "from tab 2", replyingToMessageId: null });
        expect(tab1.load("!room-a")?.message).toBe("from tab 1");
        expect(tab2.load("!room-a")?.message).toBe("from tab 2");
    });

    it("restores a proximity draft only in the space it was written in", () => {
        const drafts = new ComposerDraftStore();
        drafts.save("proximity", { message: "hi Sara", replyingToMessageId: null, spaceGeneration: 3 });
        expect(drafts.load("proximity", 3)?.message).toBe("hi Sara");

        // Sara's bubble was left: the draft must not show up, ready to send, in Omar's.
        expect(drafts.load("proximity", 5)).toBeUndefined();
        // And it is gone for good.
        expect(drafts.load("proximity", 3)).toBeUndefined();
    });

    it("does not copy the stored draft out by reference", () => {
        const drafts = new ComposerDraftStore();
        const draft = { message: "hello", replyingToMessageId: null };
        drafts.save("!room-a", draft);
        draft.message = "changed";
        const loaded = drafts.load("!room-a");
        expect(loaded?.message).toBe("hello");
    });

    it("clears a draft once sent, unless it changed meanwhile", () => {
        const drafts = new ComposerDraftStore();
        drafts.save("!room-a", { message: "with a file", replyingToMessageId: null });
        drafts.clearIfUnchanged("!room-a", "with a file");
        expect(drafts.load("!room-a")).toBeUndefined();

        drafts.save("!room-a", { message: "something newer", replyingToMessageId: null });
        drafts.clearIfUnchanged("!room-a", "with a file");
        expect(drafts.load("!room-a")?.message).toBe("something newer");
    });
});
