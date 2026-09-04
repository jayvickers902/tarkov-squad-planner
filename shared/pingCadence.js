// Framework-free ping gesture contract shared by the browser and companion.
// Keep this module free of React, Tauri, Supabase, and map rendering imports.

export const TAP_WINDOW_MS = 1200
export const MAX_TAPS = 3
export const SCREENSHOT_PING_CADENCE_MS = TAP_WINDOW_MS
export const SCREENSHOT_PING_MAX_TAPS = MAX_TAPS
