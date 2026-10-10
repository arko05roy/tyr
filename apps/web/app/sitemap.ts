import type { MetadataRoute } from "next";
import { ONBOARD_URL } from "./_app/surface";

const ROUTES = ["", "/start", "/markets", "/agents", "/portfolio", "/fund", "/zcash", "/onboarding/limit"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = ONBOARD_URL.replace(/\/$/, "");
  const lastModified = new Date();
  return ROUTES.map((path) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: path === "/markets" ? "hourly" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
