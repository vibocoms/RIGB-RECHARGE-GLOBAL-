# RIGB Recharge Global — delivery outcomes

- [x] **Reference-aligned blue recharge scanner:** Deliver a portrait-first RIGB RECHARGE GLOBAL screen with a top app bar, back navigation, wordmark, scan guidance, camera/card alignment area, flashlight controls, prominent Scan Again action, and secure Nigeria footer treatment.
  - The app uses the user-selected blue-first visual direction with gold accents and retains the reference composition without copying numeric PIN data from the image.
  - The scan area uses a real Expo Camera live preview, not a static card image.
  - Camera permission is requested on open; denied permission shows `Camera permission needed` and an `OPEN SETTINGS` action.
  - The card artwork and all empty states use placeholder-only PIN content such as `XXXX XXXX XXXX XXXX`.
  - Scan Again captures a real camera photo, runs on-device ML Kit OCR, and returns a result without inventing or truncating a PIN.

- [x] **Recharge PIN-only OCR selection:** Extract only likely recharge PIN groups from the OCR result.
  - Prefer blocks labeled PIN, Recharge PIN, Recharge Code, Code, or Scratch.
  - Accept only 12–18 digit candidates after removing spaces, dashes, and letters.
  - Ignore shorter serial/batch/phone/price/expiry numbers; when multiple valid candidates are found, show all options in PIN RESULT and require a tap to choose.

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

- [x] **Per-network USSD configuration and offline fallback:** Store MTN, Airtel, Glo, and 9mobile codes separately with each network’s own `last_updated` date.
  - Fetch the online JSON at app start when available, save each network independently to local storage, and use that network’s saved value while offline.
  - If a network has never been fetched and the device is offline, use the fallback `*311*{PIN}#` only for that network.
  - Before dialing, check only the selected SIM’s network; if offline and its code is more than 7 days old, show the network-specific outdated-code prompt with `Connect & Update` and `Dial Anyway Offline`.
  - Connect & Update fetches only the selected network’s value, saves it, shows `{NETWORK} Code Updated`, and auto-dials; failed updates offer `Yes Dial` or `Cancel`.

- [x] **USSD Codes settings:** Add Settings > USSD Codes with all four networks, current code, last-updated date, `Check For Update`, and `Edit Manually`.
  - Manual edits work offline, require `{PIN}`, and are saved locally for that network without an APK rebuild.

- [x] **Android multi-SIM auto-dial:** Add a large DIAL TO RECHARGE action under PIN RESULT, disabled unless the PIN is 12–18 digits.
  - Request `CALL_PHONE` and `READ_PHONE_STATE`; identify one active SIM automatically or show SIM 1–3 with carrier and number.
  - Use Android TelecomManager/PhoneAccountHandle to place the USSD call through the selected SIM, encode `#` as `%23`, and save the exact PIN to masked history after dialing.

- [x] **Build handoff:** Run TypeScript checks, keep the mobile runtime configuration intact, save a Manus checkpoint, and request the managed Android APK build. Mark complete only after an actual APK artifact link is returned.
  - Corrected GitHub Actions run `44425410386` completed successfully and produced signed APK/AAB artifacts.
