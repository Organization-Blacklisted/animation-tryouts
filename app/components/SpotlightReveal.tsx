"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

type Shape = "circle" | "ellipse";
type RevealMode = "hover" | "always" | "click";
type TouchBehavior = "follow" | "fixed" | "disabled";

interface RestingPositionPercent {
  x: number;
  y: number;
}

interface EdgeRingProps {
  enabled?: boolean;
  color?: string;
  /** px, 0-8 */
  thickness?: number;
  /** 0-100 */
  opacity?: number;
}

export interface SpotlightRevealProps {
  /** Bottom layer — always visible. */
  base: ReactNode;
  /** Top layer — visible only inside the spotlight shape. */
  reveal: ReactNode;

  // Mask shape
  shape?: Shape;
  /** 20-800. Radius for "circle", radius X for "ellipse". */
  radius?: number;
  /** 20-800. Radius Y, "ellipse" only. */
  radiusY?: number;
  /** 0-1. 0 = hard edge, 1 = fades from the centre. */
  feather?: number;
  /** 0-100. */
  revealOpacity?: number;
  /** When true, the shape hides the Reveal layer instead of showing it. */
  invert?: boolean;

  // Follow behaviour
  /** 0.05-1, fraction of remaining distance closed per frame. */
  followSpeed?: number;

  // Mode
  revealMode?: RevealMode;
  /** "center" or a custom {x, y} in percent of the box. */
  restingPosition?: "center" | RestingPositionPercent;

  // Enter / exit transition
  /** ms, 0-2000. */
  enterDuration?: number;
  /** ms, 0-2000. */
  exitDuration?: number;

  // Touch
  touchBehavior?: TouchBehavior;

  // Edge ring
  edgeRing?: EdgeRingProps;

  className?: string;
  style?: CSSProperties;
}

const DEFAULTS = {
  shape: "circle" as Shape,
  radius: 180,
  radiusY: 180,
  feather: 0.3,
  revealOpacity: 100,
  invert: false,
  followSpeed: 0.18,
  revealMode: "hover" as RevealMode,
  restingPosition: "center" as const,
  enterDuration: 250,
  exitDuration: 350,
  touchBehavior: "follow" as TouchBehavior,
};

const POS_EPSILON = 0.4;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function easeOutCubic(t: number) {
  const p = t - 1;
  return p * p * p + 1;
}

function buildMask(
  shape: Shape,
  px: number,
  py: number,
  rx: number,
  ry: number,
  feather: number,
  invert: boolean
) {
  if (rx < 0.5 || ry < 0.5) {
    // Fully collapsed — hide the whole layer regardless of invert, so the
    // enter/exit transition never has a frame where the Reveal layer is
    // unmasked (and therefore fully visible).
    return "radial-gradient(circle 0px at 0px 0px, transparent 0%, transparent 100%)";
  }
  const core = clamp((1 - feather) * 100, 0, 100);
  const shapeStr =
    shape === "circle"
      ? `circle ${rx}px at ${px}px ${py}px`
      : `ellipse ${rx}px ${ry}px at ${px}px ${py}px`;
  const inner = invert ? "transparent" : "black";
  const outer = invert ? "black" : "transparent";
  return `radial-gradient(${shapeStr}, ${inner} 0%, ${inner} ${core}%, ${outer} 100%)`;
}

export default function SpotlightReveal({
  base,
  reveal,
  shape = DEFAULTS.shape,
  radius = DEFAULTS.radius,
  radiusY = DEFAULTS.radiusY,
  feather = DEFAULTS.feather,
  revealOpacity = DEFAULTS.revealOpacity,
  invert = DEFAULTS.invert,
  followSpeed = DEFAULTS.followSpeed,
  revealMode = DEFAULTS.revealMode,
  restingPosition = DEFAULTS.restingPosition,
  enterDuration = DEFAULTS.enterDuration,
  exitDuration = DEFAULTS.exitDuration,
  touchBehavior = DEFAULTS.touchBehavior,
  edgeRing,
  className,
  style,
}: SpotlightRevealProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  // Latest prop values, read inside the rAF loop without retriggering effects.
  const propsRef = useRef({
    shape,
    radius,
    radiusY,
    feather,
    revealOpacity,
    invert,
    followSpeed,
    revealMode,
    restingPosition,
    enterDuration,
    exitDuration,
    touchBehavior,
    edgeRing,
  });
  useEffect(() => {
    propsRef.current = {
      shape,
      radius,
      radiusY,
      feather,
      revealOpacity,
      invert,
      followSpeed,
      revealMode,
      restingPosition,
      enterDuration,
      exitDuration,
      touchBehavior,
      edgeRing,
    };
  });

  // Animation state, kept entirely in refs — never drives a React re-render.
  const posRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(0);
  const scaleAnimRef = useRef<{
    from: number;
    to: number;
    start: number;
    duration: number;
  } | null>(null);
  const lockedRef = useRef(false);
  const hoveringRef = useRef(false);
  const isTouchRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const inViewRef = useRef(true);

  function restingPx(width: number, height: number) {
    const rp = propsRef.current.restingPosition;
    if (rp === "center") return { x: width / 2, y: height / 2 };
    return { x: (width * rp.x) / 100, y: (height * rp.y) / 100 };
  }

  function touchDisabled() {
    return isTouchRef.current && propsRef.current.touchBehavior === "disabled";
  }

  function startScaleAnim(to: number) {
    const { enterDuration, exitDuration } = propsRef.current;
    const duration = to > scaleRef.current ? enterDuration : exitDuration;
    if (duration <= 0) {
      scaleRef.current = to;
      scaleAnimRef.current = null;
      ensureLoopRunning();
      return;
    }
    scaleAnimRef.current = {
      from: scaleRef.current,
      to,
      start: performance.now(),
      duration,
    };
    ensureLoopRunning();
  }

  function tick(now: number) {
    rafRef.current = null;
    const el = containerRef.current;
    const revealEl = revealRef.current;
    if (!el || !revealEl) return;

    const { followSpeed, shape, radius, radiusY, feather, invert, revealOpacity, edgeRing } =
      propsRef.current;

    const pos = posRef.current;
    const target = targetRef.current;
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    pos.x += dx * followSpeed;
    pos.y += dy * followSpeed;

    const anim = scaleAnimRef.current;
    if (anim) {
      const t = clamp((now - anim.start) / anim.duration, 0, 1);
      const eased = easeOutCubic(t);
      scaleRef.current = anim.from + (anim.to - anim.from) * eased;
      if (t >= 1) scaleAnimRef.current = null;
    }

    const scale = scaleRef.current;
    const targetRadius = radius;
    const targetRadiusY = shape === "circle" ? radius : radiusY;

    let rx: number;
    let ry: number;
    let containerOpacityMul = 1;
    if (invert) {
      // Growing/shrinking the hole itself is ill-defined (shrinking the hole
      // to zero would make the Reveal layer fully visible, not hidden), so
      // for invert we keep the hole at its configured size and fade the
      // whole layer in/out instead. Keeps the "never flash fully visible"
      // guarantee true in both invert and normal mode.
      rx = targetRadius;
      ry = targetRadiusY;
      containerOpacityMul = scale;
    } else {
      rx = targetRadius * scale;
      ry = targetRadiusY * scale;
    }

    revealEl.style.maskImage = buildMask(shape, pos.x, pos.y, rx, ry, feather, invert);
    revealEl.style.webkitMaskImage = revealEl.style.maskImage;
    revealEl.style.opacity = String((revealOpacity / 100) * containerOpacityMul);

    const ringEl = ringRef.current;
    if (ringEl) {
      if (edgeRing?.enabled) {
        const ringOpacity = ((edgeRing.opacity ?? 100) / 100) * containerOpacityMul * scale;
        ringEl.style.display = rx < 0.5 || ry < 0.5 ? "none" : "block";
        ringEl.style.width = `${rx * 2}px`;
        ringEl.style.height = `${ry * 2}px`;
        ringEl.style.left = `${pos.x}px`;
        ringEl.style.top = `${pos.y}px`;
        ringEl.style.opacity = String(ringOpacity);
      } else {
        ringEl.style.display = "none";
      }
    }

    const converged = Math.abs(dx) < POS_EPSILON && Math.abs(dy) < POS_EPSILON;
    const scaleSettled = !scaleAnimRef.current;
    if (!(converged && scaleSettled)) {
      ensureLoopRunning();
    }
  }

  function ensureLoopRunning() {
    if (rafRef.current !== null || !inViewRef.current) return;
    rafRef.current = requestAnimationFrame(tick);
  }

  function eventPoint(e: { clientX: number; clientY: number }) {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function goVisible() {
    hoveringRef.current = true;
    startScaleAnim(1);
  }

  function goHidden() {
    hoveringRef.current = false;
    if (lockedRef.current) return;
    startScaleAnim(0);
  }

  function handlePointerEnter(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDisabled()) return;
    if (e.pointerType === "touch") return; // touch handled by pointerdown/move
    const mode = propsRef.current.revealMode;
    targetRef.current = eventPoint(e);
    if (mode === "hover" || mode === "click") goVisible();
    ensureLoopRunning();
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDisabled()) return;
    if (lockedRef.current) return;
    if (e.pointerType === "touch") {
      const behavior = propsRef.current.touchBehavior;
      if (behavior !== "follow") return;
    }
    targetRef.current = eventPoint(e);
    ensureLoopRunning();
  }

  function handlePointerLeave(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDisabled()) return;
    if (e.pointerType === "touch") return;
    const mode = propsRef.current.revealMode;
    if (mode === "hover" || mode === "click") {
      goHidden();
    } else if (mode === "always") {
      const el = containerRef.current;
      if (el) targetRef.current = restingPx(el.clientWidth, el.clientHeight);
    }
    ensureLoopRunning();
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDisabled()) return;
    if (lockedRef.current) return;
    if (e.pointerType === "touch") {
      const behavior = propsRef.current.touchBehavior;
      const el = containerRef.current;
      if (behavior === "fixed" && el) {
        targetRef.current = restingPx(el.clientWidth, el.clientHeight);
      } else if (behavior === "follow") {
        targetRef.current = eventPoint(e);
      }
      if (behavior !== "disabled") goVisible();
      ensureLoopRunning();
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (touchDisabled()) return;
    if (e.pointerType === "touch") {
      const mode = propsRef.current.revealMode;
      if (mode === "hover") goHidden();
      ensureLoopRunning();
    }
  }

  function handleClick() {
    if (touchDisabled()) return;
    if (propsRef.current.revealMode !== "click") return;
    lockedRef.current = !lockedRef.current;
    if (lockedRef.current) {
      // Freeze exactly where it currently is.
      targetRef.current = { ...posRef.current };
      goVisible();
    } else if (!hoveringRef.current) {
      goHidden();
    }
    ensureLoopRunning();
  }

  // Mount: detect touch, size the container, and set the idle/resting state.
  useLayoutEffect(() => {
    isTouchRef.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches === true;

    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const resting = restingPx(rect.width, rect.height);
    posRef.current = { ...resting };
    targetRef.current = { ...resting };

    // Only "always" has a well-defined idle-visible state (resting position).
    // "hover" and "click" (which behaves like hover until locked) start hidden.
    const startVisible = !touchDisabled() && propsRef.current.revealMode === "always";
    scaleRef.current = startVisible ? 1 : 0;

    const revealEl = revealRef.current;
    if (revealEl) {
      const { shape, radius, radiusY, feather, invert, revealOpacity } = propsRef.current;
      const targetRy = shape === "circle" ? radius : radiusY;
      const rx = invert ? radius : radius * scaleRef.current;
      const ry = invert ? targetRy : targetRy * scaleRef.current;
      revealEl.style.maskImage = buildMask(
        shape,
        resting.x,
        resting.y,
        rx,
        ry,
        feather,
        invert
      );
      revealEl.style.webkitMaskImage = revealEl.style.maskImage;
      revealEl.style.opacity = String(
        (revealOpacity / 100) * (invert ? scaleRef.current : 1)
      );
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
        if (inViewRef.current) ensureLoopRunning();
        else if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      },
      { threshold: 0 }
    );
    io.observe(el);

    return () => {
      io.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to resting-position / revealMode changes while idle (not hovering, not locked).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!hoveringRef.current && !lockedRef.current && revealMode !== "hover") {
      targetRef.current = restingPx(el.clientWidth, el.clientHeight);
      ensureLoopRunning();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restingPosition, revealMode]);

  const wrapperStyle: CSSProperties = {
    position: "relative",
    width: 600,
    height: 600,
    overflow: "hidden",
    ...style,
  };

  const layerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={wrapperStyle}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
    >
      <div style={layerStyle}>{base}</div>
      <div
        ref={revealRef}
        style={{
          ...layerStyle,
          pointerEvents: "none",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
        }}
      >
        {reveal}
      </div>
      <div
        ref={ringRef}
        style={{
          position: "absolute",
          display: "none",
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          borderStyle: "solid",
          borderColor: edgeRing?.color ?? "#ffffff",
          borderWidth: edgeRing?.thickness ?? 1,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
