/**
 * 100% Procedural Web Audio API soundscape for KOMOREBI — A Forest Flight.
 * Synthesizes gentle forest wind, Wright Flyer twin-pusher prop hum,
 * pentatonic lantern chimes, resonant temple torii bells, and impact cues.
 */
export class ForestAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private propOsc: OscillatorNode | null = null;
  private propGain: GainNode | null = null;
  private isMuted = false;
  private isRunning = false;
  private chimeIndex = 0;

  // Japanese Yo pentatonic scale (D5, E5, G5, A5, B5, D6)
  private readonly pentatonicHz = [587.33, 659.25, 783.99, 880.0, 987.77, 1174.66];

  public unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.isMuted ? 0 : 0.42;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Filtered noise buffer for forest wind & air rush
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.06) * 0.32;
      }

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer;
      noiseSrc.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 340;
      windFilter.Q.value = 0.85;
      this.windFilter = windFilter;

      const windGain = ctx.createGain();
      windGain.gain.value = 0.0;
      this.windGain = windGain;

      noiseSrc.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      noiseSrc.start();

      // Subtle low wooden pusher-propeller purr
      const propOsc = ctx.createOscillator();
      propOsc.type = 'triangle';
      propOsc.frequency.value = 62;
      this.propOsc = propOsc;

      const propFilter = ctx.createBiquadFilter();
      propFilter.type = 'lowpass';
      propFilter.frequency.value = 180;

      const propGain = ctx.createGain();
      propGain.gain.value = 0.0;
      this.propGain = propGain;

      propOsc.connect(propFilter);
      propFilter.connect(propGain);
      propGain.connect(master);
      propOsc.start();

      this.isRunning = true;
    } catch {
      // Ignore Web Audio restriction errors in headless browsers
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.08);
    }
  }

  public updateFlightLoops(active: boolean, speedRatio: number, isBoosting: boolean): void {
    if (!this.isRunning || !this.ctx || !this.windGain || !this.windFilter || !this.propGain || !this.propOsc) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active || this.isMuted) {
      this.windGain.gain.setTargetAtTime(0, now, 0.14);
      this.propGain.gain.setTargetAtTime(0, now, 0.14);
      return;
    }

    const boostAdd = isBoosting ? 0.14 : 0;
    this.windGain.gain.setTargetAtTime(0.16 + speedRatio * 0.12 + boostAdd, now, 0.12);
    this.windFilter.frequency.setTargetAtTime(300 + speedRatio * 260 + (isBoosting ? 240 : 0), now, 0.12);

    this.propGain.gain.setTargetAtTime(0.065 + (isBoosting ? 0.035 : 0), now, 0.12);
    this.propOsc.frequency.setTargetAtTime(58 + speedRatio * 22 + (isBoosting ? 18 : 0), now, 0.12);
  }

  public playLanternChime(): void {
    if (this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const baseFreq = this.pentatonicHz[this.chimeIndex % this.pentatonicHz.length];
    this.chimeIndex += 1;

    // Two gentle bell partials
    [1, 2.0].forEach((mult, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(baseFreq * mult, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.24 : 0.07, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (idx === 0 ? 1.15 : 0.65));

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.2);
    });
  }

  public playToriiBell(): void {
    if (this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freqs = [293.66, 440.0, 587.33]; // D4 - A4 - D5 serene shrine triad

    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.045);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.045);
      gain.gain.linearRampToValueAtTime(0.16 / (idx + 1), now + idx * 0.045 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.85);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.045);
      osc.stop(now + 1.9);
    });
  }

  public playDamageThud(): void {
    if (this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  public playSanctuaryChord(): void {
    if (this.isMuted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [293.66, 440.0, 587.33, 739.99, 880.0];
    notes.forEach((hz, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.11;
      osc.frequency.setValueAtTime(hz, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 2.7);
    });
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.isRunning = false;
  }
}
