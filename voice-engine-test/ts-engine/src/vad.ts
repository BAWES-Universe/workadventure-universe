// Voice activity state machine. Same states, thresholds and counters as pipecat's VADAnalyzer (confidence 0.7, start 0.2 s,
// stop 0.2 s, min_volume 0.6) and the same Silero model reset rule. ONE DEVIATION: pipecat gates on BS.1770 loudness
// (min_volume 0.6 = about -50 LUFS over a smoothed 400 ms window); here the gate is the RMS of the 32 ms window >= -50 dBFS.
import { SileroModel } from './models.ts';

export const VAD = { confidence: 0.7, startSecs: 0.2, stopSecs: 0.2, windowSamples: 512, minRmsDb: -50 };
const WIN_SECS = 512 / 16000;
const START_FRAMES = Math.round(VAD.startSecs / WIN_SECS), STOP_FRAMES = Math.round(VAD.stopSecs / WIN_SECS);
type S = 'QUIET' | 'STARTING' | 'SPEAKING' | 'STOPPING';

export class Vad {
  private model = new SileroModel(); private state: S = 'QUIET'; private starting = 0; private stopping = 0;
  private buf = new Float32Array(512 * 4); private n = 0; private sinceReset = 0; private lowConf = 0;
  /** Feed 16 kHz int16 samples. Calls onChange('start'|'stop') on transitions. Returns after all complete 512-sample windows are scored. */
  async feed(pcm: Int16Array, onChange: (e: 'start' | 'stop') => void): Promise<void> {
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.n++] = pcm[i] / 32768;
      if (this.n === 512) {
        const w = this.buf.slice(0, 512); this.n = 0;
        const conf = await this.model.score(w);
        this.maybeReset(conf);
        let e = 0; for (let k = 0; k < 512; k++) e += w[k] * w[k];
        const db = 10 * Math.log10(e / 512 + 1e-12);
        const speaking = conf >= VAD.confidence && db >= VAD.minRmsDb;
        const before = this.state;
        if (speaking) {
          if (this.state === 'QUIET') { this.state = 'STARTING'; this.starting = 1; }
          else if (this.state === 'STARTING') this.starting++;
          else if (this.state === 'STOPPING') { this.state = 'SPEAKING'; this.stopping = 0; }
        } else {
          if (this.state === 'STARTING') { this.state = 'QUIET'; this.starting = 0; }
          else if (this.state === 'SPEAKING') { this.state = 'STOPPING'; this.stopping = 1; }
          else if (this.state === 'STOPPING') this.stopping++;
        }
        if (this.state === 'STARTING' && this.starting >= START_FRAMES) { this.state = 'SPEAKING'; this.starting = 0; }
        if (this.state === 'STOPPING' && this.stopping >= STOP_FRAMES) { this.state = 'QUIET'; this.stopping = 0; }
        if (before !== 'SPEAKING' && before !== 'STOPPING' && this.state === 'SPEAKING') onChange('start');
        else if ((before === 'SPEAKING' || before === 'STOPPING') && this.state === 'QUIET') onChange('stop');
      }
    }
  }
  private maybeReset(conf: number) {
    this.sinceReset++; this.lowConf = conf < 0.1 ? this.lowConf + 1 : 0;
    if (this.sinceReset * 512 >= 2.0 * 16000 && this.state === 'QUIET' && this.lowConf >= 5) { this.model.resetStates(); this.sinceReset = 0; }
  }
  reset() { this.state = 'QUIET'; this.starting = this.stopping = 0; this.n = 0; this.model.resetStates(); }
}
