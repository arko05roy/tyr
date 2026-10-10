import type { MetadataRoute } from "next";
import { ONBOARD_URL } from "./_app/surface";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${ONBOARD_URL.replace(/\/$/, "")}/sitemap.xml`,
  };
}
