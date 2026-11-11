// Workout sound: an upbeat backing track made in the browser with the Web Audio API (there is
// no audio file to download), and a voice that counts and encourages using the device's own
// speech. Both are optional and either can fail quietly: the workout never depends on sound.

const BPM = 126;
const STEP = 60 / BPM / 4; // a sixteenth note, in seconds
const LOOKAHEAD = 0.35;
// Four bars: A minor, F, C, G. Notes are MIDI numbers.
const BARS = [
  { bass: 45, chord: [69, 72, 76] },
  { bass: 41, chord: [69, 72, 77] },
  { bass: 48, chord: [67, 72, 76] },
  { bass: 43, chord: [67, 71, 74] },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function createSound() {
  let ctx = null;
  let master = null;
  let music = null;
  let noise = null;
  let timer = 0;
  let step = 0;
  let nextTime = 0;
  let musicOn = false;
  let voiceOn = false;
  let muted = false;
  let level = 1;

  function envelope(node, time, peak, length) {
    node.gain.setValueAtTime(0.0001, time);
    node.gain.exponentialRampToValueAtTime(peak, time + 0.005);
    node.gain.exponentialRampToValueAtTime(0.0001, time + length);
  }

  function tone(type, freq, time, length, peak, cutoff) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    envelope(gain, time, peak, length);
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      osc.connect(filter).connect(gain);
    } else osc.connect(gain);
    gain.connect(music);
    osc.start(time);
    osc.stop(time + length + 0.02);
    return osc;
  }

  function hit(time, length, peak, type, freq) {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noise;
    filter.type = type;
    filter.frequency.value = freq;
    envelope(gain, time, peak, length);
    src.connect(filter).connect(gain).connect(music);
    src.start(time);
    src.stop(time + length + 0.02);
  }

  function schedule(i, time) {
    const bar = BARS[Math.floor(i / 16) % BARS.length];
    const s = i % 16;
    if (s % 4 === 0) {
      // Kick drum: a sine that drops quickly in pitch.
      const kick = tone('sine', 150, time, 0.16, 0.9);
      kick.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    }
    if (s === 4 || s === 12) hit(time, 0.14, 0.35, 'bandpass', 1800); // clap
    if (s % 2 === 0) hit(time, 0.04, s % 4 === 2 ? 0.16 : 0.07, 'highpass', 7000); // hi-hat
    if (s % 2 === 0) tone('sawtooth', hz(bar.bass + (s % 8 === 6 ? 12 : 0)), time, 0.16, 0.22, 500); // bass
    tone('triangle', hz(bar.chord[ARP[s]] + (s % 8 === 7 ? 12 : 0)), time, 0.11, 0.07, 3000); // melody
  }

  function pump() {
    if (!ctx || !musicOn) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      schedule(step, nextTime);
      step += 1;
      nextTime += STEP;
    }
  }

  const applyLevel = () => {
    if (!ctx) return;
    music.gain.setTargetAtTime(muted ? 0 : 0.5 * level, ctx.currentTime, 0.15);
  };

  return {
    /** Call from a tap (browsers only allow sound to start from one). */
    start({ music: wantMusic, voice: wantVoice }) {
      voiceOn = Boolean(wantVoice) && 'speechSynthesis' in window;
      musicOn = false;
      if (!wantMusic) return;
      try {
        const AudioContext = window.AudioContext ?? window.webkitAudioContext;
        ctx ??= new AudioContext();
        if (!master) {
          master = ctx.createDynamicsCompressor();
          master.connect(ctx.destination);
          music = ctx.createGain();
          music.connect(master);
          noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
          const data = noise.getChannelData(0);
          for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        }
        ctx.resume?.();
        musicOn = true;
        step = 0;
        nextTime = ctx.currentTime + 0.08;
        applyLevel();
        clearInterval(timer);
        timer = setInterval(pump, 100);
        pump();
      } catch {
        musicOn = false; // no audio on this device or browser
      }
    },
    /** Quieter while resting, full during the exercise. */
    setLevel(next) {
      if (level === next) return;
      level = next;
      applyLevel();
    },
    say(text) {
      if (!voiceOn || muted || !text) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-IE';
        u.rate = 1.05;
        u.pitch = 1.1;
        // A count that is already late is dropped rather than queued behind the last one.
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch {
        /* no speech on this device */
      }
    },
    setMuted(next) {
      muted = Boolean(next);
      applyLevel();
      if (muted) {
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* nothing to stop */
        }
      }
    },
    get muted() {
      return muted;
    },
    get available() {
      return musicOn || voiceOn;
    },
    pause() {
      try {
        ctx?.suspend?.();
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing to pause */
      }
    },
    resume() {
      if (!musicOn) return;
      try {
        ctx.resume?.();
        nextTime = Math.max(nextTime, ctx.currentTime + 0.08);
      } catch {
        /* stays silent */
      }
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      musicOn = false;
      voiceOn = false;
      try {
        ctx?.suspend?.();
        window.speechSynthesis?.cancel();
      } catch {
        /* already stopped */
      }
    },
  };
}
