# Second opinion on doubtful recordings (11 Nov 2026)

**What this is.** A machine opinion from two tools that are neither of the detectors under test. It is **not a person
listening**: nobody could listen in the environment this was run in. Where the two tools do not settle it, the label is
"uncertain" and the recording stays where its source put it.

- **Whisper** (base, multilingual, int8, through sherpa-onnx 2.0.1): which words it hears, in the recording's language.
  A sound tag such as `[Music]` or `(crunching)` counts as "no words".
- **The WebRTC project's voice detector** (webrtcvad, strictest mode, 10 ms frames, at least 30 ms in a row): where it finds
  a voice. Every recording is brought to the same loudness first, so a quiet one is not judged on loudness. This detector
  reacts to many noises once they are made loud, so by itself it never makes a recording "speech".

**What was looked at.**

1. Every speech recording of the test set, both halves: 1,350 (1,200 short commands, 150 sentences). That covers every
   recording behind a miss, every apparent success, and the slow tail.
2. Every speech clip, exactly as the detectors got it, where the frozen rule did not give a VALID firing on the report half,
   plus every clip on either half that today's gate catches and the rule does not: 60 clips.
3. Every place the frozen rule fired on a noise recording of the report half, three seconds around the firing: 114 spans
   from 33 recordings.

**Labels, by fixed rules** (in `scripts/adjudicate.py`; nobody picked a label by hand):

| for | label | rule |
| --- | --- | --- |
| a speech recording | valid speech | Whisper hears the expected word; or it hears other words and a voice is found (100 ms or more) |
| | no speech | Whisper hears no words and under 100 ms of voice is found |
| | uncertain | anything else |
| a noise recording | background voice | the same place in the recording, cut at two different loudness levels, gives Whisper nearly the same two or more words. A real sentence stays the same; a made-up one changes. |
| | no speech | Whisper hears no words in any span where the rule fired |
| | uncertain | anything else |

**Result for the 1,350 speech recordings:** 1,344 valid speech, 4 uncertain, 2 no speech. So the set is overwhelmingly
what it says it is, and the "no speech" recordings are two files from one contributor.

**How the scores use it** (`results/results.md`, last section; the original scores are kept unchanged above it):

- A speech recording labelled "no speech" is taken out of the speech scores, for both detectors. "Uncertain" stays in as speech.
- A non-speech noise recording labelled "background voice" is taken out of the non-speech group whole, for both detectors.
- Nothing else changes. The rule under test is not re-picked.

**Limits.** Whisper invents words on noise; that is why a noise recording needs the same words twice. Whisper also misses
very soft or clipped words. Only noise recordings where the rule fired were looked at, so a voice hidden in a recording
where only today's gate fired was not looked for (that would lower the gate's count, not the rule's). Where speech starts
and ends was not labelled by anything better than the energy estimate: the WebRTC detector's bounds are in
`results/adjudication-sources.tsv`, but it starts early on noisy files and is not used for scoring.

## What it says about the misses

On the report half, 17 clips from 11 recordings are VALID for today's gate and not for the frozen rule.

| second opinion on the recording | clips | recordings | what they are |
| --- | --- | --- | --- |
| valid speech, rule gave NONE | 7 | 5 | **Machine-supported speech misses** (both machines find speech; no person has listened). Four are at the very soft level only (S40, speech at about -40 dBFS, which is the gate's own threshold): "go", "stop", "yes", and one Arabic "cancel" in noise. One English "Stop!" is missed at every level: the detector's probability never passes 0.26 on it. |
| valid speech, rule fired EARLY | 2 | 2 | "Yes" twice at the loudest level. The rule fired inside the recording more than 200 ms before the estimated onset, so it is not counted as a catch. Most likely it fired on the word and the estimate is late, but that is not shown. |
| uncertain | 5 | 2 | Whisper hears no words ("(music)"); the voice detector reacts. Kept as speech, so they stay misses. |
| no speech | 3 | 2 | Two files from one contributor in which neither machine finds a word (which is not the same as a person hearing none). Taken out of the adjudicated score for both detectors. |

So "zero newly missed" is **not met** after the second opinion either. The original count stands: 17 clips from 11
recordings. The provisional count after the machine opinion is 14 clips from 9 recordings, 7 of them machine-supported
speech misses. Neither count is verified ground truth.

## What it says about firings on "non-speech" noise

15 firings came from 6 recordings. One of them is a person talking: `Munching_2` (train) says "Hmm, I love potatoes", the same
words at all three levels and both places. One is uncertain (`AirConditioner_9`: Whisper gives a different sentence each
time, so nothing is concluded). Four hold no words (a cough, crunching, a chair, cooking).

| | recordings | firings | per hour incl. variants |
| --- | --- | --- | --- |
| as the source labels them (the primary score) | 6 of 59 | 15 | 8.5 |
| sensitivity: without the recording that holds a voice | 5 of 58 | 9 | 5.2 |
| sensitivity: also without the uncertain one | 4 of 57 | 5 | 2.9 |

Every row is above the agreed 1 per hour. The last two are sensitivity results from a machine opinion, not corrected scores.

## The slow tail

Under the first report's scoring the rule's p95 delay was 536 ms. Almost all of that tail (255 of 262 clips over 400 ms) is
English one-word recordings where the energy estimate covers the whole one-second file, so the "onset" is the start of the
file, not the word. A single word does not last 0.7 s. The filter, exactly: one-word command clips whose estimated speech
span is over 700 ms are dropped; every sentence is kept. On that subset the rule's p95 is 230 ms and today's gate's is
280 ms; on every clip they are 536 ms and 400 ms (table "Delay on the filtered subset, beside the aggregate" in
`results/results.md`). Both are reported together. The filter looks only at the recording, never at a detector, but it was
written after the fact and is a diagnostic: span alone cannot prove an onset wrong or right. It does not show what a listener would experience: network and playout are not in it.

## Tables

### Clips today's gate catches and the frozen rule does not (both halves)

| half | recording | condition | rule's outcome | Whisper on this very clip | label of the recording | why |
| --- | --- | --- | --- | --- | --- | --- |
| report | `ar/cancel/00000020_NO_01.wav` | N10 | NONE | "نلوها" | **valid speech** | Whisper hears other words and the voice detector finds a voice. Whisper: "الواقع"; voice found: 760 ms |
| report | `en/go/0d53e045_nohash_0.wav` | S40 | NONE | "Oh" | **valid speech** | Whisper hears the expected word. Whisper: "Go!"; voice found: 1000 ms |
| report | `en/no/15c563d7_nohash_1.wav` | S40 | NONE | "(music)" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(music)"; voice found: 960 ms |
| report | `en/stop/7014b07e_nohash_1.wav` | S40 | NONE | "Stop" | **valid speech** | Whisper hears the expected word. Whisper: "Stop"; voice found: 460 ms |
| report | `en/stop/b1114e4f_nohash_0.wav` | S20 | NONE | "STUCK!" | **valid speech** | Whisper hears the expected word. Whisper: "Stop!"; voice found: 800 ms |
| report | `en/stop/b1114e4f_nohash_0.wav` | S30 | NONE | "Stop!" | **valid speech** | Whisper hears the expected word. Whisper: "Stop!"; voice found: 800 ms |
| report | `en/stop/b1114e4f_nohash_0.wav` | S40 | NONE | "Stop!" | **valid speech** | Whisper hears the expected word. Whisper: "Stop!"; voice found: 800 ms |
| report | `en/stop/f8f60f59_nohash_1.wav` | N10 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(music)"; voice found: 610 ms |
| report | `en/stop/f8f60f59_nohash_1.wav` | S20 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(music)"; voice found: 610 ms |
| report | `en/stop/f8f60f59_nohash_1.wav` | S30 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(music)"; voice found: 610 ms |
| report | `en/stop/f8f60f59_nohash_1.wav` | S40 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(music)"; voice found: 610 ms |
| report | `en/stop/fd395b74_nohash_3.wav` | S40 | NONE | "I'm going to kill him." | **no speech** | Whisper hears no words and the voice detector finds under 100 ms of voice. Whisper: "[Music]"; voice found: 50 ms |
| report | `en/stop/fd395b74_nohash_4.wav` | S30 | NONE | "[Music]" | **no speech** | Whisper hears no words and the voice detector finds under 100 ms of voice. Whisper: "[Music]"; voice found: 0 ms |
| report | `en/stop/fd395b74_nohash_4.wav` | S40 | NONE | "(Gunshot)" | **no speech** | Whisper hears no words and the voice detector finds under 100 ms of voice. Whisper: "[Music]"; voice found: 0 ms |
| report | `en/yes/28ce0c58_nohash_3.wav` | S20 | EARLY | "Yes." | **valid speech** | Whisper hears the expected word. Whisper: "Yes"; voice found: 570 ms |
| report | `en/yes/97f4c236_nohash_2.wav` | S20 | EARLY | "Yes" | **valid speech** | Whisper hears the expected word. Whisper: "Yes"; voice found: 790 ms |
| report | `en/yes/f34e6f44_nohash_2.wav` | S40 | NONE | "Yes" | **valid speech** | Whisper hears the expected word. Whisper: "Yes"; voice found: 490 ms |
| tune | `en/go/5c8af87a_nohash_0.wav` | S20 | EARLY | "Go" | **valid speech** | Whisper hears other words and the voice detector finds a voice. Whisper: "Rico"; voice found: 440 ms |
| tune | `en/go/b01c8f61_nohash_0.wav` | N5 | NONE | "Go" | **valid speech** | Whisper hears the expected word. Whisper: "Go"; voice found: 260 ms |
| tune | `en/no/735845ab_nohash_0.wav` | N10 | NONE | "(gunshot)" | **valid speech** | Whisper hears the expected word. Whisper: "No."; voice found: 370 ms |
| tune | `en/no/ced835d3_nohash_1.wav` | S20 | NONE | "[Laughter]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "["; voice found: 320 ms |
| tune | `en/no/ced835d3_nohash_1.wav` | S30 | NONE | "[Laughter]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "["; voice found: 320 ms |
| tune | `en/no/ced835d3_nohash_1.wav` | S40 | NONE | "(laughter)" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "["; voice found: 320 ms |
| tune | `en/stop/778a4a01_nohash_1.wav` | S40 | NONE | "Stop" | **valid speech** | Whisper hears the expected word. Whisper: "Stop"; voice found: 460 ms |
| tune | `en/stop/b959cd0c_nohash_0.wav` | N10 | NONE | "(crunching)" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(upbeat music)"; voice found: 940 ms |
| tune | `en/stop/b959cd0c_nohash_0.wav` | S20 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(upbeat music)"; voice found: 940 ms |
| tune | `en/stop/b959cd0c_nohash_0.wav` | S30 | NONE | "[Music]" | **uncertain** | the voice detector reacts but Whisper hears no words. Whisper: "(upbeat music)"; voice found: 940 ms |

### Non-speech recordings where the frozen rule fired (report half)

| recording | firings (all levels) | label | why | what Whisper heard around each firing |
| --- | --- | --- | --- | --- |
| `asc/background_noise/cooking_1.wav` | 1 | **no speech** | Whisper hears no words in any span where the detector fired | -25 dBFS 0.4-3.4 s: "(crickets chirping)" |
| `ms-snsd/noise_test/AirConditioner_9.wav` | 4 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 38.9-41.9 s: "The future is going to be a great future."; -35 dBFS 0.0-2.1 s: "I'm going to put some paper on the paper"; -35 dBFS 38.6-41.6 s: "[Speaking in foreign language]"; -25 dBFS 0.0-1.9 s: "I'm going to start the work." |
| `ms-snsd/noise_test/Munching_2.wav` | 1 | **no speech** | Whisper hears no words in any span where the detector fired | -35 dBFS 18.1-21.1 s: "(cough)" |
| `ms-snsd/noise_test/Munching_6.wav` | 1 | **no speech** | Whisper hears no words in any span where the detector fired | -35 dBFS 2.7-5.7 s: "(crunching)" |
| `ms-snsd/noise_train/Munching_2.wav` | 6 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 10.7-13.7 s: "Hmm, I love potato"; -45 dBFS 26.0-28.2 s: "Hmm, I love potatoes."; -35 dBFS 10.7-13.7 s: "Hmm, I love potato"; -35 dBFS 25.8-28.2 s: "Hmm, I love potatoes."; -25 dBFS 10.7-13.7 s: "Hmm, I love potato"; -25 dBFS 25.5-28.2 s: "Hmm, I love potatoes." |
| `ms-snsd/noise_train/SqueakyChair_1.wav` | 2 | **no speech** | Whisper hears no words in any span where the detector fired | -35 dBFS 0.0-2.5 s: "[coughing]"; -25 dBFS 0.0-2.5 s: "(crashing)" |

### Scene recordings where it fired

| recording | firings (all levels) | label | why | what Whisper heard around each firing |
| --- | --- | --- | --- | --- |
| `ms-snsd/noise_train/Office_1.wav` | 1 | **no speech** | Whisper hears no words in any span where the detector fired | -25 dBFS 51.8-54.8 s: "(car engine rumbling)" |

### Speech-like recordings where it fired (babble, neighbours, announcements)

| recording | firings (all levels) | label | why | what Whisper heard around each firing |
| --- | --- | --- | --- | --- |
| `ms-snsd/noise_test/AirportAnnouncements_2.wav` | 1 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -25 dBFS 1.8-4.8 s: "They have to be sure because any job might not be" |
| `ms-snsd/noise_test/AirportAnnouncements_4.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-2.1 s: "I'm sorry for having to ask you, sir."; -35 dBFS 0.0-2.0 s: "I'm not even having a chance to do so."; -25 dBFS 0.0-2.0 s: "I'm not even having a natural self." |
| `ms-snsd/noise_test/Babble_1.wav` | 6 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 27.8-30.8 s: "Thank you."; -35 dBFS 0.0-2.6 s: "[MUSIC PLAYING]"; -35 dBFS 27.3-30.3 s: "Thank you."; -35 dBFS 34.8-37.8 s: "(indistinct chatter)"; -35 dBFS 49.8-52.8 s: "[MUSIC]"; -25 dBFS 0.0-2.8 s: "(speaking in foreign language)" |
| `ms-snsd/noise_test/Babble_7.wav` | 4 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 1.4-4.3 s: "I will do a quick analysis now."; -45 dBFS 21.0-22.7 s: "[laughter]"; -35 dBFS 0.0-1.7 s: "[Music]"; -25 dBFS 0.0-1.7 s: "[Music]" |
| `ms-snsd/noise_test/Neighbor_1.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.9 s: "10"; -35 dBFS 0.0-1.8 s: "10-h like oh I mean"; -25 dBFS 0.0-1.8 s: "10-inch like oh I mean" |
| `ms-snsd/noise_test/Neighbor_3.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.7 s: "falling into deep depression."; -35 dBFS 0.0-1.6 s: "falling into deep darkness."; -25 dBFS 0.0-1.6 s: "falling into deep darkness." |
| `ms-snsd/noise_test/Neighbor_5.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.8 s: "Lucky for this"; -35 dBFS 0.0-1.6 s: "Lucky for"; -25 dBFS 0.0-1.6 s: "Lucky for" |
| `ms-snsd/noise_test/Neighbor_7.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.9 s: "10"; -35 dBFS 0.0-1.8 s: "10-h like oh I mean"; -25 dBFS 0.0-1.8 s: "10-inch like oh I mean" |
| `ms-snsd/noise_test/Neighbor_9.wav` | 2 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -35 dBFS 7.1-10.1 s: "I only want to talk once."; -25 dBFS 7.1-10.1 s: "I only want to talk once." |
| `ms-snsd/noise_train/AirportAnnouncements_4.wav` | 3 | **no speech** | Whisper hears no words in any span where the detector fired | -25 dBFS 2.2-5.2 s: "[Music]"; -25 dBFS 46.8-49.8 s: "[Spanish]"; -25 dBFS 53.9-56.9 s: "(speaking in foreign language)" |
| `ms-snsd/noise_train/AirportAnnouncements_6.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 1.7-4.7 s: "It doesn't just climb either"; -35 dBFS 1.4-4.3 s: "with passengers climbing"; -25 dBFS 1.3-4.3 s: "with passengers climbing" |
| `ms-snsd/noise_train/AirportAnnouncements_8.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 1.4-4.4 s: "and her. Please wait for the smoke."; -35 dBFS 0.0-2.6 s: "Very rich ladies and gentlemen."; -25 dBFS 0.0-2.1 s: "Very rich ladies and gentlemen." |
| `ms-snsd/noise_train/Babble_1.wav` | 3 | **no speech** | Whisper hears no words in any span where the detector fired | -45 dBFS 3.0-6.0 s: "(speaking in foreign language)"; -35 dBFS 0.3-3.3 s: "(speaking in foreign language) (upbeat music)"; -25 dBFS 0.0-1.8 s: "[inaudible]" |
| `ms-snsd/noise_train/Babble_10.wav` | 4 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-2.4 s: "I'm not a cub, I'm a cunt, I'm"; -45 dBFS 22.2-25.2 s: "(speaking in foreign language)"; -35 dBFS 0.0-2.1 s: "I'm not a caggy, I'm a c"; -25 dBFS 0.0-1.9 s: "I'm not a caggy, I'm a" |
| `ms-snsd/noise_train/Babble_12.wav` | 4 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 1.5-4.5 s: "I will tell you that my class is now closed."; -45 dBFS 21.2-23.1 s: "[laughter]"; -35 dBFS 0.0-2.4 s: "[Music]"; -25 dBFS 0.0-2.0 s: "[Music]" |
| `ms-snsd/noise_train/Babble_3.wav` | 3 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -25 dBFS 12.0-15.0 s: "I told you"; -25 dBFS 26.5-29.5 s: "(speaking in foreign language)"; -25 dBFS 36.5-39.5 s: "[MUSIC PLAYING]" |
| `ms-snsd/noise_train/Babble_7.wav` | 6 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 5.2-8.2 s: "(speaking in foreign language)"; -45 dBFS 15.9-18.9 s: "[MUSIC PLAYING]"; -35 dBFS 4.3-7.3 s: "(speaking in foreign language)"; -35 dBFS 15.8-18.8 s: "[MUSIC PLAYING]"; -25 dBFS 0.0-2.1 s: "Stop! This is the end of the series."; -25 dBFS 12.3-15.3 s: "[INAUDIBLE]" |
| `ms-snsd/noise_train/Babble_9.wav` | 3 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 2.9-5.9 s: "I'm saying"; -35 dBFS 0.3-3.3 s: "Yeah, we'll be sure"; -25 dBFS 0.0-2.1 s: "Yeah" |
| `ms-snsd/noise_train/NeighborSpeaking_1.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.7 s: "You just know, man."; -35 dBFS 0.0-1.7 s: "You just know, man."; -25 dBFS 0.0-1.7 s: "You just knocked right" |
| `ms-snsd/noise_train/NeighborSpeaking_10.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.7 s: "cheese type of tasting"; -35 dBFS 0.0-1.6 s: "cheese type of tasting"; -25 dBFS 0.0-1.6 s: "cheese type of tasting" |
| `ms-snsd/noise_train/NeighborSpeaking_12.wav` | 8 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-3.0 s: "Stat over in terms of large artificial intelligence."; -45 dBFS 19.0-22.0 s: "(indistinct chatter)"; -45 dBFS 21.4-24.4 s: "I do not like these chairs"; -45 dBFS 41.5-44.5 s: "I'm doing it. Yeah, they're doing it."; -35 dBFS 0.0-1.8 s: "Step over on terms of..."; -35 dBFS 18.9-21.9 s: "(chatter)"; -25 dBFS 0.0-1.8 s: "Step over on terms of..."; -25 dBFS 18.9-21.9 s: "(chatter)" |
| `ms-snsd/noise_train/NeighborSpeaking_14.wav` | 3 | **uncertain** | Whisper hears words, but not the same words at the same place at two levels | -45 dBFS 0.0-2.8 s: "Because the eating of the crawfish is the same as you do"; -35 dBFS 0.0-2.3 s: "Because the urine got the colon part of the baby"; -25 dBFS 0.0-2.2 s: "I'm gonna go to the entrance of the girl's house" |
| `ms-snsd/noise_train/NeighborSpeaking_3.wav` | 6 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-1.8 s: "[SPEAKING SPANISH]"; -45 dBFS 33.2-36.2 s: "So, these"; -35 dBFS 0.0-1.7 s: "[MUSIC PLAYING]"; -35 dBFS 33.2-36.2 s: "So, these..."; -25 dBFS 0.0-1.6 s: "[SPEAKING SPANISH]"; -25 dBFS 33.2-36.2 s: "So, these" |
| `ms-snsd/noise_train/NeighborSpeaking_5.wav` | 3 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.8-3.8 s: "The ten each like a... I mean..."; -35 dBFS 0.8-3.8 s: "The tenage like a... I mean..."; -25 dBFS 0.6-3.6 s: "The ten each like a..." |
| `ms-snsd/noise_train/NeighborSpeaking_7.wav` | 3 | **no speech** | Whisper hears no words in any span where the detector fired | -45 dBFS 0.0-1.8 s: "(speaking in foreign language)"; -35 dBFS 0.0-1.7 s: "(speaking in foreign language)"; -25 dBFS 0.0-1.6 s: "[Music]" |
| `ms-snsd/noise_train/NeighborSpeaking_9.wav` | 9 | **background voice** | Whisper hears nearly the same words at the same place at two levels | -45 dBFS 0.0-2.0 s: "wanna rock right now"; -45 dBFS 10.3-13.3 s: "Do you want to hit it loose after me?"; -45 dBFS 14.3-17.3 s: "I was sure of both her, so you can always"; -45 dBFS 18.5-21.5 s: "This is made sure I take the wood"; -45 dBFS 23.1-26.1 s: "Oh, by the way, I'm recording this conversation."; -35 dBFS 0.0-1.6 s: "wanna rock right now"; -35 dBFS 23.1-26.1 s: "Oh, by the way, I'm recording this conversation."; -25 dBFS 0.0-1.6 s: "wanna rock right now"; -25 dBFS 23.1-26.1 s: "Oh, by the way, I'm recording this conversation." |
