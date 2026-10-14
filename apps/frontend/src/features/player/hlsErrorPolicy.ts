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
        message: `첫 영상이 준비되기를 기다리고 있습니다. (${nextNotFoundRetryCount}/${MAX_NOT_FOUND_RETRIES})`,
      };
    }
    return {
      kind: "not-found-fatal",
      message: "영상이 아직 준비되지 않았습니다. 카메라와 변환기 연결을 확인해 주세요.",
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
      message: `영상 서버에 다시 연결하고 있습니다${codeSuffix}. (${nextRetryCount}/${MAX_NETWORK_RETRIES})`,
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
      message: `연결이 지연되어 플레이어를 다시 시작합니다${codeSuffix}. (${nextFatalReloadCount}/${MAX_FATAL_RELOADS})`,
    };
  }

  if (input.type === "mediaError") {
    if (state.mediaRecoveryCount < MAX_MEDIA_RECOVERIES) {
      const nextMediaRecoveryCount = state.mediaRecoveryCount + 1;
      return {
        kind: "media-recovery",
        nextMediaRecoveryCount,
        message: `영상 재생을 복구하고 있습니다. (${nextMediaRecoveryCount}/${MAX_MEDIA_RECOVERIES})`,
      };
    }

    if (state.fatalReloadCount < MAX_FATAL_RELOADS) {
      const nextFatalReloadCount = state.fatalReloadCount + 1;
      const delayMs = Math.min(15000, FATAL_RELOAD_BASE_DELAY_MS * nextFatalReloadCount);
      return {
        kind: "media-full-reload",
        nextFatalReloadCount,
        delayMs,
        message: `영상을 새로 연결하고 있습니다. (${nextFatalReloadCount}/${MAX_FATAL_RELOADS})`,
      };
    }

    return {
      kind: "media-fatal",
      message: "영상을 정상적으로 읽지 못했습니다. 카메라 연결을 확인해 주세요.",
    };
  }

  const codeSuffix = httpCode ? ` (HTTP ${httpCode})` : "";
  return {
    kind: "fatal",
    message: "영상을 불러오지 못했습니다. 다시 연결해 주세요." + codeSuffix,
  };
}
