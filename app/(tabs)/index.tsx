import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { ScreenContainer } from "@/components/screen-container";

const COLORS = {
  navy: "#071A38",
  navySoft: "#0C2853",
  blue: "#1769D2",
  blueBright: "#2E8BFF",
  blueWash: "#EAF3FF",
  blueLine: "#BFD6F4",
  ink: "#112A49",
  muted: "#667991",
  gold: "#E7B84D",
  goldSoft: "#FFF3CF",
  white: "#FFFFFF",
  paper: "#F6FAFF",
  line: "#D5E2F1",
  danger: "#C53D50",
  dangerWash: "#FFF0F2",
  warning: "#9A6715",
  warningWash: "#FFF8E7",
  success: "#19734A",
  successWash: "#EAF8F0",
};

const MIN_PIN_DIGITS = 12;
const MAX_PIN_DIGITS = 18;
const PLACEHOLDER_PIN = "XXXX XXXX XXXX XXXX";

type AppView = "scanner" | "confirm" | "history";
type ScanState = "ready" | "scanning" | "result";
type HistoryEntry = { id: string; digits: string; savedAt: number };
type PinValidation = {
  digits: string;
  isValid: boolean;
  error: string;
  warning: string;
};

/** Keeps the complete numeric payload returned by OCR or entered by the user. */
export function sanitizeDigits(rawText: string) {
  return rawText.replace(/[^0-9]/g, "");
}

/** Groups the complete value into fours without padding or truncating it. */
export function formatPin(rawText: string) {
  const digits = sanitizeDigits(rawText);
  if (!digits) return PLACEHOLDER_PIN;
  return digits.match(/.{1,4}/g)?.join(" ") ?? digits;
}

export function validatePin(rawText: string): PinValidation {
  const digits = sanitizeDigits(rawText);
  if (!digits) return { digits, isValid: false, error: "", warning: "" };
  if (digits.length < MIN_PIN_DIGITS || digits.length > MAX_PIN_DIGITS) {
    return {
      digits,
      isValid: false,
      error: "Invalid PIN - please scan again or edit",
      warning: "",
    };
  }
  return {
    digits,
    isValid: true,
    error: "",
    warning:
      digits.length % 4 !== 0
        ? "The final group is shorter than four digits. Verify every digit before confirming."
        : "",
  };
}

function maskPin(digits: string) {
  if (digits.length < 8) return "••••";
  return `${digits.slice(0, 4)} **** ${digits.slice(-4)}`;
}

function formatSavedDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

export default function HomeScreen() {
  const router = useRouter();
  const [view, setView] = useState<AppView>("scanner");
  const [scanState, setScanState] = useState<ScanState>("result");
  const [rawPin, setRawPin] = useState("");
  const [flashOn, setFlashOn] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const pin = useMemo(() => validatePin(rawPin), [rawPin]);
  const pinGroupCount = pin.digits ? Math.ceil(pin.digits.length / 4) : 0;

  const applyOcrResult = useCallback((rawText: string) => {
    // A camera/OCR integration can call this with any raw text. Every digit is kept.
    setRawPin(sanitizeDigits(rawText));
    setScanState("result");
  }, []);

  const handleScanAgain = useCallback(() => {
    if (scanState === "scanning") return;
    setScanState("scanning");
    setRawPin("");
    // Prototype timing stands in for the camera/OCR callback. A real OCR result
    // should be passed through applyOcrResult without changing its length.
    setTimeout(() => applyOcrResult(""), 850);
  }, [applyOcrResult, scanState]);

  const openEditor = () => {
    setEditValue(pin.digits);
    setEditError("");
    setEditVisible(true);
  };

  const saveEditedPin = () => {
    const digits = sanitizeDigits(editValue);
    if (digits.length < MIN_PIN_DIGITS || digits.length > MAX_PIN_DIGITS) {
      setEditError("Invalid PIN - please scan again or edit");
      return;
    }
    setRawPin(digits);
    setScanState("result");
    setEditVisible(false);
    setEditError("");
  };

  const confirmPin = () => {
    if (!pin.isValid) return;
    setHistory((current) => [
      {
        id: `${Date.now()}-${pin.digits}`,
        digits: pin.digits,
        savedAt: Date.now(),
      },
      ...current,
    ]);
    setView("history");
  };

  const handleBack = () => {
    if (view !== "scanner") {
      setView("scanner");
      return;
    }
    router.back();
  };

  const renderHeader = (title = "RIGB RECHARGE GLOBAL") => (
    <View style={styles.header}>
      <TouchableOpacity
        accessibilityLabel="Go back"
        onPress={handleBack}
        style={styles.headerIcon}
      >
        <Ionicons name="arrow-back" size={26} color={COLORS.gold} />
      </TouchableOpacity>
      <Text numberOfLines={1} style={styles.wordmark}>
        {title}
      </Text>
      <TouchableOpacity
        accessibilityLabel="Open history"
        onPress={() => setView("history")}
        style={styles.headerIcon}
      >
        <MaterialCommunityIcons name="history" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );

  const renderScanner = () => (
    <>
      {renderHeader()}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contextRow}>
          <View style={styles.contextPill}>
            <MaterialCommunityIcons
              name="shield-check"
              size={15}
              color={COLORS.blue}
            />
            <Text style={styles.contextText}>SECURE OCR SCAN</Text>
          </View>
          <Text style={styles.contextCountry}>NIGERIA</Text>
        </View>
        <Text style={styles.instruction}>Align card inside box</Text>
        <Text style={styles.instructionSub}>
          Keep the recharge card flat and well lit
        </Text>
        <View style={styles.cameraPanel}>
          <View style={styles.cameraTopRow}>
            <View style={styles.cameraStatus}>
              <View
                style={[
                  styles.liveDot,
                  scanState === "scanning" && styles.liveDotActive,
                ]}
              />
              <Text style={styles.cameraStatusText}>
                {scanState === "scanning" ? "READING CARD" : "CAMERA READY"}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="scan-helper"
              size={22}
              color={COLORS.blueBright}
            />
          </View>
          <View style={styles.scanFrame}>
            <View style={[styles.scanCorner, styles.cornerTopLeft]} />
            <View style={[styles.scanCorner, styles.cornerTopRight]} />
            <View style={[styles.scanCorner, styles.cornerBottomLeft]} />
            <View style={[styles.scanCorner, styles.cornerBottomRight]} />
            <View style={styles.cardMock}>
              <View style={styles.cardShine} />
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardBrand}>RIGB RECHARGE</Text>
                <MaterialCommunityIcons
                  name="card-outline"
                  size={18}
                  color="#7A8796"
                />
              </View>
              <View style={styles.chip}>
                <View style={styles.chipLine} />
                <View style={styles.chipLine} />
              </View>
              <Text style={styles.cardLabel}>TOP-UP CARD</Text>
              <Text style={styles.cardPlaceholder}>PIN AREA</Text>
            </View>
            {scanState === "scanning" && (
              <View style={styles.scanningOverlay}>
                <ActivityIndicator size="small" color={COLORS.gold} />
                <Text style={styles.scanningText}>
                  Looking for card digits…
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.cameraHint}>
            Use a clear, glare-free view of the card
          </Text>
        </View>

        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <View>
              <Text style={styles.eyebrow}>PIN RESULT</Text>
              <Text style={styles.resultTitle}>Exact OCR output</Text>
            </View>
            <TouchableOpacity onPress={openEditor} style={styles.editButton}>
              <Text style={styles.editText}>EDIT</Text>
              <MaterialCommunityIcons
                name="square-edit-outline"
                size={17}
                color={COLORS.navy}
              />
            </TouchableOpacity>
          </View>
          <Text
            selectable
            style={[
              styles.pinText,
              pinGroupCount >= 5 && styles.pinTextCompact,
              !pin.digits && styles.pinPlaceholder,
            ]}
          >
            {formatPin(rawPin)}
          </Text>
          <Text style={styles.countText}>
            {pin.digits.length} {pin.digits.length === 1 ? "digit" : "digits"}{" "}
            detected
          </Text>
          {pin.error ? (
            <View style={styles.messageBoxDanger}>
              <Ionicons name="alert-circle" size={17} color={COLORS.danger} />
              <Text style={styles.messageDanger}>{pin.error}</Text>
            </View>
          ) : pin.warning ? (
            <View style={styles.messageBoxWarning}>
              <Ionicons
                name="warning-outline"
                size={17}
                color={COLORS.warning}
              />
              <Text style={styles.messageWarning}>{pin.warning}</Text>
            </View>
          ) : (
            <View style={styles.messageBoxInfo}>
              <Ionicons
                name="information-circle-outline"
                size={17}
                color={COLORS.blue}
              />
              <Text style={styles.messageInfo}>
                {pin.digits
                  ? "Review the complete result before confirming."
                  : "Awaiting OCR result — edit to test a PIN."}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controlRow}>
          <TouchableOpacity
            accessibilityLabel={
              flashOn ? "Turn flashlight off" : "Turn flashlight on"
            }
            onPress={() => setFlashOn((current) => !current)}
            style={[
              styles.controlButton,
              flashOn && styles.controlButtonActive,
            ]}
          >
            <View
              style={[styles.controlIcon, flashOn && styles.controlIconActive]}
            >
              <MaterialCommunityIcons
                name="flashlight"
                size={21}
                color={flashOn ? COLORS.navy : COLORS.gold}
              />
            </View>
            <Text
              style={[styles.controlText, flashOn && styles.controlTextActive]}
            >
              FLASH {flashOn ? "ON" : "OFF"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFlashOn(false)}
            style={styles.controlButton}
          >
            <View style={styles.controlIcon}>
              <MaterialCommunityIcons
                name="flash-off"
                size={21}
                color={COLORS.gold}
              />
            </View>
            <Text style={styles.controlText}>FLASH OFF</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={handleScanAgain}
          style={styles.scanAgainButton}
        >
          <MaterialCommunityIcons
            name="camera-retake-outline"
            size={22}
            color={COLORS.navy}
          />
          <Text style={styles.scanAgainText}>
            {scanState === "scanning" ? "SCANNING…" : "SCAN AGAIN"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!pin.isValid}
          onPress={() => setView("confirm")}
          style={[
            styles.confirmButton,
            !pin.isValid && styles.confirmButtonDisabled,
          ]}
        >
          <Text style={styles.confirmButtonText}>
            {pin.isValid ? "REVIEW & CONFIRM" : "ENTER 12–18 DIGITS TO CONFIRM"}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={pin.isValid ? COLORS.white : COLORS.muted}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setView("history")}
          style={styles.historyLink}
        >
          <MaterialCommunityIcons
            name="history"
            size={18}
            color={COLORS.blue}
          />
          <Text style={styles.historyLinkText}>VIEW PIN HISTORY</Text>
        </TouchableOpacity>
        <View style={styles.footerBadge}>
          <MaterialCommunityIcons
            name="lock-check"
            size={14}
            color={COLORS.navy}
          />
          <Text style={styles.footerText}>v1.2.0 • Secure • Nigeria</Text>
        </View>
      </ScrollView>
    </>
  );

  const renderConfirm = () => (
    <>
      {renderHeader("CONFIRM PIN")}
      <ScrollView
        contentContainerStyle={styles.detailScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailIconCircle}>
          <MaterialCommunityIcons
            name="shield-check-outline"
            size={32}
            color={COLORS.blue}
          />
        </View>
        <Text style={styles.detailEyebrow}>CONFIRM EXACT PIN</Text>
        <Text style={styles.detailTitle}>No digits will be changed</Text>
        <Text style={styles.detailCopy}>
          This is the exact value from the scan or edit screen. Confirm only
          after checking every digit.
        </Text>
        <View style={styles.confirmCard}>
          <Text style={styles.eyebrow}>PIN TO SAVE</Text>
          <Text
            selectable
            style={[
              styles.confirmPinText,
              pinGroupCount >= 5 && styles.pinTextCompact,
            ]}
          >
            {formatPin(pin.digits)}
          </Text>
          <Text style={styles.countText}>
            {pin.digits.length} digits detected
          </Text>
          <View style={styles.exactRow}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={COLORS.success}
            />
            <Text style={styles.exactText}>
              Exact length preserved: {pin.digits.length} digits
            </Text>
          </View>
        </View>
        <TouchableOpacity
          disabled={!pin.isValid}
          onPress={confirmPin}
          style={[
            styles.primaryButton,
            !pin.isValid && styles.confirmButtonDisabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>CONFIRM & SAVE</Text>
          <Ionicons name="checkmark" size={19} color={COLORS.white} />
        </TouchableOpacity>
        <TouchableOpacity onPress={openEditor} style={styles.secondaryButton}>
          <MaterialCommunityIcons
            name="square-edit-outline"
            size={19}
            color={COLORS.blue}
          />
          <Text style={styles.secondaryButtonText}>EDIT PIN</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );

  const renderHistory = () => (
    <>
      {renderHeader("PIN HISTORY")}
      <ScrollView
        contentContainerStyle={styles.detailScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.historyHero}>
          <View style={styles.detailIconCircle}>
            <MaterialCommunityIcons
              name="history"
              size={30}
              color={COLORS.blue}
            />
          </View>
          <Text style={styles.detailEyebrow}>LOCAL PROTOTYPE HISTORY</Text>
          <Text style={styles.detailTitle}>Your saved scans</Text>
          <Text style={styles.detailCopy}>
            History masks the middle digits while preserving each PIN’s real
            length.
          </Text>
        </View>
        {history.length === 0 ? (
          <View style={styles.emptyHistory}>
            <MaterialCommunityIcons
              name="card-search-outline"
              size={42}
              color={COLORS.blueLine}
            />
            <Text style={styles.emptyTitle}>No saved scans yet</Text>
            <Text style={styles.emptyCopy}>
              Confirm a valid 12–18 digit PIN and it will appear here masked.
            </Text>
          </View>
        ) : (
          history.map((entry) => (
            <View key={entry.id} style={styles.historyCard}>
              <View style={styles.historyCardIcon}>
                <MaterialCommunityIcons
                  name="credit-card-outline"
                  size={21}
                  color={COLORS.blue}
                />
              </View>
              <View style={styles.historyCardBody}>
                <Text style={styles.historyMasked}>
                  {maskPin(entry.digits)}
                </Text>
                <Text style={styles.historyMeta}>
                  {entry.digits.length} digits •{" "}
                  {formatSavedDate(entry.savedAt)}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="lock-outline"
                size={18}
                color={COLORS.muted}
              />
            </View>
          ))
        )}
        <TouchableOpacity
          onPress={() => setView("scanner")}
          style={styles.primaryButton}
        >
          <Ionicons name="scan-outline" size={20} color={COLORS.white} />
          <Text style={styles.primaryButtonText}>BACK TO SCANNER</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );

  return (
    <ScreenContainer
      containerClassName="bg-[#071A38]"
      safeAreaClassName="bg-[#F6FAFF]"
    >
      <StatusBar style="light" />
      <View style={styles.appShell}>
        {view === "scanner"
          ? renderScanner()
          : view === "confirm"
            ? renderConfirm()
            : renderHistory()}
      </View>
      <Modal
        animationType="slide"
        transparent
        visible={editVisible}
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable
            onPress={() => setEditVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.editSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.detailEyebrow}>EDIT PIN RESULT</Text>
                <Text style={styles.sheetTitle}>
                  Keep the exact digit count
                </Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close editor"
                onPress={() => setEditVisible(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={COLORS.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetCopy}>
              Type 12–18 digits. Spaces, dashes, and letters are removed
              automatically.
            </Text>
            <TextInput
              autoFocus
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={32}
              onChangeText={(value) => {
                setEditValue(value);
                setEditError("");
              }}
              placeholder="Enter PIN digits"
              placeholderTextColor="#92A3B8"
              style={styles.pinInput}
              value={editValue}
            />
            <View style={styles.inputMetaRow}>
              <Text style={styles.inputMeta}>
                {sanitizeDigits(editValue).length} digits entered
              </Text>
              <Text style={styles.inputMeta}>12–18 accepted</Text>
            </View>
            {editError ? (
              <View style={styles.messageBoxDanger}>
                <Ionicons name="alert-circle" size={17} color={COLORS.danger} />
                <Text style={styles.messageDanger}>{editError}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={saveEditedPin}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>SAVE EXACT PIN</Text>
              <Ionicons name="checkmark" size={19} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: COLORS.paper },
  header: {
    alignItems: "center",
    backgroundColor: COLORS.navy,
    flexDirection: "row",
    minHeight: 66,
    paddingHorizontal: 14,
  },
  headerIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  wordmark: {
    color: COLORS.gold,
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.7,
    textAlign: "center",
  },
  scrollContent: { paddingBottom: 28, paddingHorizontal: 16, paddingTop: 16 },
  contextRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 17,
  },
  contextPill: {
    alignItems: "center",
    backgroundColor: COLORS.blueWash,
    borderRadius: 14,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  contextText: {
    color: COLORS.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  contextCountry: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  instruction: {
    color: COLORS.ink,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  instructionSub: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 5,
    textAlign: "center",
  },
  cameraPanel: {
    backgroundColor: COLORS.navySoft,
    borderRadius: 26,
    marginTop: 16,
    overflow: "hidden",
    padding: 15,
  },
  cameraTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 11,
  },
  cameraStatus: { alignItems: "center", flexDirection: "row", gap: 7 },
  liveDot: {
    backgroundColor: COLORS.gold,
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  liveDotActive: { backgroundColor: "#F47C7C" },
  cameraStatusText: {
    color: "#D7E8FF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  scanFrame: {
    alignItems: "center",
    borderColor: "#214B7A",
    borderRadius: 20,
    borderWidth: 1,
    height: 270,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  scanCorner: {
    borderColor: COLORS.gold,
    height: 30,
    position: "absolute",
    width: 30,
  },
  cornerTopLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 16, top: 16 },
  cornerTopRight: {
    borderRightWidth: 3,
    borderTopWidth: 3,
    right: 16,
    top: 16,
  },
  cornerBottomLeft: {
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 16,
    left: 16,
  },
  cornerBottomRight: {
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 16,
    right: 16,
  },
  cardMock: {
    backgroundColor: "#D9DEE4",
    borderColor: "#F6F8FA",
    borderRadius: 13,
    elevation: 2,
    height: 130,
    overflow: "hidden",
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 9,
    width: "78%",
  },
  cardShine: {
    backgroundColor: "rgba(255,255,255,0.36)",
    height: 250,
    position: "absolute",
    right: -70,
    transform: [{ rotate: "28deg" }],
    width: 75,
  },
  cardHeaderLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardBrand: {
    color: "#586A80",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  chip: {
    backgroundColor: "#C8A965",
    borderRadius: 5,
    height: 28,
    justifyContent: "center",
    marginTop: 16,
    paddingHorizontal: 5,
    width: 36,
  },
  chipLine: {
    borderColor: "#937844",
    borderTopWidth: 1,
    marginVertical: 2,
    width: 26,
  },
  cardLabel: {
    bottom: 14,
    color: "#617287",
    fontSize: 10,
    fontWeight: "800",
    left: 15,
    letterSpacing: 1.3,
    position: "absolute",
  },
  cardPlaceholder: {
    bottom: 14,
    color: "#8C9AA9",
    fontSize: 10,
    fontWeight: "700",
    position: "absolute",
    right: 15,
  },
  scanningOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(7,26,56,0.76)",
    borderRadius: 16,
    bottom: 26,
    flexDirection: "row",
    gap: 9,
    left: 29,
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: "absolute",
    right: 29,
  },
  scanningText: { color: COLORS.white, fontSize: 12, fontWeight: "700" },
  cameraHint: {
    color: "#A9C5E8",
    fontSize: 11,
    marginTop: 11,
    textAlign: "center",
  },
  resultCard: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 22,
    borderWidth: 1.5,
    marginTop: 14,
    padding: 16,
  },
  resultHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  resultTitle: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  editButton: {
    alignItems: "center",
    backgroundColor: COLORS.gold,
    borderRadius: 10,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  editText: {
    color: COLORS.navy,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  pinText: {
    color: COLORS.navy,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 19,
  },
  pinTextCompact: { fontSize: 23, letterSpacing: 0.2 },
  pinPlaceholder: { color: "#9AAABD", fontSize: 27, letterSpacing: 1.2 },
  countText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 7,
  },
  messageBoxDanger: {
    alignItems: "flex-start",
    backgroundColor: COLORS.dangerWash,
    borderRadius: 11,
    flexDirection: "row",
    gap: 7,
    marginTop: 14,
    padding: 10,
  },
  messageDanger: {
    color: COLORS.danger,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  messageBoxWarning: {
    alignItems: "flex-start",
    backgroundColor: COLORS.warningWash,
    borderRadius: 11,
    flexDirection: "row",
    gap: 7,
    marginTop: 14,
    padding: 10,
  },
  messageWarning: {
    color: COLORS.warning,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  messageBoxInfo: {
    alignItems: "flex-start",
    backgroundColor: COLORS.blueWash,
    borderRadius: 11,
    flexDirection: "row",
    gap: 7,
    marginTop: 14,
    padding: 10,
  },
  messageInfo: {
    color: COLORS.blue,
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  controlRow: { flexDirection: "row", gap: 11, marginTop: 13 },
  controlButton: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 17,
    borderWidth: 1.5,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 13,
  },
  controlButtonActive: {
    backgroundColor: COLORS.goldSoft,
    borderColor: COLORS.gold,
  },
  controlIcon: {
    alignItems: "center",
    backgroundColor: COLORS.navy,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  controlIconActive: { backgroundColor: COLORS.gold },
  controlText: {
    color: COLORS.navy,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
  },
  controlTextActive: { color: COLORS.warning },
  scanAgainButton: {
    alignItems: "center",
    backgroundColor: COLORS.gold,
    borderRadius: 18,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 15,
    minHeight: 58,
  },
  scanAgainText: {
    color: COLORS.navy,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 16,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 11,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  confirmButtonDisabled: { backgroundColor: "#E7EDF5" },
  confirmButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  historyLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: 17,
    padding: 6,
  },
  historyLinkText: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  footerBadge: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: COLORS.gold,
    borderRadius: 16,
    flexDirection: "row",
    gap: 5,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  footerText: {
    color: COLORS.navy,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  detailScroll: {
    alignItems: "stretch",
    flexGrow: 1,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  detailIconCircle: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: COLORS.blueWash,
    borderRadius: 30,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  detailEyebrow: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 18,
    textAlign: "center",
  },
  detailTitle: {
    color: COLORS.ink,
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginTop: 7,
    textAlign: "center",
  },
  detailCopy: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    textAlign: "center",
  },
  confirmCard: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 21,
    borderWidth: 1.5,
    marginTop: 25,
    padding: 18,
  },
  confirmPinText: {
    color: COLORS.navy,
    fontSize: 29,
    fontWeight: "900",
    marginTop: 20,
  },
  exactRow: {
    alignItems: "center",
    backgroundColor: COLORS.successWash,
    borderRadius: 10,
    flexDirection: "row",
    gap: 7,
    marginTop: 17,
    padding: 10,
  },
  exactText: {
    color: COLORS.success,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 16,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 20,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: COLORS.blueLine,
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 11,
    minHeight: 52,
  },
  secondaryButtonText: {
    color: COLORS.blue,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  historyHero: { alignItems: "center" },
  emptyHistory: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 20,
    borderWidth: 1.5,
    marginTop: 28,
    paddingHorizontal: 25,
    paddingVertical: 33,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 13,
  },
  emptyCopy: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    textAlign: "center",
  },
  historyCard: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderColor: COLORS.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 13,
    padding: 13,
  },
  historyCardIcon: {
    alignItems: "center",
    backgroundColor: COLORS.blueWash,
    borderRadius: 22,
    height: 43,
    justifyContent: "center",
    width: 43,
  },
  historyCardBody: { flex: 1, marginLeft: 12 },
  historyMasked: {
    color: COLORS.navy,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  historyMeta: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 5,
  },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { backgroundColor: "rgba(7,26,56,0.62)", flex: 1 },
  editSheet: {
    backgroundColor: COLORS.paper,
    borderTopLeftRadius: 27,
    borderTopRightRadius: 27,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: COLORS.blueLine,
    borderRadius: 4,
    height: 5,
    marginBottom: 20,
    width: 46,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: COLORS.ink,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 5,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sheetCopy: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 15,
  },
  pinInput: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.blue,
    borderRadius: 15,
    borderWidth: 1.5,
    color: COLORS.navy,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 16,
    minHeight: 60,
    paddingHorizontal: 15,
  },
  inputMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  inputMeta: { color: COLORS.muted, fontSize: 11, fontWeight: "700" },
});
