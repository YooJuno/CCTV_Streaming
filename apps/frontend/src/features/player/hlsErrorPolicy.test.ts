import { describe, expect, it } from "vitest";
import {
  MAX_NOT_FOUND_RETRIES,
  MAX_MEDIA_RECOVERIES,
  decideFatalHlsErrorAction,
} from "./hlsErrorPolicy";

describe("hlsErrorPolicy", () => {
  it("returns unauthorized action for 401/403 network errors", () => {
    const action = decideFatalHlsErrorAction(
      { type: "networkError", httpCode: 401 },
      { retryCount: 0, notFoundRetryCount: 0, fatalReloadCount: 0, mediaRecoveryCount: 0 },
    );

    expect(action.kind).toBe("unauthorized");
  });

  it("retries 404 until limit then fails", () => {
    const retryAction = decideFatalHlsErrorAction(
      { type: "networkError", httpCode: 404 },
      { retryCount: 0, notFoundRetryCount: 3, fatalReloadCount: 0, mediaRecoveryCount: 0 },
    );
    expect(retryAction.kind).toBe("not-found-retry");

    const fatalAction = decideFatalHlsErrorAction(
      { type: "networkError", httpCode: 404 },
      { retryCount: 0, notFoundRetryCount: MAX_NOT_FOUND_RETRIES, fatalReloadCount: 0, mediaRecoveryCount: 0 },
    );
    expect(fatalAction.kind).toBe("not-found-fatal");
  });

  it("handles network retry for server-side errors", () => {
    const action = decideFatalHlsErrorAction(
      { type: "networkError", httpCode: 503 },
      { retryCount: 1, notFoundRetryCount: 0, fatalReloadCount: 0, mediaRecoveryCount: 0 },
    );

    expect(action.kind).toBe("network-retry");
    if (action.kind === "network-retry") {
      expect(action.nextRetryCount).toBe(2);
      expect(action.message).toContain("HTTP 503");
    }
  });

  it("attempts media recovery before escalating", () => {
    const recoveryAction = decideFatalHlsErrorAction(
      { type: "mediaError" },
      {
        retryCount: 0,
        notFoundRetryCount: 0,
        fatalReloadCount: 0,
        mediaRecoveryCount: MAX_MEDIA_RECOVERIES - 1,
      },
    );
    expect(recoveryAction.kind).toBe("media-recovery");

    const escalationAction = decideFatalHlsErrorAction(
      { type: "mediaError" },
      {
        retryCount: 0,
        notFoundRetryCount: 0,
        fatalReloadCount: 1,
        mediaRecoveryCount: MAX_MEDIA_RECOVERIES,
      },
    );
    expect(escalationAction.kind).toBe("media-full-reload");
  });
});
