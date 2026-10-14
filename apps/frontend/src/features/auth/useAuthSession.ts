import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login, logout } from "../../api/client";
import type { AuthSession } from "../../types";
import { isUnauthorizedErrorMessage, toErrorMessage } from "../common/httpError";

interface LoginPayload {
  username: string;
  password: string;
}

interface UseAuthSessionResult {
  session: AuthSession | null;
  restoringSession: boolean;
  loadingAuth: boolean;
  authError: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  expireSession: () => void;
}

export default function useAuthSession(): UseAuthSessionResult {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [restorationFinished, setRestorationFinished] = useState(false);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !restorationFinished,
  });

  useEffect(() => {
    if (restorationFinished) {
      return;
    }
    if (meQuery.status === "success") {
      const restored = {
        username: meQuery.data.username,
        displayName: meQuery.data.displayName,
      };
      setSession(restored);
      queryClient.setQueryData(["streams", restored.username], {
        streams: meQuery.data.streams ?? [],
      });
      setAuthError(null);
      setRestorationFinished(true);
      return;
    }
    if (meQuery.status === "error") {
      const message = toErrorMessage(meQuery.error, "Failed to restore session.");
      if (!isUnauthorizedErrorMessage(message)) {
        setAuthError(message);
      }
      setRestorationFinished(true);
    }
  }, [meQuery.data, meQuery.error, meQuery.status, queryClient, restorationFinished]);

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: LoginPayload) => login(username, password),
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
  });

  const clearSessionState = useCallback((nextError: string | null) => {
    setSession(null);
    setAuthError(nextError);
    queryClient.removeQueries({ queryKey: ["streams"] });
    queryClient.removeQueries({ queryKey: ["streams-health"] });
    queryClient.removeQueries({ queryKey: ["system-health"] });
    queryClient.removeQueries({ queryKey: ["device-settings"] });
  }, [queryClient]);

  const handleLogin = useCallback(async (username: string, password: string) => {
    setAuthError(null);
    try {
      const result = await loginMutation.mutateAsync({ username, password });
      const nextSession: AuthSession = {
        username: result.username,
        displayName: result.displayName,
      };
      setSession(nextSession);
      queryClient.setQueryData(["streams", nextSession.username], {
        streams: result.streams ?? [],
      });
      queryClient.removeQueries({ queryKey: ["streams-health", nextSession.username] });
      queryClient.removeQueries({ queryKey: ["system-health", nextSession.username] });
    } catch (error: unknown) {
      setAuthError(toErrorMessage(error, "Login failed."));
    }
  }, [loginMutation, queryClient]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
      clearSessionState(null);
    } catch {
      setAuthError("로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    }
  }, [clearSessionState, logoutMutation]);

  const expireSession = useCallback(() => {
    clearSessionState("로그인 시간이 만료되었습니다. 다시 로그인해 주세요.");
  }, [clearSessionState]);

  return {
    session,
    restoringSession: !restorationFinished,
    loadingAuth: loginMutation.isPending,
    authError,
    login: handleLogin,
    logout: handleLogout,
    expireSession,
  };
}
