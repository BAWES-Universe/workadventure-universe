import { describe, expect, it } from 'vitest';
import { audioFileNameFor } from '../utils/audioFileName';

describe('the name a bot sends a song under (#1803)', () => {
    it('keeps a name that already ends as audio', () => {
        expect(audioFileNameFor('https://cdn.example.com/files/Desert%20Drive.mp3?sig=x', 'audio/mpeg')).toBe('Desert Drive.mp3');
        expect(audioFileNameFor('https://cdn.example.com/a.m4a')).toBe('a.m4a');
    });

    it('names a link with no ending after its type', () => {
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a?sig=x', 'audio/mpeg')).toBe('song.mp3');
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a', 'audio/wav')).toBe('song.wav');
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a', 'audio/ogg; codecs=opus')).toBe('song.ogg');
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a', 'audio/mp4')).toBe('song.m4a');
    });

    it('keeps the words of a name it was given and adds the ending', () => {
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a', 'audio/mpeg', 'Desert Drive')).toBe('Desert Drive.mp3');
    });

    it('gives no name when neither the name nor the type says it is audio', () => {
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a')).toBeUndefined();
        expect(audioFileNameFor('https://cdn.example.com/files/7f3a', 'application/octet-stream')).toBeUndefined();
    });
});
