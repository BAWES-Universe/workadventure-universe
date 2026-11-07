import { expect, test, vi } from "vitest";
import axios from "axios";
import {
    isBotServiceTokenValid,
    parseBotPushPayload,
    PushNotificationClient,
} from "../server/PushNotificationClient";

/**
 * Verifies bot-triggered push notification dispatch for individual users, rooms,
 * and broadcast events via the backend push API.
 */

test("returns push-service-not-configured when baseUrl or serviceToken is missing", async () => {
    const client = new PushNotificationClient({ baseUrl: "http://localhost:8080", serviceToken: "" });

    expect(client.isConfigured()).toBe(false);
    const result = await client.notifyUser({
        userId: "user-42",
        title: "Bot reply",
        body: "Aria replied to your message",
    });

    expect(result).toEqual({
        dryRun: true,
        matched: 0,
        sent: 0,
        forwarded: false,
        skippedReason: "push-service-not-configured",
    });
});

test("forwards user, room, and broadcast notifications with Bearer service token", async () => {
    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
        data: { dryRun: false, matched: 2, sent: 2 },
    });

    const client = new PushNotificationClient({
        baseUrl: "wss://universe.bawes.net/",
        serviceToken: "push-secret-token",
    });

    const userResult = await client.notifyUser({
        userId: "u-1",
        title: "New DM",
        body: "Hello from bot",
        url: "/@/bawes/universe/lobby",
    });
    const roomResult = await client.notifyRoom({
        roomId: "room-main",
        title: "Room Event",
        body: "Townhall starting now",
    });
    const allResult = await client.notifyAll({
        title: "System",
        body: "Welcome to BAWES Universe",
    });

    expect(userResult).toEqual({ dryRun: false, matched: 2, sent: 2, forwarded: true });
    expect(roomResult.forwarded).toBe(true);
    expect(allResult.forwarded).toBe(true);
    expect(postSpy).toHaveBeenCalledWith(
        "https://universe.bawes.net/api/push/send",
        expect.objectContaining({ target: "user:u-1", title: "New DM" }),
        expect.objectContaining({ headers: { Authorization: "Bearer push-secret-token" } })
    );

    postSpy.mockRestore();
});

test("validates bot service tokens and parses incoming webhook payloads", () => {
    expect(isBotServiceTokenValid("bot-token-1", "bot-token-1")).toBe(true);
    expect(isBotServiceTokenValid("bot-token-1", "bot-token-2")).toBe(false);
    expect(parseBotPushPayload(null)).toBeNull();
    expect(parseBotPushPayload({ target: "", title: "T", body: "B" })).toBeNull();
    expect(
        parseBotPushPayload({
            target: "room:lobby",
            title: "Alert",
            body: "Bot spawned",
            url: "/@/bawes/universe/lobby",
        })
    ).toEqual({
        target: "room:lobby",
        title: "Alert",
        body: "Bot spawned",
        url: "/@/bawes/universe/lobby",
    });
});
