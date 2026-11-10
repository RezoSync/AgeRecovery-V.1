import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File as ExpoFile } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./src/Icon";
import { pacienteDemo, type Cuidado, type FotoPaciente, type Paciente, type PlanPaciente } from "./src/data";
import {
  ApiError,
  getPhotos,
  getPlan,
  getTodaysCare,
  loginWithCode,
  markCare,
  notifyAlarm,
  photoDownloadUrl,
  registerPatient,
  sendChatMessage,
  uploadPhoto,
} from "./src/api";
import { SHOW_SAMPLE_CONTENT_NOTICE } from "./src/config";
import {
  CHAT_CLINIC_PHONE,
  CHAT_CLINIC_WHATSAPP_URL,
} from "./src/config";
import {
  LIMITS,
  createRateLimiter,
  isValidClinicCode,
  sanitizeText,
} from "./src/lib/security";
import { LanguageProvider, useT, type Language } from "./src/i18n";
import type { TranslationKey } from "./src/i18n/translations";

type Screen =
  | "splash" | "consent" | "login" | "home" | "plan" | "care" | "chat"
  | "alarm" | "photo" | "history" | "clinic" | "profile";
type Go = (screen: Screen) => void;

async function downloadPatientPhotos(
  token: string,
  photos: FotoPaciente[],
  onUnauthorized: () => void,
): Promise<Record<string, string>> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new ApiError("No se pudieron cargar las fotos.");

  const downloaded = await Promise.all(photos.map(async (photo, index) => {
    const destination = `${cacheDirectory}${photo.id}-${Date.now()}-${index}.img`;
    const result = await FileSystem.downloadAsync(
      photoDownloadUrl(photo.id),
      destination,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (result.status === 401) {
      onUnauthorized();
      throw new ApiError("Tu sesión terminó. Inicia sesión de nuevo.", 401, "http");
    }
    if (result.status < 200 || result.status >= 300) {
      if (__DEV__) {
        const body = await FileSystem.readAsStringAsync(result.uri);
        console.log(`Photo download HTTP ${result.status}:`, body);
      }
      throw new ApiError("No se pudieron cargar las fotos.", result.status, "http");
    }
    return [photo.id, result.uri] as const;
  }));
  return Object.fromEntries(downloaded);
}

const C = {
  bg: "#001b33", dark: "#00101f", card: "#06263f", brand: "#003d6e",
  cyan: "#008ac4", light: "#4fb8e8", cyanSoft: "rgba(0,138,196,0.16)",
  gold: "#b89456", muted: "rgba(255,255,255,0.62)", border: "rgba(255,255,255,0.1)",
  red: "#e24b4a", success: "#6fa99d", white: "#fff",
};
const logo = require("./src/assets/logo-white.png");
const doctor = require("./src/assets/doctor-portrait.jpeg");
const candid = require("./src/assets/doctor-clinical-candid.jpeg");
const procedure = require("./src/assets/procedure.jpeg");
const SESSION_KEY = "age-recovery-session-token";
type RemoteStatus = "loading" | "ready" | "empty" | "error";
const navItems: { label: TranslationKey; screen: Screen; icon: IconName }[] = [
  { label: "nav.home", screen: "home", icon: "home" },
  { label: "nav.plan", screen: "plan", icon: "calendar" },
  { label: "nav.chat", screen: "chat", icon: "chat" },
  { label: "nav.tracking", screen: "history", icon: "camera" },
  { label: "nav.profile", screen: "profile", icon: "user" },
];

function Txt({ children, style, ...props }: React.ComponentProps<typeof Text>) {
  return <Text {...props} style={[styles.text, style]}>{children}</Text>;
}

function Title({ children, style }: { children: ReactNode; style?: object }) {
  return <Txt style={[styles.title, style]}>{children}</Txt>;
}

function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Button({
  children, onPress, variant = "primary", icon, disabled,
}: {
  children: ReactNode; onPress?: () => void;
  variant?: "primary" | "outline" | "danger" | "ghost";
  icon?: IconName; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "outline" && styles.buttonOutline,
        variant === "danger" && styles.buttonDanger,
        variant === "ghost" && styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={variant === "outline" || variant === "ghost" ? C.light : C.white} />}
      <Txt style={styles.buttonText}>{children}</Txt>
    </Pressable>
  );
}

function SmallHeader({
  title, back, right,
}: { title?: string; back?: () => void; right?: ReactNode }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.topbar, width <= 380 && styles.topbarCompact]}>
      {back ? (
        <Pressable onPress={back} accessibilityLabel={t("common.back")} style={styles.iconButton}>
          <Txt style={styles.backArrow}>‹</Txt>
        </Pressable>
      ) : (
        <Image source={logo} resizeMode="contain" style={styles.headerLogo} />
      )}
      {title ? <Txt numberOfLines={1} style={styles.topbarTitle}>{title}</Txt> : <View style={styles.headerSpacer} />}
      {right}
    </View>
  );
}

function Page({
  screen, go, children, title, back, right, noNav = false, noAlarm = false,
}: {
  screen: Screen; go: Go; children: ReactNode; title?: string; back?: () => void;
  right?: ReactNode; noNav?: boolean; noAlarm?: boolean;
}) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const showNav = !noNav;
  const showAlarm = !noAlarm && !["splash", "consent", "login", "alarm"].includes(screen);
  const active = screen === "photo" ? "history" : screen === "care" ? "home" : screen === "clinic" ? "profile" : screen;
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      {title !== undefined || back || right ? <SmallHeader title={title} back={back} right={right} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, showNav && styles.withNav, showAlarm && styles.withAlarm]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
        {SHOW_SAMPLE_CONTENT_NOTICE && (
          <Txt style={styles.sampleNotice}>{t("common.sampleNotice")}</Txt>
        )}
      </ScrollView>
      {showNav && (
        <View style={styles.bottomNav}>
          {navItems.map((item) => {
            const selected = active === item.screen;
            return (
              <Pressable key={item.screen} style={styles.navItem} onPress={() => go(item.screen)}>
                <View style={[styles.navIconWrap, selected && styles.navIconActive]}>
                  <Icon name={item.icon} size={20} color={selected ? C.light : "rgba(255,255,255,0.48)"} />
                </View>
                <Txt numberOfLines={1} style={[styles.navLabel, selected && styles.navLabelActive]}>{t(item.label)}</Txt>
              </Pressable>
            );
          })}
        </View>
      )}
      {showAlarm && (
        <Pressable
          accessibilityRole="button"
          onPress={() => go("alarm")}
          style={[styles.alarmFab, { top: insets.top + 8 }, width <= 380 && styles.alarmFabCompact]}
        >
          <Icon name="alert" size={16} color={C.white} />
          {width > 380 && <Txt style={styles.alarmText}>{t("common.alarm")}</Txt>}
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <Txt style={styles.eyebrow}>{children}</Txt>;
}

function Splash({ go }: { go: Go }) {
  const { t } = useT();
  return (
    <Page screen="splash" go={go} noNav noAlarm>
      <View style={styles.splash}>
        <View style={styles.splashRing} />
        <Image source={logo} resizeMode="contain" style={styles.splashLogo} />
        <View style={styles.splashBottom}>
          <Title style={styles.splashTitle}>{t("splash.title")}{"\n"}<Txt style={styles.italic}>{t("splash.titleSecond")}</Txt></Title>
          <Txt style={styles.lead}>{t("splash.lead")}</Txt>
          <Button icon="arrow" onPress={() => go("consent")}>{t("splash.begin")}</Button>
        </View>
      </View>
    </Page>
  );
}

function Consent({ go }: { go: Go }) {
  const { t } = useT();
  const [health, setHealth] = useState(false);
  const [notices, setNotices] = useState(false);
  const toggle = (checked: boolean, update: (v: boolean) => void, label: string) => (
    <Pressable onPress={() => update(!checked)} style={styles.consentRow}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <Icon name="check" size={15} color={C.white} />}
      </View>
      <Txt style={styles.consentText}>{label}</Txt>
    </Pressable>
  );
  return (
    <Page screen="consent" go={go} noNav noAlarm title={t("consent.title")} back={() => go("splash")}>
      <View style={styles.pageBody}>
        <Eyebrow>{t("consent.step")}</Eyebrow>
        <Title>{t("consent.headline")}{"\n"}<Txt style={styles.italic}>{t("consent.headlineSecond")}</Txt></Title>
        <Card style={styles.noticeCard}>
          <Icon name="shield" size={24} color={C.light} />
          <View style={styles.flexOne}>
            <Txt style={styles.subhead}>{t("consent.important")}</Txt>
            <Txt style={styles.bodyCopy}>{t("consent.aiNotice")}</Txt>
          </View>
        </Card>
        <View style={styles.gap16}>
          {toggle(health, setHealth, t("consent.healthData"))}
          {toggle(notices, setNotices, t("consent.reminders"))}
        </View>
        <View style={styles.privacyNote}>
          <Icon name="lock" size={15} color={C.muted} />
          <Txt style={styles.mutedSmall}>{t("consent.privacy")}</Txt>
        </View>
        <View style={styles.stickyCta}>
          <Button disabled={!health || !notices} onPress={() => go("login")}>{t("consent.continue")}</Button>
          {(!health || !notices) && <Txt style={styles.helper}>{t("consent.selectBoth")}</Txt>}
        </View>
      </View>
    </Page>
  );
}

function Login({
  go,
  setLoading,
  onLogin,
}: {
  go: Go;
  setLoading: (v: boolean) => void;
  onLogin: (token: string, patient: Paciente) => Promise<void>;
}) {
  const { t, translateError } = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registrationMessage, setRegistrationMessage] = useState("");
  const enter = async () => {
    if (!isValidClinicCode(code) || busy) {
      setError(t("login.invalidCode"));
      return;
    }
    setError("");
    setBusy(true);
    setLoading(true);
    try {
      const session = await loginWithCode(code);
      await onLogin(session.token, session.paciente);
      go("home");
    } catch (loginError) {
      setError(loginError instanceof ApiError
        ? translateError(loginError.message)
        : t("login.failed"));
    } finally {
      setBusy(false);
      setLoading(false);
    }
  };
  const submitRegistration = async () => {
    const name = registerName.trim();
    const email = registerEmail.trim();
    if (busy) return;
    if (name.length < 2 || name.length > 100) {
      setRegisterError(t("registration.invalidName"));
      return;
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegisterError(t("registration.invalidEmail"));
      return;
    }

    setRegisterError("");
    setRegistrationMessage("");
    setBusy(true);
    try {
      const response = await registerPatient(name, email);
      setRegistrationMessage(response.mensaje === "Si el correo es válido, recibirás tu código en unos minutos."
        ? t("registration.success")
        : response.mensaje);
    } catch (registrationError) {
      setRegisterError(registrationError instanceof ApiError
        ? translateError(registrationError.message)
        : t("api.requestFailed"));
    } finally {
      setBusy(false);
    }
  };
  const backToLogin = () => {
    setRegisterMode(false);
    setRegisterError("");
    setRegistrationMessage("");
  };
  return (
    <Page screen="login" go={go} noNav noAlarm back={() => registerMode ? backToLogin() : go("consent")}>
      <View style={styles.pageBody}>
        <Image source={logo} resizeMode="contain" style={styles.loginLogo} />
        {registerMode ? (
          <>
            <Eyebrow>{t("login.access")}</Eyebrow>
            <Title>{t("registration.title")}</Title>
            {registrationMessage ? (
              <>
                <Txt accessibilityRole="alert" style={[styles.successText, styles.fieldHelp]}>{registrationMessage}</Txt>
                <Button onPress={backToLogin}>{t("registration.backToLogin")}</Button>
              </>
            ) : (
              <>
                <Txt style={[styles.fieldLabel, styles.spaceTop]}>{t("registration.name")}</Txt>
                <TextInput
                  value={registerName}
                  onChangeText={(value) => {
                    setRegisterName(value);
                    setRegisterError("");
                  }}
                  placeholder={t("registration.name")}
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  autoCapitalize="words"
                  autoComplete="name"
                  maxLength={100}
                  style={styles.input}
                />
                <Txt style={styles.fieldLabel}>{t("registration.email")}</Txt>
                <TextInput
                  value={registerEmail}
                  onChangeText={(value) => {
                    setRegisterEmail(value);
                    setRegisterError("");
                  }}
                  placeholder={t("registration.email")}
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  maxLength={254}
                  style={styles.input}
                />
                {!!registerError && <Txt accessibilityRole="alert" style={styles.errorText}>{registerError}</Txt>}
                <Button disabled={busy} onPress={() => { void submitRegistration(); }}>
                  {busy ? t("registration.sending") : t("registration.submit")}
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Eyebrow>{t("login.access")}</Eyebrow>
            <Title>{t("login.welcome")}{"\n"}<Txt style={styles.italic}>{t("login.recovery")}</Txt></Title>
            <Txt style={[styles.lead, styles.spaceTop]}>{t("login.instruction")}</Txt>
            <Txt style={styles.fieldLabel}>{t("login.code")}</Txt>
            <TextInput
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="• • • • • •"
              placeholderTextColor="rgba(255,255,255,0.38)"
              keyboardType="number-pad"
              autoCapitalize="none"
              autoComplete="one-time-code"
              maxLength={6}
              secureTextEntry={false}
              style={[styles.input, styles.codeInput]}
            />
            <Txt style={styles.fieldHelp}><Icon name="info" size={15} color={C.light} />  {t("login.codeHelp")}</Txt>
            {!!error && <Txt accessibilityRole="alert" style={styles.errorText}>{error}</Txt>}
            <Button disabled={busy} onPress={() => { void enter(); }}>{t("login.submit")}</Button>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setRegisterError("");
                setRegistrationMessage("");
                setRegisterMode(true);
              }}
              style={styles.supportLink}
            >
              <Txt style={styles.linkText}>{t("registration.createAccount")}</Txt>
            </Pressable>
            <Pressable onPress={() => go("clinic")} style={styles.supportLink}>
              <Txt style={styles.mutedSmall}>{t("login.missingCode")} </Txt><Txt style={styles.linkText}>{t("login.contactClinic")}</Txt>
            </Pressable>
          </>
        )}
      </View>
    </Page>
  );
}

function RemoteMessage({
  status,
  onRetry,
  emptyTitle = "remote.empty",
}: {
  status: RemoteStatus;
  onRetry: () => void;
  emptyTitle?: TranslationKey;
}) {
  const { t } = useT();
  if (status === "loading") {
    return <View style={styles.remoteState}><ActivityIndicator color={C.light} /><Txt style={styles.mutedSmall}>{t("remote.loading")}</Txt></View>;
  }
  if (status === "empty") {
    return <View style={styles.remoteState}><Txt style={styles.subhead}>{t(emptyTitle)}</Txt></View>;
  }
  if (status === "error") {
    return <View style={styles.remoteState}><Txt style={styles.errorText}>{t("common.noConnection")}</Txt><Button variant="outline" onPress={onRetry}>{t("remote.retry")}</Button></View>;
  }
  return null;
}

function Home({
  go,
  patient,
  plan,
  care,
  status,
  retry,
  mark,
  selectCare,
}: {
  go: Go;
  patient: Paciente;
  plan: PlanPaciente | null;
  care: Cuidado[];
  status: RemoteStatus;
  retry: () => void;
  mark: (care: Cuidado) => void;
  selectCare: (care: Cuidado) => void;
}) {
  const { t } = useT();
  const [marking, setMarking] = useState<number[]>([]);
  const onMark = async (item: Cuidado) => {
    if (marking.includes(item.id_cuidado) || item.hecho === true || item.hecho === 1) return;
    setMarking((current) => [...current, item.id_cuidado]);
    try {
      await mark(item);
    } catch {
      return;
    } finally {
      setMarking((current) => current.filter((id) => id !== item.id_cuidado));
    }
  };
  const markedCount = care.filter((item) => item.hecho === true || item.hecho === 1).length;
  return (
    <Page screen="home" go={go} right={<Pressable onPress={() => go("profile")} style={styles.avatar}><Txt style={styles.avatarText}>{patient.nombre.slice(0, 2).toUpperCase()}</Txt></Pressable>}>
      <View style={styles.pageContent}>
        <Eyebrow>{t("home.eyebrow")}</Eyebrow>
        <Title>{t("home.hello")}{"\n"}<Txt style={styles.italic}>{patient.nombre}</Txt></Title>
        <RemoteMessage status={status} onRetry={retry} emptyTitle="remote.planEmpty" />
        {status === "ready" && plan && (
          <>
            <Card style={styles.treatmentCard}>
              <Txt style={styles.statusChip}>{t("home.activeTreatment")}</Txt>
              <Txt style={styles.cardTitle}>{plan.tratamiento}</Txt>
              <Txt style={styles.mutedSmall}>{t("home.dayOf", { day: plan.dia_actual, total: plan.plan_dias })}</Txt>
              <View style={styles.progressTrack}>
                <View style={[styles.progressValueLine, { width: `${Math.min(100, Math.max(0, (plan.dia_actual / plan.plan_dias) * 100))}%` }]} />
              </View>
              {!!plan.etapa && <Txt style={styles.nextStep}>{t("home.stage")} <Txt style={styles.strong}>{plan.etapa}</Txt></Txt>}
            </Card>
            <View style={styles.sectionHeading}>
              <View><Eyebrow>{t("home.forYou")}</Eyebrow><Txt style={styles.sectionTitle}>{t("home.todayCare")}</Txt></View>
              <Txt style={styles.mutedSmall}>{t("home.careCount", { done: markedCount, total: care.length })}</Txt>
            </View>
            {care.length === 0 && <Txt style={styles.mutedSmall}>{t("home.noCare")}</Txt>}
            {care.map((item) => {
              const isDone = item.hecho === true || item.hecho === 1;
              return (
                <Card key={item.id_cuidado} style={[styles.careRow, isDone && styles.completed]}>
                  <Pressable onPress={() => selectCare(item)} style={styles.careMain}>
                    <View style={styles.careIcon}><Icon name="check" color={C.light} /></View>
                    <View style={styles.flexOne}><Txt style={styles.subhead}>{item.titulo}</Txt><Txt style={styles.mutedSmall}>{item.instruccion}</Txt></View>
                  </Pressable>
                  <Pressable
                    disabled={isDone || marking.includes(item.id_cuidado)}
                    onPress={() => { void onMark(item); }}
                    style={[styles.checkButton, isDone && styles.checkButtonActive]}
                    accessibilityLabel={t("home.markDone")}
                  >
                    {marking.includes(item.id_cuidado)
                      ? <ActivityIndicator size="small" color={C.light} />
                      : <Icon name="check" size={17} color={isDone ? C.white : C.muted} />}
                  </Pressable>
                </Card>
              );
            })}
          </>
        )}
        <View style={styles.quickGrid}>
          <QuickAction icon="chat" label={t("home.askAssistant")} emphasis={t("home.assistant")} onPress={() => go("chat")} />
          <QuickAction icon="camera" label={t("home.sendPhoto")} emphasis={t("home.followup")} onPress={() => go("photo")} />
        </View>
      </View>
    </Page>
  );
}

function QuickAction({ icon, label, emphasis, onPress }: { icon: IconName; label: string; emphasis: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.quickAction}><Icon name={icon} color={C.light} /><View style={styles.flexOne}><Txt>{label}</Txt><Txt style={styles.strong}>{emphasis}</Txt></View><Icon name="arrow" size={16} color={C.light} /></Pressable>;
}

function Plan({ go, plan, status, retry }: { go: Go; plan: PlanPaciente | null; status: RemoteStatus; retry: () => void }) {
  const { t } = useT();
  return (
    <Page screen="plan" go={go} title={t("nav.plan")}>
      <View style={styles.pageContent}>
        <RemoteMessage status={status} onRetry={retry} emptyTitle="remote.planEmpty" />
        {status === "ready" && plan && (
          <Card style={styles.treatmentCard}>
            <Txt style={styles.statusChip}>{t("plan.activeProtocol")}</Txt>
            <Txt style={styles.cardTitle}>{plan.tratamiento}</Txt>
            <Txt style={styles.mutedSmall}>{t("home.dayOf", { day: plan.dia_actual, total: plan.plan_dias })}</Txt>
            {!!plan.etapa && <Txt style={styles.subhead}>{plan.etapa}</Txt>}
          </Card>
        )}
      </View>
    </Page>
  );
}

function CareDetail({ go, care, onMark }: { go: Go; care: Cuidado | null; onMark: (care: Cuidado) => Promise<void> }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isDone = care?.hecho === true || care?.hecho === 1;
  const mark = async () => {
    if (!care || isDone || busy) return;
    setBusy(true);
    setError("");
    try {
      await onMark(care);
    } catch {
      setError(t("care.updateFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page screen="care" go={go} title={t("care.title")} back={() => go("home")}>
      <View style={styles.pageContent}>
        {care ? (
          <>
            <View style={styles.featureIcon}><Icon name="check" size={30} color={C.light} /></View>
            <Eyebrow>{t("care.eyebrow")}</Eyebrow>
            <Title>{care.titulo}</Title>
            <Txt style={styles.lead}>{care.instruccion}</Txt>
            <Button disabled={busy || isDone} icon="check" onPress={() => { void mark(); }}>
              {busy ? t("care.saving") : isDone ? t("care.completed") : t("care.markDone")}
            </Button>
            {!!error && <Txt style={styles.errorText}>{error}</Txt>}
          </>
        ) : <Txt style={styles.mutedSmall}>{t("care.selectPrompt")}</Txt>}
        <Pressable onPress={() => go("chat")} style={styles.inlineLink}><Txt>{t("care.question")} </Txt><Txt style={styles.linkText}>{t("care.askInChat")}</Txt><Icon name="arrow" size={15} color={C.light} /></Pressable>
      </View>
    </Page>
  );
}

const suggestions: TranslationKey[] = [
  "chat.suggestionTreatments", "chat.suggestionCare", "chat.suggestionDuration",
  "chat.suggestionAppointment", "chat.suggestionNormal",
];

const CHAT_REPLY_PREVIEW_LENGTH = 280;

function getChatReplyPreview(text: string): string {
  if (text.length <= CHAT_REPLY_PREVIEW_LENGTH) return text;

  const preview = text.slice(0, CHAT_REPLY_PREVIEW_LENGTH);
  const sentenceEndPattern = /[.!?…](?:["'’”»)\]]*)?(?=\s|$)/g;
  let sentenceEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = sentenceEndPattern.exec(preview)) !== null) {
    sentenceEnd = match.index + match[0].length;
  }
  if (sentenceEnd > 0) return preview.slice(0, sentenceEnd).trimEnd();

  let lastWhitespace = -1;
  for (let index = 0; index < preview.length; index += 1) {
    if (/\s/.test(preview[index])) lastWhitespace = index;
  }
  if (lastWhitespace > 0) return preview.slice(0, lastWhitespace).trimEnd();

  const nextWhitespace = text.slice(CHAT_REPLY_PREVIEW_LENGTH).search(/\s/);
  return nextWhitespace < 0
    ? text
    : text.slice(0, CHAT_REPLY_PREVIEW_LENGTH + nextWhitespace).trimEnd();
}

function Chat({ go, patient }: { go: Go; patient: Paciente }) {
  const { language, t, translateError } = useT();
  const [messages, setMessages] = useState<{ user?: boolean; text: string }[]>([
    { text: t("chat.greeting", { name: patient.nombre }) },
  ]);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(() => new Set());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fallback, setFallback] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSig, setConversationSig] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState("");
  const sendingRef = useRef(false);
  const limiter = useRef(createRateLimiter(LIMITS.chatMessages, LIMITS.chatWindowMs));
  useEffect(() => {
    setMessages((current) => current.length === 1 && !current[0].user
      ? [{ text: t("chat.greeting", { name: patient.nombre }) }]
      : current);
  }, [language, patient.nombre, t]);
  const send = async (value = text, retry = false) => {
    if (sendingRef.current) return;
    const clean = sanitizeText(value, 1000);
    if (!clean) return;
    if (!retry && !limiter.current.take()) {
      setError(t("chat.rateLimit"));
      return;
    }

    setError("");
    setFallback(false);
    sendingRef.current = true;
    setBusy(true);
    if (!retry) {
      setLastMessage(clean);
      setMessages((current) => [...current, { user: true, text: clean }]);
      setText("");
    }
    try {
      const result = await sendChatMessage(clean, conversationId, conversationSig);
      setConversationId(result.conversation_id);
      setConversationSig(result.conversation_sig ?? null);
      setMessages((current) => [...current, { text: result.reply }]);
    } catch (sendError) {
      if (sendError instanceof ApiError && (sendError.status === 403 || sendError.status === 422)) {
        setConversationId(null);
        setConversationSig(null);
        setError(t("chat.newConversation"));
      } else if (sendError instanceof ApiError && sendError.status === 429) {
        setError(translateError(sendError.message));
      } else {
        const shouldOfferFallback = sendError instanceof ApiError
          && (sendError.kind === "network" || sendError.kind === "timeout"
            || [500, 502, 503].includes(sendError.status ?? 0));
        setFallback(shouldOfferFallback);
        setError(sendError instanceof ApiError && sendError.kind === "timeout"
          ? translateError(sendError.message)
          : sendError instanceof ApiError && sendError.kind === "network"
            ? t("common.noConnection")
            : t("chat.requestFailed"));
      }
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };
  const callClinic = async () => {
    try {
      await Linking.openURL(`tel:${CHAT_CLINIC_PHONE}`);
    } catch {
      setError(t("chat.openDialerFailed"));
    }
  };
  const writeWhatsApp = async () => {
    try {
      await Linking.openURL(CHAT_CLINIC_WHATSAPP_URL);
    } catch {
      setError(t("chat.openWhatsAppFailed"));
    }
  };
  const sendLatestAgain = () => {
    if (lastMessage) void send(lastMessage, true);
  };
  return (
    <Page screen="chat" go={go} title={t("chat.title")}>
      <View style={styles.aiBanner}><Icon name="spark" size={16} color={C.light} /><Txt style={styles.mutedSmall}><Txt style={styles.strong}>{t("chat.ai")}</Txt> {t("chat.disclaimer")}</Txt></View>
      <View style={styles.chatArea}>
        <View style={styles.assistantId}><View style={styles.aiAvatar}><Txt style={styles.aiAvatarText}>A</Txt></View><View><Txt style={styles.strong}>{t("chat.name")}</Txt><Txt style={styles.online}>{t("chat.available")}</Txt></View></View>
        {messages.map((message, index) => {
          const isAssistantReply = !message.user && index > 0;
          const preview = isAssistantReply ? getChatReplyPreview(message.text) : message.text;
          const isTruncated = preview.length < message.text.length;
          const isExpanded = expandedMessages.has(index);
          return (
            <View key={`${index}-${message.text.slice(0, 8)}`} style={[styles.bubble, message.user ? styles.userBubble : styles.assistantBubble]}>
              <Txt>{isTruncated && !isExpanded ? `${preview}...` : message.text}</Txt>
              {isTruncated && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExpandedMessages((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })}
                  style={styles.chatExpandButton}
                >
                  <Txt style={styles.chatExpandText}>{isExpanded ? t("chat.showLess") : t("chat.showMore")}</Txt>
                </Pressable>
              )}
            </View>
          );
        })}
        {busy && <Txt style={styles.typingText}>{t("chat.typing")}</Txt>}
        {!!error && (
          <View>
            <Txt accessibilityRole="alert" style={styles.errorText}>{error}</Txt>
            <Button variant="outline" disabled={busy} onPress={sendLatestAgain}>{t("chat.retry")}</Button>
          </View>
        )}
        {fallback && (
          <Card style={styles.chatFallback}>
            <Txt style={styles.subhead}>{t("chat.unavailable")}</Txt>
            <Button variant="outline" onPress={() => { void writeWhatsApp(); }}>{t("chat.whatsapp")}</Button>
            <Button variant="outline" onPress={() => { void callClinic(); }}>{t("chat.callClinic")}</Button>
          </Card>
        )}
        {messages.length === 1 && <View style={styles.suggestions}>{suggestions.map((question) => <Pressable key={question} disabled={busy} onPress={() => { void send(t(question)); }} style={styles.suggestion}><Txt style={styles.linkText}>{t(question)}</Txt></Pressable>)}</View>}
      </View>
      <View style={styles.chatInputWrap}>
        <View style={styles.chatInputRow}>
          <TextInput value={text} maxLength={1000} editable={!busy} onChangeText={(value) => setText(value.slice(0, 1000))} onSubmitEditing={() => { void send(); }} returnKeyType="send" placeholder={t("chat.placeholder")} placeholderTextColor={C.muted} style={styles.chatInput} />
          <Pressable disabled={busy} onPress={() => { void send(); }} style={[styles.sendButton, busy && styles.buttonDisabled]} accessibilityLabel={t("chat.send")}><Icon name="send" size={19} color={C.white} /></Pressable>
        </View>
        <Txt style={styles.helper}>{t("chat.help")}</Txt>
      </View>
    </Page>
  );
}

function Alarm({
  go,
  token,
  onUnauthorized,
}: {
  go: Go;
  token: string;
  onUnauthorized: () => void;
}) {
  const { t, translateError } = useT();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [symptom, setSymptom] = useState("");
  const [sending, setSending] = useState(false);
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (countdown === null || countdown === 0) return undefined;
    const timer = setTimeout(() => setCountdown((current) => current === null ? null : current - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  useEffect(() => {
    if (countdown !== 0 || sending) return;
    let active = true;
    setSending(true);
    void notifyAlarm(token, sanitizeText(symptom, 300), onUnauthorized)
      .then(() => {
        if (active) {
          setNotified(true);
          setCountdown(null);
          setError("");
        }
      })
      .catch((notifyError: unknown) => {
        if (active) {
          setCountdown(null);
          setError(notifyError instanceof ApiError ? translateError(notifyError.message) : t("alarm.sendFailed"));
        }
      })
      .finally(() => {
        if (active) setSending(false);
      });
    return () => { active = false; };
  }, [countdown]);

  const callEmergency = async () => {
    try {
      await Linking.openURL("tel:911");
    } catch {
      setError(t("chat.openDialerFailed"));
    }
  };
  return (
    <Page screen="alarm" go={go} noAlarm noNav title={t("alarm.title")} back={() => go("home")}>
      <View style={styles.alarmContent}>
        <View style={styles.criticalIcon}><Icon name="alert" size={32} color={C.red} /></View>
        <Eyebrow>{t("alarm.attention")}</Eyebrow>
        <Title>{t("alarm.headline")}{"\n"}<Txt style={styles.italic}>{t("alarm.headlineSecond")}</Txt></Title>
        {/* TODO_MEDICO: FAQ signals are informational and do not yet have a dedicated endpoint. */}
        <Txt style={styles.bodyCopy}>{t("alarm.description")}</Txt>
        <TextInput
          value={symptom}
          onChangeText={(value) => setSymptom(value.slice(0, 300))}
          maxLength={300}
          multiline
          placeholder={t("alarm.symptom")}
          placeholderTextColor={C.muted}
          style={styles.commentInput}
        />
        <View style={styles.alarmActions}>
          {countdown === null && !notified && (
            <Button icon="alert" disabled={sending} onPress={() => { setError(""); setCountdown(5); }}>
              {t("alarm.notify")}
            </Button>
          )}
          {countdown !== null && countdown > 0 && (
            <>
              <Txt style={styles.subhead}>{t("alarm.sendingIn", { seconds: countdown })}</Txt>
              <Button variant="outline" onPress={() => setCountdown(null)}>{t("alarm.cancel")}</Button>
            </>
          )}
          {sending && <ActivityIndicator color={C.light} />}
          <Button variant="danger" icon="phone" onPress={() => { void callEmergency(); }}>{t("alarm.openDialer")}</Button>
        </View>
        {!!error && <Txt accessibilityRole="alert" style={styles.errorText}>{error}</Txt>}
        {notified && <Card style={styles.notified}><Icon name="check" color={C.success} /><View><Txt style={styles.strong}>{t("alarm.sent")}</Txt></View></Card>}
      </View>
    </Page>
  );
}

function PhotoFollowup({
  go,
  token,
  onUnauthorized,
  onUploaded,
}: {
  go: Go;
  token: string;
  onUnauthorized: () => void;
  onUploaded: () => Promise<void>;
}) {
  const { t, translateError } = useT();
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoWidth, setPhotoWidth] = useState(0);
  const [mood, setMood] = useState(3);
  const [comment, setComment] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [sent, setSent] = useState(false);
  const takePhoto = async () => {
    try {
      setPermissionError("");
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setPermissionError(t("photo.permissionCamera")); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
      if (!result.canceled) {
        setPhoto(result.assets[0].uri);
        setPhotoWidth(result.assets[0].width);
        setSent(false);
      }
    } catch {
      setPermissionError(t("photo.cameraFailed"));
    }
  };
  const choosePhoto = async () => {
    try {
      setPermissionError("");
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setPermissionError(t("photo.permissionLibrary")); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
      if (!result.canceled) {
        setPhoto(result.assets[0].uri);
        setPhotoWidth(result.assets[0].width);
        setSent(false);
      }
    } catch {
      setPermissionError(t("photo.libraryFailed"));
    }
  };
  const sendPhoto = async () => {
    if (!photo || uploading) return;
    setUploading(true);
    setUploadError("");
    try {
      const asset = await ImageManipulator.manipulateAsync(
        photo,
        photoWidth > 1280 ? [{ resize: { width: 1280 } }] : [],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
      );
      const form = new FormData();
      // SDK 58 fetch no acepta {uri,name,type}; File de expo-file-system implementa Blob.
      form.append("foto", new ExpoFile(asset.uri) as unknown as Blob);
      form.append("animo", String(mood));
      const cleanNote = sanitizeText(comment, LIMITS.doctorComment);
      if (cleanNote) form.append("nota", cleanNote);
      await uploadPhoto(token, form, onUnauthorized);
      setSent(true);
      try {
        await onUploaded();
      } catch {
        setUploadError(t("photo.uploadedButRefreshFailed"));
      }
    } catch (sendError) {
      setUploadError(sendError instanceof ApiError && sendError.kind === "network"
        ? t("common.noConnection")
        : sendError instanceof ApiError && sendError.status === 401
          ? translateError(sendError.message)
          : sendError instanceof ApiError && sendError.kind === "http"
            ? t("photo.uploadFailed")
            : t("photo.prepareFailed"));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Page screen="photo" go={go} title={t("photo.title")} back={() => go("history")}>
      {!photo ? (
        <View style={styles.cameraView}>
          <Image source={procedure} resizeMode="cover" style={styles.cameraPlaceholder} />
          <View style={styles.faceGuide} />
          <View style={styles.cameraTip}><Icon name="sun" size={17} color={C.white} /><Txt style={styles.whiteSmall}>{t("photo.cameraTip")}</Txt></View>
          <Pressable onPress={takePhoto} accessibilityLabel={t("photo.take")} style={styles.shutter}><View style={styles.shutterInner} /></Pressable>
          <Button variant="outline" icon="camera" onPress={choosePhoto}>{t("photo.choose")}</Button>
          {!!permissionError && <Txt style={styles.errorText}>{permissionError}</Txt>}
        </View>
      ) : (
        <View style={styles.pageContent}>
          <View style={styles.preview}>
            <Image source={{ uri: photo }} resizeMode="cover" style={styles.previewImage} />
            <Pressable onPress={() => { setPhoto(null); setPhotoWidth(0); setSent(false); }} style={styles.repeatButton}><Icon name="refresh" size={16} color={C.white} /><Txt style={styles.whiteSmall}>{t("photo.repeat")}</Txt></Pressable>
          </View>
          <Txt style={styles.fieldLabel}>{t("photo.feeling")} <Txt style={styles.mutedSmall}>{t("photo.optional")}</Txt></Txt>
          <View style={styles.moodScale}>
            {(["photo.moodBad", "photo.moodUncomfortable", "photo.moodStable", "photo.moodGood", "photo.moodVeryGood"] as const).map((key, index) => {
              const value = index + 1;
              return <Pressable key={key} onPress={() => setMood(value)} style={[styles.moodChoice, mood === value && styles.moodActive]}><Txt style={styles.moodFace}>{["☹", "🙁", "😐", "🙂", "☺"][index]}</Txt><Txt style={styles.moodLabel}>{t(key)}</Txt></Pressable>;
            })}
          </View>
          <TextInput value={comment} onChangeText={(value) => setComment(sanitizeText(value, LIMITS.doctorComment))} maxLength={LIMITS.doctorComment} multiline placeholder={t("photo.commentPlaceholder")} placeholderTextColor={C.muted} style={styles.commentInput} />
          <View style={styles.privacyNote}><Icon name="lock" size={15} color={C.muted} /><Txt style={styles.mutedSmall}>{t("photo.private")}</Txt></View>
          <Button disabled={uploading || sent} icon="send" onPress={() => { void sendPhoto(); }}>
            {sent ? t("photo.sent") : uploading ? t("photo.uploading") : t("photo.send")}
          </Button>
          {uploading && <ActivityIndicator color={C.light} />}
          {!!uploadError && <Txt accessibilityRole="alert" style={styles.errorText}>{uploadError}</Txt>}
          {sent && <Pressable onPress={() => go("history")} style={styles.inlineLink}><Txt style={styles.linkText}>{t("photo.viewHistory")}</Txt><Icon name="arrow" size={14} color={C.light} /></Pressable>}
        </View>
      )}
    </Page>
  );
}

function History({
  go,
  photos,
  photoUris,
  status,
  retry,
}: {
  go: Go;
  photos: FotoPaciente[];
  photoUris: Record<string, string>;
  status: RemoteStatus;
  retry: () => void;
}) {
  const { t, formatDate } = useT();
  return (
    <Page screen="history" go={go} title={t("history.title")} right={<Pressable onPress={() => go("photo")} style={styles.iconButton}><Icon name="camera" color={C.light} /></Pressable>}>
      <View style={styles.pageContent}>
        <Eyebrow>{t("history.eyebrow")}</Eyebrow>
        <Title>{t("history.headline")}{"\n"}<Txt style={styles.italic}>{t("history.headlineSecond")}</Txt></Title>
        <RemoteMessage status={status} onRetry={retry} />
        {status === "ready" && photos.length === 0 && <Txt style={styles.mutedSmall}>{t("history.noPhotos")}</Txt>}
        {status === "ready" && photos.map((photo) => (
          <Card key={photo.id} style={styles.photoHistoryCard}>
            {photoUris[photo.id]
              ? <Image source={{ uri: photoUris[photo.id] }} resizeMode="cover" style={styles.photoHistoryImage} />
              : <View style={[styles.photoHistoryImage, styles.remoteState]}><ActivityIndicator color={C.light} /></View>}
            <Txt style={styles.strong}>{formatDate(photo.fecha)}</Txt>
          </Card>
        ))}
      </View>
    </Page>
  );
}

function Clinic({ go }: { go: Go }) {
  const { t, formatDate, language } = useT();
  const appointmentDate = new Date(2026, 4, 21);
  const locale = language === "es" ? "es-MX" : "en-US";
  return (
    <Page screen="clinic" go={go} title={t("clinic.title")} back={() => go("profile")}>
      <View style={styles.clinicHero}>
        <Image source={doctor} resizeMode="cover" style={styles.clinicHeroImage} />
        <View style={styles.clinicHeroShade} />
        <View style={styles.clinicHeroText}><Txt style={styles.goldBadge}>{t("clinic.team")}</Txt><Title>Dr. Gregorio{"\n"}<Txt style={styles.italic}>García</Txt></Title><Txt style={styles.mutedSmall}>{t("clinic.specialty")}</Txt></View>
      </View>
      <View style={styles.pageContent}>
        <Card style={styles.addressCard}><Icon name="map" color={C.light} /><View style={styles.flexOne}><Eyebrow>AGE RECOVERY</Eyebrow><Txt style={styles.subhead}>Av. Álvaro Obregón 1842</Txt><Txt style={styles.mutedSmall}>{t("clinic.addressCity")}</Txt></View></Card>
        <View style={styles.contactActions}>{[
          ["phone", "clinic.call"],
          ["chat", "clinic.whatsapp"],
          ["map", "clinic.directions"],
        ].map(([icon, key]) => {
          const label = t(key as TranslationKey);
          return <Pressable key={key} style={styles.contactAction} onPress={() => Alert.alert(label, t("clinic.contactInfo"))}><Icon name={icon as IconName} color={C.light} /><Txt style={styles.mutedSmall}>{label}</Txt></Pressable>;
        })}</View>
        <Card style={styles.appointmentCard}><View style={styles.sectionHeading}><View><Eyebrow>{t("clinic.nextAppointment")}</Eyebrow><Txt style={styles.sectionTitle}>{t("clinic.review")}</Txt></View><Icon name="calendar" color={C.light} /></View><View style={styles.dateBlock}><Txt style={styles.dateNumber}>{formatDate(appointmentDate, { day: "2-digit" })}</Txt><View><Txt style={styles.strong}>{formatDate(appointmentDate, { month: "long" }).toLocaleUpperCase(locale)}</Txt><Txt style={styles.mutedSmall}>{t("clinic.dateTime")}</Txt></View></View><Button variant="outline" onPress={() => Alert.alert(t("clinic.appointment"), t("clinic.rescheduleInfo"))}>{t("clinic.reschedule")}</Button></Card>
        <Card style={styles.valuation}><Eyebrow>{t("clinic.otherTreatment")}</Eyebrow><Txt style={styles.sectionTitle}>{t("clinic.bookAssessment")}</Txt><Txt style={styles.mutedSmall}>{t("clinic.recommendation")}</Txt><Button onPress={() => Alert.alert(t("clinic.assessment"), t("clinic.valuationInfo"))}>{t("clinic.requestAssessment")}</Button></Card>
        <Image source={candid} resizeMode="cover" style={styles.clinicStrip} />
      </View>
    </Page>
  );
}

function Toggle({ initial = false, onChange }: { initial?: boolean; onChange?: (active: boolean) => void }) {
  const [active, setActive] = useState(initial);
  return <Pressable onPress={() => { setActive(!active); onChange?.(!active); }} accessibilityRole="switch" accessibilityState={{ checked: active }} style={[styles.toggle, active && styles.toggleOn]}><View style={[styles.toggleKnob, active && styles.toggleKnobOn]} /></Pressable>;
}

function Profile({ go, patient, logout }: { go: Go; patient: Paciente; logout: () => void }) {
  const { language, setLanguage, t } = useT();
  const settings: { icon: IconName; title: TranslationKey; subtitle: TranslationKey }[] = [
    { icon: "watch", title: "profile.smartwatch", subtitle: "profile.notConnected" },
    { icon: "shield", title: "profile.privacy", subtitle: "profile.permissions" },
  ];
  const toggleLanguage = () => {
    const nextLanguage: Language = language === "es" ? "en" : "es";
    void setLanguage(nextLanguage).catch(() => {
      Alert.alert(t("profile.language"), t("profile.languageSaveFailed"));
    });
  };
  return (
    <Page screen="profile" go={go} title={t("profile.title")}>
      <View style={styles.pageContent}>
        <View style={styles.profileId}><View style={styles.profileAvatar}><Txt style={styles.avatarText}>{patient.nombre.slice(0, 2).toUpperCase()}</Txt></View><View style={styles.flexOne}><Txt style={styles.profileName}>{patient.nombre}</Txt><Txt style={styles.mutedSmall}>{t("profile.patient")}</Txt></View></View>
        <Eyebrow>{t("profile.reminders")}</Eyebrow>
        <Card style={styles.settingsCard}>
          <SettingRow icon="clock" title={t("profile.mainSchedule")} subtitle={`${patient.hora_recordatorio_1.slice(0, 5)} ${t("profile.scheduleJoin")} ${patient.hora_recordatorio_2.slice(0, 5)}`} />
          <SettingRow icon="bell" title={t("profile.importantNotices")} subtitle={Boolean(patient.notif_importantes) ? t("profile.enabled") : t("profile.disabled")} />
        </Card>
        <Eyebrow>{t("profile.preferences")}</Eyebrow>
        <Card style={styles.settingsCard}>
          <Pressable onPress={toggleLanguage} accessibilityRole="button">
            <SettingRow icon="globe" title={t("profile.language")} subtitle={language === "es" ? t("profile.spanish") : t("profile.english")} right={<Txt style={styles.strong}>{language.toUpperCase()}</Txt>} />
          </Pressable>
          {settings.map((setting) => <SettingRow key={setting.title} icon={setting.icon} title={t(setting.title)} subtitle={t(setting.subtitle)} right={<Icon name="chevron" size={17} color={C.muted} />} />)}
          <Pressable onPress={() => go("clinic")}><SettingRow icon="heart" title={t("profile.clinicContact")} subtitle="Age Recovery · SLRC" right={<Icon name="chevron" size={17} color={C.muted} />} /></Pressable>
        </Card>
        <Pressable onPress={logout} style={styles.destructiveRow}><Icon name="logout" color={C.red} /><Txt style={styles.errorText}>{t("profile.logout")}</Txt></Pressable>
        <Pressable onPress={() => Alert.alert(t("profile.deleteData"), t("profile.deleteDataInfo"))} style={styles.destructiveRow}><Icon name="trash" color={C.red} /><Txt style={styles.errorText}>{t("profile.deleteData")}</Txt></Pressable>
        <Txt style={styles.version}>{t("profile.version")}</Txt>
      </View>
    </Page>
  );
}

function SettingRow({ icon, title, subtitle, right }: { icon: IconName; title: string; subtitle: string; right?: ReactNode }) {
  return <View style={styles.settingRow}><View style={styles.settingIcon}><Icon name={icon} color={C.light} /></View><View style={styles.flexOne}><Txt style={styles.strong}>{title}</Txt><Txt style={styles.mutedSmall}>{subtitle}</Txt></View>{right}</View>;
}

function Overlay({ error, close }: { error: "loading" | "error"; close?: () => void }) {
  const { t } = useT();
  return (
    <View style={styles.overlay}>
      <Card style={styles.overlayCard}>
        {error === "loading" ? <View style={styles.loader} /> : <Icon name="refresh" size={28} color={C.light} />}
        <Txt style={styles.strong}>{error === "loading" ? t("overlay.preparing") : t("common.noConnection")}</Txt>
        <Txt style={styles.mutedSmall}>{error === "loading" ? t("overlay.oneMoment") : t("overlay.offline")}</Txt>
        {close && <Button onPress={close}>{t("common.retry")}</Button>}
      </Card>
    </View>
  );
}

function AppContent() {
  const { t, translateError } = useT();
  const [screen, setScreen] = useState<Screen>("splash");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [patient, setPatient] = useState<Paciente | null>(null);
  const [selectedCare, setSelectedCare] = useState<Cuidado | null>(null);
  const [plan, setPlan] = useState<PlanPaciente | null>(null);
  const [care, setCare] = useState<Cuidado[]>([]);
  const [photos, setPhotos] = useState<FotoPaciente[]>([]);
  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>("loading");
  const [authReady, setAuthReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const go: Go = (next) => setScreen(next);
  const translationRef = useRef(t);
  translationRef.current = t;
  const onUnauthorized = useCallback(() => {
    setToken(null);
    setPatient(null);
    setScreen("login");
    void SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {
      Alert.alert(translationRef.current("alert.session"), translationRef.current("alert.loginAgain"));
    });
    void SecureStore.deleteItemAsync(`${SESSION_KEY}-patient`).catch(() => {
      Alert.alert(translationRef.current("alert.session"), translationRef.current("alert.loginAgain"));
    });
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      SecureStore.getItemAsync(SESSION_KEY),
      SecureStore.getItemAsync(`${SESSION_KEY}-patient`),
    ]).then(([savedToken, savedPatient]) => {
      if (!active) return;
      if (savedToken && savedPatient) {
        try {
          setToken(savedToken);
          setPatient(JSON.parse(savedPatient) as Paciente);
          setScreen("home");
        } catch {
          void SecureStore.deleteItemAsync(SESSION_KEY);
          void SecureStore.deleteItemAsync(`${SESSION_KEY}-patient`);
          setScreen("login");
        }
      }
    }).catch(() => {
      if (active) setScreen("login");
    }).finally(() => {
      if (active) setAuthReady(true);
    });
    return () => { active = false; };
  }, []);

  const finishLogin = useCallback(async (newToken: string, newPatient: Paciente) => {
    await SecureStore.setItemAsync(SESSION_KEY, newToken);
    await SecureStore.setItemAsync(`${SESSION_KEY}-patient`, JSON.stringify(newPatient));
    setToken(newToken);
    setPatient(newPatient);
    setPlan(null);
    setCare([]);
    setPhotos([]);
  }, []);

  useEffect(() => {
    if (!token || !["home", "plan", "history"].includes(screen)) return undefined;
    let active = true;
    setRemoteStatus("loading");
    const load = async () => {
      try {
        if (screen === "home" || screen === "plan") {
          const currentPlan = await getPlan(token, onUnauthorized);
          if (!active) return;
          setPlan(currentPlan);
          if (screen === "home") {
            const result = await getTodaysCare(token, onUnauthorized);
            if (!active) return;
            setCare(result.cuidados);
          }
          setRemoteStatus("ready");
        } else {
          const patientPhotos = await getPhotos(token, onUnauthorized);
          if (!active) return;
          setPhotos(patientPhotos);
          const downloaded = await downloadPatientPhotos(token, patientPhotos, onUnauthorized);
          if (!active) return;
          setPhotoUris(downloaded);
          setRemoteStatus("ready");
        }
      } catch (loadError) {
        if (!active) return;
        if (loadError instanceof ApiError && loadError.status === 404) {
          setPlan(null);
          setCare([]);
          setRemoteStatus("empty");
        } else {
          setRemoteStatus("error");
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [onUnauthorized, refreshKey, screen, token]);

  const retryRemote = useCallback(() => setRefreshKey((current) => current + 1), []);

  const refreshPhotosAfterUpload = useCallback(async () => {
    if (!token) throw new ApiError("Tu sesión terminó. Inicia sesión de nuevo.", 401, "http");
    const latestPhotos = await getPhotos(token, onUnauthorized);
    const latestUris = await downloadPatientPhotos(token, latestPhotos, onUnauthorized);
    setPhotos(latestPhotos);
    setPhotoUris(latestUris);
    setRemoteStatus("ready");
  }, [onUnauthorized, token]);

  const markPatientCare = useCallback(async (item: Cuidado) => {
    if (!token) return;
    const previousValue = care.find((careItem) => careItem.id_cuidado === item.id_cuidado)?.hecho ?? item.hecho;
    setCare((current) => current.map((careItem) => careItem.id_cuidado === item.id_cuidado
      ? { ...careItem, hecho: 1 }
      : careItem));
    setSelectedCare((current) => current?.id_cuidado === item.id_cuidado ? { ...current, hecho: 1 } : current);
    try {
      await markCare(token, item.id_cuidado, onUnauthorized);
    } catch (error) {
      setCare((current) => current.map((careItem) => careItem.id_cuidado === item.id_cuidado
        ? { ...careItem, hecho: previousValue }
        : careItem));
      setSelectedCare((current) => current?.id_cuidado === item.id_cuidado
        ? { ...current, hecho: previousValue }
        : current);
      Alert.alert(
        t("care.alertTitle"),
        error instanceof ApiError ? translateError(error.message) : t("care.updateFailed"),
      );
      throw error;
    }
  }, [care, onUnauthorized, t, token, translateError]);

  let content: ReactNode;
  switch (screen) {
    case "splash": content = <Splash go={go} />; break;
    case "consent": content = <Consent go={go} />; break;
    case "login": content = <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "home": content = patient
      ? <Home go={go} patient={patient} plan={plan} care={care} status={remoteStatus} retry={retryRemote} mark={markPatientCare} selectCare={(item) => { setSelectedCare(item); go("care"); }} />
      : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "plan": content = <Plan go={go} plan={plan} status={remoteStatus} retry={retryRemote} />; break;
    case "care": content = <CareDetail go={go} care={selectedCare} onMark={markPatientCare} />; break;
    case "chat": content = patient ? <Chat go={go} patient={patient} /> : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "alarm": content = token
      ? <Alarm go={go} token={token} onUnauthorized={onUnauthorized} />
      : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "photo": content = token
      ? <PhotoFollowup go={go} token={token} onUnauthorized={onUnauthorized} onUploaded={refreshPhotosAfterUpload} />
      : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "history": content = token
      ? <History go={go} photos={photos} photoUris={photoUris} status={remoteStatus} retry={retryRemote} />
      : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
    case "clinic": content = <Clinic go={go} />; break;
    case "profile": content = patient
      ? <Profile go={go} patient={patient} logout={() => {
        onUnauthorized();
        setPlan(null);
        setCare([]);
        setPhotos([]);
      }} />
      : <Login go={go} setLoading={setLoading} onLogin={finishLogin} />; break;
  }
  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {authReady ? content : <View style={styles.remoteState}><ActivityIndicator color={C.light} /><Txt style={styles.mutedSmall}>{t("common.loading")}</Txt></View>}
      {loading && <Overlay error="loading" />}
    </View>
  );
}

function FontMessage({ messageKey }: { messageKey: TranslationKey }) {
  const { t } = useT();
  return <View style={styles.fontError}><Text style={styles.text}>{t(messageKey)}</Text></View>;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakarta400: require("./src/assets/fonts/plus-jakarta-400.ttf"),
    PlusJakarta500: require("./src/assets/fonts/plus-jakarta-500.ttf"),
    PlusJakarta600: require("./src/assets/fonts/plus-jakarta-600.ttf"),
    Playfair500: require("./src/assets/fonts/playfair-500.ttf"),
    PlayfairItalic500: require("./src/assets/fonts/playfair-500-italic.ttf"),
  });
  if (fontError) {
    return <SafeAreaProvider><LanguageProvider><FontMessage messageKey="alert.fontsFailed" /></LanguageProvider></SafeAreaProvider>;
  }
  if (!fontsLoaded) {
    return <SafeAreaProvider><LanguageProvider><FontMessage messageKey="alert.appLoading" /></LanguageProvider></SafeAreaProvider>;
  }
  return <SafeAreaProvider><LanguageProvider><AppContent /></LanguageProvider></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.dark },
  safeArea: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 22 },
  withNav: { paddingBottom: 96 },
  withAlarm: { paddingTop: 4 },
  text: { color: C.white, fontFamily: "PlusJakarta400", fontSize: 14, lineHeight: 21 },
  title: { color: C.white, fontFamily: "Playfair500", fontSize: 30, lineHeight: 35, marginTop: 8, marginBottom: 18 },
  italic: { color: C.light, fontFamily: "PlayfairItalic500" },
  topbar: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingRight: 172, backgroundColor: "rgba(0,27,51,0.98)", borderBottomWidth: 1, borderBottomColor: C.border, zIndex: 2 },
  topbarCompact: { paddingLeft: 14, paddingRight: 70 },
  headerLogo: { width: 110, height: 36 },
  headerSpacer: { flex: 1 },
  topbarTitle: { flex: 1, textAlign: "center", fontFamily: "PlusJakarta500", fontSize: 15 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderColor: C.border, borderWidth: 1, borderRadius: 9 },
  backArrow: { fontSize: 30, lineHeight: 34, color: C.white, marginTop: -4 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.cyanSoft, borderColor: "rgba(79,184,232,0.4)", borderWidth: 1, alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.light, fontFamily: "PlusJakarta600", fontSize: 12 },
  bottomNav: { position: "absolute", bottom: 0, left: 0, right: 0, height: 76, flexDirection: "row", justifyContent: "space-around", backgroundColor: "rgba(1,22,40,0.99)", borderTopColor: C.border, borderTopWidth: 1, paddingHorizontal: 4, paddingTop: 7 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3 },
  navIconWrap: { minWidth: 32, alignItems: "center" },
  navIconActive: { borderTopWidth: 2, borderTopColor: C.cyan, paddingTop: 2 },
  navLabel: { color: "rgba(255,255,255,0.48)", fontSize: 10, fontFamily: "PlusJakarta500" },
  navLabelActive: { color: C.light },
  alarmFab: { position: "absolute", top: 8, right: 14, zIndex: 5, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.red, borderRadius: 8, paddingHorizontal: 10, elevation: 5 },
  alarmFabCompact: { width: 40, paddingHorizontal: 0 },
  alarmText: { fontFamily: "PlusJakarta600", fontSize: 11 },
  pageContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 32, gap: 14 },
  sampleNotice: { alignSelf: "center", color: "rgba(255,255,255,0.42)", fontSize: 9, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, textAlign: "center" },
  remoteState: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: 10, padding: 20 },
  eyebrow: { color: C.light, fontFamily: "PlusJakarta600", fontSize: 11, letterSpacing: 1.4, marginBottom: 9 },
  flexOne: { flex: 1 },
  card: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 11, padding: 15 },
  bodyCopy: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  mutedSmall: { color: C.muted, fontSize: 11, lineHeight: 17 },
  lead: { color: C.muted, fontSize: 14, lineHeight: 22 },
  subhead: { fontFamily: "PlusJakarta600", fontSize: 14, color: C.white, lineHeight: 20 },
  strong: { fontFamily: "PlusJakarta600", color: C.white, fontSize: 13 },
  linkText: { color: C.light, fontFamily: "PlusJakarta600", fontSize: 12 },
  button: { minHeight: 50, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14, marginTop: 14 },
  buttonPrimary: { backgroundColor: C.cyan },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.cyan },
  buttonDanger: { backgroundColor: C.red },
  buttonGhost: { backgroundColor: "transparent" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: "PlusJakarta600", fontSize: 13, color: C.white, textAlign: "center" },
  pressed: { opacity: 0.82 },
  splash: { flex: 1, minHeight: 680, justifyContent: "space-between", paddingHorizontal: 30, paddingTop: 70, paddingBottom: 32, overflow: "hidden", backgroundColor: C.bg },
  splashRing: { position: "absolute", top: -220, alignSelf: "center", width: 460, height: 460, borderRadius: 230, borderWidth: 1, borderColor: "rgba(184,148,86,0.18)" },
  splashLogo: { width: 220, height: 150, alignSelf: "center", marginTop: 12 },
  splashBottom: { gap: 12 },
  splashTitle: { fontSize: 34, lineHeight: 40, marginBottom: 0 },
  pageBody: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 30 },
  noticeCard: { flexDirection: "row", gap: 14, marginTop: 10, marginBottom: 22 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkbox: { width: 22, height: 22, borderWidth: 1, borderColor: C.muted, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxChecked: { backgroundColor: C.cyan, borderColor: C.cyan },
  consentText: { flex: 1, color: C.muted, fontSize: 13, lineHeight: 20 },
  gap16: { gap: 16 },
  privacyNote: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 22 },
  stickyCta: { marginTop: 28 },
  helper: { color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 8, textAlign: "center" },
  segmented: { flexDirection: "row", padding: 4, backgroundColor: C.dark, borderColor: C.border, borderWidth: 1, borderRadius: 9, marginTop: 20, marginBottom: 20 },
  segment: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 7 },
  segmentActive: { backgroundColor: C.cyanSoft },
  segmentText: { color: C.muted, fontSize: 12 },
  segmentTextActive: { color: C.light, fontFamily: "PlusJakarta600" },
  fieldLabel: { color: C.white, fontFamily: "PlusJakarta600", fontSize: 13, marginBottom: 8, marginTop: 12 },
  input: { height: 50, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.white, backgroundColor: C.card, paddingHorizontal: 14, fontFamily: "PlusJakarta400", fontSize: 14 },
  codeInput: { fontSize: 20, letterSpacing: 8, textAlign: "center" },
  fieldHelp: { color: C.muted, fontSize: 11, marginVertical: 11 },
  errorText: { color: C.red, fontSize: 12, lineHeight: 18 },
  successText: { color: C.success, fontSize: 13, lineHeight: 20 },
  loginLogo: { width: 170, height: 74, alignSelf: "center", marginBottom: 24 },
  spaceTop: { marginTop: 2 },
  supportLink: { flexDirection: "row", justifyContent: "center", marginTop: 22 },
  homePlaceholder: { flex: 1 },
  treatmentCard: { marginTop: 18, padding: 18 },
  photoHistoryCard: { gap: 10 },
  photoHistoryImage: { width: "100%", height: 240, borderRadius: 8, backgroundColor: C.dark },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  statusChip: { alignSelf: "flex-start", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, backgroundColor: C.cyanSoft, color: C.light, fontSize: 10, letterSpacing: 1, borderRadius: 4, marginBottom: 8 },
  cardTitle: { color: C.white, fontFamily: "Playfair500", fontSize: 22, lineHeight: 27, marginBottom: 5 },
  progressRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: "rgba(79,184,232,0.25)", borderRightColor: C.light, alignItems: "center", justifyContent: "center" },
  progressValue: { fontFamily: "PlusJakarta600", fontSize: 18 },
  smallPercent: { fontSize: 11 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 4, marginTop: 18, marginBottom: 11 },
  progressValueLine: { width: "28%", height: 4, backgroundColor: C.cyan, borderRadius: 4 },
  nextStep: { color: C.muted, fontSize: 11 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 4 },
  sectionTitle: { fontFamily: "Playfair500", color: C.white, fontSize: 19, lineHeight: 26 },
  careRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 12 },
  completed: { borderColor: "rgba(111,169,157,0.45)" },
  careMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  careIcon: { width: 38, height: 38, borderRadius: 9, backgroundColor: C.cyanSoft, alignItems: "center", justifyContent: "center" },
  checkButton: { width: 34, height: 34, borderWidth: 1, borderColor: C.border, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  checkButtonActive: { backgroundColor: C.success, borderColor: C.success },
  normalCard: { flexDirection: "row", gap: 12, marginTop: 4 },
  inlineLink: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  quickGrid: { flexDirection: "row", gap: 10, marginTop: 2 },
  quickAction: { flex: 1, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 9, padding: 10 },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 30, paddingBottom: 38, gap: 10 },
  emptyIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: C.cyanSoft, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  planHero: { height: 220, overflow: "hidden" },
  heroImage: { flex: 1, justifyContent: "flex-end", padding: 20 },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,12,25,0.48)" },
  heroText: { zIndex: 1 },
  thumbs: { gap: 8, paddingTop: 10, paddingBottom: 6 },
  thumb: { width: 98, height: 82, borderRadius: 8, overflow: "hidden", backgroundColor: C.card },
  thumbImage: { width: "100%", height: "100%", position: "absolute" },
  thumbText: { flex: 1, color: C.white, fontSize: 10, fontFamily: "PlusJakarta600", textAlignVertical: "bottom", padding: 5, backgroundColor: "rgba(0,12,25,0.42)" },
  timeline: { gap: 8, marginTop: 12 },
  timelineItem: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  timelineMarker: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", marginTop: 12 },
  timelineDone: { backgroundColor: C.success, borderColor: C.success },
  timelineNumber: { color: C.muted, fontSize: 11 },
  timelineCard: { flex: 1, padding: 12 },
  expand: { fontSize: 22, color: C.light, paddingHorizontal: 6 },
  dayDetail: { borderTopColor: C.border, borderTopWidth: 1, marginTop: 10, paddingTop: 10, gap: 8 },
  yes: { color: C.success, fontFamily: "PlusJakarta600", fontSize: 12 },
  no: { color: C.red, fontFamily: "PlusJakarta600", fontSize: 12 },
  featureIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.cyanSoft, alignItems: "center", justifyContent: "center", marginVertical: 5 },
  goldRule: { height: 1, width: 54, backgroundColor: C.gold, marginVertical: 10 },
  reminderCard: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 10 },
  aiBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: C.cyanSoft },
  chatArea: { flex: 1, paddingHorizontal: 18, paddingTop: 14 },
  assistantId: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  aiAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.cyanSoft, alignItems: "center", justifyContent: "center" },
  aiAvatarText: { color: C.light, fontFamily: "Playfair500", fontSize: 18 },
  online: { color: C.success, fontSize: 11 },
  bubble: { maxWidth: "88%", borderRadius: 12, padding: 12, marginBottom: 10 },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: C.card, borderTopLeftRadius: 3 },
  userBubble: { alignSelf: "flex-end", backgroundColor: C.brand, borderTopRightRadius: 3 },
  chatExpandButton: { alignSelf: "flex-start", paddingTop: 4 },
  chatExpandText: { color: C.light, fontSize: 11 },
  messageTime: { color: C.muted, fontSize: 9, textAlign: "right", marginTop: 5 },
  suggestions: { gap: 8, marginTop: 5 },
  typingText: { color: C.muted, fontSize: 12, fontStyle: "italic", marginBottom: 10 },
  chatFallback: { marginVertical: 10 },
  suggestion: { borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  chatInputWrap: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, backgroundColor: C.bg },
  chatInputRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingLeft: 12, paddingRight: 5 },
  chatInput: { flex: 1, minHeight: 46, color: C.white, fontFamily: "PlusJakarta400", fontSize: 13 },
  sendButton: { width: 38, height: 38, borderRadius: 8, backgroundColor: C.cyan, alignItems: "center", justifyContent: "center" },
  alarmContent: { flex: 1, paddingHorizontal: 22, paddingTop: 30, paddingBottom: 18, justifyContent: "center" },
  criticalIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(226,75,74,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  alarmActions: { gap: 4, marginTop: 20, marginBottom: 14 },
  notified: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  availability: { flexDirection: "row", gap: 10, alignItems: "center", padding: 17, borderTopWidth: 1, borderTopColor: C.border },
  onlineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.success },
  cameraView: { flex: 1, minHeight: 470, alignItems: "center", justifyContent: "center", backgroundColor: C.dark, padding: 20, gap: 12 },
  cameraPlaceholder: { ...StyleSheet.absoluteFill, width: undefined, height: undefined, opacity: 0.45 },
  faceGuide: { width: 218, height: 285, borderWidth: 1, borderColor: "rgba(255,255,255,0.65)", borderRadius: 110, borderStyle: "dashed" },
  cameraTip: { position: "absolute", top: 24, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.35)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  whiteSmall: { color: C.white, fontSize: 11, fontFamily: "PlusJakarta600" },
  shutter: { width: 68, height: 68, borderWidth: 3, borderColor: C.white, borderRadius: 34, alignItems: "center", justifyContent: "center", marginTop: 6 },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.white },
  preview: { height: 270, overflow: "hidden", borderRadius: 10, marginBottom: 4 },
  previewImage: { width: "100%", height: "100%" },
  repeatButton: { position: "absolute", right: 10, top: 10, flexDirection: "row", gap: 5, alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", padding: 8, borderRadius: 7 },
  dayChoices: { flexDirection: "row", gap: 8 },
  dayChoice: { flex: 1, alignItems: "center", paddingVertical: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 7 },
  dayChoiceActive: { backgroundColor: C.cyanSoft, borderColor: C.cyan },
  dayChoiceText: { color: C.white, fontFamily: "PlusJakarta600", fontSize: 12 },
  moodScale: { flexDirection: "row", justifyContent: "space-between", gap: 3, marginTop: 8 },
  moodChoice: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  moodActive: { backgroundColor: C.cyanSoft },
  moodFace: { fontSize: 22 },
  moodLabel: { color: C.muted, fontSize: 8, textAlign: "center" },
  commentInput: { minHeight: 90, textAlignVertical: "top", color: C.white, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, marginTop: 14, fontFamily: "PlusJakarta400" },
  compare: { height: 230, borderRadius: 10, overflow: "hidden", marginTop: 4, backgroundColor: C.card },
  compareImage: { width: "100%", height: "100%" },
  afterLayer: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
  compareLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: C.white, alignItems: "center", justifyContent: "center" },
  compareHandle: { width: 30, height: 30, overflow: "hidden", borderRadius: 15, backgroundColor: C.white, color: C.bg, textAlign: "center", textAlignVertical: "center", fontSize: 18 },
  beforeLabel: { position: "absolute", left: 9, bottom: 9, fontSize: 10, backgroundColor: "rgba(0,0,0,0.55)", padding: 5, borderRadius: 3 },
  afterLabel: { position: "absolute", right: 9, bottom: 9, fontSize: 10, backgroundColor: "rgba(0,0,0,0.55)", padding: 5, borderRadius: 3 },
  reviewCard: { gap: 9, marginTop: 14 },
  goldBadge: { color: C.gold, fontFamily: "PlusJakarta600", fontSize: 10, letterSpacing: 0.7 },
  doctorSign: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 5 },
  doctorAvatar: { width: 40, height: 40, borderRadius: 20 },
  photoGrid: { flexDirection: "row", gap: 8 },
  photoTile: { flex: 1, height: 110, borderRadius: 8, overflow: "hidden", backgroundColor: C.card },
  photoTileImage: { width: "100%", height: "100%", position: "absolute" },
  photoTileCaption: { flex: 1, justifyContent: "flex-end", padding: 7, backgroundColor: "rgba(0,0,0,0.25)" },
  clinicHero: { height: 240, justifyContent: "flex-end" },
  clinicHeroImage: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  clinicHeroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,12,25,0.48)" },
  clinicHeroText: { padding: 20, zIndex: 1 },
  addressCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  contactActions: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  contactAction: { flex: 1, minHeight: 72, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.card, borderRadius: 9 },
  appointmentCard: { gap: 14 },
  dateBlock: { flexDirection: "row", alignItems: "center", gap: 12 },
  dateNumber: { color: C.light, fontFamily: "Playfair500", fontSize: 32 },
  valuation: { gap: 8 },
  clinicStrip: { width: "100%", height: 150, borderRadius: 10 },
  profileId: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  profileAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.cyanSoft, borderWidth: 1, borderColor: C.light, alignItems: "center", justifyContent: "center" },
  profileName: { fontFamily: "Playfair500", fontSize: 19 },
  settingsCard: { paddingVertical: 3, marginBottom: 16, marginTop: 2 },
  settingRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  settingIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: C.cyanSoft },
  pushExample: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, backgroundColor: "rgba(0,138,196,0.1)", borderRadius: 9, marginBottom: 20 },
  toggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", justifyContent: "center", padding: 2 },
  toggleOn: { backgroundColor: C.cyan },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.white },
  toggleKnobOn: { alignSelf: "flex-end" },
  destructiveRow: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  version: { color: C.muted, textAlign: "center", fontSize: 10, padding: 20 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,12,25,0.72)", alignItems: "center", justifyContent: "center", padding: 30, zIndex: 20 },
  overlayCard: { width: "100%", alignItems: "center", gap: 12, padding: 24 },
  loader: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: C.cyan, borderTopColor: "transparent" },
  fontError: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg, padding: 24 },
});
