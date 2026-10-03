import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import type { Tree } from "../../shared/api";
import { useTree } from "../api";
import { useUI } from "../store";
import { endTour, startTour, tourSeen, useTour } from "./state";
import { STEPS, type TourStep } from "./steps";

type Rect = { left: number; top: number; width: number; height: number };

/** Shows the first-run tour (once), and replays it when asked. */
export function TourHost() {
  const step = useTour((s) => s.step);
  const { data: tree } = useTree();
  const { pathname } = useLocation();

  // First visit: start on its own, once the workspace has loaded.
  useEffect(() => {
    if (tree && !tourSeen() && useTour.getState().step === null) startTour();
  }, [!!tree]);

  if (step === null || !tree || pathname.startsWith("/print")) return null;
  return <TourRunner tree={tree} index={step} />;
}

/** Steps that make sense for this workspace (e.g. no notebook step without a notebook). */
const available = (tree: Tree) => STEPS.filter((s) => !s.route || s.route(tree) !== null);

function TourRunner({ tree, index }: { tree: Tree; index: number }) {
  const steps = useMemo(() => available(tree), [tree]);
  const step: TourStep | undefined = steps[Math.min(index, steps.length - 1)];
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [searching, setSearching] = useState(!!step?.target);
  const last = index >= steps.length - 1;

  const go = (i: number) => useTour.setState({ step: Math.max(0, Math.min(i, steps.length - 1)) });
  const next = () => (last ? endTour("done") : go(index + 1));
  const back = () => go(index - 1);

  // Get to the step's page, open the sidebar if it points there, then find its target.
  useEffect(() => {
    if (!step) return;
    setRect(null);
    setSearching(!!step.target);
    if (step.sidebar && !useUI.getState().sidebarOpen) useUI.getState().setSidebarOpen(true);
    const path = step.route?.(tree);
    if (path && `${location.pathname}${location.search}` !== path) navigate(path);
    if (!step.target) return;

    let frame = 0;
    let found: Element | null = null;
    const started = performance.now();
    const track = () => {
      found ??= document.querySelector(step.target!);
      if (found && !found.isConnected) found = document.querySelector(step.target!);
      if (found) {
        const r = found.getBoundingClientRect();
        setSearching(false);
        setRect((prev) =>
          prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
            ? prev
            : { left: r.left, top: r.top, width: r.width, height: r.height },
        );
      } else if (performance.now() - started > 2500) {
        setSearching(false); // not on screen: explain it without pointing
      }
      frame = requestAnimationFrame(track);
    };
    // Bring it into view once it shows up.
    const scroll = window.setInterval(() => {
      const el = document.querySelector(step.target!);
      if (!el) return;
      window.clearInterval(scroll);
      el.scrollIntoView({ block: step.scroll ?? "center", inline: "nearest", behavior: "smooth" });
    }, 100);
    window.setTimeout(() => window.clearInterval(scroll), 4000);
    frame = requestAnimationFrame(track);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(scroll);
    };
  }, [step?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour("skipped");
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!step || searching) return null;
  const spot = rect && visible(rect) ? pad(rect, step.padding ?? 6) : null;

  return createPortal(
    <div className={`tour${spot ? "" : " is-centered"}`} role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="tour-shade" onMouseDown={(e) => e.preventDefault()} />
      {spot && <div className="tour-spot" style={spot} />}
      <Popover
        key={step.id}
        step={step}
        n={index + 1}
        total={steps.length}
        spot={spot}
        first={index === 0}
        last={last}
        onNext={next}
        onBack={back}
        onSkip={() => endTour("skipped")}
      />
    </div>,
    document.body,
  );
}

function Popover({
  step,
  n,
  total,
  spot,
  first,
  last,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  n: number;
  total: number;
  spot: Rect | null;
  first: boolean;
  last: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 220 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = spot ? placeBeside(spot, size, step.placement) : null;
  const intro = first && !step.target;

  return (
    <div
      ref={ref}
      className={`tour-pop${intro ? " is-intro" : ""}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tour-pop-head">
        <span className="tour-count tabular">
          {n} / {total}
        </span>
        <button type="button" className="tour-close" onClick={onSkip} aria-label="Skip tour" title="Skip tour (Esc)">
          <X size={15} />
        </button>
      </div>
      {step.icon && <div className="tour-icon">{step.icon}</div>}
      <h3 className="tour-title">{step.title}</h3>
      <div className="tour-body">{step.body}</div>
      <div className="tour-progress" aria-hidden="true">
        <span style={{ width: `${(n / total) * 100}%` }} />
      </div>
      <div className="tour-actions">
        <button type="button" className="tour-skip" onClick={onSkip}>
          {intro ? "Skip, I'll explore" : "Skip tour"}
        </button>
        <span className="grow" />
        {!first && (
          <button type="button" className="btn-secondary small" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </button>
        )}
        <button type="button" className="btn-primary small" onClick={onNext} autoFocus>
          {intro ? "Show me around" : last ? "Finish" : "Next"} {!last && <ArrowRight size={14} />}
        </button>
      </div>
    </div>
  );
}

// ── Geometry ─────────────────────────────────────────────────────────────

const visible = (r: Rect) =>
  r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.left < window.innerWidth && r.top + r.height > 0;

/** The target plus some air, kept on screen (a tall editor is cut to the viewport). */
function pad(r: Rect, p: number): Rect {
  const left = Math.max(4, r.left - p);
  const top = Math.max(4, r.top - p);
  const right = Math.min(window.innerWidth - 4, r.left + r.width + p);
  const bottom = Math.min(window.innerHeight - 4, r.top + r.height + p);
  return { left, top, width: right - left, height: bottom - top };
}

export type Placement = "right" | "left" | "bottom" | "top";

/** Where the popover goes: beside the spotlight on the first side with room, else inside the screen. */
function placeBeside(r: Rect, size: { w: number; h: number }, prefer?: Placement) {
  const gap = 14;
  const m = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(m, Math.min(x, vw - size.w - m));
  const clampY = (y: number) => Math.max(m, Math.min(y, vh - size.h - m));
  const options: Record<Placement, () => { left: number; top: number } | null> = {
    right: () => (r.left + r.width + gap + size.w <= vw - m ? { left: r.left + r.width + gap, top: clampY(r.top) } : null),
    left: () => (r.left - gap - size.w >= m ? { left: r.left - gap - size.w, top: clampY(r.top) } : null),
    bottom: () => (r.top + r.height + gap + size.h <= vh - m ? { left: clampX(r.left), top: r.top + r.height + gap } : null),
    top: () => (r.top - gap - size.h >= m ? { left: clampX(r.left), top: r.top - gap - size.h } : null),
  };
  const order: Placement[] = [prefer ?? "right", "right", "bottom", "left", "top"];
  for (const side of order) {
    const p = options[side]();
    if (p) return p;
  }
  // No side has room (a big target): of the spots on screen, cover as little of it as possible.
  const candidates = [
    { left: clampX(r.left + r.width + gap), top: clampY(r.top) },
    { left: clampX(r.left - gap - size.w), top: clampY(r.top) },
    { left: clampX(r.left), top: clampY(r.top + r.height + gap) },
    { left: clampX(r.left), top: clampY(r.top - gap - size.h) },
    { left: clampX(vw - size.w - 24), top: clampY(vh - size.h - 24) },
  ];
  const overlap = (p: { left: number; top: number }) =>
    Math.max(0, Math.min(p.left + size.w, r.left + r.width) - Math.max(p.left, r.left)) *
    Math.max(0, Math.min(p.top + size.h, r.top + r.height) - Math.max(p.top, r.top));
  return candidates.reduce((best, p) => (overlap(p) < overlap(best) ? p : best));
}
