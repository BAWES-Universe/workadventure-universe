# Real-provider check: Soniox, recorded, then replayed through the pause

Clips: 364, all from the report half (never used to pick the quiet window). Streams opened: 480. Audio sent to Soniox: 39.57 min,
about $0.079 at $0.12 per hour (real-time). Model stt-rt-v6, the worker's own connector and settings, played in
real time from this machine. Noise is played for its first 10 s; speech over noise gets 0 to 2 s more noise before the person starts.

## What Soniox heard

| group | clips | any words heard | streams: text / taken back / empty / failed |
| --- | --- | --- | --- |
| known hard case | 17 | 17 | 17 / 0 / 5 / 0 |
| steady non-speech | 89 | 0 | 0 / 0 / 104 / 0 |
| scene | 7 | 0 | 0 / 0 / 7 / 0 |
| speech-like (babble) | 31 | 23 | 43 / 1 / 12 / 0 |
| three knocks | 20 | 0 | 0 / 0 / 20 / 0 |
| soft command (S40), English | 40 | 38 | 38 / 0 / 2 / 0 |
| soft command (S40), Arabic | 40 | 40 | 40 / 0 / 0 / 0 |
| command over noise, English | 40 | 39 | 39 / 0 / 36 / 0 |
| command over noise, Arabic | 40 | 40 | 39 / 1 / 18 / 0 |
| sentence over noise | 20 | 20 | 27 / 0 / 4 / 0 |
| sentence (S30) | 20 | 20 | 27 / 0 / 0 / 0 |

Words Soniox wrote down for noise (first final or partial per clip):

- speech-like (babble), ms-snsd/noise_test/AirportAnnouncements_2.wav -35: "Mesdames, messieurs, nous arrivons maintenant des passagers dans le bureau de si"
- speech-like (babble), ms-snsd/noise_test/AirportAnnouncements_4.wav -35: "Un départ à destination de New York, New York. Vol d'avion 001, embarquement vol"
- speech-like (babble), ms-snsd/noise_test/Babble_7.wav -35: "My dad's side family for Thanksgiving. And then I went up to—"
- speech-like (babble), ms-snsd/noise_test/Neighbor_1.wav -35: "A teenage, like, uh, I mean, get you a trucker in and put it underneath there, w"
- speech-like (babble), ms-snsd/noise_test/Neighbor_3.wav -35: "Falling into, you know, deep depressions and things like that because they were "
- speech-like (babble), ms-snsd/noise_test/Neighbor_5.wav -35: "Lucky for the Department of Student Activities, both the choir and the dance tea"
- speech-like (babble), ms-snsd/noise_test/Neighbor_7.wav -35: "A teenage, like, uh, I mean, get you a trucker in and put it underneath there, w"
- speech-like (babble), ms-snsd/noise_test/Neighbor_9.wav -35: "Only 1 headphone works."
- speech-like (babble), ms-snsd/noise_train/AirportAnnouncements_4.wav -35: "入国よりご出発のお客様にご案内申し上げます。 Nail growth was uninhabitability and that."
- speech-like (babble), ms-snsd/noise_train/AirportAnnouncements_6.wav -35: "With passengers climbing up, traveling to Las Vegas with Virgin Atlantic on flig"
- speech-like (babble), ms-snsd/noise_train/AirportAnnouncements_8.wav -35: "Sehr geehrte Damen und Herren, bitte beachten Sie das Rauchverbot in unseren Ter"
- speech-like (babble), ms-snsd/noise_train/Babble_10.wav -35: "Isn't that cubby off Simpson? He always appears like that."
- speech-like (babble), ms-snsd/noise_train/Babble_12.wav -35: "My dad's side family for Thanksgiving."
- speech-like (babble), ms-snsd/noise_train/Babble_7.wav -35: "Er moet alleen Elin helpen. Really validate ourselves in that regard. But."
- speech-like (babble), ms-snsd/noise_train/Babble_9.wav -35: "Uh, yeah. What I am saying you do is great. Take up space. And, uh, yeah."
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_1.wav -35: "Hang on. When it asks you for the genotype ratio, it's wanting to know how."
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_10.wav -35: "Cheese type of tasting. I mean, obviously, I know I'm helping out a bit, but I w"
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_12.wav -35: "Step, in terms of artificial intelligence, kind of could— It's not just made up "
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_14.wav -35: "You didn't go to the Coral Concert today, did you? But it's an environmental pro"
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_3.wav -35: "Rende conto di che- di che cosa noi facciamo, poi tutto sommato. Allora, questo "
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_5.wav -35: "A 10-inch, like a— I mean, get you a trucker in and put it underneath there, wel"
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_7.wav -35: "Neke lupa sad zakonitosti. Zakonitosti. Ali ovo jeste, jeste to. Postoji nešto, "
- speech-like (babble), ms-snsd/noise_train/NeighborSpeaking_9.wav -35: "Want to rock right now. Here, mismanagement class, Morgan. He was a guy who was "

Speech: heard right (string check), and when the words came, from the estimated onset and offset:

| group | clips | heard right | first words after onset, median / p95 | final words after offset, median / p95 |
| --- | --- | --- | --- | --- |
| known hard case | 17 | 16 | 1271 ms / 2549 ms | 1050 ms / 2390 ms |
| soft command (S40), English | 40 | 38 | 1128 ms / 1757 ms | 585 ms / 1776 ms |
| soft command (S40), Arabic | 40 | 31 | 1420 ms / 2066 ms | 1718 ms / 1834 ms |
| command over noise, English | 40 | 39 | 923 ms / 1755 ms | 444 ms / 1268 ms |
| command over noise, Arabic | 40 | 23 | 1405 ms / 1968 ms | 1192 ms / 2593 ms |
| sentence over noise | 20 | 20 | 1116 ms / 1673 ms | 2032 ms / 2860 ms |
| sentence (S30) | 20 | 20 | 1089 ms / 1328 ms | 1559 ms / 1907 ms |

## The pause, replayed with Soniox's recorded answers

The worker's own Recognition and YieldControl on simulated time; the detector answers from Silero on the audio as played; each stream says
what Soniox said, when it said it. Quiet window 1,500 ms (frozen). "Today" is the stop on the volume gate; "hold" is the candidate.

Speech over the bot (should stop):

| group | clips | never stopped: today / hold (of which Soniox heard the words) | stopped by background first: today / hold | first change after onset, hold, median / p95 | stopped for good after onset: today / hold, median / p95 | false resumes, hold (overlap) |
| --- | --- | --- | --- | --- | --- | --- |
| known hard case | 17 | 8 / 8 (8) | 9 / 0 | 160 ms / 180 ms | - / -; 160 ms / 180 ms | 0 (0.0 s) |
| soft command (S40), English | 40 | 0 / 2 (0) | 0 / 0 | 250 ms / 590 ms | 250 ms / 590 ms; 250 ms / 590 ms | 2 (16.1 s) |
| soft command (S40), Arabic | 40 | 0 / 0 (0) | 0 / 0 | 170 ms / 330 ms | 170 ms / 330 ms; 170 ms / 330 ms | 0 (0.0 s) |
| command over noise, English | 40 | 0 / 0 (0) | 36 / 1 | 100 ms / 800 ms | 100 ms / 260 ms; 120 ms / 800 ms | 3 (0.5 s) |
| command over noise, Arabic | 40 | 0 / 0 (0) | 35 / 0 | 90 ms / 150 ms | 90 ms / 100 ms; 100 ms / 150 ms | 2 (0.2 s) |
| sentence over noise | 20 | 0 / 0 (0) | 18 / 0 | 90 ms / 390 ms | 100 ms / 100 ms; 100 ms / 390 ms | 0 (0.0 s) |
| sentence (S30) | 20 | 0 / 0 (0) | 0 / 0 | 110 ms / 270 ms | 110 ms / 270 ms; 110 ms / 270 ms | 0 (0.0 s) |

Noise and knocks over the bot (should not stop):

| group | clips | stopped: today / hold | hold stopped by: words or a failed stream / the detector / 6 s deadline / view lost | hold went on: watched / after an empty end | held, median |
| --- | --- | --- | --- | --- | --- |
| steady non-speech | 89 | 89 / 4 | 0 / 4 / 0 / 0 | 99 / 0 | 1.6 s |
| scene | 7 | 6 / 0 | 0 / 0 / 0 / 0 | 6 / 0 | 1.6 s |
| speech-like (babble) | 31 | 31 / 25 | 2 / 23 / 0 / 0 | 11 / 0 | 0.5 s |
| three knocks | 20 | 20 / 0 | 0 / 0 / 0 / 0 | 20 / 0 | 1.6 s |

