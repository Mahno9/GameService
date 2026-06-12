import { useRef, useState } from 'react';
import './map.css';

interface JoystickProps {
  /** dx, dy normalized to -1..1. dy positive = up. */
  onChange: (dx: number, dy: number) => void;
}

const SIZE = 120;
const KNOB = 48;
const RADIUS = (SIZE - KNOB) / 2;

export function Joystick({ onChange }: JoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  function update(clientX: number, clientY: number) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ox = clientX - cx;
    let oy = clientY - cy;
    const dist = Math.hypot(ox, oy);
    if (dist > RADIUS) {
      ox = (ox / dist) * RADIUS;
      oy = (oy / dist) * RADIUS;
    }
    setKnob({ x: ox, y: oy });
    // Screen y grows downward; flip so dy positive = up = north.
    onChange(ox / RADIUS, -oy / RADIUS);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== null) return;
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== e.pointerId) return;
    update(e.clientX, e.clientY);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  }

  return (
    <div
      ref={baseRef}
      className="joystick-base"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="joystick-knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  );
}
