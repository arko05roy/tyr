import type { Metadata } from "next";
import { Caveat, Inter, Newsreader } from "next/font/google";
import "./globals.css";

// Tiempos Headline is a commercial face; Newsreader is the closest open
// warm, high-contrast editorial serif. Swap in Tiempos via next/font/local
// once the licence files are in the repo.
const display = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const script = Caveat({
  variable: "--font-script",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tyr — Private prediction markets",
  description:
    "Bet on anything, from any chain, with a hidden bankroll and a loss limit you can't break.",
  icons: { icon: "/brand/logo-nobg.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${script.variable} h-full antialiased`}
    >
      <body className="grain min-h-full flex flex-col">{children}</body>
    </html>
  );
}
