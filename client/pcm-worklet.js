// Mic capture on the AUDIO thread. The old ScriptProcessorNode ran its
// callback on the main thread, and an 8-player battle janks the main thread
// hard enough to DROP audio buffers — captains' words went missing from the
// middle of utterances (playtest 2026-07-12). An AudioWorklet keeps
// capturing through any main-thread stall; chunk messages queue losslessly
// and merely arrive late.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048); // ~43 ms at 48 kHz, matches the old chunking
    this.len = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let off = 0;
    while (off < ch.length) {
      const n = Math.min(ch.length - off, this.buf.length - this.len);
      this.buf.set(ch.subarray(off, off + n), this.len);
      this.len += n;
      off += n;
      if (this.len === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(2048);
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
