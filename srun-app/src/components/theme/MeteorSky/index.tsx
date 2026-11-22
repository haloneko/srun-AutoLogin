import type { ThemePluginMeta } from "@/domain/theme";
import { usePageVisible } from "@/hooks/usePageVisible";
import "./index.css";

const METEOR_SLOTS = [0, 1, 2, 3];

export const meta: ThemePluginMeta = {
  id: "meteor",
  label: "流星夜空",
  desc: "流星掠过深蓝夜空",
  colorScheme: "dark",
  unlock: {
    when: (values) => (values["konami.entered"] ?? 0) >= 1,
    hint: "未知事件解锁",
  },
};

export default function MeteorSky() {
  const visible = usePageVisible();

  return (
    <div className={`theme-layer meteor-sky${visible ? "" : " meteor-sky--paused"}`} aria-hidden>
      <div className="meteor-sky__stars" />
      {METEOR_SLOTS.map((slot) => (
        <div key={slot} className="meteor-sky__route" data-slot={slot}>
          <span className="meteor-sky__meteor" />
        </div>
      ))}
    </div>
  );
}
