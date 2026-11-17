# RIGB Recharge Global — delivery outcomes

- [x] **Reference-aligned blue recharge scanner:** Deliver a portrait-first RIGB RECHARGE GLOBAL screen with a top app bar, back navigation, wordmark, scan guidance, camera/card alignment area, flashlight controls, prominent Scan Again action, and secure Nigeria footer treatment.
  - The app uses the user-selected blue-first visual direction with gold accents and retains the reference composition without copying numeric PIN data from the image.
  - The card artwork and all empty states use placeholder-only PIN content such as `XXXX XXXX XXXX XXXX`.
  - Scan Again has a visible scanning state and returns to a completed result state without inventing or truncating a PIN.

- [x] **Dynamic OCR PIN normalization and display:** Make the PIN result panel display the complete digit string returned by OCR or edit input.
  - Remove spaces, dashes, and letters before display.
  - Group the complete result into groups of four for readability.
  - Preserve 12, 15, 16, 17, or 18 digits exactly; never cut off or pad to force 16 digits.
  - Show the exact count under the formatted PIN, such as `15 digits detected` or `16 digits detected`.

- [x] **Length validation and incomplete warning:** Accept 12–18 digits as valid regardless of whether the value has 16 digits.
  - Values below 12 or above 18 show `Invalid PIN - please scan again or edit`.
  - Values that look shorter than common cards may show a warning, but a warning must not reject a valid 12–18 digit PIN.
  - Edit input accepts any length and does not use a fixed 16-digit limit.

- [x] **Exact confirm flow:** Provide a Confirm screen that uses the exact scanned or edited raw digit string and its real length.
  - Do not add, remove, pad, or truncate digits between the result and Confirm screen.
  - Confirm is available only for a valid 12–18 digit value and clearly identifies the exact digit count.

- [x] **Masked history:** Save confirmed prototype entries with the real-length PIN preserved internally.
  - Display history as first four digits + `****` + last four digits and show the saved digit count.
  - Never display the full saved PIN in History.

- [ ] **Build handoff:** Run TypeScript checks, keep the mobile runtime configuration intact, save a Manus checkpoint, and request the managed Android APK build. Mark complete only after an actual APK artifact link is returned.
