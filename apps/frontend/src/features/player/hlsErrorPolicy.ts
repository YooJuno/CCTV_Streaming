export const MAX_NETWORK_RETRIES = 5;
export const MAX_NOT_FOUND_RETRIES = 40;
export const RETRY_BASE_DELAY_MS = 500;
export const MAX_FATAL_RELOADS = 6;
export const FATAL_RELOAD_BASE_DELAY_MS = 1500;
export const MAX_MEDIA_RECOVERIES = 3;

export interface FatalErrorInput {
  type: string;
  httpCode?: number;
  details?: string;
}

export interface FatalErrorState {
  retryCount: number;
  notFoundRetryCount: number;
  fatalReloadCount: number;
  mediaRecoveryCount: number;
}

export type FatalErrorAction =
  | { kind: "unauthorized" }
  | { kind: "not-found-retry"; nextNotFoundRetryCount: number; delayMs: number; message: string }
  | { kind: "not-found-fatal"; message: string }
  | { kind: "network-retry"; nextRetryCount: number; delayMs: number; message: string }
  | { kind: "network-full-reload"; nextFatalReloadCount: number; delayMs: number; message: string }
  | { kind: "media-recovery"; nextMediaRecoveryCount: number; message: string }
  | { kind: "media-full-reload"; nextFatalReloadCount: number; delayMs: number; message: string }
  | { kind: "media-fatal"; message: string }
  | { kind: "fatal"; message: string };

export function decideFatalHlsErrorAction(input: FatalErrorInput, state: FatalErrorState): FatalErrorAction {
  const httpCode = input.httpCode;

  if (input.type === "networkError" && (httpCode === 401 || httpCode === 403)) {
    return { kind: "unauthorized" };
  }

  if (input.type === "networkError" && httpCode === 404) {
    if (state.notFoundRetryCount < MAX_NOT_FOUND_RETRIES) {
      const nextNotFoundRetryCount = state.notFoundRetryCount + 1;
      const delayMs = Math.min(5000, RETRY_BASE_DELAY_MS * nextNotFoundRetryCount);
      return {
        kind: "not-found-retry",
        nextNotFoundRetryCount,
        delayMs,
        message: `HLS stream is not generated yet (404). Waiting for pipeline... (${nextNotFoundRetryCount}/${MAX_NOT_FOUND_RETRIES})`,
      };
    }
    return {
      kind: "not-found-fatal",
      message: "HLS stream is not generated yet (404). Start the FFmpeg pipeline first.",
    };
  }

  const shouldRetryNetwork = input.type === "networkError" && state.retryCount < MAX_NETWORK_RETRIES && (!httpCode || httpCode >= 500);
  if (shouldRetryNetwork) {
    const nextRetryCount = state.retryCount + 1;
    const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
    return {
      kind: "network-retry",
      nextRetryCount,
      delayMs: RETRY_BASE_DELAY_MS * nextRetryCount,
      message: `Network issue detected${codeSuffix}. Retrying (${nextRetryCount}/${MAX_NETWORK_RETRIES})...`,
    };
  }

  if (input.type === "networkError" && state.fatalReloadCount < MAX_FATAL_RELOADS) {
    const nextFatalReloadCount = state.fatalReloadCount + 1;
    const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
    const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * nextFatalReloadCount);
    return {
      kind: "network-full-reload",
      nextFatalReloadCount,
      delayMs,
      message: `Persistent network issue${codeSuffix}. Reinitializing player (${nextFatalReloadCount}/${MAX_FATAL_RELOADS})...`,
    };
  }

  if (input.type === "mediaError") {
    if (state.mediaRecoveryCount < MAX_MEDIA_RECOVERIES) {
      const nextMediaRecoveryCount = state.mediaRecoveryCount + 1;
      return {
        kind: "media-recovery",
        nextMediaRecoveryCount,
        message: `Media decode issue detected. Attempting recovery (${nextMediaRecoveryCount}/${MAX_MEDIA_RECOVERIES})...`,
      };
    }

    if (state.fatalReloadCount < MAX_FATAL_RELOADS) {
      const nextFatalReloadCount = state.fatalReloadCount + 1;
      const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * nextFatalReloadCount);
      return {
        kind: "media-full-reload",
        nextFatalReloadCount,
        delayMs,
        message: `Media recovery limit reached. Reinitializing player (${nextFatalReloadCount}/${MAX_FATAL_RELOADS})...`,
      };
    }

    return {
      kind: "media-fatal",
      message: "Media decode failed repeatedly. Please restart stream source.",
    };
  }

  const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
  return {
    kind: "fatal",
    message: (input.details || "Fatal playback error.") + codeSuffix,
  };
}
