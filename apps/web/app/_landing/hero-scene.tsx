"use client";

import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";

// Sun centre in Banner.png, as a fraction of the image box.
const SUN = { x: 61.5, y: 42 };

// Birds cross the whole hero, headline included. `top` is % of the hero.
const BIRDS = [
  { top: 14, dur: 22, delay: -4, size: 44, bob: 26 },
  { top: 19, dur: 22, delay: -3.4, size: 30, bob: 22 },
  { top: 11, dur: 22, delay: -2.8, size: 26, bob: 30 },
  { top: 38, dur: 30, delay: -12, size: 36, bob: 18 },
  { top: 52, dur: 26, delay: -20, size: 28, bob: 24 },
  { top: 6, dur: 36, delay: -8, size: 22, bob: 14 },
];

const CLOUDS = [
  { top: 8, w: 300, dur: 90, delay: -10, o: 0.75 },
  { top: 24, w: 200, dur: 120, delay: -70, o: 0.5 },
  { top: 50, w: 380, dur: 100, delay: -40, o: 0.7 },
];

// Deterministic so server and client markup match.
const POLLEN = Array.from({ length: 46 }, (_, i) => ({
  left: (i * 37 + (i % 7) * 3) % 100,
  bottom: (i * 29) % 70,
  size: 4 + (i % 4) * 2,
  dur: 10 + (i % 6) * 2.5,
  delay: -((i * 1.9) % 16),
  drift: (i % 2 ? 1 : -1) * (20 + (i % 5) * 14),
}));

function Cloud({ w }: { w: number }) {
  return (
    <svg width={w} height={w * 0.32} viewBox="0 0 300 96" fill="none" aria-hidden>
      <path
        d="M14 84c-14 0-14-20 2-22 0-18 22-26 34-14 6-22 38-28 52-8 10-22 50-24 60 4 18-14 46-4 44 18 22-4 34 18 18 22H14Z"
        fill="var(--sage)"
        fillOpacity="0.55"
        stroke="var(--charcoal)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M40 72c10-6 22-6 30 0M120 60c12-8 28-8 38 2M196 70c8-5 18-5 24 0" stroke="var(--charcoal)" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="1 4" />
      <path d="M-10 90h330" stroke="var(--charcoal)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="30 8 6 8" />
    </svg>
  );
}

/**
 * The whole hero as one scene: sky, clouds and birds behind and around the
 * headline, a radiant sun over the printed landscape, pollen rising out of
 * the meadow. Layers move at different speeds with the cursor and on scroll.
 */
export function HeroScene({ children }: { children: ReactNode }) {
  const sky = useRef<HTMLDivElement>(null);
  const land = useRef<HTMLDivElement>(null);
  const near = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / innerWidth - 0.5) * 2;
      target.y = (e.clientY / innerHeight - 0.5) * 2;
    };
    const set = (el: HTMLDivElement | null, k: number, sc: number, extra = "") => {
      if (!el) return;
      const s = Math.min(scrollY, innerHeight * 1.6);
      el.style.transform = `translate3d(${cur.x * -k}px, ${s * sc + cur.y * -k * 0.5}px, 0)${extra}`;
    };
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      set(sky.current, 8, 0.18);
      set(land.current, 14, -0.04, " scale(1.04)");
      set(near.current, 34, -0.16);
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="relative overflow-clip">
      {/* Sky: warm wash and drifting clouds, behind the headline */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_62%_70%,#f3d75738,transparent_70%)]" />
      <div ref={sky} aria-hidden className="pointer-events-none absolute inset-0 will-change-transform">
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className="cloud-drift absolute left-0"
            style={{ top: `${c.top}%`, opacity: c.o, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }}
          >
            <Cloud w={c.w} />
          </div>
        ))}
      </div>

      <div className="relative z-10 pt-36 sm:pt-44">{children}</div>

      {/* Landscape */}
      <div className="relative mt-10 sm:-mt-6">
        <div ref={land} className="hero-scene will-change-transform">
          {/* Sun: slow rays reaching up into the sky, plus a breathing halo */}
          <div
            aria-hidden
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${SUN.x}%`, top: `${SUN.y}%` }}
          >
            <div className="sun-rays aspect-square w-[150vw] max-w-[2200px] rounded-full" />
          </div>
          <Image
            src="/brand/Banner.png"
            alt="Tyr wordmark on a hillside with flowers, a lake, a village and a rising sun"
            width={2172}
            height={724}
            preload
            sizes="100vw"
            className="relative z-[1] h-auto w-full [mask-image:linear-gradient(to_bottom,transparent,black_22%)]"
          />
          <div
            aria-hidden
            className="sun-halo pointer-events-none absolute z-[2] aspect-square w-[38vw] rounded-full"
            style={{ left: `${SUN.x}%`, top: `${SUN.y}%` }}
          />
        </div>
      </div>

      {/* Near layer: birds and pollen across the full hero */}
      <div ref={near} aria-hidden className="pointer-events-none absolute inset-0 z-20 will-change-transform">
        {BIRDS.map((b, i) => (
          <div
            key={i}
            className="bird-path absolute left-0"
            style={{
              top: `${b.top}%`,
              animationDuration: `${b.dur}s`,
              animationDelay: `${b.delay}s`,
              ["--bob" as string]: `${b.bob}px`,
            }}
          >
            <svg width={b.size} height={b.size * 0.5} viewBox="0 0 40 20" className="bird-flap" style={{ animationDelay: `${i * 0.17}s`, animationDuration: `${0.45 + (i % 3) * 0.12}s` }}>
              <path d="M0 8 Q10 0 20 10 Q30 0 40 8 Q30 4 20 14 Q10 4 0 8 Z" fill="var(--charcoal)" />
            </svg>
          </div>
        ))}
        {POLLEN.map((p, i) => (
          <span
            key={i}
            className="pollen absolute rounded-full"
            style={{
              left: `${p.left}%`,
              bottom: `${p.bottom}%`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              ["--drift" as string]: `${p.drift}px`,
            }}
          />
        ))}
      </div>
    </section>
  );
}
