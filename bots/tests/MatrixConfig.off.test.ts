/** "No chat server on purpose" means none of the four settings is set. A half-set deployment has chats it cannot reach, so it is not "off". */
import { describe, expect, it } from 'vitest';
import { matrixIntentionallyOff } from '../matrix/MatrixConfig';

const ALL = { MATRIX_HOMESERVER_URL: 'http://hs', MATRIX_DOMAIN: 'matrix.test', MATRIX_AS_TOKEN: 'a', MATRIX_HS_TOKEN: 'h' };

describe('matrixIntentionallyOff', () => {
    it('is true only when no setting is set', () => {
        expect(matrixIntentionallyOff({})).toBe(true);
        expect(matrixIntentionallyOff({ MATRIX_DOMAIN: '  ' })).toBe(true);
    });

    it('is false when everything is set, and when only some is set', () => {
        expect(matrixIntentionallyOff(ALL)).toBe(false);
        for (const name of Object.keys(ALL)) {
            expect(matrixIntentionallyOff({ [name]: (ALL as any)[name] })).toBe(false);
        }
        const { MATRIX_AS_TOKEN, ...missingToken } = ALL;
        expect(matrixIntentionallyOff(missingToken)).toBe(false);
    });
});
