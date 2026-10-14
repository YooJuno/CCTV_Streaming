import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/useAuthSession", () => ({ default: vi.fn() }));
vi.mock("./features/streams/useStreamsQuery", () => ({ default: vi.fn() }));
vi.mock("./features/health/useHealthPolling", () => ({ default: vi.fn() }));
vi.mock("./features/system/useSystemHealthQuery", () => ({ default: vi.fn() }));
vi.mock("./components/DeviceInstaller", () => ({
  default: () => <div data-testid="device-installer">설치 작업</div>,
}));
vi.mock("./components/LoginForm", () => ({
  default: () => <div data-testid="login-form">로그인</div>,
}));
vi.mock("./components/StreamCard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./components/StreamCard")>();
  return {
    ...actual,
    default: ({ stream }: { stream: { name: string } }) => (
      <div data-testid="stream-card">{stream.name}</div>
    ),
  };
});

import App from "./App";
import useAuthSession from "./features/auth/useAuthSession";
import useStreamsQuery from "./features/streams/useStreamsQuery";
import useHealthPolling from "./features/health/useHealthPolling";
import useSystemHealthQuery from "./features/system/useSystemHealthQuery";
import type { StreamHealth } from "./types";

const mockAuth = vi.mocked(useAuthSession);
const mockStreams = vi.mocked(useStreamsQuery);
const mockHealth = vi.mocked(useHealthPolling);
const mockSystem = vi.mocked(useSystemHealthQuery);
const SAMPLE_HEALTH: StreamHealth = {
  id: "cam-a",
  live: true,
  state: "LIVE",
  reason: "OK",
  manifestExists: true,
  lastModifiedEpochMs: 1,
  manifestAgeSeconds: 0,
  segmentCount: 3,
  targetDurationSeconds: 1,
  endList: false,
  latestSegmentExists: true,
  latestSegmentSizeBytes: 1024,
};

function signIn() {
  mockAuth.mockReturnValue({
    session: { username: "viewer", displayName: "관제 담당자" },
    restoringSession: false,
    loadingAuth: false,
    authError: null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    expireSession: vi.fn(),
  });
}

describe("App", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mockAuth.mockReturnValue({
      session: null,
      restoringSession: true,
      loadingAuth: false,
      authError: null,
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      expireSession: vi.fn(),
    });
    mockStreams.mockReturnValue({
      streams: [
        { id: "cam-a", name: "정문" },
        { id: "cam-b", name: "로비" },
      ],
      loadingStreams: false,
      streamsError: null,
      refreshStreams: vi.fn().mockResolvedValue(undefined),
    });
    mockHealth.mockReturnValue({
      streamHealthById: {
        "cam-a": SAMPLE_HEALTH,
        "cam-b": {
          ...SAMPLE_HEALTH,
          id: "cam-b",
          live: false,
          state: "OFFLINE",
          reason: "MANIFEST_MISSING",
        },
      },
      liveThresholdSeconds: 12,
      healthPollMs: 4000,
      healthWarning: null,
    });
    mockSystem.mockReturnValue({ systemRecommendations: [], hlsStorage: null });
  });

  it("announces session restoration before showing login", () => {
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "관제 환경을 불러오고 있습니다",
    );
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("shows login when session is missing", () => {
    mockAuth.mockReturnValue({
      session: null,
      restoringSession: false,
      loadingAuth: false,
      authError: null,
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      expireSession: vi.fn(),
    });
    render(<App />);
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });

  it("searches by camera name and id and combines the status filter", () => {
    signIn();
    render(<App />);
    expect(screen.getAllByTestId("stream-card")).toHaveLength(2);
    fireEvent.change(screen.getByRole("searchbox", { name: "카메라 검색" }), {
      target: { value: "CAM-B" },
    });
    expect(screen.getAllByTestId("stream-card")).toHaveLength(1);
    expect(screen.getByTestId("stream-card")).toHaveTextContent("로비");
    fireEvent.click(screen.getByRole("button", { name: /^정상\s*1$/ }));
    expect(
      screen.getByText("조건에 맞는 카메라가 없습니다"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "검색과 필터 초기화" }));
    expect(screen.getAllByTestId("stream-card")).toHaveLength(2);
  });

  it("keeps the installer mounted when switching sections", () => {
    signIn();
    render(<App />);
    const installer = screen.getByTestId("device-installer");
    expect(installer).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "장비 설치" }));
    expect(installer).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^실시간 관제\s*2$/ }));
    expect(installer).not.toBeVisible();
    expect(screen.getByTestId("device-installer")).toBe(installer);
  });

  it("requires readable storage before reporting healthy", () => {
    signIn();
    mockSystem.mockReturnValue({
      systemRecommendations: [],
      hlsStorage: {
        path: "/tmp/hls",
        exists: true,
        readable: false,
        writable: true,
        manifestCount: 2,
        segmentCount: 5,
      },
    });
    render(<App />);
    expect(screen.getByText("점검 필요")).toBeInTheDocument();
  });

  it("expires the session when a health request is unauthorized", () => {
    signIn();
    mockHealth.mockReturnValue({
      streamHealthById: {},
      liveThresholdSeconds: 12,
      healthPollMs: 4000,
      healthWarning: "HTTP 401: unauthorized",
    });
    render(<App />);
    expect(mockAuth().expireSession).toHaveBeenCalledTimes(1);
  });
});
