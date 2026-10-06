"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ok } from "./api";

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await api.GET("/api/auth/me");
      return r.response.status === 401 ? null : ok(Promise.resolve(r));
    },
    staleTime: 60_000,
  });

export const useLimit = (enabled = true) =>
  useQuery({ queryKey: ["limit"], queryFn: () => ok(api.GET("/api/limits")), enabled });

export const useBalance = (enabled = true) =>
  useQuery({ queryKey: ["balance"], queryFn: () => ok(api.GET("/api/balance")), enabled });

export const useVenues = () =>
  useQuery({ queryKey: ["venues"], queryFn: () => ok(api.GET("/api/venues")), staleTime: 300_000 });

export const useMarketEvents = () =>
  useQuery({
    queryKey: ["events"],
    queryFn: () => ok(api.GET("/api/venues/events")),
    refetchInterval: 15_000,
  });
