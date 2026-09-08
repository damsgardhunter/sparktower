import { useQuery } from "@tanstack/react-query";
import { defaultSurfaceMap } from "@shared/surfaces";

/**
 * Which feature areas are switched on.
 *
 * Read once and cached for the session — flags change when someone flips a
 * toggle in the admin console, not while a person is using the page, so
 * refetching on every mount would be noise.
 *
 * Falls back to the shipped defaults if the request fails. That keeps the nav
 * usable during an outage, and the server enforces the real answer regardless
 * — this only decides what's worth showing.
 */
export function useSurfaces() {
  const { data, isLoading } = useQuery<{ enabled: Record<string, boolean> }>({
    queryKey: ["/api/surfaces"],
    queryFn: async () => {
      const res = await fetch("/api/surfaces", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const enabled = data?.enabled ?? defaultSurfaceMap();

  return {
    enabled,
    isLoading,
    /** Unknown ids are treated as on, so a new surface isn't hidden by default. */
    on: (id: string) => enabled[id] !== false,
  };
}
