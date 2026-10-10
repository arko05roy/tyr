"use client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { WsEvent } from "@tyr/api-client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { wsEndpoint } from "./api";

const EventsCtx = createContext<WsEvent[]>([]);
/** Recent /ws events, newest first. */
export const useEvents = () => useContext(EventsCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <EventStream>{children}</EventStream>
    </QueryClientProvider>
  );
}

/** PRD 5.4: live order/settlement/deposit events; each one refreshes the affected queries. */
function EventStream({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<WsEvent[]>([]);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    // The mock API has no event stream.
    if (process.env.NEXT_PUBLIC_TYR_MOCK) return;
    const connect = () => {
      ws = new WebSocket(wsEndpoint());
      ws.onmessage = (m) => {
        const ev = JSON.parse(String(m.data)) as WsEvent;
        setEvents((e) => [ev, ...e].slice(0, 50));
        if (ev.type === "order" || ev.type === "settlement") {
          qc.invalidateQueries({ queryKey: ["bets"] });
          qc.invalidateQueries({ queryKey: ["balance"] });
          qc.invalidateQueries({ queryKey: ["limit"] });
        }
        if (ev.type === "settlement") qc.invalidateQueries({ queryKey: ["receipts"] });
        if (ev.type === "deposit") {
          qc.invalidateQueries({ queryKey: ["deposits"] });
          qc.invalidateQueries({ queryKey: ["balance"] });
        }
      };
      // 4401 = not signed in yet; reconnect after login (any query invalidation re-renders us)
      ws.onclose = (e) => {
        if (!closed) retry = setTimeout(connect, e.code === 4401 ? 5_000 : 2_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [qc]);
  return <EventsCtx.Provider value={events}>{children}</EventsCtx.Provider>;
}
