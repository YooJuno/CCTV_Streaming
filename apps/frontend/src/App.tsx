import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import LoginForm from "./components/LoginForm";
import StreamCard, {
  guidanceFromHealth,
  streamStateLabel,
  streamStateTone,
} from "./components/StreamCard";
import DeviceInstaller from "./components/DeviceInstaller";
import useAuthSession from "./features/auth/useAuthSession";
import { isUnauthorizedErrorMessage } from "./features/common/httpError";
import useHealthPolling from "./features/health/useHealthPolling";
import useStreamsQuery from "./features/streams/useStreamsQuery";
import useSystemHealthQuery from "./features/system/useSystemHealthQuery";

const NAV_ITEMS = [
  { id: "monitor", label: "실시간 관제", icon: "camera" },
  { id: "system", label: "시스템 상태", icon: "activity" },
  { id: "install", label: "장비 설치", icon: "device" },
] as const;
type Section = (typeof NAV_ITEMS)[number]["id"];
type Filter = "all" | "live" | "attention" | "offline";
function Icon({ name, className = "" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="3" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </>
    ),
    device: (
      <>
        <rect x="5" y="3" width="14" height="14" rx="3" />
        <path d="M9 21h6m-3-4v4m-3-11h6m-3-3v6" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    focus: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 8h3m-3 0v3m10 5h-3m3 0v-3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H5v16h5m5-12 4 4-4 4m-6-4h10" />
      </>
    ),
    storage: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M6 18 18 6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 4 6v5c0 5 8 10 8 10s8-5 8-10V6l-8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      className={`ui-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.camera}
    </svg>
  );
}
function localizeRecommendation(text: string): string {
  const labels: Record<string, string> = {
    "All authorized streams are healthy.":
      "모든 카메라가 정상적으로 영상을 송출하고 있습니다.",
    "HLS directory is missing. Create it and verify hls.path configuration.":
      "영상 저장소가 없습니다. 서버 저장 경로를 확인하고 디렉터리를 생성하세요.",
    "HLS directory is not readable. Check filesystem permissions.":
      "영상 저장소를 읽을 수 없습니다. 서버의 파일 접근 권한을 확인하세요.",
    "HLS directory is not writable. Converter cannot publish segments.":
      "영상 저장소에 기록할 수 없습니다. 변환 프로세스의 쓰기 권한을 확인하세요.",
    "No authorized streams for this account. Verify AUTH_USERS stream assignments.":
      "이 계정에 등록된 카메라가 없습니다. 관리자에게 접근 권한을 문의하세요.",
    "No authorized streams for this account.":
      "이 계정에 등록된 카메라가 없습니다. 관리자에게 접근 권한을 문의하세요.",
    "Manifest is stale. Check camera connectivity and restart converter if needed.":
      "영상 업데이트가 멈췄습니다. 장비 연결을 확인하고 필요하면 변환 프로세스를 다시 시작하세요.",
    "Segment files are broken or missing. Restart converter and inspect ffmpeg logs.":
      "영상 파일이 없거나 손상되었습니다. 변환 프로세스를 다시 시작하고 로그를 확인하세요.",
    "Backend cannot read manifests. Check hls.path and directory ownership.":
      "서버에서 영상 목록을 읽을 수 없습니다. 저장 경로와 디렉터리 접근 권한을 확인하세요.",
    "Stream check in progress. Wait a few seconds and refresh health.":
      "카메라 상태를 확인하고 있습니다. 잠시 후 상태가 자동으로 갱신됩니다.",
  };
  if (text.startsWith("Manifest missing. Start converter:"))
    return "영상이 아직 연결되지 않았습니다. 장비 설치에서 연결 정보를 확인하고 영상 변환을 시작하세요.";
  return labels[text] ?? text;
}

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
  const { streams, loadingStreams, streamsError, refreshStreams } =
    useStreamsQuery(session);
  const {
    streamHealthById,
    liveThresholdSeconds,
    healthPollMs,
    healthWarning,
  } = useHealthPolling(session);
  const { systemRecommendations, hlsStorage } = useSystemHealthQuery(session);
  const [section, setSection] = useState<Section>("monitor");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "focus">("grid");
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (
      isUnauthorizedErrorMessage(streamsError) ||
      isUnauthorizedErrorMessage(healthWarning)
    )
      expireSession();
  }, [expireSession, healthWarning, streamsError]);
  useEffect(() => {
    if (!session) {
      setMenuOpen(false);
      setSearch("");
      setFilter("all");
      setSection("monitor");
    }
  }, [session]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>(".nav-item")?.focus();
    const closeOnResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key !== "Tab") return;
      const controls = sidebarRef.current?.querySelectorAll<
        HTMLButtonElement | HTMLAnchorElement
      >("button:not([disabled]), a[href]");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [menuOpen]);

  const healthSummary = useMemo(() => {
    let live = 0;
    let attention = 0;
    let offline = 0;
    let checking = 0;
    streams.forEach((stream) => {
      const health = streamHealthById[stream.id];
      if (!health) checking += 1;
      else if (health.state === "LIVE") live += 1;
      else if (["STARTING", "STALE", "ERROR"].includes(health.state))
        attention += 1;
      else offline += 1;
    });
    return { total: streams.length, live, attention, offline, checking };
  }, [streamHealthById, streams]);
  const visibleStreams = useMemo(
    () =>
      streams.filter((stream) => {
        const health = streamHealthById[stream.id];
        const searchMatches = `${stream.name} ${stream.id}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase());
        const stateMatches =
          filter === "all" ||
          (filter === "live" && health?.state === "LIVE") ||
          (filter === "attention" &&
            health &&
            ["STARTING", "STALE", "ERROR"].includes(health.state)) ||
          (filter === "offline" && health?.state === "OFFLINE");
        return searchMatches && stateMatches;
      }),
    [filter, search, streamHealthById, streams],
  );
  const storageHealthy =
    hlsStorage?.exists && hlsStorage.readable && hlsStorage.writable;
  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
  const changeSection = (next: Section) => {
    setSection(next);
    if (menuOpen) closeMenu();
  };
  const headings: Record<
    Section,
    { title: string; subtitle: string; kicker: string }
  > = {
    monitor: {
      title: "실시간 관제",
      subtitle: "모든 카메라의 연결 상태와 영상을 한눈에 확인하세요.",
      kicker: "LIVE MONITORING",
    },
    system: {
      title: "시스템 상태",
      subtitle: "영상 저장소와 카메라의 상태를 실시간으로 살펴보세요.",
      kicker: "SYSTEM HEALTH",
    },
    install: {
      title: "장비 설치",
      subtitle: "새로운 장비를 연결하고 관제를 준비하세요.",
      kicker: "DEVICE SETUP",
    },
  };

  if (restoringSession)
    return (
      <main className="session-loading" aria-busy="true">
        <span className="brand-mark">
          <Icon name="camera" />
        </span>
        <p role="status">관제 환경을 불러오고 있습니다…</p>
      </main>
    );
  if (!session)
    return (
      <LoginForm
        loading={loadingAuth}
        errorMessage={authError}
        onSubmit={login}
      />
    );

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        본문으로 바로가기
      </a>
      {menuOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="메뉴 닫기"
          onClick={closeMenu}
          tabIndex={-1}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        id="app-navigation"
        className={`sidebar${menuOpen ? " open" : ""}`}
        aria-label="주 메뉴"
      >
        <div className="sidebar-brand-row">
          <a
            className="brand"
            href="#main-content"
            onClick={() => changeSection("monitor")}
            aria-label="FRAME 실시간 관제"
          >
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </span>
            <span>
              FRAME<span className="brand-caption">CAMERA OPERATIONS</span>
            </span>
          </a>
          <button
            className="icon-button mobile-close"
            type="button"
            aria-label="메뉴 닫기"
            onClick={closeMenu}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-icon">
            <Icon name="shield" />
          </span>
          <div>
            <strong>CCTV 관제 시스템</strong>
            <span>안전한 공간을 위한 시야</span>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="관제 기능">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item${section === item.id ? " active" : ""}`}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => changeSection(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "monitor" ? (
                <span className="nav-count">{streams.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span
            className={`status-dot ${healthWarning ? "attention" : hlsStorage ? "live" : "checking"}`}
          />
          <div>
            <strong>
              {healthWarning
                ? "상태 확인 지연"
                : hlsStorage
                  ? "상태 자동 확인 중"
                  : "서버 상태 확인 중"}
            </strong>
            <p>{(healthPollMs / 1000).toFixed(1)}초 간격으로 확인</p>
          </div>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar" aria-hidden="true">
            {(session.displayName || session.username)
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <div>
            <strong>{session.displayName}</strong>
            <span>{session.username}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="로그아웃"
            onClick={() => void logout()}
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-topbar">
          <div className="topbar-leading">
            <button
              ref={menuButtonRef}
              className="icon-button mobile-menu"
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={menuOpen}
              aria-controls="app-navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">
              워크스페이스 <span aria-hidden="true">/</span>{" "}
              <strong>{headings[section].title}</strong>
            </span>
          </div>
          <span className="access-badge">
            <Icon name="shield" />
            접근 권한 확인됨
          </span>
        </header>
        <main className="dashboard-main" id="main-content" tabIndex={-1}>
          <section className="page-heading">
            <div>
              <p className="eyebrow">{headings[section].kicker}</p>
              <h1>
                {headings[section].title}
                <span className="heading-dot" aria-hidden="true">
                  .
                </span>
              </h1>
              <p className="page-subtitle">{headings[section].subtitle}</p>
            </div>
            {section !== "install" ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => void refreshStreams()}
                disabled={loadingStreams}
              >
                <Icon
                  name="refresh"
                  className={loadingStreams ? "spinning" : ""}
                />
                {loadingStreams ? "목록 갱신 중…" : "목록 새로고침"}
              </button>
            ) : null}
          </section>
          {streamsError ? (
            <p className="error-text" role="alert">
              {streamsError}
            </p>
          ) : null}
          {healthWarning ? (
            <div className="warning-text" role="status">
              <strong>최신 상태 확인이 지연되고 있습니다.</strong>
              <p>{healthWarning}</p>
              <span>카메라 상태와 수치는 마지막 확인 결과입니다.</span>
            </div>
          ) : null}
          {authError ? (
            <p className="error-text" role="alert">
              {authError}
            </p>
          ) : null}
          <div hidden={section !== "install"}>
            <DeviceInstaller />
          </div>
          {section !== "install" ? (
            <>
              <section className="overview-grid" aria-label="관제 요약">
                <article className="overview-card">
                  <div className="overview-card-top">
                    <span className="overview-label">전체 카메라</span>
                    <Icon name="camera" />
                  </div>
                  <strong>
                    {healthSummary.total}
                    <span>대</span>
                  </strong>
                  <p>접근 권한이 있는 카메라</p>
                </article>
                <article className="overview-card live">
                  <div className="overview-card-top">
                    <span className="overview-label">
                      <span className="status-dot" />
                      정상 송출
                    </span>
                    <Icon name="activity" />
                  </div>
                  <strong>
                    {healthSummary.live}
                    <span>대</span>
                  </strong>
                  <p>
                    {healthWarning
                      ? "마지막 확인 기준"
                      : `최근 ${liveThresholdSeconds || 12}초 내 영상 갱신`}
                  </p>
                </article>
                <article className="overview-card attention">
                  <div className="overview-card-top">
                    <span className="overview-label">확인 필요</span>
                    <span className="overview-alert-icon" aria-hidden="true">
                      !
                    </span>
                  </div>
                  <strong>
                    {healthSummary.attention + healthSummary.offline}
                    <span>대</span>
                  </strong>
                  <p>
                    {healthSummary.checking > 0
                      ? `${healthSummary.checking}대 상태 확인 중`
                      : `주의 ${healthSummary.attention} · 오프라인 ${healthSummary.offline}`}
                  </p>
                </article>
                <article className="overview-card storage">
                  <div className="overview-card-top">
                    <span className="overview-label">영상 저장소</span>
                    <Icon name="storage" />
                  </div>
                  <strong className="storage-value">
                    {!hlsStorage
                      ? "확인 중"
                      : storageHealthy
                        ? "정상"
                        : "점검 필요"}
                    <span
                      className={`status-dot ${storageHealthy ? "live" : hlsStorage ? "attention" : "checking"}`}
                    />
                  </strong>
                  <p>
                    {hlsStorage
                      ? `목록 ${hlsStorage.manifestCount}개 · 영상 조각 ${hlsStorage.segmentCount}개`
                      : "저장소 상태를 불러오는 중"}
                  </p>
                </article>
              </section>
              {section === "monitor" ? (
                <>
                  <section
                    className="camera-section"
                    aria-labelledby="camera-section-title"
                  >
                    <div className="section-heading">
                      <div>
                        <h2 id="camera-section-title">
                          카메라 목록 <span>{visibleStreams.length}</span>
                        </h2>
                        <p>필요한 화면을 선택해 관제를 시작하세요.</p>
                      </div>
                      <div
                        className="view-switch"
                        role="group"
                        aria-label="카메라 보기 방식"
                      >
                        <button
                          type="button"
                          aria-label="그리드 보기"
                          aria-pressed={view === "grid"}
                          onClick={() => setView("grid")}
                        >
                          <Icon name="grid" />
                        </button>
                        <button
                          type="button"
                          aria-label="집중 보기"
                          aria-pressed={view === "focus"}
                          onClick={() => setView("focus")}
                        >
                          <Icon name="focus" />
                        </button>
                      </div>
                    </div>
                    <div className="camera-toolbar">
                      <div
                        className="filter-tabs"
                        role="group"
                        aria-label="카메라 상태 필터"
                      >
                        {(
                          [
                            {
                              key: "all",
                              label: "전체",
                              count: healthSummary.total,
                            },
                            {
                              key: "live",
                              label: "정상",
                              count: healthSummary.live,
                            },
                            {
                              key: "attention",
                              label: "주의",
                              count: healthSummary.attention,
                            },
                            {
                              key: "offline",
                              label: "오프라인",
                              count: healthSummary.offline,
                            },
                          ] as const
                        ).map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            aria-pressed={filter === item.key}
                            onClick={() => setFilter(item.key)}
                          >
                            {item.label}
                            <span>{item.count}</span>
                          </button>
                        ))}
                      </div>
                      <div className="search-field">
                        <Icon name="search" />
                        <input
                          type="search"
                          aria-label="카메라 검색"
                          placeholder="이름 또는 ID로 검색"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </div>
                    </div>
                    {loadingStreams && streams.length === 0 ? (
                      <div className="empty-state" role="status">
                        <span className="button-spinner" />
                        <h3>카메라를 불러오고 있습니다</h3>
                        <p>사용 가능한 카메라 목록을 확인하는 중입니다.</p>
                      </div>
                    ) : !loadingStreams &&
                      !streamsError &&
                      streams.length === 0 ? (
                      <div className="empty-state">
                        <Icon name="camera" />
                        <h3>등록된 카메라가 없습니다</h3>
                        <p>
                          관리자에게 카메라 등록과 계정의 접근 권한을
                          문의하세요.
                        </p>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => changeSection("install")}
                        >
                          장비 설치 안내
                        </button>
                      </div>
                    ) : visibleStreams.length === 0 && streams.length > 0 ? (
                      <div className="empty-state">
                        <Icon name="search" />
                        <h3>조건에 맞는 카메라가 없습니다</h3>
                        <p>다른 이름을 검색하거나 상태 필터를 변경하세요.</p>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => {
                            setSearch("");
                            setFilter("all");
                          }}
                        >
                          검색과 필터 초기화
                        </button>
                      </div>
                    ) : null}
                    <div
                      className={`stream-grid${view === "focus" ? " focus-view" : ""}`}
                    >
                      {visibleStreams.map((stream) => (
                        <StreamCard
                          key={stream.id}
                          stream={stream}
                          health={streamHealthById[stream.id]}
                          liveThresholdSeconds={liveThresholdSeconds}
                        />
                      ))}
                    </div>
                  </section>
                  <div className="monitor-footnote">
                    <span className="status-dot" />
                    <p>
                      상태는 {(healthPollMs / 1000).toFixed(1)}초 간격으로
                      확인합니다. 영상 시작을 누른 카메라만 재생됩니다.
                    </p>
                    <button
                      type="button"
                      onClick={() => changeSection("system")}
                    >
                      시스템 진단 보기 <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <section className="system-grid">
                    <article className="system-panel">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">STORAGE</p>
                          <h2>영상 저장소</h2>
                        </div>
                        <Icon name="storage" />
                      </div>
                      <dl className="storage-diagnostics">
                        <div>
                          <dt>저장 경로</dt>
                          <dd className="storage-path">
                            {hlsStorage?.path || "확인 중"}
                          </dd>
                        </div>
                        <div>
                          <dt>디렉터리</dt>
                          <dd>
                            {!hlsStorage
                              ? "확인 중"
                              : hlsStorage.exists
                                ? "있음"
                                : "없음"}
                          </dd>
                        </div>
                        <div>
                          <dt>읽기 권한</dt>
                          <dd>
                            {!hlsStorage
                              ? "확인 중"
                              : hlsStorage.readable
                                ? "정상"
                                : "접근 불가"}
                          </dd>
                        </div>
                        <div>
                          <dt>쓰기 권한</dt>
                          <dd>
                            {!hlsStorage
                              ? "확인 중"
                              : hlsStorage.writable
                                ? "정상"
                                : "접근 불가"}
                          </dd>
                        </div>
                        <div>
                          <dt>영상 목록</dt>
                          <dd>
                            {hlsStorage ? `${hlsStorage.manifestCount}개` : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>영상 조각</dt>
                          <dd>
                            {hlsStorage ? `${hlsStorage.segmentCount}개` : "—"}
                          </dd>
                        </div>
                      </dl>
                    </article>
                    <article className="system-panel">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">NEXT ACTION</p>
                          <h2>운영 안내</h2>
                        </div>
                        <Icon name="shield" />
                      </div>
                      {systemRecommendations.length ? (
                        <ul className="system-recommendations">
                          {systemRecommendations.map((item) => (
                            <li key={item}>
                              <span className="status-dot" />
                              {localizeRecommendation(item)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-text">
                          서버의 운영 안내를 확인하고 있습니다.
                        </p>
                      )}
                      <p className="system-note">
                        실제 영상의 지연·버퍼·복구 횟수는 관제 화면에서 영상을
                        시작한 뒤 ‘재생 진단’에서 확인할 수 있습니다.
                      </p>
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() => changeSection("monitor")}
                      >
                        실시간 관제 열기 <span aria-hidden="true">↗</span>
                      </button>
                    </article>
                  </section>
                  <section
                    className="system-panel camera-health-panel"
                    aria-label="카메라 연결 진단"
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">CAMERA DIAGNOSTICS</p>
                        <h2>카메라 연결 진단</h2>
                        <p>
                          {healthWarning
                            ? "마지막 확인된 상태입니다."
                            : "영상 목록과 최근 영상 파일의 상태를 확인합니다."}
                        </p>
                      </div>
                      <span className="polling-note">
                        {(healthPollMs / 1000).toFixed(1)}초 간격
                      </span>
                    </div>
                    <div className="health-list">
                      {streams.length === 0 ? (
                        <p className="muted-text">등록된 카메라가 없습니다.</p>
                      ) : (
                        streams.map((stream) => {
                          const health = streamHealthById[stream.id];
                          return (
                            <div className="health-row" key={stream.id}>
                              <div className="health-row-camera">
                                <Icon name="camera" />
                                <div>
                                  <strong>{stream.name}</strong>
                                  <span>{stream.id}</span>
                                </div>
                              </div>
                              <span
                                className={`stream-live-pill ${streamStateTone(health)}`}
                              >
                                <span className="status-dot" />
                                {streamStateLabel(health)}
                              </span>
                              <p>
                                {
                                  guidanceFromHealth(
                                    health,
                                    liveThresholdSeconds,
                                  ).detail
                                }
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : null}
          <footer className="workspace-footer">
            <span>
              FRAME <span className="footer-separator" /> CAMERA OPERATIONS
            </span>
            <span>더 명확한 시야, 더 안전한 공간.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
