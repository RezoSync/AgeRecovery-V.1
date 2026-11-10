// Utilidades de seguridad del cliente.
// OJO: esta es solo la primera capa. La validación real debe repetirse en el backend.

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Quita caracteres de control/invisibles, normaliza espacios y recorta a `max`. */
export function sanitizeText(value: string, max = 500): string {
  return value
    .normalize("NFKC")
    .replace(CONTROL_CHARS, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function isValidClinicCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function isValidEmail(email: string): boolean {
  const e = email.trim();
  return e.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(e);
}

/** Limitador de ventana deslizante: `limit` eventos cada `windowMs`. */
export function createRateLimiter(limit: number, windowMs: number) {
  let stamps: number[] = [];
  return {
    /** true si el evento se permite (y lo registra). */
    take(): boolean {
      const now = Date.now();
      stamps = stamps.filter((t) => now - t < windowMs);
      if (stamps.length >= limit) return false;
      stamps.push(now);
      return true;
    },
  };
}

/** Bloqueo temporal tras N intentos fallidos. */
export function createLockout(maxAttempts: number, lockMs: number) {
  let fails = 0;
  let lockedUntil = 0;
  return {
    remainingMs(): number {
      return Math.max(0, lockedUntil - Date.now());
    },
    fail(): void {
      fails += 1;
      if (fails >= maxAttempts) {
        lockedUntil = Date.now() + lockMs;
        fails = 0;
      }
    },
    reset(): void {
      fails = 0;
      lockedUntil = 0;
    },
  };
}

export const LIMITS = {
  chatMessage: 500,
  doctorComment: 500,
  chatMessages: 6,
  chatWindowMs: 10_000,
  loginAttempts: 5,
  loginLockMs: 60_000,
} as const;
