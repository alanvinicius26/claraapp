---
name: Warm Editorial Studio
colors:
  surface: '#fef9f3'
  surface-dim: '#ded9d4'
  surface-bright: '#fef9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8f3ed'
  surface-container: '#f2ede7'
  surface-container-high: '#ece7e2'
  surface-container-highest: '#e6e2dc'
  on-surface: '#1d1b18'
  on-surface-variant: '#544245'
  inverse-surface: '#32302c'
  inverse-on-surface: '#f5f0ea'
  outline: '#877275'
  outline-variant: '#dac0c4'
  surface-tint: '#9c3e59'
  primary: '#500021'
  on-primary: '#ffffff'
  primary-container: '#6e1936'
  on-primary-container: '#f2829f'
  inverse-primary: '#ffb1c2'
  secondary: '#9d3d5a'
  on-secondary: '#ffffff'
  secondary-container: '#ff8aa9'
  on-secondary-container: '#781f3e'
  tertiary: '#4a0f0e'
  on-tertiary: '#ffffff'
  tertiary-container: '#662521'
  on-tertiary-container: '#e78b84'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffd9e0'
  primary-fixed-dim: '#ffb1c2'
  on-primary-fixed: '#3f0018'
  on-primary-fixed-variant: '#7e2642'
  secondary-fixed: '#ffd9e0'
  secondary-fixed-dim: '#ffb1c3'
  on-secondary-fixed: '#3f0019'
  on-secondary-fixed-variant: '#7f2543'
  tertiary-fixed: '#ffdad6'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#3d0606'
  on-tertiary-fixed-variant: '#76312d'
  background: '#fef9f3'
  on-background: '#1d1b18'
  surface-variant: '#e6e2dc'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.25rem
    fontWeight: '600'
    lineHeight: 2.75rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.375rem
    fontWeight: '600'
    lineHeight: 1.875rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.625rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.625rem
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.02em
  number-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
  space-2xl: 3rem
---

## Brand & Style

This design system is tailored for independent beauty, wellness, and aesthetic specialists who balance artistic care with business execution. The aesthetic bridges the precision of a high-efficiency SaaS tool with the tactile warmth of a boutique treatment studio. It avoids the cold, clinical look of conventional CRM platforms in favor of an editorial, calm, and grounded environment.

The design philosophy combines:
- **Warm Editorial Layouts:** Quiet surfaces, thoughtful negative space, and disciplined typographic rhythm that make day-long scheduling and revenue tracking visually effortless.
- **Tactile Softness:** Generous corner radiuses, organic edge transitions, and muted blush accents that soften administrative fatigue.
- **Clarity & Control:** Low-contrast structural borders paired with deep wine and warm espresso ink values, providing unambiguous glanceability across appointments, treatment cards, and cash flow ledgers.

## Colors

The palette relies entirely on natural pigments, warm stone foundations, and deep wine accents. High saturation synthetic colors are omitted to preserve visual calm.

### Role Mapping
- **Primary (`#6E1936` - Bordô Profundo):** Key anchor for primary actions, active navigation states, bold financial totals, and high-emphasis brand cues.
- **Secondary (`#8C2F4D` - Vinho Rosado):** Interactive buttons, focused borders, hover elevation on primary items, and prominent active dates.
- **Tertiary / Accent (`#CB746D` - Coral Queimado):** Warm notifications, pending deposits, reschedule requests, and attention markers.
- **Surface Foundation (`#FAF5EF` - Creme Claro):** The overall application background canvas. Provides a soft, paper-like warmth that reduces screen glare during long working days.
- **Elevated Surfaces (`#FFFFFF` - Branco):** Applied exclusively to cards, flyout drawers, dropdowns, and modal dialogs to provide clean separation from the cream canvas.
- **Borders & Dividers (`#E7DAD3` - Bege Rosado):** Used for structural container borders, table splitters, and calendar grid divisions.
- **Soft Badges & Containers (`#F3DCD7` - Rosa Blush):** Selected appointment blocks, soft chips, filter pills, and neutral tags.
- **Success / Confirmed States (`#E5EADD` - Verde Sálvia Claro):** Confirmed client appointments, completed payments, and balanced cash receipts. Text within these tags uses `#2F2928` to maintain contrast.
- **Primary Ink (`#2F2928` - Marrom Escuro):** Primary headlines, numbers, table entries, and body copy.
- **Secondary Ink (`#716765` - Cinza Quente):** Field labels, timestamps, metadata, and placeholder copy.

## Typography

Typography relies on **Plus Jakarta Sans** across all roles to achieve a balance between geometric cleanliness and humanist softness. The font's wide counters and subtle organic curves prevent data tables and calendar slots from appearing overly industrial.

- **Financial & Metrics:** Apply tabular figure positioning (`tnum`) across all pricing, balance figures, and time duration indicators to ensure smooth vertical scanning in tables and daily agendas.
- **Editorial Headings:** Use semibold weights (`600`) with tight letter-spacing (`-0.025em`) to evoke high-end beauty magazine titling while retaining full interface legibility.
- **Hierarchy Rules:** Never use pure black (`#000000`). All text levels must use `#2F2928` for primary text and `#716765` for secondary labels and hints.

## Layout & Spacing

The layout is built around a desktop-first productivity dashboard with an adaptive multi-pane layout:
- **Shell Structure:** A persistent slim navigation sidebar (260px) fixed to the left, paired with a flexible primary working surface and an optional contextual side panel (380px) for quick client histories or ticket details.
- **Grid Structure:** A 12-column layout within the main viewport container, using `gutter` (1.5rem) and standard page outer `margin` (2rem).
- **Rhythm & Breathing Room:** Generous internal card spacing (`space-lg` / 1.5rem) provides a clean, open surface for schedule slots and financial summaries, avoiding visual clutter during hectic workdays.

## Elevation & Depth

Visual hierarchy relies on structural boundaries and warm, tinted ambient shadows rather than stark elevation:

- **Border-First Architecture:** Elevation is anchored by crisp 1px borders using `#E7DAD3` on pure white (`#FFFFFF`) cards resting atop the `#FAF5EF` canvas.
- **Warm Ambient Shadow:** When lift is required (modals, active dropdowns, popovers, and floating appointment detail cards), apply an ultra-diffused, warm-tinted shadow:
  `box-shadow: 0 8px 30px -4px rgba(110, 25, 54, 0.06), 0 2px 8px -2px rgba(47, 41, 40, 0.04);`
- **Tonal Layering:** Avoid heavy drop shadows on static inline cards. Depth is created by placing crisp `#FFFFFF` cards over the `#FAF5EF` background, punctuated by soft fills (`#F3DCD7`, `#E5EADD`) for appointment blocks.

## Shapes

The interface embraces a gentle, welcoming visual language with smooth corner treatments:

- **Cards & Primary Modules:** 16px (`1rem` / `rounded-lg`) for workspace cards, calendar grids, and finance charts.
- **Buttons, Form Inputs & Dropdowns:** 10px to 12px (`rounded-md` / `rounded-lg`) for a soft, tactile touch.
- **Status Pills, Service Badges & Chips:** Full pill radius (`9999px`) to maintain contrast with angular card bounds.
- **Modals & Slide-out Panels:** 20px (`1.25rem` to `1.5rem`) for a tailored, premium boutique finish.

## Components

### Buttons
- **Primary:** Background `#6E1936`, text `#FFFFFF`, border none, radius 10px. Hover: background `#8C2F4D` with smooth 150ms transition. Active: scale 0.98.
- **Secondary / Soft:** Background `#F3DCD7`, text `#6E1936`, border none. Hover: background `#E7DAD3`.
- **Outline:** Background `#FFFFFF`, text `#2F2928`, border 1px solid `#E7DAD3`. Hover: border `#8C2F4D`, text `#6E1936`.

### Inputs & Select Fields
- Base height: 42px. Background `#FFFFFF`, border 1px solid `#E7DAD3`, text `#2F2928`, radius 10px, horizontal padding `1rem`.
- Focus state: border 1.5px solid `#8C2F4D`, box-shadow `0 0 0 3px rgba(140, 47, 77, 0.12)`.
- Helper labels: text `#716765`, font weight 600, `label-sm`.

### Appointment & Status Chips
- **Confirmed / Paid:** Background `#E5EADD`, text `#2F2928`, weight 600, radius `9999px`, padding `0.25rem 0.75rem`.
- **Pending / Deposit Due:** Background `#FAF5EF`, border 1px solid `#CB746D`, text `#CB746D`.
- **Selected / In-Treatment:** Background `#6E1936`, text `#FFFFFF`.

### Cards & Calendar Blocks
- **Standard Card:** Background `#FFFFFF`, border 1px solid `#E7DAD3`, radius 16px, padding `1.5rem`.
- **Calendar Event Slot:** Background `#FFFFFF`, border-left 4px solid `#6E1936`, border-top/right/bottom 1px solid `#E7DAD3`, radius 8px, padding `0.625rem 0.875rem`. Hover state lifts with light warm shadow.

### Checkboxes & Radios
- Size: 18px x 18px. Border 1.5px solid `#E7DAD3`, radius 6px (checkbox) or circle (radio).
- Checked: Background `#6E1936`, border `#6E1936`, check glyph `#FFFFFF`.

### Specialized Domain Components
- **Cash Flow Summary Pill:** A dual-value badge showing revenue vs. pending payout, featuring a soft `#E5EADD` background with `#2F2928` text and a secondary `#716765` indicator.
- **Client Procedure History Drawer:** A right-aligned sliding modal with an elevated white surface (`#FFFFFF`), separated from the main schedule canvas by a clean 1px `#E7DAD3` border, containing treatment notes, past formulas, and payment records.