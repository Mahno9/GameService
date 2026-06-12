/**
 * Heading utilities: smoothing and device-compass subscription.
 */

/**
 * Exponential moving average over the SHORTEST arc between two headings.
 * Normalises the result to 0..360.
 *
 * @param prev  Previous smoothed heading (null = bootstrap with `next`)
 * @param next  Raw new heading (degrees, any range)
 * @param alpha Smoothing factor 0..1  (higher = more responsive, default 0.3)
 */
export function smoothHeading(prev: number | null, next: number, alpha = 0.3): number {
  if (prev === null) return normalise(next);

  const p = normalise(prev);
  const n = normalise(next);

  // Find the shortest arc (-180..180).
  let delta = n - p;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  return normalise(p + alpha * delta);
}

function normalise(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Compass permission (iOS 13+)
// ---------------------------------------------------------------------------

/**
 * Requests DeviceOrientationEvent permission on iOS 13+.
 * Returns true if permission was granted or if the API is absent (non-iOS).
 */
export async function requestCompassPermission(): Promise<boolean> {
  // The requestPermission static method only exists on iOS 13+.
  const DoE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DoE.requestPermission !== 'function') {
    // Not iOS — permission not required.
    return true;
  }
  try {
    const result = await DoE.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/**
 * Returns true only when the iOS DeviceOrientationEvent.requestPermission API
 * exists — i.e. an explicit user gesture is needed before we can read the compass.
 */
export function compassNeedsPermission(): boolean {
  const DoE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  return typeof DoE.requestPermission === 'function';
}

// ---------------------------------------------------------------------------
// Compass subscription
// ---------------------------------------------------------------------------

/**
 * Subscribes to device orientation and calls `cb` with compass heading in
 * degrees (0 = North, clockwise).
 *
 * Strategy:
 *   1. Prefer `deviceorientationabsolute` (Android Chrome, etc.)
 *   2. Fall back to `deviceorientation`
 *   3. On iOS, use `webkitCompassHeading` when present
 *   4. Otherwise derive from the `alpha` Euler angle:  heading = 360 - alpha
 *      (only reliable for absolute events; relative alpha is meaningless as heading)
 *
 * Returns an unsubscribe function.
 */
export function startCompass(cb: (heading: number) => void): () => void {
  let active = true;

  function handleEvent(e: DeviceOrientationEvent): void {
    if (!active) return;

    // iOS webkitCompassHeading: degrees from magnetic north, clockwise.
    const ios = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
    if (typeof ios.webkitCompassHeading === 'number') {
      cb(normalise(ios.webkitCompassHeading));
      return;
    }

    // For absolute events, alpha = 0 → North on some implementations; derive
    // compass heading as 360 - alpha (the bearing the top of the device faces).
    if (e.alpha !== null) {
      cb(normalise(360 - e.alpha));
    }
  }

  // Prefer absolute events; fall back to relative.
  let eventName: 'deviceorientationabsolute' | 'deviceorientation' = 'deviceorientation';
  if ('ondeviceorientationabsolute' in window) {
    eventName = 'deviceorientationabsolute';
  }

  window.addEventListener(eventName, handleEvent as EventListener);

  return () => {
    active = false;
    window.removeEventListener(eventName, handleEvent as EventListener);
  };
}
