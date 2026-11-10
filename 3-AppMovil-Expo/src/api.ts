import { API_BASE_URL, CHATBOT_URL } from "./config";
import type { Cuidado, FotoPaciente, Paciente, PlanPaciente } from "./data";
import { sanitizeText } from "./lib/security";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: "network" | "timeout" | "http" | "response" = "response",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
  onUnauthorized?: () => void,
  httpErrorMessage?: string,
  useServerErrorMessage = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (__DEV__) {
      console.log("API network error:", detail);
    }
    if (/FormData/i.test(detail)) {
      throw new ApiError("No se pudo preparar la foto. Intenta de nuevo.", undefined, "response");
    }
    throw new ApiError("Sin conexión. Revisa tu red e intenta de nuevo.", undefined, "network");
  }

  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
  }
  if (!response.ok) {
    const body = await response.text();
    if (__DEV__) {
      console.log(`API HTTP ${response.status}:`, body);
    }
    let serverErrorMessage: string | undefined;
    if (useServerErrorMessage) {
      try {
        const result: unknown = JSON.parse(body);
        if (typeof result === "object" && result !== null
          && "error" in result && typeof result.error === "string") {
          serverErrorMessage = result.error;
        }
      } catch {
        serverErrorMessage = undefined;
      }
    }
    const message = response.status === 401
      ? "Tu sesión terminó. Inicia sesión de nuevo."
      : serverErrorMessage ?? httpErrorMessage ?? (response.status === 404
        ? "No encontramos información para mostrar."
        : "No se pudo completar la solicitud. Intenta de nuevo.");
    throw new ApiError(message, response.status, "http");
  }

  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new ApiError("No se pudo leer la respuesta. Intenta de nuevo.", response.status, "response");
  }
}

export function loginWithCode(code: string): Promise<{ token: string; paciente: Paciente }> {
  return request("/api/login", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: code }),
  });
}

export function registerPatient(
  name: string,
  email: string,
): Promise<{ ok: true; mensaje: string }> {
  return request("/api/registro", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: name, correo: email }),
  }, undefined, undefined, true);
}

export function getPlan(token: string, onUnauthorized: () => void): Promise<PlanPaciente> {
  return request("/api/plan", token, {}, onUnauthorized);
}

export function getTodaysCare(token: string, onUnauthorized: () => void): Promise<{ fecha: string; cuidados: Cuidado[] }> {
  return request("/api/cuidados/hoy", token, {}, onUnauthorized);
}

export function markCare(token: string, careId: number, onUnauthorized: () => void): Promise<{ ok: true }> {
  return request(`/api/cuidados/${careId}/marcar`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }, onUnauthorized);
}

export function getPhotos(token: string, onUnauthorized: () => void): Promise<FotoPaciente[]> {
  return request<{ fotos: FotoPaciente[] }>("/api/fotos", token, {}, onUnauthorized)
    .then((response) => response.fotos);
}

export function uploadPhoto(
  token: string,
  form: FormData,
  onUnauthorized: () => void,
): Promise<{ id: string; fecha: string }> {
  return request(
    "/api/fotos",
    token,
    { method: "POST", body: form },
    onUnauthorized,
    "No se pudo subir la foto.",
  );
}

export function notifyAlarm(
  token: string,
  symptom: string,
  onUnauthorized: () => void,
): Promise<{ ok: true }> {
  return request("/api/alarmas", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(symptom ? { sintoma: symptom } : {}),
  }, onUnauthorized);
}

export function photoDownloadUrl(photoId: string): string {
  return `${API_BASE_URL}/api/fotos/${encodeURIComponent(photoId)}`;
}

export async function sendChatMessage(
  message: string,
  conversationId: string | null,
  sig: string | null,
): Promise<{ reply: string; conversation_id: string; conversation_sig?: string }> {
  const cleanMessage = sanitizeText(message, 1000);
  if (!cleanMessage) {
    throw new ApiError("Escribe un mensaje antes de enviarlo.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  const body: { message: string; conversation_id?: string; conversation_sig?: string } = {
    message: cleanMessage,
  };
  if (conversationId) body.conversation_id = conversationId;
  if (sig) body.conversation_sig = sig;

  try {
    let response: Response;
    try {
      response = await fetch(`${CHATBOT_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new ApiError("El asistente tardó demasiado. Intenta de nuevo.", undefined, "timeout");
      }
      throw new ApiError("Sin conexión", undefined, "network");
    }

    if (!response.ok) {
      let serverMessage: string | undefined;
      const responseBody = await response.text();
      try {
        const result: unknown = JSON.parse(responseBody);
        if (typeof result === "object" && result !== null && "error" in result
          && typeof result.error === "string") {
          serverMessage = sanitizeText(result.error, 1000) || undefined;
        }
      } catch {
        serverMessage = undefined;
      }
      if (__DEV__) {
        console.log(`Chat HTTP ${response.status}`);
        if (serverMessage) console.log(serverMessage);
      }
      if (response.status === 429) {
        throw new ApiError(
          serverMessage ?? "Has enviado muchos mensajes. Intenta de nuevo en un momento.",
          response.status,
          "http",
        );
      }
      if (response.status === 403 || response.status === 422) {
        throw new ApiError("Empecemos una conversación nueva", response.status, "http");
      }
      throw new ApiError("No pudimos completar la solicitud. Intenta de nuevo.", response.status, "http");
    }

    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null
      || !("reply" in result) || typeof result.reply !== "string"
      || !("conversation_id" in result) || typeof result.conversation_id !== "string") {
      throw new ApiError("No pudimos leer la respuesta. Intenta de nuevo.", response.status, "response");
    }
    return {
      reply: result.reply
        .replace(/【[^】]*】/g, "")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim(),
      conversation_id: result.conversation_id,
      ...("conversation_sig" in result && typeof result.conversation_sig === "string"
        ? { conversation_sig: result.conversation_sig }
        : {}),
    };
  } catch (error) {
    if (__DEV__ && error instanceof ApiError) {
      console.log(`Chat error: ${error.name}: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
