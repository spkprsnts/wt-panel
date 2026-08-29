// POPUP_SURFACE is the M3 menu-surface look shared by every popup built on
// a bare Base UI Popover/Select/Menu primitive (select.tsx, combobox.tsx,
// multi-select.tsx, dropdown-menu.tsx) — color, shape, and elevation only.
// Sizing, overflow, and open/close animation stay per-file since those
// genuinely differ per popup (Select's scale transition vs DropdownMenu's
// directional slide, fixed vs anchor-relative width, ...); pulling those in
// too would force a shared shape none of the four actually has. This way a
// future M3 color/shape/elevation tweak only needs applying in one place.
export const POPUP_SURFACE = "rounded-xs bg-surface-container text-on-surface shadow-elevation-2"
