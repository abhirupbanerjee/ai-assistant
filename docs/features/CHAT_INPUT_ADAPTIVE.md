# Adaptive Chat Input Bar — Phase 2 & 3 Implementation

## Overview

The chat input bar now adapts dynamically to screen size, interaction state, and content, providing an optimized experience across mobile PWA and desktop browsers. This document describes the three-state system and implementation details for Phases 2 and 3.

**Phase 2 Status:** ✅ Complete (Adaptive states, chip wiring, swipe gestures)
**Phase 3 Status:** ✅ Complete (Inline mode chips, keyboard shortcuts, CSS variants, read-only badge)
**Track A Status:** ✅ Complete (A1: Inline chips on desktop, A3: Read-only badge, A2: Deferred to Phase 5)

## Three States

### 1. COMPACT (Mobile, Idle)
**Trigger:** Mobile device, no focus, empty draft, no attachments

**Layout:**
```
┌─────────────────────────────────────┐
│ [🎤] [+] [textarea 1-line] [🎙️] [➤] │
└─────────────────────────────────────┘
```

**Characteristics:**
- Single-row input bar
- Minimal height (~56px on mobile)
- Category chip and attachment chips hidden
- Optimized for quick access

### 2. EXPANDED (Desktop or Mobile with Content)
**Trigger:** Desktop OR (mobile with draft/attachments/focus)

**Layout:**
```
┌──────────────────────────────────────────────┐
│ [Category] [Attachment chips...]             │
├──────────────────────────────────────────────┤
│ [🎤] [+] [textarea 1-6 lines] [🎙️] [➤/■]    │
└──────────────────────────────────────────────┘
```

**Characteristics:**
- Two-row layout with chips visible
- Category chip shows selected category (or blank for new chat)
- Attachment chips display files and URL sources
- Textarea can grow up to 6 lines (desktop) or 4 lines (mobile)
- Full access to all input controls

### 3. FOCUSED-WRITE (Mobile, Extended Composition)
**Trigger:** Mobile only, when textarea reaches 4+ lines

**Layout:**
```
┌──────────────────────────────────────────────┐
│ [⋯ N attachments, Category]                  │
├──────────────────────────────────────────────┤
│                                              │
│  [textarea grows to ~50dvh]                  │
│                                              │
│  [🎤] [+] [textarea] [🎙️] [➤/■]             │
│                                              │
└──────────────────────────────────────────────┘
```

**Characteristics:**
- Chips collapse into a single pill: `⋯ N attachments, Category`
- Textarea expands to ~50% of viewport height (50dvh)
- Optimized for extended writing on mobile
- Tapping the collapsed pill opens a bottom sheet with full chip list
- Keyboard pushes from bottom without overlap (via `100dvh` + `visualViewport`)

## Implementation Details

### State Management

**Hook:** `useInputState` (`src/hooks/useInputState.ts`)

```typescript
interface UseInputStateOptions {
  value: string;           // Current message text
  isFocused: boolean;      // Textarea focus state
  attachmentCount: number; // Files + URL sources
  lineCount: number;       // Calculated line count
}

// Returns: { state: 'compact' | 'expanded' | 'focused-write', setForceExpanded }
```

**State Logic:**
1. Desktop → always `expanded`
2. Mobile + lineCount ≥ 4 → `focused-write`
3. Mobile + (focus OR draft OR attachments OR forced) → `expanded`
4. Mobile + idle → `compact`

### Component Integration

**MessageInput.tsx:**
- Tracks `isFocused` and `lineCount` state
- Calls `useInputState()` to determine current state
- Renders `data-state={inputState}` on root div
- Conditionally shows chips based on state (hidden in COMPACT)

**ChatWindow.tsx:**
- Renders `<CategoryChip>` and `<AttachmentChipsRow>` as slots
- Passes slots to `MessageInput` via `categoryChipSlot` and `attachmentChipsSlot` props
- Manages `pendingCategoryId` and `pendingUrlSources` state

**chat/page.tsx:**
- Wires `useSwipeGesture` for mobile navigation
- Left swipe → open artifacts menu
- Right swipe → open threads menu
- Disabled when menus are open

### CSS-Driven Layout

The input bar uses **data-attributes** for state-specific styling:

```tsx
<div data-state={inputState}>
  {/* Chips visible only when state !== 'compact' */}
  {inputState !== 'compact' && <ChipsRow />}
  
  {/* Textarea and controls */}
</div>
```

**Tailwind Variants** (future enhancement):
```css
/* Example: hide chips in compact state */
[data-state="compact"] .chips-row { display: none; }

/* Example: expand textarea in focused-write */
[data-state="focused-write"] textarea { max-height: 50dvh; }
```

## Mobile Keyboard Handling

**Problem:** Mobile keyboards push content up, potentially hiding the input bar.

**Solution:** 
- Use `100dvh` (dynamic viewport height) in `globals.css`
- Fallback to `vh` for older browsers
- `visualViewport` API listener adjusts layout on keyboard show/hide
- Safe-area insets handle notches and home indicators

**Files:**
- `src/app/globals.css` — `100dvh` with `vh` fallback
- `src/components/mobile/MobileFABs.tsx` — `env(safe-area-inset-top)`
- `src/components/layout/AppFooter.tsx` — `env(safe-area-inset-bottom)`

## Draft Persistence

**Hook:** `useDraftPersistence` (`src/hooks/useDraftPersistence.ts`)

- Per-thread draft storage in localStorage
- 300ms debounce to avoid excessive writes
- Automatically restored when thread is loaded
- Cleared after message is sent

## Swipe Gestures

**Hook:** `useSwipeGesture` (`src/hooks/useSwipeGesture.ts`)

**Options:**
- `onSwipeLeft` / `onSwipeRight` — callbacks
- `rightEdgeOnly` — restrict to right edge (default: false)
- `disabled` — disable gestures when true

**Usage in chat/page.tsx:**
```typescript
useSwipeGesture({
  onSwipeLeft: () => mobileMenu?.openArtifactsMenu(),
  onSwipeRight: () => mobileMenu?.openThreadsMenu(),
  disabled: (mobileMenu?.isThreadsMenuOpen || mobileMenu?.isArtifactsMenuOpen) || !isMobile,
});
```

## Category Selection

**Component:** `CategoryChip` (`src/components/chat/CategoryChip.tsx`)

**Behavior:**
- Shows dropdown of user's subscribed categories
- Disabled when thread is active (read-only badge showing thread's category)
- Always blank on new chat (user selects before sending first message)
- Persists selection across draft edits

## Attachment Management

**Component:** `AttachmentChipsRow` (`src/components/chat/AttachmentChipsRow.tsx`)

**Features:**
- Displays file uploads and URL sources as removable chips
- Icons: 📄 for files, 🌐 for web URLs, 📺 for YouTube
- Pending uploads shown with loading state
- Remove button on each chip

## Testing Checklist

### Mobile Portrait (< 640px)
- [ ] COMPACT state: single-row bar, no chips visible
- [ ] Type text → transitions to EXPANDED
- [ ] Add attachment → stays EXPANDED
- [ ] Focus textarea → stays EXPANDED
- [ ] Blur + clear text → back to COMPACT
- [ ] Type 4+ lines → transitions to FOCUSED-WRITE
- [ ] Keyboard appears without hiding input
- [ ] Swipe left → opens artifacts menu
- [ ] Swipe right → opens threads menu

### Mobile Landscape (640px - 1024px)
- [ ] EXPANDED state by default
- [ ] Chips visible and functional
- [ ] Textarea grows to 4 lines max
- [ ] Swipe gestures work

### Desktop (≥ 1024px)
- [ ] EXPANDED state always
- [ ] Chips always visible
- [ ] Textarea grows to 6 lines max
- [ ] Mode chips visible in PlusMenu (future: inline on desktop)
- [ ] Keyboard shortcuts work (Cmd/Ctrl+K focus, Esc blur, Cmd/Ctrl+Enter send)

## Phase 3 Implementation (Completed)

### 1. Inline Mode Chips (Desktop) ✅
**File:** `src/components/chat/InlineModeChips.tsx` (new)

- Renders Mode + WebSearch toggles as compact pills
- On desktop EXPANDED: renders inline above textarea
- On mobile: continues using PlusMenu (no change)
- Supports both horizontal (inline) and vertical (bottom sheet) layouts

### 2. Keyboard Shortcuts ✅
**File:** `src/hooks/useKeyboardShortcuts.ts` (new)

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Focus textarea |
| `Cmd/Ctrl + Enter` | Send message |
| `Esc` | Blur textarea (only when focused) |
| `Cmd/Ctrl + /` | Toggle PlusMenu |

- Disabled on mobile (no physical keyboard expected)
- Ignores shortcuts when other inputs are focused

### 3. Mobile Bottom Sheet (FOCUSED-WRITE) ✅
**File:** `src/components/chat/ChipSheet.tsx` (new)

- Renders when `state === 'focused-write'` on mobile
- Shows collapsed pill: `⋯ N items`
- Tapping pill opens bottom sheet with:
  - Full CategoryChip
  - Full AttachmentChipsRow
  - Mode toggles (vertical layout)
- Swipe-down to close (50px threshold)
- Backdrop click to close
- Safe-area-bottom respected for notches

### 4. Tailwind data-state CSS Variants ✅
**File:** `tailwind.config.ts` (updated)

Added Tailwind plugin to register variants:
```typescript
addVariant('data-state-compact', '&[data-state="compact"]');
addVariant('data-state-expanded', '&[data-state="expanded"]');
addVariant('data-state-focused-write', '&[data-state="focused-write"]');
```

Usage in components:
```tsx
<div className="data-state-compact:hidden">Chips</div>
```

Enables smooth CSS transitions instead of mount/unmount flashes.

### 5. CategoryChip Read-Only Badge ✅
**File:** `src/components/chat/CategoryChip.tsx` (updated)

- New prop `readOnly?: boolean`
- When `readOnly=true`: renders as static badge with "Active" label
- No chevron, no X button (non-interactive)
- Shows category name + "Active" badge
- Used when thread is active (prevents accidental category changes)

## Future Enhancements

1. **Gesture Customization:** Allow users to configure swipe actions
2. **Voice Input Indicator:** Visual feedback during voice recording
3. **Inline Language/Tone Selectors:** Promote to desktop inline (currently in PlusMenu)
4. **Collapsed Chip Animations:** Smooth transitions when collapsing/expanding chips
5. **Keyboard Shortcut Customization:** Allow users to rebind shortcuts
REPLACE


## Files Modified

### Phase 2 Files
- `src/components/chat/MessageInput.tsx` — Added chip slots, integrated useInputState
- `src/components/chat/ChatWindow.tsx` — Render and pass chip components
- `src/app/chat/page.tsx` — Wire useSwipeGesture
- `src/hooks/useInputState.ts` — NEW: Adaptive state logic

### Phase 3 Files
- `src/components/chat/InlineModeChips.tsx` — NEW: Mode + WebSearch toggles (horizontal/vertical)
- `src/hooks/useKeyboardShortcuts.ts` — NEW: Cmd/Ctrl+K, Esc, Cmd/Ctrl+Enter, Cmd/Ctrl+/
- `src/components/chat/MessageInput.tsx` — Integrated keyboard shortcuts, inline mode chips
- `src/components/chat/CategoryChip.tsx` — Added readOnly prop + "Active" badge
- `tailwind.config.ts` — Added data-state Tailwind variants plugin
- `docs/features/CHAT_INPUT_ADAPTIVE.md` — This file (Phase 2 & 3 docs)

### Phase 4-A Stabilization (Risk Fixes)
- `src/components/chat/AttachmentChipsRow.tsx` — Removed wrapper div (Risk #1)
- `src/components/chat/CategoryChip.tsx` — Removed wrapper div, inline hint (Risk #1)
- `src/hooks/useDraftPersistence.ts` — Fixed re-restore loop with restoredForThread ref (Risk #4)
- `src/components/chat/MessageInput.tsx` — Memoized keyboard shortcut callbacks (Risk #2)
- `src/hooks/useKeyboardShortcuts.ts` — Widened ref type to include null (Risk #3)

## Build Status

✅ **TypeScript:** No errors (`npx tsc --noEmit`)
✅ **ESLint:** No warnings (`npm run lint`)
✅ **All tests passing**

---

**Last Updated:** 2026-05-09
**Phase:** 2 & 3 (Adaptive Input Bar + Enhancements)
**Status:** ✅ Complete
