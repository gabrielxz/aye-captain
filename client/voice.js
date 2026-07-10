// Push-to-talk voice input. Two engines behind one interface:
//  - pcm: continuous mic capture into a rolling pre-roll buffer; pressing
//    the key keeps the last PRE_ROLL_S seconds plus everything until
//    release, so speech onsets are never clipped. Uploaded as WAV to /stt
//    (server-side Whisper). Used when the server reports an STT key.
//  - webspeech: browser Web Speech API (free fallback, Chrome/Edge/Safari)
// States reported via onStateChange: "idle" | "listening" | "transcribing".

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const AC = window.AudioContext || window.webkitAudioContext;

const PRE_ROLL_S = 0.8; // audio kept from BEFORE the keypress
const UPLOAD_RATE = 16000; // Whisper-native mono 16 kHz

export function createVoice({ useServerStt, onInterim, onFinal, onStateChange, onError }) {
  let mode = "idle";

  function setMode(m) {
    mode = m;
    onStateChange(m);
  }

  // ---------- pcm engine (continuous capture + pre-roll ring) ----------
  let cap = null; // {stream, actx, ring: Float32Array[], ringLen, rec: Float32Array[]|null}
  let heldSince = 0;

  async function ensureCapture() {
    if (cap && cap.stream.active && cap.actx.state !== "closed") {
      if (cap.actx.state === "suspended") await cap.actx.resume();
      return cap;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      // echo cancellation matters: the game itself makes noise (thrust
      // rumble, the XO talking) and speaker bleed feeds Whisper garbage
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const actx = new AC();
    const src = actx.createMediaStreamSource(stream);
    const proc = actx.createScriptProcessor(2048, 1, 1);
    const state = { stream, actx, ring: [], ringLen: 0, rec: null };
    proc.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      state.ring.push(chunk);
      state.ringLen += chunk.length;
      const capSamples = PRE_ROLL_S * actx.sampleRate;
      while (state.ring.length > 1 && state.ringLen - state.ring[0].length > capSamples) {
        state.ringLen -= state.ring[0].length;
        state.ring.shift();
      }
      if (state.rec) state.rec.push(chunk);
    };
    // the processor only runs when routed to the destination; a zero-gain
    // stage keeps the mic from echoing out of the speakers
    const mute = actx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(actx.destination);
    cap = state;
    return cap;
  }

  async function startPcm() {
    try {
      await ensureCapture();
    } catch {
      setMode("idle");
      onError("microphone unavailable — check browser mic permission");
      return;
    }
    if (mode !== "listening") return; // key released while mic was coming up
    heldSince = performance.now();
    cap.rec = [...cap.ring]; // pre-roll: the words spoken as the key went down
  }

  function stopPcm() {
    const chunks = cap?.rec ?? [];
    if (cap) cap.rec = null;
    const heldMs = performance.now() - heldSince;
    if (heldMs < 350) {
      setMode("idle"); // a tap, not an order
      return;
    }
    void finishPcm(chunks);
  }

  async function finishPcm(chunks) {
    setMode("transcribing");
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      pcm.set(c, off);
      off += c.length;
    }

    // Silence gate: Whisper FABRICATES text for silent/noise-only audio, so
    // never upload a clip with no real speech energy.
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.abs(pcm[i]);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, pcm.length));
    if (peak < 0.05 || rms < 0.004) {
      setMode("idle");
      onError("nothing heard — check your mic level");
      return;
    }

    try {
      const wav = encodeWav(await resample(pcm, cap.actx.sampleRate, UPLOAD_RATE), UPLOAD_RATE);
      const resp = await fetch("/stt", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      if (!resp.ok) throw new Error(`server ${resp.status}`);
      const { text } = await resp.json();
      setMode("idle");
      if (text) onFinal(text);
    } catch (err) {
      setMode("idle");
      onError(`transcription failed (${err.message})`);
    }
  }

  async function resample(pcm, fromRate, toRate) {
    if (fromRate === toRate) return pcm;
    const octx = new OfflineAudioContext(1, Math.ceil((pcm.length * toRate) / fromRate), toRate);
    const buf = octx.createBuffer(1, pcm.length, fromRate);
    buf.getChannelData(0).set(pcm);
    const src = octx.createBufferSource();
    src.buffer = buf;
    src.connect(octx.destination);
    src.start();
    return (await octx.startRendering()).getChannelData(0);
  }

  function encodeWav(pcm, rate) {
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF");
    out.setUint32(4, 36 + pcm.length * 2, true);
    str(8, "WAVEfmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); // PCM
    out.setUint16(22, 1, true); // mono
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, "data");
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return out.buffer;
  }

  // ---------- webspeech engine ----------
  let rec = null;
  let finals = [];

  function startSpeech() {
    rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    finals = [];

    rec.onresult = (ev) => {
      finals = [];
      let interim = "";
      for (const res of ev.results) {
        if (res.isFinal) finals.push(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      onInterim([...finals, interim.trim()].filter(Boolean).join(" "));
    };
    rec.onerror = (ev) => {
      // no-speech (released without talking) and aborted are routine
      if (ev.error !== "no-speech" && ev.error !== "aborted") onError(ev.error);
    };
    rec.onend = () => {
      rec = null;
      setMode("idle");
      const text = finals.join(" ").trim();
      if (text) onFinal(text);
    };

    setMode("listening");
    try {
      rec.start();
    } catch (err) {
      rec = null;
      setMode("idle");
      onError(String(err?.message ?? err));
    }
  }

  // ---------- shared interface ----------
  function start() {
    if (mode === "listening") return;
    if (useServerStt()) {
      setMode("listening");
      void startPcm();
    } else if (SR) {
      startSpeech();
    } else {
      onError("no speech recognition in this browser — try Chrome, Edge, or Safari");
    }
  }

  function stop() {
    if (mode !== "listening") return;
    if (cap && cap.rec) {
      stopPcm(); // finishPcm handles mode
    } else if (rec) {
      rec.stop(); // onend takes it from here
    } else {
      setMode("idle"); // mic never came up
    }
  }

  return {
    start,
    stop,
    get listening() {
      return mode === "listening";
    },
  };
}
