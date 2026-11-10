import { useEffect, useRef } from "react";

const SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
  "enter",
];

const SHAKE: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

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

let playing = 0;

function lockScroll() {
  if (playing++ === 0) document.documentElement.classList.add("fx-locked");
}

function unlockScroll() {
  if (--playing === 0) document.documentElement.classList.remove("fx-locked");
}


function playFeedback(key: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.querySelector<HTMLElement>(".wf-root");
  if (!root) return;

  const dir = SHAKE[key];
  const hit = dir
    ? `translate(${dir[0] * 28}px, ${dir[1] * 28}px) scale(1)`
    : "translate(0px, 0px) scale(0.95)";

  const frames = [
    { transform: "translate(0px, 0px) scale(1)", filter: "brightness(1)", offset: 0, easing: "cubic-bezier(0.1, 0.9, 0.2, 1)" },
    { transform: hit, filter: "brightness(1.3)", offset: 0.38, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    { transform: "translate(0px, 0px) scale(1)", filter: "brightness(1)", offset: 1 },
  ];

  lockScroll();
  root
    .animate(frames, {
      duration: dir ? 190 : 150,
      easing: "linear",
    })
    .finished.catch(() => {})
    .finally(unlockScroll);
}

export function useKonamiCode(onComplete: () => void) {
  const done = useRef(onComplete);

  useEffect(() => {
    done.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let progress = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target)) return;

      const key = e.key.toLowerCase();
      if (key !== SEQUENCE[progress]) {
        progress = key === SEQUENCE[0] ? 1 : 0;
        return;
      }

      progress += 1;
      if (key !== "enter") playFeedback(key);
      if (progress === SEQUENCE.length) {
        progress = 0;
        done.current();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
