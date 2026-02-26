import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemHealth } from "../../api/client";
import type { AuthSession, HlsStorageStatus } from "../../types";

interface UseSystemHealthQueryResult {
  systemRecommendations: string[];
  hlsStorage: HlsStorageStatus | null;
}

export default function useSystemHealthQuery(session: AuthSession | null): UseSystemHealthQueryResult {
  const query = useQuery({
    queryKey: ["system-health", session?.username],
    queryFn: fetchSystemHealth,
    enabled: Boolean(session),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return useMemo(() => {
    if (!session) {
      return {
        systemRecommendations: [],
        hlsStorage: null,
      };
    }

    return {
      systemRecommendations: query.data?.recommendations ?? [],
      hlsStorage: query.data?.hlsStorage ?? null,
    };
  }, [query.data?.hlsStorage, query.data?.recommendations, session]);
}
