import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStreams } from "../../api/client";
import type { AuthSession, StreamInfo } from "../../types";
import { toErrorMessage } from "../common/httpError";

interface UseStreamsQueryResult {
  streams: StreamInfo[];
  loadingStreams: boolean;
  streamsError: string | null;
  refreshStreams: () => Promise<void>;
}

export default function useStreamsQuery(session: AuthSession | null): UseStreamsQueryResult {
  const query = useQuery({
    queryKey: ["streams", session?.username],
    queryFn: fetchStreams,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: Boolean(session),
  });

  const streams = useMemo(() => {
    if (!session) {
      return [];
    }
    return query.data?.streams ?? [];
  }, [query.data?.streams, session]);

  const streamsError = query.error ? toErrorMessage(query.error, "Failed to load streams.") : null;

  const refreshStreams = useCallback(async () => {
    if (!session) {
      return;
    }
    await query.refetch();
  }, [query, session]);

  return {
    streams,
    loadingStreams: Boolean(session) && query.isFetching,
    streamsError,
    refreshStreams,
  };
}
