// Feature flags. Flip a flag to false to disable a feature app-wide without
// removing its code (and to make a clean revert obvious).
//
// Calls: experimental 1:1 WebRTC audio/video (STUN-only, no TURN relay yet).
// Set to false to hide all call UI and ignore incoming call signals.
export const CALLS_ENABLED = true;
