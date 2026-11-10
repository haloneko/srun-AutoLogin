import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { ThemePluginMeta } from "@/domain/theme";
import "./index.css";

export const meta: ThemePluginMeta = {
  id: "meteor",
  label: "流星夜空",
  desc: "流星划过夜空",
  colorScheme: "dark",
  unlock: {
    when: (values) => (values["konami.entered"] ?? 0) >= 1,
    hint: "未知事件解锁",
  },
};

function beamCount(): number {
  const area = window.innerWidth * window.innerHeight;
  return Math.round(Math.min(28, Math.max(8, area / 24_000)));
}

interface BeamSeed {
  top: string;
  left: string;
  delay: string;
  duration: string;
  trail: string;
}

function seedBeams(count: number): BeamSeed[] {
  const rand = (min: number, max: number) => min + Math.random() * (max - min);
  return Array.from({ length: count }, () => ({
    top: `${(rand(0, 70) - 10).toFixed(2)}%`,
    left: `${(rand(0, 90) + 10).toFixed(2)}%`,
    delay: `${rand(0, 4).toFixed(2)}s`,
    duration: `${rand(1, 2.2).toFixed(2)}s`,
    trail: `${Math.floor(rand(90, 170))}px`,
  }));
}

export default function MeteorSky() {
  const beams = useMemo(() => seedBeams(beamCount()), []);

  return (
    <div className="theme-layer meteor-sky" aria-hidden>
      <div className="meteor-sky__stars" />
      <div className="meteor-sky__stars meteor-sky__stars--far" />
      <div className="meteor-sky__beams">
        {beams.map((beam, i) => (
          <span
            key={i}
            className="m-beam"
            style={
              {
                top: beam.top,
                left: beam.left,
                animationDelay: beam.delay,
                animationDuration: beam.duration,
                "--trail-len": beam.trail,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
