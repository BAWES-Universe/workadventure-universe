// Source-level labels from a person listening (results/soniox/disputed-clips.md). They apply to every clip made from the
// source, in every condition, and to today's rule and the candidates alike. The original-label results stay reported beside them.
//   noise:     heard as no voice; out of the speech rows
//   uncertain: no sure answer; unscored in the primary view, counted as speech in the conservative view
export const LISTENED: Record<string, { label: 'noise' | 'uncertain'; heard: string }> = {
    'en/no/15c563d7_nohash_1.wav': { label: 'noise', heard: 'no voice' },
    'en/stop/fd395b74_nohash_3.wav': { label: 'uncertain', heard: 'static sound and a weird hint of voice starting towards the end but no recognizable voice' },
};
/** The source of a speech clip id, `speech|<source>|<condition>`. */
export const sourceOfId = (id: string): string => id.split('|')[1];
export const listenedAs = (id: string) => LISTENED[sourceOfId(id)]?.label;
