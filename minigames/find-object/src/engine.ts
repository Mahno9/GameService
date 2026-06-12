/**
 * Pure find-object logic. No DOM, no side-effects.
 *
 * Coordinate space: all positions are in BACKGROUND IMAGE pixel space
 * (0..naturalWidth, 0..naturalHeight). An item's (x, y) is its CENTER.
 * Items are rendered scaled by `scale` and rotated by `rotation` (degrees,
 * clockwise) about that center.
 */

export interface ScoreThreshold {
  maxSeconds: number;
  points: number;
}

/**
 * Returns the points for the given elapsed time.
 * Finds the threshold with the smallest maxSeconds >= elapsedSeconds.
 * Returns 0 if no threshold qualifies or the list is empty.
 *
 * (Same semantics as sliding-puzzle.)
 */
export function scoreForElapsed(thresholds: ScoreThreshold[], elapsedSeconds: number): number {
  if (thresholds.length === 0) return 0;

  let best: ScoreThreshold | null = null;
  for (const t of thresholds) {
    if (t.maxSeconds >= elapsedSeconds) {
      if (best === null || t.maxSeconds < best.maxSeconds) {
        best = t;
      }
    }
  }

  return best !== null ? best.points : 0;
}

/** A 2D point in background pixel space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A placed item used for hit-testing. (x, y) is the item's center, in
 * background pixel space. naturalWidth/Height are the unscaled intrinsic
 * pixel sizes of the image. The item occupies a rectangle of
 * naturalWidth*scale by naturalHeight*scale, rotated by `rotation` degrees
 * about its center.
 */
export interface PlacedItem {
  id: string;
  x: number;
  y: number;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

/**
 * Returns true if `point` lies inside the (possibly rotated, scaled)
 * rectangle of `item`. Works by rotating the point into the item's local,
 * axis-aligned frame about the item's center, then doing a simple
 * half-extent comparison.
 */
export function pointInItem(point: Point, item: PlacedItem): boolean {
  const halfW = (item.naturalWidth * item.scale) / 2;
  const halfH = (item.naturalHeight * item.scale) / 2;
  if (halfW <= 0 || halfH <= 0) return false;

  // Vector from item center to point.
  const dx = point.x - item.x;
  const dy = point.y - item.y;

  // Rotate by -rotation to undo the item's clockwise rotation.
  const rad = (-item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  return Math.abs(localX) <= halfW && Math.abs(localY) <= halfH;
}

/**
 * Returns the id of the topmost item (highest zIndex, ties broken by later
 * position in the array) whose rotated bounding quad contains `point`.
 * Returns null if no item is hit.
 */
export function hitTest(point: Point, items: PlacedItem[]): string | null {
  let best: PlacedItem | null = null;
  let bestIndex = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (!pointInItem(point, item)) continue;
    if (best === null || item.zIndex > best.zIndex || (item.zIndex === best.zIndex && i > bestIndex)) {
      best = item;
      bestIndex = i;
    }
  }
  return best !== null ? best.id : null;
}
