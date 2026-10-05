/** Repeating request cue. The caller must unlock Web Audio with a user gesture. */
export function startTaskBell(context, timers = globalThis) {
  if (!context || context.state !== 'running') return () => {};
  const playing = new Set();
  let stopped = false;
  const ring = () => {
    if (stopped || context.state !== 'running') return;
    [0, .24, .48, .72].forEach((offset, i) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = context.currentTime + offset;
      oscillator.type = 'sine';
      oscillator.frequency.value = i % 2 ? 880 : 660;
      gain.gain.setValueAtTime(.001, at);
      gain.gain.exponentialRampToValueAtTime(.65, at + .015);
      gain.gain.exponentialRampToValueAtTime(.001, at + .21);
      oscillator.connect(gain); gain.connect(context.destination);
      playing.add(oscillator);
      oscillator.onended = () => { playing.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + .22);
    });
  };
  ring();
  const interval = timers.setInterval(ring, 2200);
  return () => {
    stopped = true;
    timers.clearInterval(interval);
    for (const oscillator of playing) { try { oscillator.stop(); } catch { /* Already ended. */ } }
    playing.clear();
  };
}
