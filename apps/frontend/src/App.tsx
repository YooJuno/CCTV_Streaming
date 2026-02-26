import { useEffect, useMemo } from "react";
import LoginForm from "./components/LoginForm";
import StreamCard from "./components/StreamCard";
import useAuthSession from "./features/auth/useAuthSession";
import { isUnauthorizedErrorMessage } from "./features/common/httpError";
import useHealthPolling from "./features/health/useHealthPolling";
import useStreamsQuery from "./features/streams/useStreamsQuery";
import useSystemHealthQuery from "./features/system/useSystemHealthQuery";

export default function App() {
  const {
    session,
    restoringSession,
    loadingAuth,
    authError,
    login,
    logout,
    expireSession,
  } = useAuthSession();

  const { streams, loadingStreams, streamsError, refreshStreams } = useStreamsQuery(session);
  const { streamHealthById, liveThresholdSeconds, healthPollMs, healthWarning } = useHealthPolling(session);
  const { systemRecommendations, hlsStorage } = useSystemHealthQuery(session);

  useEffect(() => {
    if (isUnauthorizedErrorMessage(streamsError) || isUnauthorizedErrorMessage(healthWarning)) {
      expireSession();
    }
  }, [expireSession, healthWarning, streamsError]);

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
            <button type="button" className="btn ghost" onClick={() => void refreshStreams()} disabled={loadingStreams}>
              {loadingStreams ? "Refreshing..." : "Refresh Streams"}
            </button>
            <button type="button" className="btn danger" onClick={() => void logout()}>
              Logout
            </button>
            <span className="polling-note">Health poll: {(healthPollMs / 1000).toFixed(1)}s</span>
          </div>
        ) : null}
      </header>

      {restoringSession ? <p className="loading-text">Restoring session...</p> : null}

      {restoringSession ? null : !session ? (
        <LoginForm loading={loadingAuth} errorMessage={authError} onSubmit={login} />
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
            <article className="overview-card storage">
              <span className="overview-label">HLS Storage</span>
              <strong>{hlsStorage && hlsStorage.exists && hlsStorage.writable ? "OK" : "CHECK"}</strong>
              <p>
                {hlsStorage
                  ? `${hlsStorage.manifestCount} manifests, ${hlsStorage.segmentCount} segments`
                  : "Waiting for backend health details"}
              </p>
            </article>
          </section>

          {streamsError ? <p className="error-text">{streamsError}</p> : null}
          {healthWarning ? <p className="warning-text">{healthWarning}</p> : null}
          {systemRecommendations.length > 0 ? (
            <section className="system-recommendations">
              <strong>System guidance</strong>
              <ul>
                {systemRecommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

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
