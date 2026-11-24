import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { readAppOffer, type AppOffer } from "../Brick";
import { APP_CONNECT, APP_NOT_NOW, APP_OTHER, BRICK_APP_CARD, brickAppCard } from "../BrickHello";
import { connectFromCard, type ChatConnectSteps } from "../Apps/ChatConnect";

const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:chat.test";
const raw = {
    topic: "app google calendar",
    app: "google-calendar",
    name: "Google Calendar",
    connectKind: "listed",
    state: "new",
    connectionId: null,
    ask: "Connect your calendar?",
    asked: false,
    other: { label: "Another calendar", line: "Outlook, iCloud and more", search: "calendar" },
};
const content = (offer: unknown = raw) => ({
    msgtype: "m.text",
    body: "Connect your calendar?",
    "universe.app_offer": offer,
});

describe("a Brick's offer to connect an App, as the chat reads it", () => {
    it("reads the offer only when it is whole and from a bot", () => {
        expect(readAppOffer(BRICK, content())).toEqual(raw);
        expect(readAppOffer("@sara:chat.test", content())).toBeUndefined();
        expect(readAppOffer(BRICK, { ...content(), msgtype: "m.notice" })).toBeUndefined();
        for (const missing of ["topic", "app", "name"]) {
            expect(readAppOffer(BRICK, content({ ...raw, [missing]: " " }))).toBeUndefined();
        }
        expect(readAppOffer(BRICK, content("calendar"))).toBeUndefined();
        expect(readAppOffer(BRICK, { msgtype: "m.text", body: "x" })).toBeUndefined();
    });

    it("reads which call connects it: ready-made, or listed, which is also what an older message means", () => {
        expect(readAppOffer(BRICK, content({ ...raw, connectKind: "readyMade" }))?.connectKind).toBe("readyMade");
        expect(readAppOffer(BRICK, content({ ...raw, connectKind: "listed" }))?.connectKind).toBe("listed");
        const older: Record<string, unknown> = { ...raw };
        delete older.connectKind;
        expect(readAppOffer(BRICK, content(older))?.connectKind).toBe("listed");
        expect(readAppOffer(BRICK, content({ ...raw, connectKind: "something else" }))?.connectKind).toBe("listed");
    });

    it("drops a second choice that cannot be used, and a 'let it use' that names no connection", () => {
        expect(readAppOffer(BRICK, content({ ...raw, other: { label: "Another calendar" } }))?.other).toBeNull();
        expect(readAppOffer(BRICK, content({ ...raw, other: "x" }))?.other).toBeNull();
        expect(readAppOffer(BRICK, content({ ...raw, state: "connected", connectionId: null }))?.state).toBe("new");
        expect(readAppOffer(BRICK, content({ ...raw, state: "connected", connectionId: "c1" }))).toMatchObject({
            state: "connected",
            connectionId: "c1",
        });
    });
});

describe("the card", () => {
    beforeAll(() => loadLocale("en-US"));
    const LL = () => i18nObject("en-US");
    const offer = (over: Partial<AppOffer> = {}): AppOffer => ({ ...(raw as AppOffer), ...over });

    it("asks 'Connect your calendar?' with the App's sign-in, a second choice and 'Not now', as in mock v10", () => {
        const card = brickAppCard(offer(), LL());
        expect(card.id).toBe(BRICK_APP_CARD);
        expect(card.title).toBe("Connect your calendar?");
        expect(card.question).toEqual({
            multiple: false,
            choices: [
                { id: APP_CONNECT, label: "Connect Google Calendar", line: "Opens Google Calendar's own sign-in page" },
                { id: APP_OTHER, label: "Another calendar", line: "Outlook, iCloud and more" },
                { id: APP_NOT_NOW, label: "Not now", line: "I'll help another way, and won't ask again" },
            ],
        });
        expect(card.expiresAt).toBeGreaterThan(Date.now() + 100 * 365 * 24 * 3600 * 1000);
    });

    it("asks 'Connect Notion?' for one they asked for by name, with two choices", () => {
        const card = brickAppCard(
            offer({ app: "notion", name: "Notion", ask: "", asked: true, other: raw.other }),
            LL()
        );
        expect(card.title).toBe("Connect Notion?");
        expect(card.question?.choices).toEqual([
            { id: APP_CONNECT, label: "Connect Notion", line: "Opens Notion's own sign-in page" },
            { id: APP_NOT_NOW, label: "Not now", line: "Nothing is connected" },
        ]);
    });

    it("says 'Let it use' for an App they connected already, never a second sign-in", () => {
        const card = brickAppCard(offer({ state: "connected", connectionId: "c1", name: "Gmail", other: null }), LL());
        expect(card.question?.choices[0]).toEqual({
            id: APP_CONNECT,
            label: "Let it use Gmail",
            line: "You connected it already",
        });
    });

    it("never calls an App a tool, a server or a connector", () => {
        const words = JSON.stringify(brickAppCard(offer(), LL())) + JSON.stringify(LL().chat.brick.appCard);
        expect(words).not.toMatch(/\btools?\b|MCP|connector|server/i);
    });
});

type Mocked = { [K in keyof ChatConnectSteps]: Mock & ChatConnectSteps[K] };

/** Like the real sign-in: the window is open first, then the connection is made behind it, and the window ends with `result` */
const windowThatEnds = (result: "done" | "stopped" | "blocked") =>
    vi.fn((makeApp: () => Promise<string>) => {
        makeApp().catch(() => undefined);
        return Promise.resolve(result);
    });

function steps(over: Partial<ChatConnectSteps> = {}): Mocked {
    return {
        connectListedApp: vi.fn(() => Promise.resolve("conn-1")),
        signIn: windowThatEnds("done"),
        connectReadyMade: vi.fn(() => Promise.resolve({ status: "connected", appId: "conn-rm" } as const)),
        isConnected: vi.fn(() => Promise.resolve(false)),
        letBrickUse: vi.fn(() => Promise.resolve(undefined)),
        carryOn: vi.fn(() => Promise.resolve()),
        refresh: vi.fn(() => Promise.resolve()),
        ...over,
    } as never;
}

describe("connecting from the card", () => {
    it("connects, opens the sign-in window in the same tap, lets only this Brick use it, then tells the Brick to carry on", async () => {
        const s = steps();
        const order: string[] = [];
        s.connectListedApp.mockImplementation(() => (order.push("connect"), Promise.resolve("conn-1")));
        s.signIn.mockImplementation((makeApp: () => Promise<string>) => {
            order.push("window");
            makeApp().catch(() => undefined);
            return Promise.resolve("done" as const);
        });
        s.letBrickUse.mockImplementation(() => (order.push("let"), Promise.resolve(undefined)));
        s.carryOn.mockImplementation(() => (order.push("carry on"), Promise.resolve()));

        const pending = connectFromCard(raw as AppOffer, "brick-1", s);
        // The window opens first, in the tap, and the connection is made behind it: a window that cannot open makes none
        expect(order).toEqual(["window", "connect"]);
        expect(await pending).toBe("connected");

        expect(s.connectListedApp).toHaveBeenCalledWith("google-calendar");
        // The window is given the way to ask for the connection, and the sign-in uses what it answers
        expect(s.signIn).toHaveBeenCalledTimes(1);
        expect(s.letBrickUse).toHaveBeenCalledWith("conn-1", "brick-1");
        expect(s.carryOn).toHaveBeenCalledWith({ app: "google-calendar", name: "Google Calendar" });
        expect(order).toEqual(["window", "connect", "let", "carry on"]);
        expect(s.refresh).toHaveBeenCalled();
    });

    it("only lets the Brick use an App they connected already, with no window", async () => {
        const s = steps();
        const result = await connectFromCard(
            { ...(raw as AppOffer), state: "connected", connectionId: "conn-9" },
            "brick-1",
            s
        );
        expect(result).toBe("connected");
        expect(s.connectListedApp).not.toHaveBeenCalled();
        expect(s.signIn).not.toHaveBeenCalled();
        expect(s.letBrickUse).toHaveBeenCalledWith("conn-9", "brick-1");
        expect(s.carryOn).toHaveBeenCalledTimes(1);
    });

    it("lets nothing use the App and says nothing to the Brick when the window is closed", async () => {
        const s = steps({ signIn: windowThatEnds("stopped") });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("stopped");
        expect(s.letBrickUse).not.toHaveBeenCalled();
        expect(s.carryOn).not.toHaveBeenCalled();
    });

    it("is blocked when the window cannot open and the App is not connected anyway", async () => {
        // A window that could not open never asks for the connection
        const s = steps({ signIn: vi.fn(() => Promise.resolve("blocked" as const)) });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("blocked");
        expect(s.connectListedApp).not.toHaveBeenCalled();
        expect(s.letBrickUse).not.toHaveBeenCalled();
    });

    it("goes on for an App that needs no sign-in: no window opened, but it is connected", async () => {
        const s = steps({
            signIn: windowThatEnds("blocked"),
            isConnected: vi.fn(() => Promise.resolve(true)),
        });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("connected");
        expect(s.letBrickUse).toHaveBeenCalledWith("conn-1", "brick-1");
    });

    it("is blocked when the connection cannot be made", async () => {
        const s = steps({
            connectListedApp: vi.fn(() => Promise.reject(new Error("no"))),
            signIn: windowThatEnds("blocked"),
        });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("blocked");
        expect(s.carryOn).not.toHaveBeenCalled();
    });

    it("says the App is connected but not let in when this Brick cannot be let use it, and does not tell it to carry on", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const s = steps({ letBrickUse: vi.fn(() => Promise.reject(new Error("no"))) });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("not_let");
        expect(s.carryOn).not.toHaveBeenCalled();
        expect(s.refresh).toHaveBeenCalled();
    });

    it("says the App is connected and let in but the Brick was not told to carry on, when the nudge to it is lost", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const s = steps({ carryOn: vi.fn(() => Promise.reject(new Error("offline"))) });
        expect(await connectFromCard(raw as AppOffer, "brick-1", s)).toBe("not_resumed");
        expect(s.letBrickUse).toHaveBeenCalledWith("conn-1", "brick-1");
    });

    describe("a ready-made App", () => {
        const ready = { ...(raw as AppOffer), app: "gmail", name: "Gmail", connectKind: "readyMade" as const };

        it("connects through the ready-made sign-in, never the list, and lets this Brick use it", async () => {
            const s = steps();
            const order: string[] = [];
            s.connectReadyMade.mockImplementation(
                () => (order.push("window"), Promise.resolve({ status: "connected", appId: "conn-rm" } as const))
            );
            s.letBrickUse.mockImplementation(() => (order.push("let"), Promise.resolve(undefined)));
            s.carryOn.mockImplementation(() => (order.push("carry on"), Promise.resolve()));
            const pending = connectFromCard(ready, "brick-1", s);
            // Started in the same tap, before anything is awaited: the window is not blocked
            expect(order).toEqual(["window"]);
            expect(await pending).toBe("connected");
            expect(s.connectReadyMade).toHaveBeenCalledWith({ key: "gmail", name: "Gmail" });
            expect(s.connectListedApp).not.toHaveBeenCalled();
            expect(s.signIn).not.toHaveBeenCalled();
            expect(s.letBrickUse).toHaveBeenCalledWith("conn-rm", "brick-1");
            expect(s.carryOn).toHaveBeenCalledWith({ app: "gmail", name: "Gmail" });
            expect(order).toEqual(["window", "let", "carry on"]);
        });

        it("signs in again for one they started and never finished: its state is new", async () => {
            const s = steps();
            expect(await connectFromCard({ ...ready, state: "new", connectionId: "half" }, "brick-1", s)).toBe(
                "connected"
            );
            expect(s.connectReadyMade).toHaveBeenCalledTimes(1);
            expect(s.letBrickUse).toHaveBeenCalledWith("conn-rm", "brick-1");
        });

        it("only lets the Brick use one they connected already, with no window", async () => {
            const s = steps();
            expect(await connectFromCard({ ...ready, state: "connected", connectionId: "conn-9" }, "brick-1", s)).toBe(
                "connected"
            );
            expect(s.connectReadyMade).not.toHaveBeenCalled();
            expect(s.letBrickUse).toHaveBeenCalledWith("conn-9", "brick-1");
        });

        it.each([
            ["stopped", "stopped"],
            ["unchecked", "unchecked"],
            ["blocked", "blocked"],
        ] as const)(
            "a sign-in that ends %s lets nothing use the App and tells the Brick nothing",
            async (status, result) => {
                const s = steps({ connectReadyMade: vi.fn(() => Promise.resolve({ status } as const)) });
                expect(await connectFromCard(ready, "brick-1", s)).toBe(result);
                expect(s.letBrickUse).not.toHaveBeenCalled();
                expect(s.carryOn).not.toHaveBeenCalled();
            }
        );

        it.each([
            ["stopped", true],
            ["unchecked", true],
            ["blocked", false],
        ] as const)("reads the Apps again after a sign-in that is %s: %s", async (status, refreshed) => {
            const s = steps({ connectReadyMade: vi.fn(() => Promise.resolve({ status } as const)) });
            await connectFromCard(ready, "brick-1", s);
            expect(s.refresh.mock.calls.length > 0).toBe(refreshed);
        });

        it("says the App is connected but not let in when this Brick cannot be let use it", async () => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const s = steps({ letBrickUse: vi.fn(() => Promise.reject(new Error("no"))) });
            expect(await connectFromCard(ready, "brick-1", s)).toBe("not_let");
            expect(s.carryOn).not.toHaveBeenCalled();
        });
    });

    describe("GitHub, through Universe's own GitHub App", () => {
        it("is a listed App: the same connection and sign-in window as any App of the list, then this Brick may use it", async () => {
            const s = steps();
            const github = { ...(raw as AppOffer), app: "github", name: "GitHub", connectKind: "listed" as const };
            expect(await connectFromCard(github, "brick-1", s)).toBe("connected");
            expect(s.connectListedApp).toHaveBeenCalledWith("github");
            expect(s.connectReadyMade).not.toHaveBeenCalled();
            expect(s.letBrickUse).toHaveBeenCalledWith("conn-1", "brick-1");
            expect(s.carryOn).toHaveBeenCalledWith({ app: "github", name: "GitHub" });
        });
    });
});
