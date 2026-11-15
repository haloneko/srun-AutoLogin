import { useEffect, useRef } from "react";

const SHAKE: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

let playing = 0;

function lockScroll() {
  if (playing++ === 0) document.documentElement.classList.add("fx-locked");
}

function unlockScroll() {
  if (--playing === 0) document.documentElement.classList.remove("fx-locked");
}

function play(root: HTMLElement, frames: Keyframe[], duration: number) {
  lockScroll();
  root
    .animate(frames, { duration, easing: "linear" })
    .finished.catch(() => {})
    .finally(unlockScroll);
}

let lastFeedbackKey = "";
let lastFeedbackAt = -1;

function playFeedback(key: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const now = performance.now();
  if (key === lastFeedbackKey && now - lastFeedbackAt < 16) return;
  lastFeedbackKey = key;
  lastFeedbackAt = now;

  const root = document.querySelector<HTMLElement>(".wf-root");
  if (!root) return;

  if (key === "enter") {
    play(
      root,
      [
        { transform: "rotate(0deg)", offset: 0, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
        { transform: "rotate(360deg)", offset: 1 },
      ],
      220,
    );
    return;
  }

  const dir = SHAKE[key];
  const hit = dir
    ? `translate(${dir[0] * 28}px, ${dir[1] * 28}px) scale(1)`
    : "translate(0px, 0px) scale(0.95)";

  play(
    root,
    [
      { transform: "translate(0px, 0px) scale(1)", filter: "brightness(1)", offset: 0, easing: "cubic-bezier(0.1, 0.9, 0.2, 1)" },
      { transform: hit, filter: "brightness(1.3)", offset: 0.38, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      { transform: "translate(0px, 0px) scale(1)", filter: "brightness(1)", offset: 1 },
    ],
    140,
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export function useKonamiCode(sequence: readonly string[], onMatch: () => void) {
  const handle = useRef(onMatch);
  const keys = useRef(sequence);

  useEffect(() => {
    handle.current = onMatch;
  }, [onMatch]);

  useEffect(() => {
    keys.current = sequence;
  }, [sequence]);

  useEffect(() => {
    let progress = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target)) return;

      const seq = keys.current;
      const key = e.key.toLowerCase();

      if (key !== seq[progress]) {
        progress = key === seq[0] ? 1 : 0;
        return;
      }

      progress += 1;
      playFeedback(key);

      if (progress === seq.length) {
        progress = 0;
        handle.current();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
