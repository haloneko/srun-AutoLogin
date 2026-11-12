import type { CSSProperties } from "react";
import type { ThemePluginMeta } from "@/domain/theme";
import snowflakeUrl from "./snowflake.svg";
import "./index.css";

export const meta: ThemePluginMeta = {
  id: "solstice",
  label: "冬至",
  desc: "雪花飘飘",
  colorScheme: "dark",
  unlock: {
    when: (values) => (values["login.solstice"] ?? 0) >= 1,
    hint: "冬至登录一次后解锁",
  },
};

// Art-directed frost around the frame keeps the content area quiet.
const FLAKES = [
  { x: 3, y: 6, size: 164, turn: -12, opacity: 0.23 },
  { x: 18, y: 23, size: 118, turn: 14, opacity: 0.28 },
  { x: 35, y: -6, size: 82, turn: -8, opacity: 0.14 },
  { x: 49, y: 30, size: 132, turn: 18, opacity: 0.16 },
  { x: 64, y: 9, size: 96, turn: -17, opacity: 0.24 },
  { x: 83, y: 32, size: 186, turn: 9, opacity: 0.32 },
  { x: 101, y: 3, size: 144, turn: -16, opacity: 0.25 },
  { x: -2, y: 59, size: 86, turn: 22, opacity: 0.19 },
  { x: 28, y: 49, size: 51, turn: -10, opacity: 0.13 },
  { x: 69, y: 55, size: 58, turn: 21, opacity: 0.15 },
  { x: 97, y: 66, size: 94, turn: -8, opacity: 0.17 },
];

// Stable values avoid a new composition on every theme mount.
const noise = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const SNOW = Array.from({ length: 34 }, (_, i) => ({
  x: noise(i + 1) * 100,
  y: noise(i + 51) * 100,
  size: i % 5 === 0 ? 3 + noise(i + 91) * 3 : 1 + noise(i + 91) * 1.8,
  opacity: 0.15 + noise(i + 131) * 0.4,
  duration: 17 + noise(i + 171) * 19,
  delay: -noise(i + 211) * 36,
}));
type SnowStyle = CSSProperties & { "--duration": string; "--delay": string };
type CrystalStyle = CSSProperties & {
  "--fall-duration": string;
  "--fall-delay": string;
  "--turn-duration": string;
  "--turn-delay": string;
  "--turn": string;
  "--drift": string;
  "--rest-top": string;
};

export default function WinterSolstice() {
  return (
    <div className="theme-layer solstice" aria-hidden="true">
      <div className="solstice__mist" />
      <div className="solstice__frost">
        {FLAKES.map((flake, i) => (
          <span key={i} className="solstice__crystal-flight"
            style={{
              left: `${flake.x}%`,
              width: `clamp(${flake.size * 0.65}px, ${flake.size / 7}vw, ${flake.size}px)`,
              opacity: flake.opacity,
              "--fall-duration": `${32 + noise(i + 401) * 22}s`,
              "--fall-delay": `${-(32 + noise(i + 401) * 22) * (0.2 + noise(i + 431) * 0.6)}s`,
              "--turn-duration": `${19 + noise(i + 461) * 17}s`,
              "--turn-delay": `${-noise(i + 491) * 36}s`,
              "--turn": `${flake.turn}deg`,
              "--drift": `${(i % 2 === 0 ? 1 : -1) * (12 + noise(i + 521) * 18)}px`,
              "--rest-top": `${flake.y}%`,
            } as CrystalStyle}>
            <img className="solstice__crystal" src={snowflakeUrl} alt="" draggable={false} />
          </span>
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="solstice__bokeh" style={{
            left: `${noise(i + 251) * 100}%`, top: `${noise(i + 281) * 60}%`,
            width: `${8 + noise(i + 311) * 18}px`, opacity: 0.12 + noise(i + 341) * 0.16,
          }} />
        ))}
        <i className="solstice__glint solstice__glint--one" />
        <i className="solstice__glint solstice__glint--two" />
        <i className="solstice__glint solstice__glint--three" />
      </div>
      <div className="solstice__snow">
        {SNOW.map((snow, i) => (
          <span key={i} className={`solstice__snowflake${i % 5 === 0 ? " solstice__snowflake--near" : ""}`}
            style={{
              left: `${snow.x}%`, top: `${snow.y}%`, width: snow.size, height: snow.size,
              opacity: snow.opacity, "--duration": `${snow.duration}s`, "--delay": `${snow.delay}s`,
            } as SnowStyle} />
        ))}
      </div>
      <div className="solstice__shade" />
    </div>
  );
}

