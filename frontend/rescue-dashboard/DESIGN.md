# DISHA Rescue Dashboard Design System

This document specifies the design tokens, color palette, typography, and reusable UI components for the Disha emergency rescue dashboard.

---

## 1. Tokens Reference (`src/styles/tokens.css`)

### Typography (Self-hosted Outfit font)
- **Family**: `'Outfit', system-ui, -apple-system, sans-serif`
- **H1**: `36px` / weight 700 / line-height 1.2
- **H2**: `24px` / weight 700 / line-height 1.25
- **H3**: `18px` / weight 600 / line-height 1.35
- **Body**: `14px` / weight 500 / line-height 1.45
- **Small**: `12px` / weight 500 / line-height 1.4
- **Tiny**: `10px` / weight 600 / line-height 1.3

### Color Palette
- **Background**: `#F5F6F8` (neutral light canvas)
- **Card Surface**: `#FFFFFF` with soft shadows
- **Glass-lite Surface**: `rgba(255, 255, 255, 0.82)` with `backdrop-filter: blur(12px)`
- **Primary**: `#3B82F6` (Hover: `#2563EB`, Pressed: `#1D4ED8`, Tint: `rgba(59, 130, 246, 0.1)`)
- **Primary Gradient**: `linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)`
- **Dark Neutral**: `#18181B` (replaces pure black for badges and dark actions)
- **Text**: `#111827` (primary headings & labels)
- **Muted Text**: `#6B7280` (descriptions & units), `#9CA3AF` (subtle captions)
- **Success**: `#10B981` (active nodes, connected backend, delivered SOS)
- **Danger**: `#EF4444` (offline nodes, dropped packets, critical alerts)
- **Warning**: `#F59E0B` (pending/staggered state)
- **Accent / Motion**: `#FF6B35` (in-flight packets, rerouting path, gateway badge)

### Radii & Elevation
- **Cards**: `28px` (nested inner items: `16-20px`)
- **Buttons & Inputs**: `14px`
- **Chips**: `12px`
- **Pills**: `9999px` (fully rounded)
- **Card Shadow**: `0 4px 20px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02)`
- **Float Shadow**: `0 12px 36px rgba(0, 0, 0, 0.1)`

---

## 2. Reusable UI Components (`src/components/ui/`)

| Component | File | Description |
|-----------|------|-------------|
| **Card** | `Card.jsx` | Container with 24-28px radius, white surface or glass-lite backdrop blur, header with action slots. |
| **StatCard** | `StatCard.jsx` | Metric display with label, value, caption, and optional icon container. Supports `gradient` variant. |
| **Pill** | `Pill.jsx` | Compact status badge with an optional colored indicator dot (`online`, `offline`, `active`, `accent`). |
| **Button** | `Button.jsx` | Standardized button supporting `primary`, `secondary`, `dark`, `icon`, and `glass` variants. |
| **Chip** | `Chip.jsx` | Selectable / interactive pill for presets and quick filter tags. |
| **SegmentedTabs** | `SegmentedTabs.jsx` | Glassmorphic or subtle grey pill tab list with animated active pill indicator. |
| **Slider** | `Slider.jsx` | Custom styled range slider with blue filled progress track, white 20px thumb with shadow. |
| **StripeProgress** | `StripeProgress.jsx` | Diagonal striped animated progress bar for deployment and queue status. |
| **EmptyState** | `EmptyState.jsx` | Standard empty placeholder with icon container, title, and descriptive subtitle. |

---

## 3. Panels & Floating Overlays (`src/components/panels/`)

1. **TopBar**: 64px floating glass header with DISHA wordmark, navigation step pills, and backend connectivity Pill.
2. **LeftPanel**: 360px collapsible drawer stacking Location & Area, Radio Parameters, Network Overview (2x2 StatCards), Deployment, and Selected Node inspection.
3. **RightPanel**: 380px collapsible panel with tabs: SOS, Failures, Log, and Sniffing with empty states and DEV sample card.
4. **MapToolbar**: Glass-lite pill toolbar for 3D/2D toggle, Focus Area, and North reset.
5. **Legend**: Bottom-left map overlay explaining nodes, gateway, Wi-Fi coverage, and mesh links.
6. **DemoBar**: Bottom-center floating glass action pill with preview controls.
