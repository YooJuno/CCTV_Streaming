import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMe, fetchStreamHealth, fetchStreams, login, logout } from "./api/client";
import LoginForm from "./components/LoginForm";
import StreamCard from "./components/StreamCard";
import type { AuthSession, StreamHealth, StreamInfo } from "./types";

const HTTP_UNAUTHORIZED_PREFIX = "HTTP 401";

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(HTTP_UNAUTHORIZED_PREFIX);
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [streamHealthById, setStreamHealthById] = useState<Record<string, StreamHealth>>({});
  const [liveThresholdSeconds, setLiveThresholdSeconds] = useState<number>(0);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [streamsError, setStreamsError] = useState<string | null>(null);
  const skipNextAutoFetchRef = useRef(false);

  const subtitle = useMemo(() => {
    if (!session) {
      return "MJPEG to HLS dashboard. Sign in to load your streams.";
    }
    return `Signed in as ${session.displayName}`;
  }, [session]);

  const healthSummary = useMemo(() => {
    let live = 0;
    let offline = 0;
    let checking = 0;

    for (const stream of streams) {
      const health = streamHealthById[stream.id];
      if (!health) {
        checking += 1;
        continue;
      }
      if (health.live) {
        live += 1;
      } else {
        offline += 1;
      }
    }

    return {
      total: streams.length,
      live,
      offline,
      checking,
    };
  }, [streamHealthById, streams]);

  function expireSession() {
    setSession(null);
    setStreams([]);
    setStreamHealthById({});
    setLiveThresholdSeconds(0);
    setStreamsError(null);
    setAuthError("Session expired. Please sign in again.");
  }

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((response) => {
        if (cancelled) {
          return;
        }
        skipNextAutoFetchRef.current = true;
        setSession({
          username: response.username,
          displayName: response.displayName,
        });
        setStreams(response.streams ?? []);
        setStreamsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (!isUnauthorizedError(error)) {
          const message = error instanceof Error ? error.message : "Failed to restore session.";
          setAuthError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestoringSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function clearAuthState() {
    setSession(null);
    setStreams([]);
    setStreamHealthById({});
    setLiveThresholdSeconds(0);
    setAuthError(null);
    setStreamsError(null);
  }

  useEffect(() => {
    if (!session) {
      setStreams([]);
      return;
    }
    if (skipNextAutoFetchRef.current) {
      skipNextAutoFetchRef.current = false;
      return;
    }

    let cancelled = false;
    setLoadingStreams(true);
    setStreamsError(null);

    fetchStreams()
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

  useEffect(() => {
    if (!session) {
      setStreamHealthById({});
      setLiveThresholdSeconds(0);
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const fetchHealth = async () => {
      try {
        const response = await fetchStreamHealth();
        if (cancelled) {
          return;
        }
        const nextMap: Record<string, StreamHealth> = {};
        for (const item of response.streams) {
          nextMap[item.id] = item;
        }
        setStreamHealthById(nextMap);
        setLiveThresholdSeconds(response.liveThresholdSeconds);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          expireSession();
        }
      }
    };

    void fetchHealth();
    timerId = window.setInterval(() => {
      void fetchHealth();
    }, 4000);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [session]);

  async function handleLogin(username: string, password: string) {
    setLoadingAuth(true);
    setAuthError(null);
    try {
      const result = await login(username, password);
      const nextSession: AuthSession = {
        username: result.username,
        displayName: result.displayName,
      };
      skipNextAutoFetchRef.current = true;
      setStreamsError(null);
      setSession(nextSession);
      setStreams(result.streams ?? []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed.";
      setAuthError(message);
    } finally {
      setLoadingAuth(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore logout API errors and clear local state anyway
    } finally {
      clearAuthState();
    }
  }

  async function refreshStreams() {
    if (!session) {
      return;
    }
    setLoadingStreams(true);
    setStreamsError(null);
    try {
      const response = await fetchStreams();
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
        <div className="topbar-title-block">
          <p className="topbar-kicker">CCTV OPERATIONS</p>
          <h1>Streaming Control Deck</h1>
          <p>{subtitle}</p>
        </div>
        {session ? (
          <div className="topbar-actions">
            <button type="button" className="btn ghost" onClick={refreshStreams} disabled={loadingStreams}>
              {loadingStreams ? "Refreshing..." : "Refresh Streams"}
            </button>
            <button type="button" className="btn danger" onClick={() => void handleLogout()}>
              Logout
            </button>
            <span className="polling-note">Health poll: 4s</span>
          </div>
        ) : null}
      </header>

      {restoringSession ? <p className="loading-text">Restoring session...</p> : null}

      {restoringSession ? null : !session ? (
        <LoginForm loading={loadingAuth} errorMessage={authError} onSubmit={handleLogin} />
      ) : (
        <main className="dashboard-main">
          <section className="overview-grid">
            <article className="overview-card total">
              <span className="overview-label">Authorized Streams</span>
              <strong>{healthSummary.total}</strong>
              <p>Visible to your account</p>
            </article>
            <article className="overview-card live">
              <span className="overview-label">Live Now</span>
              <strong>{healthSummary.live}</strong>
              <p>Manifest updated within {liveThresholdSeconds || 12}s</p>
            </article>
            <article className="overview-card offline">
              <span className="overview-label">Offline</span>
              <strong>{healthSummary.offline}</strong>
              <p>{healthSummary.checking > 0 ? `${healthSummary.checking} checking` : "No pending checks"}</p>
            </article>
          </section>

          {streamsError ? <p className="error-text">{streamsError}</p> : null}

          {loadingStreams ? <p className="loading-text">Loading streams...</p> : null}

          {!loadingStreams && !streamsError && streams.length === 0 ? (
            <div className="empty-state">
              <strong>No stream assignments for this account.</strong>
              <p>Check `AUTH_USERS` permissions or stream catalog configuration in backend.</p>
            </div>
          ) : null}

          <section className="stream-grid">
            {streams.map((stream) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                health={streamHealthById[stream.id]}
                liveThresholdSeconds={liveThresholdSeconds}
              />
            ))}
          </section>
        </main>
      )}
    </div>
  );
}
