// Push-to-talk voice input. Two engines behind one interface:
//  - recorder: capture audio while the key is held, POST to /stt on release,
//    server transcribes with a Whisper-class model (used when the server
//    reports an STT key via hello config — best accuracy)
//  - webspeech: browser Web Speech API (free fallback, Chrome/Edge/Safari)
// States reported via onStateChange: "idle" | "listening" | "transcribing".

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function createVoice({ useServerStt, onInterim, onFinal, onStateChange, onError }) {
  let mode = "idle";

  function setMode(m) {
    mode = m;
    onStateChange(m);
  }

  // ---------- recorder engine ----------
  let stream = null; // kept alive after first grant so re-arming is instant
  let recorder = null;
  let chunks = [];
  let heldSince = 0;

  async function startRecorder() {
    try {
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch {
      setMode("idle");
      onError("microphone unavailable — check browser mic permission");
      return;
    }
    if (mode !== "listening") return; // key released while mic was coming up

    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m)
    );
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => void finishRecording();
    heldSince = performance.now();
    recorder.start();
  }

  async function finishRecording() {
    const heldMs = performance.now() - heldSince;
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    recorder = null;
    if (heldMs < 400 || blob.size < 1000) {
      setMode("idle"); // a tap, not an order
      return;
    }
    setMode("transcribing");
    try {
      const resp = await fetch("/stt", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
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
      void startRecorder();
    } else if (SR) {
      startSpeech();
    } else {
      onError("no speech recognition in this browser — try Chrome, Edge, or Safari");
    }
  }

  function stop() {
    if (mode !== "listening") return;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // finishRecording takes it from here
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
