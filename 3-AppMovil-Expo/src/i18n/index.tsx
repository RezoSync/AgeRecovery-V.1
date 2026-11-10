import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { en, es, type TranslationKey } from "./translations";

export type Language = "es" | "en";

const LANGUAGE_STORAGE_KEY = "age-recovery-language";

const apiErrorKeys: Record<string, TranslationKey> = {
  "No se pudieron cargar las fotos.": "api.photoLoadFailed",
  "Tu sesión terminó. Inicia sesión de nuevo.": "common.sessionEnded",
  "Sin conexión. Revisa tu red e intenta de nuevo.": "common.noConnection",
  "Sin conexión": "common.noConnection",
  "No se pudo preparar la foto. Intenta de nuevo.": "api.photoPrepareFailed",
  "No se pudo completar la solicitud. Intenta de nuevo.": "api.requestFailed",
  "No encontramos información para mostrar.": "api.notFound",
  "No se pudo leer la respuesta. Intenta de nuevo.": "api.readFailed",
  "Escribe un mensaje antes de enviarlo.": "api.chatEmpty",
  "El asistente tardó demasiado. Intenta de nuevo.": "api.chatTimeout",
  "Has enviado muchos mensajes. Intenta de nuevo en un momento.": "api.chatRateLimit",
  "No pudimos completar la solicitud. Intenta de nuevo.": "chat.requestFailed",
  "No pudimos leer la respuesta. Intenta de nuevo.": "api.chatReadFailed",
  "Nombre inválido.": "registration.invalidName",
  "Correo inválido.": "registration.invalidEmail",
  "Has alcanzado el límite de registros. Intenta de nuevo más tarde.": "registration.rateLimit",
  "No se pudo enviar el correo. Intenta de nuevo.": "registration.emailFailed",
};

type TranslationContextValue = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  translateError: (message: string) => string;
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string;
};

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");
  const userChangedLanguage = useRef(false);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(LANGUAGE_STORAGE_KEY)
      .then((savedLanguage) => {
        if (active && !userChangedLanguage.current && (savedLanguage === "es" || savedLanguage === "en")) {
          setLanguageState(savedLanguage);
        }
      })
      .catch((error: unknown) => {
        console.warn("No se pudo cargar el idioma guardado.", error);
      });
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: Language) => {
    userChangedLanguage.current = true;
    await SecureStore.setItemAsync(LANGUAGE_STORAGE_KEY, nextLanguage);
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    let value = (language === "es" ? es : en)[key];
    if (params) {
      value = value.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
        String(params[name] ?? placeholder)
      ));
    }
    return value;
  }, [language]);

  const translateError = useCallback((message: string) => {
    const key = apiErrorKeys[message];
    return key ? t(key) : message;
  }, [t]);

  const formatDate = useCallback((date: Date | string, options?: Intl.DateTimeFormatOptions) => {
    const dateOnly = typeof date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
    const value = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : typeof date === "string" ? new Date(date) : date;
    const locale = language === "es" ? "es-MX" : "en-US";
    return new Intl.DateTimeFormat(locale, options).format(value);
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t,
    translateError,
    formatDate,
  }), [formatDate, language, setLanguage, t, translateError]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useT() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useT debe usarse dentro de LanguageProvider.");
  }
  return context;
}
