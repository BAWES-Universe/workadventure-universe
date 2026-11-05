import { describe, expect, it } from 'vitest';
import { MAX_POINTED_ARTIFACTS, artifactIdOfCard, artifactIdsIn, pointedArtifactIds } from '../ai/ArtifactReferences';

const A = '0b7c1d2e-1111-4222-8333-944455556666';
const B = '1c8d2e3f-2222-4333-9444-a55566667777';
const C = '2d9e3f40-3333-4444-a555-b66677778888';

describe('the artifacts a person pointed at (game #1781)', () => {
    it('finds a pasted share link, in any case, with or without words around it', () => {
        expect(artifactIdsIn(`look at https://orbit.example/a/${A} please`)).toEqual([A]);
        expect(artifactIdsIn(`https://orbit.example/a/${A.toUpperCase()}`)).toEqual([A]);
        expect(artifactIdsIn(`(see https://orbit.dev.example/a/${A}/)`)).toEqual([A]);
    });

    it('finds a card line, and each id once, in the order written', () => {
        expect(artifactIdsIn(`::artifact:${B}:2:app::Board https://orbit.example/a/${A} https://orbit.example/a/${A}`)).toEqual([A, B]);
    });

    it('leaves out anything that is not an artifact id: other paths, short ids, ids glued to more characters', () => {
        expect(artifactIdsIn(`https://orbit.example/b/${A}`)).toEqual([]);
        expect(artifactIdsIn('https://orbit.example/a/art-1')).toEqual([]);
        expect(artifactIdsIn(`the id is ${A}`)).toEqual([]);
        expect(artifactIdsIn(`https://orbit.example/a/${A}9`)).toEqual([]);
        expect(artifactIdsIn(undefined)).toEqual([]);
        expect(artifactIdsIn('')).toEqual([]);
    });

    it('reads the id of a replied-to card, and nothing from a field that is not a card', () => {
        expect(artifactIdOfCard({ id: A, version: 2, title: 'Board', kind: 'app', maker: 'Scout' })).toBe(A);
        expect(artifactIdOfCard({ id: 'art-1' })).toBeUndefined();
        expect(artifactIdOfCard('x')).toBeUndefined();
        expect(artifactIdOfCard(null)).toBeUndefined();
        expect(artifactIdOfCard(undefined)).toBeUndefined();
    });

    it("counts only what the person wrote: a bot's lines never point at anything", () => {
        const history = [
            { sender: 'person' as const, message: `https://orbit.example/a/${A}` },
            { sender: 'bot' as const, message: `Here: https://orbit.example/a/${B} and ::artifact:${B}:1:app::Board` },
            { sender: 'person' as const, message: 'thanks' },
        ];
        expect(pointedArtifactIds(history)).toEqual([A]);
    });

    it('adds the card they replied to, then the links in their recent messages, newest first, each once', () => {
        const history = [
            { sender: 'person' as const, message: `old https://orbit.example/a/${A}` },
            { sender: 'person' as const, message: `new https://orbit.example/a/${B} and https://orbit.example/a/${A}` },
        ];
        expect(pointedArtifactIds(history, [C])).toEqual([C, B, A]);
        expect(pointedArtifactIds(undefined, [C])).toEqual([C]);
        expect(pointedArtifactIds(undefined)).toEqual([]);
    });

    it('takes no more than Orbit does', () => {
        const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const history = [{ sender: 'person' as const, message: Array.from({ length: 30 }, (_, n) => `https://orbit.example/a/${id(n)}`).join(' ') }];
        expect(pointedArtifactIds(history)).toHaveLength(MAX_POINTED_ARTIFACTS);
    });
});
