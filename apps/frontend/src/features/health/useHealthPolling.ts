import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchStreamHealth, fetchSystemHealth } from "../../api/client";
import type { AuthSession, StreamHealth } from "../../types";
import { toErrorMessage } from "../common/httpError";

const DEFAULT_HEALTH_POLL_MS = 4000;
const MAX_HEALTH_BACKOFF_MS = 30000;

export function computeNextPollDelayMs(basePollMs: number, consecutiveFailures: number, visibilityState: DocumentVisibilityState): number {
  const visibilityMultiplier = visibilityState === "hidden" ? 2 : 1;
  const retryFactor = consecutiveFailures > 0 ? consecutiveFailures + 1 : 1;
  return Math.min(MAX_HEALTH_BACKOFF_MS, basePollMs * retryFactor * visibilityMultiplier);
}

interface UseHealthPollingResult {
  streamHealthById: Record<string, StreamHealth>;
  liveThresholdSeconds: number;
  healthPollMs: number;
  healthWarning: string | null;
}

export default function useHealthPolling(session: AuthSession | null): UseHealthPollingResult {
  const queryClient = useQueryClient();
  const [streamHealthById, setStreamHealthById] = useState<Record<string, StreamHealth>>({});
  const [liveThresholdSeconds, setLiveThresholdSeconds] = useState<number>(0);
  const [healthWarning, setHealthWarning] = useState<string | null>(null);
  const [healthPollMs, setHealthPollMs] = useState<number>(DEFAULT_HEALTH_POLL_MS);
  const healthPollMsRef = useRef(DEFAULT_HEALTH_POLL_MS);

  useEffect(() => {
    if (!session) {
      setStreamHealthById({});
      setLiveThresholdSeconds(0);
      setHealthWarning(null);
      setHealthPollMs(DEFAULT_HEALTH_POLL_MS);
      healthPollMsRef.current = DEFAULT_HEALTH_POLL_MS;
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    let consecutiveFailures = 0;

    const fetchHealth = async () => {
      try {
        const [response, systemHealth] = await Promise.all([
          queryClient.fetchQuery({
            queryKey: ["streams-health", session.username],
            queryFn: fetchStreamHealth,
            retry: false,
            staleTime: 0,
          }),
          queryClient.fetchQuery({
            queryKey: ["system-health", session.username],
            queryFn: fetchSystemHealth,
            retry: false,
            staleTime: 0,
          }),
        ]);
        if (cancelled) {
          return;
        }
        const nextMap: Record<string, StreamHealth> = {};
        for (const item of response.streams) {
          nextMap[item.id] = item;
        }
        setStreamHealthById(nextMap);
        setLiveThresholdSeconds(response.liveThresholdSeconds);

        const nextPollMs = Math.max(1000, response.recommendedPollMs || DEFAULT_HEALTH_POLL_MS);
        setHealthPollMs(nextPollMs);
        healthPollMsRef.current = nextPollMs;

        queryClient.setQueryData(["system-health", session.username], systemHealth);

        setHealthWarning(null);
        consecutiveFailures = 0;
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        consecutiveFailures += 1;
        const backoffMs = Math.min(MAX_HEALTH_BACKOFF_MS, healthPollMsRef.current * (consecutiveFailures + 1));
        const message = toErrorMessage(error, "Failed to check stream health.");
        setHealthWarning(`Health polling delayed (${(backoffMs / 1000).toFixed(1)}s): ${message}`);
      } finally {
        if (cancelled) {
          return;
        }
        const nextDelay = computeNextPollDelayMs(
          healthPollMsRef.current,
          consecutiveFailures,
          document.visibilityState,
        );
        timerId = window.setTimeout(() => {
          void fetchHealth();
        }, nextDelay);
      }
    };

    void fetchHealth();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [queryClient, session]);

  return {
    streamHealthById,
    liveThresholdSeconds,
    healthPollMs,
    healthWarning,
  };
}
