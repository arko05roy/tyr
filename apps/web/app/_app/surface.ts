// Which of the two servers this is (see next.config.ts).
export const SURFACE = process.env.NEXT_PUBLIC_TYR_SURFACE === "dashboard" ? "dashboard" : "onboard";
export const ONBOARD_URL = process.env.NEXT_PUBLIC_TYR_ONBOARD_URL ?? "http://localhost:3000";
export const DASHBOARD_URL = process.env.NEXT_PUBLIC_TYR_DASHBOARD_URL ?? "http://localhost:3001";
export const isDashboard = SURFACE === "dashboard";
