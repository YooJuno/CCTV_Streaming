import { useEffect, useMemo, useState } from "react";
import { fetchStreams, login } from "./api/client";
import LoginForm from "./components/LoginForm";
import StreamCard from "./components/StreamCard";
import type { AuthSession, StreamInfo } from "./types";

const AUTH_STORAGE_KEY = "cctv_auth_session_v1";
const HTTP_UNAUTHORIZED_PREFIX = "HTTP 401";

function loadStoredSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.username) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession | null) {
  if (!session) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(HTTP_UNAUTHORIZED_PREFIX);
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadStoredSession());
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [streamsError, setStreamsError] = useState<string | null>(null);

  const subtitle = useMemo(() => {
    if (!session) {
      return "MJPEG to HLS dashboard. Sign in to load your streams.";
    }
    return `Signed in as ${session.displayName}`;
  }, [session]);

  function expireSession() {
    setSession(null);
    setStreams([]);
    setStreamsError(null);
    setAuthError("Session expired. Please sign in again.");
    saveSession(null);
  }

  useEffect(() => {
    if (!session) {
      setStreams([]);
      return;
    }

    let cancelled = false;
    setLoadingStreams(true);
    setStreamsError(null);

    fetchStreams(session.token)
      .then((response) => {
        if (!cancelled) {
          setStreams(response.streams);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (isUnauthorizedError(error)) {
            expireSession();
            return;
          }
          const message = error instanceof Error ? error.message : "Failed to load streams.";
          setStreamsError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStreams(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleLogin(username: string, password: string) {
    setLoadingAuth(true);
    setAuthError(null);
    try {
      const result = await login(username, password);
      const nextSession: AuthSession = {
        token: result.accessToken,
        username: result.username,
        displayName: result.displayName,
      };
      setStreamsError(null);
      setSession(nextSession);
      setStreams(result.streams ?? []);
      saveSession(nextSession);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed.";
      setAuthError(message);
    } finally {
      setLoadingAuth(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setStreams([]);
    setAuthError(null);
    setStreamsError(null);
    saveSession(null);
  }

  async function refreshStreams() {
    if (!session) {
      return;
    }
    setLoadingStreams(true);
    setStreamsError(null);
    try {
      const response = await fetchStreams(session.token);
      setStreams(response.streams);
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        expireSession();
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to refresh streams.";
      setStreamsError(message);
    } finally {
      setLoadingStreams(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>CCTV Streaming Console</h1>
          <p>{subtitle}</p>
        </div>
        {session ? (
          <div className="topbar-actions">
            <button type="button" className="btn secondary" onClick={refreshStreams} disabled={loadingStreams}>
              {loadingStreams ? "Refreshing..." : "Refresh Streams"}
            </button>
            <button type="button" className="btn danger" onClick={handleLogout}>
              Logout
            </button>
          </div>
        ) : null}
      </header>

      {!session ? (
        <LoginForm loading={loadingAuth} errorMessage={authError} onSubmit={handleLogin} />
      ) : (
        <main>
          {streamsError ? <p className="error-text">{streamsError}</p> : null}

          {loadingStreams ? <p className="loading-text">Loading streams...</p> : null}

          {!loadingStreams && !streamsError && streams.length === 0 ? (
            <div className="empty-state">No streams available for this account.</div>
          ) : null}

          <section className="stream-grid">
            {streams.map((stream) => (
              <StreamCard key={stream.id} stream={stream} token={session.token} />
            ))}
          </section>
        </main>
      )}
    </div>
  );
}
