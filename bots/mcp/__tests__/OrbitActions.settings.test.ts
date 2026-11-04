import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CARD_SETTINGS, OrbitActions } from '../OrbitActions';

const orbit = () => ({ adminApiUrl: 'https://orbit.example', adminApiToken: 'admin', serviceToken: 'service' });
const answers = (data: unknown) => vi.spyOn(axios, 'get').mockResolvedValue({ data } as never);

afterEach(() => vi.restoreAllMocks());

describe("a bot's card settings", () => {
    it('are the recommended ones when Orbit says nothing or cannot be asked', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error('down'));
        expect(await new OrbitActions(orbit).cardSettings('b1')).toEqual(DEFAULT_CARD_SETTINGS);
        expect(DEFAULT_CARD_SETTINGS).toEqual({ cardWaitMinutes: 10, askWhichWay: 'rarely', askBeforeMaking: 5 });
    });

    it('are what Orbit says, read with the admin token', async () => {
        const get = answers({ cardWaitMinutes: 30, askWhichWay: 'never', askBeforeMaking: 10 });
        expect(await new OrbitActions(orbit).cardSettings('b1')).toEqual({ cardWaitMinutes: 30, askWhichWay: 'never', askBeforeMaking: 10 });
        expect(get).toHaveBeenCalledWith('https://orbit.example/api/bots/b1/tool-settings', expect.objectContaining({ headers: { Authorization: 'Bearer admin' } }));
    });

    it('keep "No limit" (null) as an answer, and each wrong value keeps its recommended one on its own', async () => {
        answers({ askBeforeMaking: null, askWhichWay: 'sometimes', cardWaitMinutes: -4 });
        expect(await new OrbitActions(orbit).cardSettings('b1')).toEqual({ cardWaitMinutes: 10, askWhichWay: 'rarely', askBeforeMaking: null });
    });

    it('turn down a limit that is not a whole number, and keep the others', async () => {
        answers({ askBeforeMaking: 2.5, askWhichWay: 'beforeBiggerJobs' });
        expect(await new OrbitActions(orbit).cardSettings('b1')).toEqual({ cardWaitMinutes: 10, askWhichWay: 'beforeBiggerJobs', askBeforeMaking: 5 });
    });

    it('are kept for a moment, so a chat does not ask Orbit for every message', async () => {
        const get = answers({ askWhichWay: 'never' });
        let now = 1000;
        const actions = new OrbitActions(orbit, () => now);
        await actions.cardSettings('b1');
        now += 10_000;
        await actions.cardSettings('b1');
        expect(get).toHaveBeenCalledTimes(1);
        now += 31_000;
        await actions.cardSettings('b1');
        expect(get).toHaveBeenCalledTimes(2);
    });
});
