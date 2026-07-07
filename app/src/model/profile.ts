import type { CornerRadii } from './settings';

export interface Footprint {
  width: number;
  depth: number;
  radii: CornerRadii;
}

export function fitRadii(width: number, depth: number, radii: CornerRadii): CornerRadii {
  const values = {
    frontLeft: Math.max(0, radii.frontLeft),
    frontRight: Math.max(0, radii.frontRight),
    backRight: Math.max(0, radii.backRight),
    backLeft: Math.max(0, radii.backLeft),
  };
  const scale = Math.min(
    1,
    width / Math.max(0.0001, values.frontLeft + values.frontRight),
    width / Math.max(0.0001, values.backLeft + values.backRight),
    depth / Math.max(0.0001, values.frontLeft + values.backLeft),
    depth / Math.max(0.0001, values.frontRight + values.backRight),
  );
  return {
    frontLeft: values.frontLeft * scale,
    frontRight: values.frontRight * scale,
    backRight: values.backRight * scale,
    backLeft: values.backLeft * scale,
  };
}

export function scaleRadii(radii: CornerRadii, scale: number): CornerRadii {
  return {
    frontLeft: Math.max(0, radii.frontLeft * scale),
    frontRight: Math.max(0, radii.frontRight * scale),
    backRight: Math.max(0, radii.backRight * scale),
    backLeft: Math.max(0, radii.backLeft * scale),
  };
}

export function offsetRadii(radii: CornerRadii, amount: number): CornerRadii {
  return {
    frontLeft: Math.max(0, radii.frontLeft + amount),
    frontRight: Math.max(0, radii.frontRight + amount),
    backRight: Math.max(0, radii.backRight + amount),
    backLeft: Math.max(0, radii.backLeft + amount),
  };
}

/** Parallel inset of a fitted rounded-rectangle footprint. */
export function insetFootprint(footprint: Footprint, inset: number): Footprint {
  return {
    width: Math.max(0, footprint.width - inset * 2),
    depth: Math.max(0, footprint.depth - inset * 2),
    radii: offsetRadii(footprint.radii, -inset),
  };
}

export function fitFootprint(width: number, depth: number, radii: CornerRadii): Footprint {
  return { width, depth, radii: fitRadii(width, depth, radii) };
}

export function insetProfile(width: number, depth: number, radii: CornerRadii, inset: number): Footprint {
  return insetFootprint(fitFootprint(width, depth, radii), inset);
}

export interface TopViewPath {
  d: string;
}

/** SVG path for the top-down corner editor (back at top, front at bottom). */
export function topViewPath(
  width: number,
  depth: number,
  radii: CornerRadii,
  layout: { left: number; top: number; width: number; height: number },
): TopViewPath {
  const fitted = fitRadii(width, depth, radii);
  const scale = layout.width / width;
  const radius = {
    frontLeft: fitted.frontLeft * scale,
    frontRight: fitted.frontRight * scale,
    backRight: fitted.backRight * scale,
    backLeft: fitted.backLeft * scale,
  };
  const left = layout.left;
  const top = layout.top;
  const right = left + layout.width;
  const bottom = top + layout.height;

  return {
    d: [
      `M ${left + radius.backLeft} ${top}`,
      `L ${right - radius.backRight} ${top}`,
      `Q ${right} ${top} ${right} ${top + radius.backRight}`,
      `L ${right} ${bottom - radius.frontRight}`,
      `Q ${right} ${bottom} ${right - radius.frontRight} ${bottom}`,
      `L ${left + radius.frontLeft} ${bottom}`,
      `Q ${left} ${bottom} ${left} ${bottom - radius.frontLeft}`,
      `L ${left} ${top + radius.backLeft}`,
      `Q ${left} ${top} ${left + radius.backLeft} ${top}`,
      'Z',
    ].join(' '),
  };
}
