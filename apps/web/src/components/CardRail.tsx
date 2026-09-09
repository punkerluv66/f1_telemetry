import { useRef } from "react";
import type { ReactNode } from "react";

export function CardRail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  function move(direction: number) {
    const el = rail.current;
    if (el)
      el.scrollBy({
        left: direction * el.clientWidth * 0.85,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  return (
    <div className="card-rail-shell">
      <p className="card-rail-hint muted">Scroll sideways to explore</p>
      <div
        ref={rail}
        className="card-rail"
        role="region"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            move(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
