# RIGB Recharge Global — implementation plan

## Scope

Build the managed Expo mobile prototype for RIGB RECHARGE GLOBAL from the supplied phone UI reference. The app is a portrait-first recharge-card scanning flow with a blue-first brand treatment, secure Nigeria footer language, simulated scan states, dynamic OCR PIN handling, edit/confirm flow, and local in-memory history for the prototype.

## Design

- **Design movement:** Fintech utility with restrained neo-corporate blue surfaces, generous rounded cards, and a warm gold action accent.
- **Core principles:** One-handed clarity; information hierarchy before decoration; trust cues without claiming a live redemption; every PIN state exposes its exact digit count.
- **Color philosophy:** Deep navy communicates security and stability, saturated blue provides scanning focus, pale blue-white surfaces keep long PIN strings legible, and gold is reserved for the highest-intent actions.
- **Layout paradigm:** A vertically staged scanner: identity and status at the top, camera alignment zone in the middle, then a persistent result rail and primary actions below. Secondary destinations remain accessible without competing with the scanner.
- **Signature elements:** Dashed gold alignment corners, a metallic card placeholder with no numeric PIN printed on it, and compact blue security badges.
- **Interaction philosophy:** Scan, inspect, edit, confirm, and review are explicit states. No action silently changes or truncates a PIN. Invalid values explain exactly what to do next.
- **Animation:** A short scan pulse and progress state on Scan Again; subtle press opacity only on controls; modal edit screen appears without hiding the current value.
- **Typography system:** Strong compact uppercase labels for scanner metadata, large high-contrast PIN text for result readability, and calm sentence case for guidance and errors. Use the system sans stack for platform consistency.
- **Brand essence:** A confident, transparent recharge-card helper for Nigerian users; precise, secure, approachable.
- **Brand voice:** Direct and reassuring. Example lines: “Align card inside box.” and “Check the card, then confirm the exact digits.”
- **Wordmark & logo:** Text wordmark paired with a simple scan-bracket mark; the icon assets carry a blue square field with a gold bracket/bolt motif.
- **Signature brand color:** RIGB Signal Blue `#1769D2`.

## Implementation approach

- Replace the starter home screen with a single stateful recharge flow in `app/(tabs)/index.tsx`.
- Keep PIN processing in pure helper functions: `sanitizeDigits` removes spaces, dashes, and letters; `formatPin` groups the complete digit string into groups of four without padding or truncation; `validatePin` accepts 12–18 digits and returns the exact error state for values outside that range.
- Keep the scanned/edited raw digits as the source of truth. The result panel, confirm screen, and history all derive from that same string, so the real length is preserved end to end.
- Use an edit modal with an unrestricted digit entry field (no 16-digit `maxLength`), a clear invalid-state message, and a confirm action that is disabled only when the current value is outside 12–18 digits.
- Store prototype history in component state. Each saved entry keeps the exact digits internally and renders a masked value using first four + `****` + last four, plus the real digit count.
- Use placeholder-only content when no OCR result is available: `XXXX XXXX XXXX XXXX`. No numeric PIN from the supplied reference is included.
- Keep the app self-contained and offline-friendly; camera/OCR can call the `applyOcrResult(rawText)` path later without changing PIN behavior.

## Project structure

- `app/(tabs)/index.tsx` — scanner, dynamic result panel, edit modal, confirm screen, and history view.
- `app/(tabs)/_layout.tsx` — hides the starter tab bar so the scanner owns the full portrait canvas.
- `app.config.ts` — native app identity, icon references, and project logo metadata.
- `assets/images/*` — blue/gold native launcher and splash artwork.
- `plan.md` / `TODO.md` — approved scope, design decisions, and delivery outcomes.

## Delivery

Run TypeScript diagnostics and project checks, start Metro/API for Preview verification, save the accepted change as a Manus checkpoint, and request the managed Android APK build through the supported mobile build handoff. The APK is only claimed once the platform returns an actual artifact link.
