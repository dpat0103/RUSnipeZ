import { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;

function prefersMotion(): boolean {
  return typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Animate a number from its previous value to the new one; instant when motion is reduced. */
export function useCountUp(target: number | undefined): number | undefined {
  // Start from zero only when the count will animate, so nothing flickers.
  const [shown, setShown] = useState(() => (prefersMotion() ? 0 : target));
  const from = useRef(0);

  useEffect(() => {
    if (target === undefined) return;
    if (!prefersMotion()) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(origin + (target - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return target === undefined ? undefined : (shown ?? target);
}
