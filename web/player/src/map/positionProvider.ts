import { smoothHeading, startCompass } from './heading';

export interface PlayerPosition {
  lat: number;
  lon: number;
  heading: number | null;
  timestamp: number;
}

export interface PositionProvider {
  start(): void;
  stop(): void;
  subscribe(cb: (p: PlayerPosition) => void): () => void;
}

const METERS_PER_DEG = 111320;

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// JoystickProvider
// ---------------------------------------------------------------------------

/**
 * Drives the player position from an on-screen joystick vector. Advances the
 * position in a ~10 Hz loop while a non-zero vector is set.
 */
export class JoystickProvider implements PositionProvider {
  private readonly speedMps: number;
  private pos: PlayerPosition;
  private dx = 0;
  private dy = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private readonly subscribers = new Set<(p: PlayerPosition) => void>();

  constructor(opts: { initial: { lat: number; lon: number }; speedMps: number }) {
    this.speedMps = opts.speedMps;
    this.pos = {
      lat: opts.initial.lat,
      lon: opts.initial.lon,
      heading: null,
      timestamp: Date.now(),
    };
  }

  /** Normalized vector from the joystick: -1..1, dy>0 = up = north. */
  setVector(dx: number, dy: number): void {
    this.dx = dx;
    this.dy = dy;
    if (dx !== 0 || dy !== 0) {
      this.pos.heading = normalizeDegrees((Math.atan2(dx, dy) * 180) / Math.PI);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.last = performance.now();
    this.timer = setInterval(() => { this.tick(); }, 100);
    // Emit the initial position immediately so subscribers can sync.
    this.emit();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(cb: (p: PlayerPosition) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  private tick(): void {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (this.dx === 0 && this.dy === 0) return;
    const dist = this.speedMps * dt;
    this.pos = {
      ...this.pos,
      lat: this.pos.lat + (this.dy * dist) / METERS_PER_DEG,
      lon:
        this.pos.lon +
        (this.dx * dist) / (METERS_PER_DEG * Math.cos((this.pos.lat * Math.PI) / 180)),
      timestamp: Date.now(),
    };
    this.emit();
  }

  private emit(): void {
    for (const cb of this.subscribers) cb(this.pos);
  }
}

// ---------------------------------------------------------------------------
// GpsProvider
// ---------------------------------------------------------------------------

export interface GpsProviderOptions {
  /** Called once when a GPS signal-loss timeout expires. Re-armed after next fix. */
  onSignalLoss?: (() => void) | undefined;
  /** How long without a GPS fix before onSignalLoss fires (milliseconds). */
  signalTimeoutMs: number;
}

/**
 * Wraps navigator.geolocation.watchPosition and merges GPS fixes with the
 * device compass for accurate heading even when stationary.
 *
 * Heading strategy:
 *   - Use coords.heading from GPS when speed > 0.5 m/s and heading is valid
 *   - Otherwise use the last compass heading from the device orientation API
 *   - Apply exponential moving average via smoothHeading() before emitting
 *
 * Signal-loss detection:
 *   - A 10-second interval checks whether the last fix is older than
 *     signalTimeoutMs; fires onSignalLoss once, re-armed on next fix.
 *   - PERMISSION_DENIED error also triggers onSignalLoss immediately.
 */
export class GpsProvider implements PositionProvider {
  private watchId: number | null = null;
  private readonly subscribers = new Set<(p: PlayerPosition) => void>();

  // Compass state
  private compassHeading: number | null = null;
  private stopCompass: (() => void) | null = null;

  // Smoothing state
  private smoothedHeading: number | null = null;

  // Signal-loss state
  private lastFixAt: number | null = null;
  private signalLossFired = false;
  private signalCheckTimer: ReturnType<typeof setInterval> | null = null;

  private readonly onSignalLoss: (() => void) | undefined;
  private readonly signalTimeoutMs: number;

  constructor(opts: GpsProviderOptions) {
    this.onSignalLoss = opts.onSignalLoss;
    this.signalTimeoutMs = opts.signalTimeoutMs;
  }

  start(): void {
    if (this.watchId !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    // Start compass in parallel.
    this.stopCompass = startCompass((heading) => {
      this.compassHeading = heading;
    });

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => { this.handleFix(pos); },
      (err) => { this.handleError(err); },
      { enableHighAccuracy: true },
    );

    // Signal-loss polling interval: check every 10 s.
    this.signalCheckTimer = setInterval(() => { this.checkSignalLoss(); }, 10_000);
  }

  stop(): void {
    if (this.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.stopCompass?.();
    this.stopCompass = null;
    if (this.signalCheckTimer !== null) {
      clearInterval(this.signalCheckTimer);
      this.signalCheckTimer = null;
    }
  }

  subscribe(cb: (p: PlayerPosition) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private handleFix(pos: GeolocationPosition): void {
    this.lastFixAt = Date.now();
    // Re-arm signal-loss detection after a new fix arrives.
    this.signalLossFired = false;

    const { latitude, longitude, heading: gpsHeading, speed } = pos.coords;

    // Choose raw heading source: GPS when moving, otherwise compass.
    let rawHeading: number | null = null;
    if (typeof speed === 'number' && speed > 0.5 && typeof gpsHeading === 'number' && gpsHeading !== null) {
      rawHeading = gpsHeading;
    } else if (this.compassHeading !== null) {
      rawHeading = this.compassHeading;
    }

    // Apply smoothing.
    if (rawHeading !== null) {
      this.smoothedHeading = smoothHeading(this.smoothedHeading, rawHeading);
    }

    const p: PlayerPosition = {
      lat: latitude,
      lon: longitude,
      heading: this.smoothedHeading,
      timestamp: pos.timestamp,
    };
    this.emit(p);
  }

  private handleError(err: GeolocationPositionError): void {
    if (err.code === err.PERMISSION_DENIED) {
      this.fireSignalLoss();
    }
    // TIMEOUT / POSITION_UNAVAILABLE are handled by the polling interval.
  }

  private checkSignalLoss(): void {
    if (this.signalLossFired) return;
    const now = Date.now();
    const age = this.lastFixAt !== null ? now - this.lastFixAt : now;
    if (age > this.signalTimeoutMs) {
      this.fireSignalLoss();
    }
  }

  private fireSignalLoss(): void {
    if (this.signalLossFired) return;
    this.signalLossFired = true;
    this.onSignalLoss?.();
  }

  private emit(p: PlayerPosition): void {
    for (const cb of this.subscribers) cb(p);
  }
}
