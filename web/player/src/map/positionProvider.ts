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
    this.timer = setInterval(() => this.tick(), 100);
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
    return () => this.subscribers.delete(cb);
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

/** Wraps navigator.geolocation.watchPosition. */
export class GpsProvider implements PositionProvider {
  private watchId: number | null = null;
  private readonly subscribers = new Set<(p: PlayerPosition) => void>();

  start(): void {
    if (this.watchId !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p: PlayerPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          heading: pos.coords.heading ?? null,
          timestamp: pos.timestamp,
        };
        for (const cb of this.subscribers) cb(p);
      },
      undefined,
      { enableHighAccuracy: true },
    );
  }

  stop(): void {
    if (this.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  subscribe(cb: (p: PlayerPosition) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
}
