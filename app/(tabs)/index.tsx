import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  PermissionsAndroid,
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

type AppView = "scanner" | "confirm" | "history" | "settings";
type ScanState = "ready" | "scanning" | "result";
type HistoryEntry = { id: string; digits: string; savedAt: number };
type OcrCandidate = { digits: string; score: number };
type NetworkName = "MTN" | "Airtel" | "Glo" | "9mobile";
type UssdEntry = { code: string; last_updated: string };
type UssdConfig = Record<NetworkName, UssdEntry>;
type SimCard = {
  carrierName: string;
  number: string;
  subscriptionId: number;
  slotIndex: number;
};
type SmartDialog = {
  kind: "stale" | "failed";
  network: NetworkName;
  sim: SimCard;
};
type TelecomApi = {
  getSimCards?: () => Promise<SimCard[]>;
  dialUssd?: (ussd: string, subscriptionId: number) => Promise<boolean>;
};
type PinValidation = {
  digits: string;
  isValid: boolean;
  error: string;
  warning: string;
};
const NETWORKS: NetworkName[] = ["MTN", "Airtel", "Glo", "9mobile"];
const FALLBACK_USSD = "*311*{PIN}#";
const USSD_REMOTE_URL =
  "https://raw.githubusercontent.com/vibocoms/RIGB-RECHARGE-GLOBAL-/main/ussd-codes.json";
const USSD_STORAGE_PREFIX = "rigb.ussd.";
const INITIAL_USSD_CONFIG: UssdConfig = {
  MTN: { code: FALLBACK_USSD, last_updated: "never" },
  Airtel: { code: FALLBACK_USSD, last_updated: "never" },
  Glo: { code: FALLBACK_USSD, last_updated: "never" },
  "9mobile": { code: FALLBACK_USSD, last_updated: "never" },
};
const telecomApi = NativeModules.RigbTelecom as TelecomApi | undefined;

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
function extractDigitGroups(rawText: string) {
  const matches = rawText.match(/\d(?:[\s-]*\d){11,17}/g) ?? [];
  return matches
    .filter((match) => {
      const end = rawText.indexOf(match) + match.length;
      return !/[\d\s-]*\d/.test(rawText.slice(end, end + 2));
    })
    .map(sanitizeDigits)
    .filter(
      (digits) =>
        digits.length >= MIN_PIN_DIGITS && digits.length <= MAX_PIN_DIGITS,
    );
}
export function extractRechargePinCandidates(result: {
  text: string;
  blocks?: { text: string; lines?: { text: string }[] }[];
}): OcrCandidate[] {
  const structuredEntries = (result.blocks ?? []).flatMap((block) => [
    { text: block.text },
    ...(block.lines ?? []).map((line) => ({ text: line.text })),
  ]);
  const entries = structuredEntries.length
    ? structuredEntries
    : [{ text: result.text }];
  const byDigits = new Map<string, number>();
  for (const entry of entries) {
    const hasPinLabel = /pin|recharge|scratch|code/i.test(entry.text);
    const isNonPinNumber =
      /serial|batch|phone|expiry|expires|valid until|price/i.test(entry.text);
    if (isNonPinNumber && !hasPinLabel) continue;
    const labelBoost = hasPinLabel ? 100 : 0;
    for (const digits of extractDigitGroups(entry.text)) {
      byDigits.set(
        digits,
        Math.max(byDigits.get(digits) ?? 0, labelBoost + digits.length),
      );
    }
  }
  return [...byDigits.entries()]
    .map(([digits, score]) => ({ digits, score }))
    .sort((a, b) => b.score - a.score || b.digits.length - a.digits.length);
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
function resolveNetwork(carrierName: string): NetworkName {
  const carrier = carrierName.toLowerCase();
  if (carrier.includes("airtel")) return "Airtel";
  if (carrier.includes("glo")) return "Glo";
  if (carrier.includes("9mobile") || carrier.includes("etisalat")) {
    return "9mobile";
  }
  return "MTN";
}
function isUssdEntry(value: unknown): value is UssdEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<UssdEntry>;
  return (
    typeof entry.code === "string" &&
    entry.code.includes("{PIN}") &&
    typeof entry.last_updated === "string"
  );
}
function parseRemoteUssdConfig(value: unknown): Partial<UssdConfig> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  return NETWORKS.reduce<Partial<UssdConfig>>((config, network) => {
    if (isUssdEntry(source[network])) config[network] = source[network];
    return config;
  }, {});
}
function isUssdStale(entry: UssdEntry) {
  if (entry.last_updated === "never") return true;
  const updated = Date.parse(`${entry.last_updated}T00:00:00Z`);
  return (
    !Number.isFinite(updated) || Date.now() - updated > 7 * 24 * 60 * 60 * 1000
  );
}
function buildUssd(code: string, digits: string) {
  return code.replace("{PIN}", digits);
}
async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Remote config returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
export default function HomeScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [view, setView] = useState<AppView>("scanner");
  const [scanState, setScanState] = useState<ScanState>("result");
  const [rawPin, setRawPin] = useState("");
  const [ocrCandidates, setOcrCandidates] = useState<OcrCandidate[]>([]);
  const [ocrError, setOcrError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [flashOn, setFlashOn] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [ussdConfig, setUssdConfig] = useState<UssdConfig>(INITIAL_USSD_CONFIG);
  const [ussdStatus, setUssdStatus] = useState("");
  const [simPickerVisible, setSimPickerVisible] = useState(false);
  const [simCards, setSimCards] = useState<SimCard[]>([]);
  const [smartDialog, setSmartDialog] = useState<SmartDialog | null>(null);
  const [ussdEditNetwork, setUssdEditNetwork] = useState<NetworkName | null>(
    null,
  );
  const [ussdEditValue, setUssdEditValue] = useState("");
  const [ussdEditError, setUssdEditError] = useState("");
  const pin = useMemo(() => validatePin(rawPin), [rawPin]);
  const pinGroupCount = pin.digits ? Math.ceil(pin.digits.length / 4) : 0;

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);
  const applyOcrCandidates = useCallback((candidates: OcrCandidate[]) => {
    setOcrCandidates(candidates);
    setOcrError("");
    setRawPin(candidates.length === 1 ? candidates[0].digits : "");
    setScanState("result");
  }, []);
  const handleScanAgain = useCallback(async () => {
    if (scanState === "scanning") return;
    if (!permission?.granted) {
      if (permission?.canAskAgain) {
        await requestPermission();
      } else {
        await Linking.openSettings();
      }
      return;
    }
    setScanState("scanning");
    setRawPin("");
    setOcrCandidates([]);
    setOcrError("");
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("No photo captured");
      const result = await TextRecognition.recognize(photo.uri);
      const candidates = extractRechargePinCandidates(result);
      if (candidates.length === 0) {
        setOcrError(
          "No recharge PIN found. Move closer, reduce glare, and scan again.",
        );
        setScanState("result");
        return;
      }
      applyOcrCandidates(candidates);
    } catch (error) {
      console.warn("Recharge card OCR failed", error);
      setOcrError(
        "Could not read this card. Make sure the PIN is visible and scan again.",
      );
      setScanState("result");
    }
  }, [applyOcrCandidates, permission, requestPermission, scanState]);
  const selectOcrCandidate = useCallback((candidate: OcrCandidate) => {
    setRawPin(candidate.digits);
    setOcrCandidates([]);
    setOcrError("");
  }, []);
  const saveUssdEntry = useCallback(
    async (network: NetworkName, entry: UssdEntry) => {
      setUssdConfig((current) => ({ ...current, [network]: entry }));
      await AsyncStorage.setItem(
        `${USSD_STORAGE_PREFIX}${network}`,
        JSON.stringify(entry),
      );
    },
    [],
  );
  const refreshNetwork = useCallback(
    async (network: NetworkName) => {
      const remote = parseRemoteUssdConfig(
        await fetchWithTimeout(USSD_REMOTE_URL),
      );
      const entry = remote[network];
      if (!entry) throw new Error(`No ${network} code in remote config`);
      await saveUssdEntry(network, entry);
      return entry;
    },
    [saveUssdEntry],
  );
  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await AsyncStorage.multiGet(
        NETWORKS.map((network) => `${USSD_STORAGE_PREFIX}${network}`),
      );
      const fromStorage = { ...INITIAL_USSD_CONFIG };
      stored.forEach(([key, value]) => {
        if (!value) return;
        const network = key.replace(USSD_STORAGE_PREFIX, "") as NetworkName;
        try {
          const parsed: unknown = JSON.parse(value);
          if (isUssdEntry(parsed) && NETWORKS.includes(network)) {
            fromStorage[network] = parsed;
          }
        } catch {
          // Ignore malformed local data and keep the safe fallback.
        }
      });
      if (active) setUssdConfig(fromStorage);
      try {
        const remote = parseRemoteUssdConfig(
          await fetchWithTimeout(USSD_REMOTE_URL),
        );
        for (const network of NETWORKS) {
          if (remote[network]) await saveUssdEntry(network, remote[network]);
        }
      } catch {
        // Offline startup intentionally keeps each network's own local value.
      }
    })();
    return () => {
      active = false;
    };
  }, [saveUssdEntry]);
  const recordDialHistory = useCallback((digits: string) => {
    setHistory((current) => [
      { id: `${Date.now()}-${digits}`, digits, savedAt: Date.now() },
      ...current,
    ]);
  }, []);
  const dialWithSim = useCallback(
    async (sim: SimCard, entry: UssdEntry, network: NetworkName) => {
      if (Platform.OS !== "android" || !telecomApi?.dialUssd) {
        setUssdStatus("Automatic SIM dialing is available on Android only.");
        return;
      }
      const permissions = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      ]);
      const allowed =
        permissions[PermissionsAndroid.PERMISSIONS.CALL_PHONE] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        permissions[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] ===
          PermissionsAndroid.RESULTS.GRANTED;
      if (!allowed) {
        setUssdStatus(
          "CALL_PHONE and READ_PHONE_STATE permissions are required to dial.",
        );
        return;
      }
      const ussd = buildUssd(entry.code, pin.digits);
      try {
        await telecomApi.dialUssd(ussd, sim.subscriptionId);
        recordDialHistory(pin.digits);
        setUssdStatus(
          `${network} recharge code sent through ${sim.carrierName}.`,
        );
      } catch {
        setUssdStatus("Could not start the call through the selected SIM.");
      }
    },
    [pin.digits, recordDialHistory],
  );
  const processDialForSim = useCallback(
    async (sim: SimCard) => {
      const network = resolveNetwork(sim.carrierName);
      const cached = ussdConfig[network];
      try {
        const latest = await refreshNetwork(network);
        await dialWithSim(sim, latest, network);
      } catch {
        if (isUssdStale(cached)) {
          setSmartDialog({ kind: "stale", network, sim });
          return;
        }
        await dialWithSim(sim, cached, network);
      }
    },
    [dialWithSim, refreshNetwork, ussdConfig],
  );
  const handleDialPress = useCallback(async () => {
    if (!pin.isValid) return;
    setUssdStatus("");
    if (Platform.OS !== "android" || !telecomApi?.getSimCards) {
      setUssdStatus("SIM dialing is available in the signed Android app.");
      return;
    }
    try {
      const cards = (await telecomApi.getSimCards()).slice(0, 3);
      if (cards.length === 0) {
        setUssdStatus("No active SIM card was found.");
      } else if (cards.length === 1) {
        await processDialForSim(cards[0]);
      } else {
        setSimCards(cards);
        setSimPickerVisible(true);
      }
    } catch {
      setUssdStatus(
        "Allow phone permissions so the app can identify the active SIM.",
      );
    }
  }, [pin.isValid, processDialForSim]);
  const chooseSim = async (sim: SimCard) => {
    setSimPickerVisible(false);
    await processDialForSim(sim);
  };
  const connectAndUpdate = async () => {
    if (!smartDialog) return;
    const { network, sim } = smartDialog;
    setSmartDialog(null);
    try {
      const latest = await refreshNetwork(network);
      setUssdStatus(`${network} Code Updated`);
      await dialWithSim(sim, latest, network);
    } catch {
      setSmartDialog({ kind: "failed", network, sim });
    }
  };
  const dialOfflineAnyway = async () => {
    if (!smartDialog) return;
    const { network, sim } = smartDialog;
    setSmartDialog(null);
    await dialWithSim(sim, ussdConfig[network], network);
  };
  const checkForUpdate = async (network: NetworkName) => {
    setUssdStatus(`Checking ${network} code…`);
    try {
      await refreshNetwork(network);
      setUssdStatus(`${network} Code Updated`);
    } catch {
      setUssdStatus(`Could not update ${network}. Check your connection.`);
    }
  };
  const openUssdEditor = (network: NetworkName) => {
    setUssdEditNetwork(network);
    setUssdEditValue(ussdConfig[network].code);
    setUssdEditError("");
  };
  const saveManualUssd = async () => {
    if (!ussdEditNetwork) return;
    if (!ussdEditValue.includes("{PIN}")) {
      setUssdEditError(
        "Code must include {PIN} exactly where the recharge PIN goes.",
      );
      return;
    }
    await saveUssdEntry(ussdEditNetwork, {
      code: ussdEditValue.trim(),
      last_updated: new Date().toISOString().slice(0, 10),
    });
    setUssdEditNetwork(null);
    setUssdStatus(`${ussdEditNetwork} code saved locally.`);
  };
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
    setOcrCandidates([]);
    setOcrError("");
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
        accessibilityLabel="Open USSD code settings"
        onPress={() => setView("settings")}
        style={styles.headerIcon}
      >
        <Ionicons name="settings-outline" size={24} color={COLORS.white} />
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
            {permission?.granted ? (
              <CameraView
                ref={cameraRef}
                facing="back"
                enableTorch={flashOn}
                onMountError={(event) => setCameraError(event.message)}
                style={styles.cameraPreview}
              />
            ) : (
              <View style={styles.cameraPermissionState}>
                <MaterialCommunityIcons
                  name="camera-off-outline"
                  size={38}
                  color={COLORS.gold}
                />
                <Text style={styles.cameraPermissionTitle}>
                  Camera permission needed
                </Text>
                <Text style={styles.cameraPermissionCopy}>
                  Allow camera access to scan a recharge card with OCR.
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    permission?.canAskAgain
                      ? requestPermission()
                      : Linking.openSettings()
                  }
                  style={styles.permissionButton}
                >
                  <Text style={styles.permissionButtonText}>
                    {permission?.canAskAgain ? "ALLOW CAMERA" : "OPEN SETTINGS"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.scanCorner, styles.cornerTopLeft]} />
              <View style={[styles.scanCorner, styles.cornerTopRight]} />
              <View style={[styles.scanCorner, styles.cornerBottomLeft]} />
              <View style={[styles.scanCorner, styles.cornerBottomRight]} />
            </View>
            {cameraError ? (
              <View style={styles.cameraErrorOverlay}>
                <Text style={styles.cameraErrorText}>{cameraError}</Text>
              </View>
            ) : null}
            {scanState === "scanning" && (
              <View style={styles.scanningOverlay}>
                <ActivityIndicator size="small" color={COLORS.gold} />
                <Text style={styles.scanningText}>Reading card with OCR…</Text>
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
          {ocrCandidates.length > 1 ? (
            <View style={styles.candidatePanel}>
              <Text style={styles.candidateTitle}>
                Multiple PIN-looking groups found — choose the recharge PIN
              </Text>
              {ocrCandidates.map((candidate, index) => (
                <TouchableOpacity
                  key={candidate.digits}
                  onPress={() => selectOcrCandidate(candidate)}
                  style={styles.candidateButton}
                >
                  <Text style={styles.candidateLabel}>OPTION {index + 1}</Text>
                  <Text style={styles.candidateDigits}>
                    {formatPin(candidate.digits)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
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
          {ocrError ? (
            <View style={styles.messageBoxDanger}>
              <Ionicons name="alert-circle" size={17} color={COLORS.danger} />
              <Text style={styles.messageDanger}>{ocrError}</Text>
            </View>
          ) : pin.error ? (
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

        <TouchableOpacity
          accessibilityLabel="Dial to recharge"
          disabled={!pin.isValid}
          onPress={handleDialPress}
          style={[styles.dialButton, !pin.isValid && styles.dialButtonDisabled]}
        >
          <MaterialCommunityIcons
            name="phone-outgoing"
            size={24}
            color={pin.isValid ? COLORS.navy : COLORS.muted}
          />
          <Text style={styles.dialButtonText}>
            {pin.isValid ? "DIAL TO RECHARGE" : "ENTER 12–18 DIGITS TO DIAL"}
          </Text>
        </TouchableOpacity>
        {ussdStatus ? (
          <View style={styles.ussdStatusBox}>
            <Ionicons
              name="information-circle-outline"
              size={17}
              color={COLORS.blue}
            />
            <Text style={styles.ussdStatusText}>{ussdStatus}</Text>
          </View>
        ) : null}
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

  const renderSettings = () => (
    <>
      {renderHeader("USSD CODES")}
      <ScrollView
        contentContainerStyle={styles.detailScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailIconCircle}>
          <MaterialCommunityIcons
            name="cellphone-cog"
            size={31}
            color={COLORS.blue}
          />
        </View>
        <Text style={styles.detailEyebrow}>NETWORK SETTINGS</Text>
        <Text style={styles.detailTitle}>USSD Codes</Text>
        <Text style={styles.detailCopy}>
          Online config is the truth. Each network keeps its own offline code.
        </Text>
        {ussdStatus ? (
          <View style={styles.ussdStatusBox}>
            <Ionicons
              name="information-circle-outline"
              size={17}
              color={COLORS.blue}
            />
            <Text style={styles.ussdStatusText}>{ussdStatus}</Text>
          </View>
        ) : null}
        {NETWORKS.map((network) => (
          <View key={network} style={styles.ussdCard}>
            <View style={styles.ussdCardHeader}>
              <Text style={styles.ussdNetwork}>{network}</Text>
              <Text style={styles.ussdUpdated}>
                Last updated: {ussdConfig[network].last_updated}
              </Text>
            </View>
            <Text selectable style={styles.ussdCode}>
              {ussdConfig[network].code}
            </Text>
            <View style={styles.ussdActions}>
              <TouchableOpacity
                onPress={() => checkForUpdate(network)}
                style={styles.ussdActionButton}
              >
                <Ionicons name="refresh" size={16} color={COLORS.blue} />
                <Text style={styles.ussdActionText}>CHECK FOR UPDATE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openUssdEditor(network)}
                style={styles.ussdActionButton}
              >
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={16}
                  color={COLORS.blue}
                />
                <Text style={styles.ussdActionText}>EDIT MANUALLY</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <TouchableOpacity
          onPress={() => setView("scanner")}
          style={styles.primaryButton}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.white} />
          <Text style={styles.primaryButtonText}>BACK TO SCANNER</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );

  return (
    <ScreenContainer containerClassName="bg-[#071A38]">
      <StatusBar style="light" />
      <View style={styles.appShell}>
        {view === "scanner"
          ? renderScanner()
          : view === "confirm"
            ? renderConfirm()
            : view === "history"
              ? renderHistory()
              : renderSettings()}
      </View>
      <Modal
        animationType="fade"
        transparent
        visible={simPickerVisible}
        onRequestClose={() => setSimPickerVisible(false)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogEyebrow}>SELECT SIM</Text>
            <Text style={styles.dialogTitle}>Which SIM should dial?</Text>
            <Text style={styles.dialogCopy}>
              The selected SIM’s carrier code and saved network settings will be
              used.
            </Text>
            {simCards.map((sim) => (
              <TouchableOpacity
                key={sim.subscriptionId}
                onPress={() => chooseSim(sim)}
                style={styles.simOption}
              >
                <View style={styles.simOptionIcon}>
                  <MaterialCommunityIcons
                    name="sim"
                    size={21}
                    color={COLORS.blue}
                  />
                </View>
                <View style={styles.simOptionBody}>
                  <Text style={styles.simOptionTitle}>
                    SIM {sim.slotIndex + 1} · {sim.carrierName}
                  </Text>
                  <Text style={styles.simOptionNumber}>
                    {sim.number || "Number hidden by carrier"}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={19}
                  color={COLORS.muted}
                />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setSimPickerVisible(false)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={smartDialog !== null}
        onRequestClose={() => setSmartDialog(null)}
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogEyebrow}>
              {smartDialog?.kind === "failed"
                ? "UPDATE FAILED"
                : "OFFLINE CHECK"}
            </Text>
            <Text style={styles.dialogTitle}>
              {smartDialog?.kind === "failed"
                ? "Still offline. Dial with old code?"
                : `${smartDialog?.network} dialing code may be outdated.`}
            </Text>
            <Text style={styles.dialogCopy}>
              {smartDialog?.kind === "failed"
                ? "The latest code could not be fetched for this network."
                : `Please turn on Mobile Data or WiFi to check for latest ${smartDialog?.network} code.`}
            </Text>
            <TouchableOpacity
              onPress={
                smartDialog?.kind === "failed"
                  ? dialOfflineAnyway
                  : connectAndUpdate
              }
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {smartDialog?.kind === "failed"
                  ? "YES DIAL"
                  : "CONNECT & UPDATE"}
              </Text>
            </TouchableOpacity>
            {smartDialog?.kind !== "failed" ? (
              <TouchableOpacity
                onPress={dialOfflineAnyway}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>
                  DIAL ANYWAY OFFLINE
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setSmartDialog(null)}
              style={styles.dialogCancelButton}
            >
              <Text style={styles.dialogCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={ussdEditNetwork !== null}
        onRequestClose={() => setUssdEditNetwork(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable
            onPress={() => setUssdEditNetwork(null)}
            style={styles.modalBackdrop}
          />
          <View style={styles.editSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.detailEyebrow}>EDIT USSD CODE</Text>
                <Text style={styles.sheetTitle}>{ussdEditNetwork}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setUssdEditNetwork(null)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color={COLORS.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetCopy}>
              Save offline for this network. Keep {"{PIN}"} where the recharge
              PIN belongs.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => {
                setUssdEditValue(value);
                setUssdEditError("");
              }}
              placeholder="*311*{PIN}#"
              placeholderTextColor="#92A3B8"
              style={styles.pinInput}
              value={ussdEditValue}
            />
            {ussdEditError ? (
              <View style={styles.messageBoxDanger}>
                <Ionicons name="alert-circle" size={17} color={COLORS.danger} />
                <Text style={styles.messageDanger}>{ussdEditError}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={saveManualUssd}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>SAVE CODE OFFLINE</Text>
              <Ionicons name="checkmark" size={19} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  cameraPreview: StyleSheet.absoluteFill,
  cameraPermissionState: {
    alignItems: "center",
    backgroundColor: "#12335F",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cameraPermissionTitle: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "center",
  },
  cameraPermissionCopy: {
    color: "#C4D8F1",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: COLORS.gold,
    borderRadius: 10,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: COLORS.navy,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  cameraErrorOverlay: {
    backgroundColor: "rgba(197,61,80,0.9)",
    left: 12,
    padding: 9,
    position: "absolute",
    right: 12,
    top: 12,
  },
  cameraErrorText: { color: COLORS.white, fontSize: 11, textAlign: "center" },
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
  candidatePanel: {
    backgroundColor: COLORS.goldSoft,
    borderColor: COLORS.gold,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 10,
  },
  candidateTitle: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginBottom: 8,
  },
  candidateButton: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  candidateLabel: {
    color: COLORS.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  candidateDigits: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.4,
    marginTop: 3,
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
  dialButton: {
    alignItems: "center",
    backgroundColor: COLORS.gold,
    borderRadius: 18,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 60,
    paddingHorizontal: 14,
  },
  dialButtonDisabled: { backgroundColor: "#E7EDF5" },
  dialButtonText: {
    color: COLORS.navy,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  ussdStatusBox: {
    alignItems: "flex-start",
    backgroundColor: COLORS.blueWash,
    borderRadius: 11,
    flexDirection: "row",
    gap: 7,
    marginTop: 12,
    padding: 10,
  },
  ussdStatusText: {
    color: COLORS.blue,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
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
  ussdCard: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 17,
    borderWidth: 1.5,
    marginTop: 14,
    padding: 14,
  },
  ussdCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ussdNetwork: { color: COLORS.ink, fontSize: 17, fontWeight: "900" },
  ussdUpdated: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  ussdCode: {
    color: COLORS.navy,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 13,
  },
  ussdActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  ussdActionButton: {
    alignItems: "center",
    borderColor: COLORS.blueLine,
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 5,
  },
  ussdActionText: {
    color: COLORS.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  dialogBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(7,26,56,0.68)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  dialogCard: {
    backgroundColor: COLORS.paper,
    borderRadius: 22,
    padding: 20,
    width: "100%",
  },
  dialogEyebrow: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  dialogTitle: {
    color: COLORS.ink,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
    marginTop: 7,
  },
  dialogCopy: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  simOption: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderColor: COLORS.blueLine,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 11,
    padding: 11,
  },
  simOptionIcon: {
    alignItems: "center",
    backgroundColor: COLORS.blueWash,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  simOptionBody: { flex: 1, marginLeft: 10 },
  simOptionTitle: { color: COLORS.ink, fontSize: 14, fontWeight: "900" },
  simOptionNumber: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  dialogCancelButton: { alignItems: "center", marginTop: 14, padding: 6 },
  dialogCancelText: { color: COLORS.muted, fontSize: 12, fontWeight: "900" },
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
