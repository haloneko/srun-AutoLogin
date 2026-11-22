import type { ThemePluginMeta } from "@/domain/theme";
import "./index.css";

export const meta: ThemePluginMeta = {
  id: "stars",
  label: "星空",
  desc: "深蓝夜空，星光微闪",
  colorScheme: "dark",
};

export default function StarSky() {
  return (
    <div className="theme-layer star-sky" aria-hidden>
      <div className="star-sky__field">
        <div className="star-sky__stars" />
        <div className="star-sky__stars star-sky__stars--far" />
      </div>
    </div>
  );
}
