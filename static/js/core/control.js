/**
 * Feeder control rules — the single source of truth for what frequency the
 * feeder VFD should be commanded to.
 *
 *  • The AI state (EMPTY / PARTIAL / FULL) is always detected and reported.
 *    Manual mode never stops or hides AI detection.
 *  • In AUTO the command is the configured frequency for the AI state.
 *  • MANUAL is permitted only while the AI state is EMPTY. The operator's
 *    setpoint is clamped to [manualMin, manualMax] and replaces the Empty
 *    frequency as the VFD command.
 *  • If the AI state leaves EMPTY, the effective mode falls back to AUTO.
 *
 * The backend must enforce the same rules; the UI enforces them for display
 * and to avoid sending commands that would be rejected.
 */

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function autoFrequency(aiState, s) {
  return { FULL: s.freqFull, PARTIAL: s.freqPartial, EMPTY: s.freqEmpty }[aiState] ?? s.freqFull;
}

export function isManualAllowed(aiState) {
  return aiState === 'EMPTY';
}

/** Feeder may only run while the crusher is running (interlock). */
export function crusherPermitsFeed(crusherStatus) {
  return crusherStatus === 'RUNNING' || crusherStatus === 'WARNING';
}

export function resolveVfdCommand({ aiState, requestedMode, manualHz, crusherStatus = 'RUNNING' }, s) {
  const autoHz = autoFrequency(aiState, s);
  const manualAllowed = isManualAllowed(aiState);
  const mode = requestedMode === 'MANUAL' && manualAllowed ? 'MANUAL' : 'AUTO';
  const setpoint = clamp(Number(manualHz) || s.manualDefault, s.manualMin, s.manualMax);
  const interlock = !crusherPermitsFeed(crusherStatus);
  const commandHz = interlock ? 0 : mode === 'MANUAL' ? setpoint : autoHz;
  return {
    mode,
    commandHz,
    interlock,
    autoHz,
    manualAllowed,
    manualHz: setpoint,
    atMax: mode === 'MANUAL' && setpoint >= s.manualMax,
    atMin: mode === 'MANUAL' && setpoint <= s.manualMin,
  };
}
