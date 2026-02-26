import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/useAuthSession", () => ({
  default: vi.fn(),
}));

vi.mock("./features/streams/useStreamsQuery", () => ({
  default: vi.fn(),
}));

vi.mock("./features/health/useHealthPolling", () => ({
  default: vi.fn(),
}));

vi.mock("./features/system/useSystemHealthQuery", () => ({
  default: vi.fn(),
}));

vi.mock("./components/LoginForm", () => ({
  default: () => <div data-testid="login-form">login form</div>,
}));

vi.mock("./components/StreamCard", () => ({
  default: ({ stream }: { stream: { name: string } }) => <div data-testid="stream-card">{stream.name}</div>,
}));

import App from "./App";
import useAuthSession from "./features/auth/useAuthSession";
import useStreamsQuery from "./features/streams/useStreamsQuery";
import useHealthPolling from "./features/health/useHealthPolling";
import useSystemHealthQuery from "./features/system/useSystemHealthQuery";

const mockUseAuthSession = vi.mocked(useAuthSession);
const mockUseStreamsQuery = vi.mocked(useStreamsQuery);
const mockUseHealthPolling = vi.mocked(useHealthPolling);
const mockUseSystemHealthQuery = vi.mocked(useSystemHealthQuery);

describe("App", () => {
  beforeEach(() => {
    mockUseAuthSession.mockReturnValue({
      session: null,
      restoringSession: true,
      loadingAuth: false,
      authError: null,
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      expireSession: vi.fn(),
    });
    mockUseStreamsQuery.mockReturnValue({
      streams: [],
      loadingStreams: false,
      streamsError: null,
      refreshStreams: vi.fn().mockResolvedValue(undefined),
    });
    mockUseHealthPolling.mockReturnValue({
      streamHealthById: {},
      liveThresholdSeconds: 12,
      healthPollMs: 4000,
      healthWarning: null,
    });
    mockUseSystemHealthQuery.mockReturnValue({
      systemRecommendations: [],
      hlsStorage: null,
    });
  });

  it("shows restoring text while restoring session", () => {
    render(<App />);
    expect(screen.getByText("Restoring session...")).toBeInTheDocument();
  });

  it("shows login form when session is missing", () => {
    mockUseAuthSession.mockReturnValueOnce({
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

  it("renders dashboard with stream cards for authenticated session", () => {
    mockUseAuthSession.mockReturnValueOnce({
      session: {
        username: "viewer",
        displayName: "Viewer",
      },
      restoringSession: false,
      loadingAuth: false,
      authError: null,
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      expireSession: vi.fn(),
    });
    mockUseStreamsQuery.mockReturnValueOnce({
      streams: [
        { id: "cam-a", name: "Front Gate" },
        { id: "cam-b", name: "Lobby" },
      ],
      loadingStreams: false,
      streamsError: null,
      refreshStreams: vi.fn().mockResolvedValue(undefined),
    });

    render(<App />);

    expect(screen.getByText("Signed in as Viewer")).toBeInTheDocument();
    expect(screen.getByText("Health poll: 4.0s")).toBeInTheDocument();
    expect(screen.getAllByTestId("stream-card")).toHaveLength(2);
  });
});
