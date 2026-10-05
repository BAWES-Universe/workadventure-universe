// import App from "../src/App";
import {ChildProcess} from "child_process"
import axios from "axios";
import FormData from "form-data";
import Jwt from "jsonwebtoken";
import {StartedTestContainer} from "testcontainers";
import {createClient} from "redis";
import {describe, expect, jest, it, beforeAll, afterAll} from '@jest/globals';
import {PLAY_URL} from "../src/Enum/EnvironmentVariable";
import {verifyResponseHeaders} from "./utils/verifyResponseHeaders";
import {uploadMultipleFilesTest, uploadSingleFileTest} from "./UploaderTestCommon";
import {RedisContainer} from "./utils/RedisContainer";
import isPortReachable from "./utils/isPortReachable";
import startTestServer from "./startTestServer";

const APP_PORT = 7373
const AUTH_APP_PORT = 7375
const AUTH_SECRET_KEY = "test-secret-key"

// Minimal files that start like real audio files
const MP3_CONTENTS = Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([4, 0, 0, 0, 0, 0, 0])])
const WAV_CONTENTS = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt ", "latin1")])

function postAudio(url: string, name: string, contents: Buffer | string, headers: Record<string, string> = {}) {
    const formData = new FormData();
    formData.append('file', Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf-8"), name);
    return axios.post(`${url}/upload-audio-message`, formData.getBuffer(), {
        headers: {...formData.getHeaders(), ...headers},
        maxBodyLength: Infinity,
        validateStatus: () => true,
    });
}

function stopServer(server: ChildProcess | undefined) {
    if (!server) {
        return Promise.resolve();
    }
    const promise = new Promise(resolve => {
        server.on("exit", ()=> {
            resolve(0)
        })
    });
    server.kill("SIGKILL")
    return promise;
}

jest.mock('../src/Enum/EnvironmentVariable', () => ({
    get PLAY_URL() {
        return "http://play.location"
    }
}))

describe("Redis Uploader tests", () => {
    let redisContainer:StartedTestContainer
    let server: ChildProcess| undefined;
    let authServer: ChildProcess| undefined;
    jest.setTimeout(20000)
    const redisPort = 6379
    const UPLOADER_URL = "http://localhost:7373"
    const AUTH_UPLOADER_URL = `http://localhost:${AUTH_APP_PORT}`
    beforeAll(async ()=> {
        redisContainer = await new RedisContainer()
            .port(redisPort)
            .start();

         server = startTestServer({
            REDIS_HOST: "localhost",
            REDIS_PORT: redisPort.toString(),
            ENABLE_CHAT_UPLOAD: "true",
            UPLOADER_URL: UPLOADER_URL,
            PLAY_URL: PLAY_URL
         })
        authServer = startTestServer({
            SERVER_PORT: AUTH_APP_PORT.toString(),
            REDIS_HOST: "localhost",
            REDIS_PORT: redisPort.toString(),
            ENABLE_CHAT_UPLOAD: "true",
            UPLOADER_URL: AUTH_UPLOADER_URL,
            PLAY_URL: PLAY_URL,
            SECRET_KEY: AUTH_SECRET_KEY,
        })
        await isPortReachable(APP_PORT, {host: "localhost"})
        await isPortReachable(AUTH_APP_PORT, {host: "localhost"})
    })

    afterAll(async ()=> {
        await stopServer(server)
        await stopServer(authServer)
        await redisContainer?.stop()
    })

    it("should reply options with 204", async ()=> {
        const response = await axios.options(`${UPLOADER_URL}/upload-file`)

        expect(response.status).toBe(204)
        verifyResponseHeaders(response);
    })

    it("should upload one file to redis", async ()=> {
        const responseData = await uploadSingleFileTest(UPLOADER_URL);

        const redisClient = createClient({
            url: `redis://localhost:6379/0`,
        });
        redisClient.on('error', (err: unknown) => console.error('Redis Client Error', err));
        await redisClient.connect();

        const actual = await redisClient.get(responseData.id)
        await redisClient.quit()

        expect(actual?.toString()).toEqual("file contents")
    })

    it("should upload multiple files to redis", async ()=> {
        await uploadMultipleFilesTest(UPLOADER_URL);
    })


    it("should upload and download audio message file to redis", async ()=> {
        const uploadResponse = await postAudio(UPLOADER_URL, "message.mp3", MP3_CONTENTS);

        expect(uploadResponse.status).toBe(200)
        verifyResponseHeaders(uploadResponse);

        const data = uploadResponse.data
        expect(data.id).toMatch(/^[0-9a-f-]{36}\.mp3$/)
        expect(data.path).toEqual(`/download-audio-message/${data.id}`)

        const downloadResponse = await axios.get(`${UPLOADER_URL}${data.path}`, {responseType: "arraybuffer"})
        expect(Buffer.from(downloadResponse.data)).toEqual(MP3_CONTENTS)
        expect(downloadResponse.headers["content-type"]).toEqual("audio/mpeg")
        expect(downloadResponse.headers["x-content-type-options"]).toEqual("nosniff")
        expect(downloadResponse.headers["content-disposition"]).toEqual('inline; filename="audio.mp3"')
        expect(downloadResponse.headers["content-security-policy"]).toEqual("default-src 'none'; sandbox")
    })

    it("should accept a wav audio message", async ()=> {
        const uploadResponse = await postAudio(UPLOADER_URL, "message.wav", WAV_CONTENTS);

        expect(uploadResponse.status).toBe(200)
        expect(uploadResponse.data.id).toMatch(/\.wav$/)
    })

    it.each([
        ["page.html", "<html><body>hello</body></html>"],
        ["image.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"],
        ["notes.txt", "temp file contents"],
        ["message.mp3", "<html><body>not audio</body></html>"],
    ])("should reject %s audio message with 415", async (name, contents)=> {
        const uploadResponse = await postAudio(UPLOADER_URL, name, contents);

        expect(uploadResponse.status).toBe(415)
    })

    it("should reject audio message over 10 MiB with 413", async ()=> {
        const contents = Buffer.concat([MP3_CONTENTS, Buffer.alloc(10 * 1024 * 1024)]);
        const uploadResponse = await postAudio(UPLOADER_URL, "message.mp3", contents);

        expect(uploadResponse.status).toBe(413)
    })

    it("should only serve audio message ids", async ()=> {
        // A file stored in the same Redis by /upload-file
        const otherFile = await uploadSingleFileTest(UPLOADER_URL);

        for (const id of [otherFile.id, "0b5a8f4e-5a2b-4c1d-9e3f-1234567890ab", "unknown-key"]) {
            const response = await axios.get(`${UPLOADER_URL}/download-audio-message/${id}`, {validateStatus: () => true})
            expect(response.status).toBe(404)
        }
    })

    it("should reject audio message without valid token when SECRET_KEY is set", async ()=> {
        const noToken = await postAudio(AUTH_UPLOADER_URL, "message.mp3", MP3_CONTENTS);
        expect(noToken.status).toBe(401)

        const wrongKey = Jwt.sign({identifier: "user@example.com", accessToken: "oidc-access-token"}, "another-key");
        const invalidToken = await postAudio(AUTH_UPLOADER_URL, "message.mp3", MP3_CONTENTS, {Authorization: wrongKey});
        expect(invalidToken.status).toBe(401)

        const guestToken = Jwt.sign({identifier: "3f1c2b8e-guest-uuid"}, AUTH_SECRET_KEY, {expiresIn: "30d"});
        const guest = await postAudio(AUTH_UPLOADER_URL, "message.mp3", MP3_CONTENTS, {Authorization: guestToken});
        expect(guest.status).toBe(401)
    })

    it("should accept audio message with a play token when SECRET_KEY is set", async ()=> {
        const token = Jwt.sign({identifier: "user@example.com", accessToken: "oidc-access-token"}, AUTH_SECRET_KEY, {expiresIn: "30d"});
        const uploadResponse = await postAudio(AUTH_UPLOADER_URL, "message.mp3", MP3_CONTENTS, {Authorization: token});

        expect(uploadResponse.status).toBe(200)
        expect(uploadResponse.data.id).toMatch(/\.mp3$/)
    })
})
