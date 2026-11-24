'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DoughnutRenderer } from './doughnut-renderer';
import { doughnutPixelRatio } from './Doughnut';

export interface AnimatedDoughnutDimension {
  slug: string;
  name: string;
  ring: 'social' | 'ecological';
  /** Starting overshoot/shortfall level (t = 0). */
  overshootLevel: number;
  /** Thriving safe-and-just level inside the green ring (t = 1). */
  thrivingLevel: number;
  /** Gentle phase offset (0..0.24) so wedges contract in an organic wave. */
  phaseOffset: number;
}

/**
 * Canonical 21-dimension Doughnut trajectory: transforms from widespread
 * ecological overshoot & social shortfalls (scroll progress = 0) into the
 * safe, just, and thriving green ring (scroll progress = 1).
 */
export const TRANSFORM_DIMENSIONS: readonly AnimatedDoughnutDimension[] = [
  // Social foundation (inner ring — 12 dimensions)
  { slug: 'food', name: 'Food', ring: 'social', overshootLevel: 74, thrivingLevel: -18, phaseOffset: 0.0 },
  { slug: 'health', name: 'Health', ring: 'social', overshootLevel: 58, thrivingLevel: -22, phaseOffset: 0.04 },
  { slug: 'education', name: 'Education', ring: 'social', overshootLevel: 48, thrivingLevel: -20, phaseOffset: 0.08 },
  { slug: 'income-work', name: 'Income & Work', ring: 'social', overshootLevel: 84, thrivingLevel: -16, phaseOffset: 0.12 },
  { slug: 'water-sanitation', name: 'Water & Sanitation', ring: 'social', overshootLevel: 38, thrivingLevel: -26, phaseOffset: 0.16 },
  { slug: 'energy', name: 'Energy', ring: 'social', overshootLevel: 46, thrivingLevel: -20, phaseOffset: 0.2 },
  { slug: 'networks', name: 'Networks', ring: 'social', overshootLevel: 42, thrivingLevel: -18, phaseOffset: 0.24 },
  { slug: 'housing', name: 'Housing', ring: 'social', overshootLevel: 96, thrivingLevel: -15, phaseOffset: 0.18 },
  { slug: 'gender-equality', name: 'Gender Equality', ring: 'social', overshootLevel: 62, thrivingLevel: -20, phaseOffset: 0.14 },
  { slug: 'social-equity', name: 'Social Equity', ring: 'social', overshootLevel: 86, thrivingLevel: -18, phaseOffset: 0.1 },
  { slug: 'political-voice', name: 'Political Voice', ring: 'social', overshootLevel: 54, thrivingLevel: -22, phaseOffset: 0.06 },
  { slug: 'peace-justice', name: 'Peace & Justice', ring: 'social', overshootLevel: 76, thrivingLevel: -20, phaseOffset: 0.02 },
  // Ecological ceiling (outer ring — 9 dimensions)
  { slug: 'climate-change', name: 'Climate Change', ring: 'ecological', overshootLevel: 140, thrivingLevel: -18, phaseOffset: 0.02 },
  { slug: 'ocean-acidification', name: 'Ocean Acidification', ring: 'ecological', overshootLevel: 114, thrivingLevel: -16, phaseOffset: 0.06 },
  { slug: 'chemical-pollution', name: 'Chemical Pollution', ring: 'ecological', overshootLevel: 82, thrivingLevel: -20, phaseOffset: 0.1 },
  { slug: 'nitrogen-phosphorus-loading', name: 'Nitrogen & Phosphorus', ring: 'ecological', overshootLevel: 128, thrivingLevel: -18, phaseOffset: 0.14 },
  { slug: 'freshwater-withdrawals', name: 'Freshwater Withdrawals', ring: 'ecological', overshootLevel: 90, thrivingLevel: -22, phaseOffset: 0.18 },
  { slug: 'land-conversion', name: 'Land Conversion', ring: 'ecological', overshootLevel: 110, thrivingLevel: -20, phaseOffset: 0.22 },
  { slug: 'biodiversity-loss', name: 'Biodiversity Loss', ring: 'ecological', overshootLevel: 134, thrivingLevel: -16, phaseOffset: 0.16 },
  { slug: 'air-pollution', name: 'Air Pollution', ring: 'ecological', overshootLevel: 76, thrivingLevel: -24, phaseOffset: 0.1 },
  { slug: 'extreme-heat', name: 'Extreme Heat', ring: 'ecological', overshootLevel: 96, thrivingLevel: -18, phaseOffset: 0.04 },
];

/** Smooth cubic ease-in-out on [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Map scroll progress [0, 1] into a sub-window [start, end] -> [0, 1]. */
export function subProgress(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return easeInOutCubic((progress - start) / (end - start));
}

export function interpolatedTransformLevels(progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  return TRANSFORM_DIMENSIONS.map((d) => {
    const span = 1 - d.phaseOffset;
    const localT = clamped <= 0 ? 0 : clamped >= 1 ? 1 : easeInOutCubic((clamped - d.phaseOffset * 0.55) / span);
    const level = Math.round((d.overshootLevel + (d.thrivingLevel - d.overshootLevel) * localT) * 10) / 10;
    return {
      type: d.ring === 'social' ? ('inner' as const) : ('outer' as const),
      name: d.name,
      level,
    };
  });
}

export function describeTransformPhase(progress: number): {
  badge: string;
  caption: string;
  tone: 'overshoot' | 'transition' | 'thriving';
} {
  if (progress < 0.2) {
    return {
      badge: 'Today · Overshoot & shortfall',
      caption: 'Exceeding planetary limits while leaving essentials out of reach — scroll to see the shift.',
      tone: 'overshoot',
    };
  }
  if (progress > 0.78) {
    return {
      badge: 'Safe, just & thriving',
      caption: 'Renewable-powered communities, restored ecosystems, and every resident above the social foundation.',
      tone: 'thriving',
    };
  }
  return {
    badge: 'In transition',
    caption: 'Closing social shortfalls while pulling ecological pressure back inside Earth’s limits.',
    tone: 'transition',
  };
}

/**
 * Fine-line illuminated architectural panorama of a renewable-driven, safe & just
 * future that traces itself into existence behind and around the Doughnut as the
 * visitor scrolls from overshoot (0) to thriving (1).
 */
function RenewableFutureLightLines({ progress }: { progress: number }) {
  // Staggered trace windows so horizon -> renewables -> living neighborhoods -> sunlit sky draw in smoothly.
  const horizonT = subProgress(progress, 0.08, 0.55);
  const energyT = subProgress(progress, 0.22, 0.72);
  const communityT = subProgress(progress, 0.34, 0.85);
  const auraT = subProgress(progress, 0.45, 0.96);

  const dash = (t: number) => ({
    strokeDasharray: 100,
    strokeDashoffset: +(100 * (1 - t)).toFixed(2),
  });

  // Gentle blade rotation tied directly to scroll once turbines appear.
  const turbineAngle = Math.round(progress * 140);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 820"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
    >
      <defs>
        <radialGradient id="df-thriving-glow" cx="50%" cy="52%" r="48%">
          <stop offset="0%" stopColor="#8cd755" stopOpacity={0.18 * auraT} />
          <stop offset="48%" stopColor="#d9b24c" stopOpacity={0.1 * auraT} />
          <stop offset="100%" stopColor="#d9b24c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="df-light-gold" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c79b2c" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#5b9a32" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#c79b2c" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* Soft sunlit living-ring aura behind the centered Doughnut */}
      <rect x="0" y="0" width="1440" height="820" fill="url(#df-thriving-glow)" />

      {/* Concentric luminous orbital light lines radiating around the Doughnut */}
      <g fill="none" stroke="url(#df-light-gold)" strokeLinecap="round" opacity={0.12 + 0.48 * auraT}>
        <circle cx="720" cy="425" r="295" strokeWidth="1" strokeDasharray="4 10" />
        <circle cx="720" cy="425" r="355" strokeWidth="1.15" pathLength={100} {...dash(auraT)} />
        <circle cx="720" cy="425" r="425" strokeWidth="0.9" strokeDasharray="2 12" />
        {/* Sunbeams radiating softly into the upper sky */}
        <path d="M 380 180 Q 720 60 1060 180" strokeWidth="1.1" pathLength={100} {...dash(auraT)} />
        <path d="M 260 250 Q 720 95 1180 250" strokeWidth="0.9" pathLength={100} {...dash(auraT)} />
      </g>

      {/* Rolling regenerative terrain & watershed contours across full width */}
      <g fill="none" stroke="#5b9a32" strokeLinecap="round" strokeLinejoin="round" opacity={0.16 + 0.54 * horizonT}>
        {/* Far sunlit ridge */}
        <path
          d="M 0 560 Q 170 495 360 545 T 720 565 T 1090 540 T 1440 555"
          strokeWidth="1.4"
          pathLength={100}
          {...dash(horizonT)}
        />
        {/* Mid valley contours */}
        <path
          d="M 0 640 Q 220 585 450 630 T 940 635 T 1440 615"
          strokeWidth="1.2"
          pathLength={100}
          {...dash(horizonT)}
        />
        {/* Clean flowing river light lines (bottom left to bottom right) */}
        <path
          d="M 0 725 C 180 700 290 755 470 735 C 630 718 810 718 970 735 C 1150 755 1270 705 1440 725"
          stroke="#468b6b"
          strokeWidth="1.5"
          pathLength={100}
          {...dash(horizonT)}
        />
        <path
          d="M 30 755 C 210 735 330 778 510 758 C 670 742 790 742 950 758 C 1130 778 1250 738 1420 755"
          stroke="#468b6b"
          strokeWidth="1"
          strokeDasharray="6 8"
          opacity={0.7 * horizonT}
        />
      </g>

      {/* LEFT HORIZON: Wind turbines, solar canopies, walkable green homes & tree canopies */}
      <g fill="none" stroke="#c49526" strokeLinecap="round" strokeLinejoin="round" opacity={0.12 + 0.72 * energyT}>
        {/* Wind turbine 1 (tall ridge) */}
        <line x1="155" y1="528" x2="155" y2="355" strokeWidth="1.7" pathLength={100} {...dash(energyT)} />
        <g transform={`translate(155 355) rotate(${turbineAngle})`} opacity={energyT}>
          <circle cx="0" cy="0" r="3.5" strokeWidth="1.4" />
          <line x1="0" y1="0" x2="0" y2="-56" strokeWidth="1.6" />
          <line x1="0" y1="0" x2="48" y2="28" strokeWidth="1.6" />
          <line x1="0" y1="0" x2="-48" y2="28" strokeWidth="1.6" />
        </g>

        {/* Wind turbine 2 (mid ridge) */}
        <line x1="255" y1="538" x2="255" y2="412" strokeWidth="1.4" pathLength={100} {...dash(energyT)} />
        <g transform={`translate(255 412) rotate(${turbineAngle + 42})`} opacity={energyT}>
          <circle cx="0" cy="0" r="2.8" strokeWidth="1.3" />
          <line x1="0" y1="0" x2="0" y2="-40" strokeWidth="1.4" />
          <line x1="0" y1="0" x2="35" y2="20" strokeWidth="1.4" />
          <line x1="0" y1="0" x2="-35" y2="20" strokeWidth="1.4" />
        </g>

        {/* Wind turbine 3 (distant) */}
        <line x1="88" y1="546" x2="88" y2="444" strokeWidth="1.2" pathLength={100} {...dash(energyT)} />
        <g transform={`translate(88 444) rotate(${turbineAngle + 85})`} opacity={energyT}>
          <circle cx="0" cy="0" r="2.2" strokeWidth="1.1" />
          <line x1="0" y1="0" x2="0" y2="-30" strokeWidth="1.2" />
          <line x1="0" y1="0" x2="26" y2="15" strokeWidth="1.2" />
          <line x1="0" y1="0" x2="-26" y2="15" strokeWidth="1.2" />
        </g>

        {/* Solar pavilion canopies on left terrace */}
        <path d="M 65 628 L 105 604 L 155 604 L 115 628 Z" strokeWidth="1.3" pathLength={100} {...dash(energyT)} />
        <line x1="90" y1="628" x2="90" y2="648" strokeWidth="1.2" pathLength={100} {...dash(energyT)} />
        <line x1="130" y1="628" x2="130" y2="648" strokeWidth="1.2" pathLength={100} {...dash(energyT)} />
        <path d="M 160 628 L 200 604 L 250 604 L 210 628 Z" strokeWidth="1.3" pathLength={100} {...dash(energyT)} />
        <line x1="185" y1="628" x2="185" y2="648" strokeWidth="1.2" pathLength={100} {...dash(energyT)} />
        <line x1="225" y1="628" x2="225" y2="648" strokeWidth="1.2" pathLength={100} {...dash(energyT)} />
      </g>

      {/* Left community housing with green roofs, solar lines & trees */}
      <g fill="none" stroke="#4f8a2b" strokeLinecap="round" strokeLinejoin="round" opacity={0.1 + 0.72 * communityT}>
        {/* Terraced multifamily homes */}
        <path d="M 272 648 L 272 565 L 332 544 L 332 648" strokeWidth="1.5" pathLength={100} {...dash(communityT)} />
        <path d="M 284 574 L 320 562 M 284 596 L 320 596 M 284 618 L 320 618" stroke="#c49526" strokeWidth="1.1" pathLength={100} {...dash(communityT)} />
        <path d="M 332 648 L 332 586 L 402 570 L 402 648" strokeWidth="1.5" pathLength={100} {...dash(communityT)} />
        <path d="M 346 600 L 388 600 M 346 622 L 388 622" stroke="#c49526" strokeWidth="1.1" pathLength={100} {...dash(communityT)} />
        {/* Pedestrian & bike footbridge arch */}
        <path d="M 190 726 Q 315 668 440 726" strokeWidth="1.4" pathLength={100} {...dash(communityT)} />
        <path d="M 215 714 L 415 714" strokeWidth="1" pathLength={100} {...dash(communityT)} />
        {/* Botanical tree canopies */}
        <path d="M 55 688 C 55 654 96 654 96 688 M 75 688 L 75 706" strokeWidth="1.35" pathLength={100} {...dash(communityT)} />
        <path d="M 110 694 C 110 668 142 668 142 694 M 126 694 L 126 708" strokeWidth="1.25" pathLength={100} {...dash(communityT)} />
        <path d="M 416 648 C 416 616 458 616 458 648 M 437 648 L 437 666" strokeWidth="1.35" pathLength={100} {...dash(communityT)} />
      </g>

      {/* RIGHT HORIZON: Clean electric rail viaduct, sunlit civic pavilion, living canopy & solar sails */}
      <g fill="none" stroke="#4f8a2b" strokeLinecap="round" strokeLinejoin="round" opacity={0.1 + 0.72 * communityT}>
        {/* Sleek elevated electric rail viaduct */}
        <path d="M 970 612 Q 1200 578 1440 598" strokeWidth="1.6" pathLength={100} {...dash(communityT)} />
        <path d="M 970 622 Q 1200 588 1440 608" strokeWidth="1" pathLength={100} {...dash(communityT)} />
        {/* Viaduct arches */}
        <path d="M 1030 615 Q 1075 645 1120 605" strokeWidth="1.15" pathLength={100} {...dash(communityT)} />
        <path d="M 1120 605 Q 1170 642 1220 598" strokeWidth="1.15" pathLength={100} {...dash(communityT)} />
        <path d="M 1220 598 Q 1275 640 1330 601" strokeWidth="1.15" pathLength={100} {...dash(communityT)} />
        {/* Streamlined electric train silhouette gliding forward along rail */}
        <g transform={`translate(${Math.round(-45 + 65 * communityT)} 0)`} opacity={communityT}>
          <path
            d="M 1135 595 L 1245 588 Q 1265 588 1272 598 L 1135 604 Z"
            stroke="#c49526"
            strokeWidth="1.6"
          />
          <line x1="1152" y1="597" x2="1240" y2="592" stroke="#c49526" strokeWidth="1" />
        </g>

        {/* Sunlit public commons / greenhouse pavilion */}
        <path d="M 1015 696 L 1015 642 Q 1075 604 1135 642 L 1135 696" strokeWidth="1.5" pathLength={100} {...dash(communityT)} />
        <path d="M 1045 696 L 1045 630 M 1075 696 L 1075 622 M 1105 696 L 1105 630" stroke="#c49526" strokeWidth="1.1" pathLength={100} {...dash(communityT)} />

        {/* Biophilic skyline & rooftop gardens */}
        <path d="M 1260 694 L 1260 515 Q 1300 495 1340 515 L 1340 694" strokeWidth="1.5" pathLength={100} {...dash(energyT)} />
        <path d="M 1272 548 L 1328 548 M 1272 582 L 1328 582 M 1272 616 L 1328 616 M 1272 650 L 1328 650" stroke="#c49526" strokeWidth="1.1" pathLength={100} {...dash(energyT)} />
        <path d="M 1340 694 L 1340 552 L 1402 536 L 1402 694" strokeWidth="1.4" pathLength={100} {...dash(energyT)} />
        {/* Rooftop trees & restored park canopy */}
        <path d="M 1278 510 C 1278 486 1306 486 1306 510" strokeWidth="1.3" pathLength={100} {...dash(communityT)} />
        <path d="M 1304 512 C 1304 492 1328 492 1328 512" strokeWidth="1.2" pathLength={100} {...dash(communityT)} />
        <path d="M 1165 696 C 1165 660 1210 660 1210 696 M 1187 696 L 1187 716" strokeWidth="1.35" pathLength={100} {...dash(communityT)} />
        <path d="M 1215 700 C 1215 674 1246 674 1246 700 M 1230 700 L 1230 716" strokeWidth="1.2" pathLength={100} {...dash(communityT)} />
      </g>

      {/* Delicate sunlit birds / clean-air sky arcs on upper right */}
      <g fill="none" stroke="#c49526" strokeWidth="1.25" strokeLinecap="round" opacity={0.8 * auraT}>
        <path d="M 1060 278 Q 1072 268 1084 278 Q 1096 268 1108 278" pathLength={100} {...dash(auraT)} />
        <path d="M 1122 252 Q 1131 244 1140 252 Q 1149 244 1158 252" pathLength={100} {...dash(auraT)} />
        <path d="M 310 282 Q 320 273 330 282 Q 340 273 350 282" pathLength={100} {...dash(auraT)} />
      </g>
    </svg>
  );
}

function isDarkThemeActive(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function heroCanvasTheme(dark: boolean) {
  return dark
    ? {
        transparent: true,
        outerTextColour: '#f2f0e8',
        limitStrokeColour: 'rgba(242, 240, 232, 0.34)',
        separatorColour: 'rgba(20, 24, 20, 0.55)',
      }
    : {
        transparent: true,
        outerTextColour: '#1d221c',
        limitStrokeColour: 'rgba(40, 48, 40, 0.34)',
        separatorColour: 'rgba(255, 255, 255, 0.85)',
      };
}

export interface LandingDoughnutShowcaseProps {
  selfServe?: boolean;
  secondaryAction?: { href: string; label: string } | null;
}

/**
 * Full-bleed scroll-driven landing hero: occupies the entire viewport and
 * smoothly transforms the canonical Doughnut from ecological overshoot &
 * social shortfalls into the safe, just, and thriving green space while
 * fine-line renewable-future architecture draws itself in around it.
 */
export function LandingDoughnutShowcase({
  selfServe = true,
  secondaryAction = null,
}: LandingDoughnutShowcaseProps) {
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<DoughnutRenderer | null>(null);
  const targetProgressRef = useRef(0);
  const currentProgressRef = useRef(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setReducedMotion(true);
      targetProgressRef.current = 1;
      currentProgressRef.current = 1;
      setProgress(1);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new DoughnutRenderer({
      canvas,
      size: 640,
      pixelRatio: doughnutPixelRatio(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
      donutScale: 1,
      textSize: 13,
      interactive: false,
      ...heroCanvasTheme(isDarkThemeActive()),
    });
    renderer.setColours(2, 1, '#883251', '#E096C6');
    renderer.setLevels(interpolatedTransformLevels(currentProgressRef.current));
    rendererRef.current = renderer;

    const syncTheme = () => {
      renderer.setTheme(heroCanvasTheme(isDarkThemeActive()));
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', syncTheme);

    return () => {
      observer.disconnect();
      mq?.removeEventListener?.('change', syncTheme);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const updateTargetFromScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const scrollable = Math.max(1, el.offsetHeight - window.innerHeight);
      const scrolled = Math.max(0, Math.min(scrollable, -rect.top));
      targetProgressRef.current = scrolled / scrollable;
    };

    updateTargetFromScroll();
    window.addEventListener('scroll', updateTargetFromScroll, { passive: true });
    window.addEventListener('resize', updateTargetFromScroll, { passive: true });

    let rafId = 0;
    let lastCommitted = -1;

    const tick = () => {
      const target = targetProgressRef.current;
      const current = currentProgressRef.current;
      const diff = target - current;
      const next = Math.abs(diff) < 0.0008 ? target : current + diff * 0.14;
      if (Math.abs(next - current) > 0.0002 || lastCommitted < 0) {
        currentProgressRef.current = next;
        rendererRef.current?.setLevels(interpolatedTransformLevels(next));
        if (Math.abs(next - lastCommitted) > 0.004 || next === 0 || next === 1) {
          lastCommitted = next;
          setProgress(next);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', updateTargetFromScroll);
      window.removeEventListener('resize', updateTargetFromScroll);
    };
  }, [reducedMotion]);

  const phase = describeTransformPhase(progress);
  const badgeClasses =
    phase.tone === 'thriving'
      ? 'border-green-200 bg-green-100/90 text-green-900'
      : phase.tone === 'transition'
        ? 'border-amber-200 bg-amber-100/90 text-amber-900'
        : 'border-red-200 bg-red-100/90 text-red-900';

  return (
    <section
      ref={sectionRef}
      aria-label="Scroll transformation from overshoot to a safe, just and thriving world"
      className={reducedMotion ? 'relative min-h-[calc(100dvh-3.5rem)]' : 'relative h-[250vh]'}
    >
      <div className="sticky top-14 flex h-[calc(100dvh-3.5rem)] w-full flex-col items-center justify-between overflow-hidden px-4 py-5 sm:px-6 sm:py-7">
        {/* Fine-line renewable-driven future tracing in behind & around the Doughnut */}
        <RenewableFutureLightLines progress={progress} />

        {/* Subtle vertical scroll-story progress rail on desktop */}
        {!reducedMotion ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-2 lg:flex"
          >
            <span className="text-[10px] font-medium uppercase tracking-widest text-[color:var(--color-muted)]">
              Today
            </span>
            <div className="h-28 w-1 overflow-hidden rounded-full bg-black/10">
              <div
                className="w-full rounded-full bg-[color:var(--color-accent)]"
                style={{ height: `${Math.max(8, Math.round(progress * 100))}%` }}
              />
            </div>
            <span className="text-[10px] font-medium uppercase tracking-widest text-green-900">Thriving</span>
          </div>
        ) : null}

        {/* Top headline band */}
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <span className={`inline-block rounded-full border px-3 py-0.5 text-xs font-medium ${badgeClasses}`}>
            {phase.badge}
          </span>
          <h1 className="mt-2.5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            What would it take to create a safe, just and thriving world?
          </h1>
          <p className="mt-2 text-base font-medium text-[color:var(--color-muted)] sm:text-lg">
            Make a portrait for your community today.
          </p>
        </div>

        {/* Center canonical Doughnut floating freely in open space (non-selectable) */}
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="pointer-events-none aspect-square h-[min(450px,51vh)] w-[min(450px,51vh)] max-w-[92vw] select-none">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="Scroll-driven Doughnut Economics transformation from ecological overshoot and social shortfalls into the safe, just, and thriving green space."
              className="pointer-events-none h-full w-full select-none bg-transparent"
            />
          </div>
        </div>

        {/* Bottom caption + CTAs + scroll cue */}
        <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
          <p className="max-w-2xl text-xs text-[color:var(--color-muted)] sm:text-sm" aria-live="polite">
            {phase.caption}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
            {selfServe ? (
              <Link
                href="/start"
                className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
              >
                Start a portrait
              </Link>
            ) : null}
            <a
              href="#portraits"
              className="rounded border border-black/20 bg-[color:var(--color-bg)]/85 px-3.5 py-2 text-sm font-medium backdrop-blur-sm hover:bg-black/5"
            >
              Explore existing doughnuts ↓
            </a>
            {secondaryAction ? (
              <Link
                href={secondaryAction.href}
                className="rounded border border-black/15 bg-[color:var(--color-bg)]/85 px-3.5 py-2 text-sm font-medium backdrop-blur-sm hover:bg-black/5"
              >
                {secondaryAction.label}
              </Link>
            ) : null}
            <a
              href="#policy-impact"
              className="rounded border border-black/15 bg-[color:var(--color-bg)]/85 px-3.5 py-2 text-sm font-medium backdrop-blur-sm hover:bg-black/5"
            >
              Policy evidence ↓
            </a>
          </div>
          {!reducedMotion ? (
            <p
              className="mt-2 text-[11px] font-medium tracking-wide text-[color:var(--color-muted)] transition-opacity"
              style={{ opacity: progress > 0.85 ? 0.45 : 0.85 }}
            >
              {progress > 0.85 ? 'Keep scrolling for portraits & policy evidence ↓' : 'Scroll to transform ↓'}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
