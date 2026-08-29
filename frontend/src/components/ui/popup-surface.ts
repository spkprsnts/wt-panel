// The M3 menu-surface look shared by every popup built on a bare Base UI
// Popover/Select/Menu primitive — color, shape, and elevation only. Sizing,
// overflow, and open/close animation stay per-file since those genuinely
// differ per popup (Select's scale transition vs DropdownMenu's directional
// slide, ...).
export const POPUP_SURFACE = "rounded-xs bg-surface-container text-on-surface shadow-elevation-2"
