import axios from "axios";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: "https://workadventure.localhost" }));

// Loading the authenticator is what used to turn on caching for the axios the pusher uses to ask Orbit things
import "../../../src/room-api/authentication/AdminAuthenticator";

describe("AdminAuthenticator and the shared axios", () => {
    it("leaves the shared axios uncached: the same request to Orbit twice is asked twice", async () => {
        let asked = 0;
        const adapter: AxiosAdapter = (config: InternalAxiosRequestConfig) => {
            asked += 1;
            return Promise.resolve({ data: { asked }, status: 200, statusText: "OK", headers: {}, config });
        };
        const request = () =>
            axios.get("https://orbit.test/api/woka/mine", { adapter, params: { uuid: "p@example.test" } });

        const first = await request();
        const second = await request();

        expect(first.data).toEqual({ asked: 1 });
        expect(second.data).toEqual({ asked: 2 });
    });
});
