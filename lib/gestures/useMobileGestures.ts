'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export type MobileSwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface GesturePoint {
  x: number;
  y: number;
}

export interface MobileGestureHandlers {
  onLongPress?: (point: GesturePoint) => void;
  onTwoFingerTap?: (point: GesturePoint) => void;
  onThreeFingerTap?: (point: GesturePoint) => void;
  onSwipe?: (direction: MobileSwipeDirection, distance: number) => void;
  onThreeFingerSwipe?: (direction: MobileSwipeDirection, distance: number) => void;
  onPinch?: (scale: number, center: GesturePoint) => void;
  onRotate?: (degrees: number, center: GesturePoint) => void;
  onTwoFingerPan?: (delta: GesturePoint, center: GesturePoint) => void;
  onMultiTouchStart?: (point: GesturePoint, count: number) => void;
  onMultiTouchEnd?: () => void;
}

interface PointerState extends GesturePoint {
  id: number;
  downAt: number;
}

const LONG_PRESS_MS = 520;
const TAP_MAX_MS = 280;
const TAP_MAX_MOVE = 14;
const SWIPE_MIN_DISTANCE = 48;

function distance(a: GesturePoint, b: GesturePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: GesturePoint, b: GesturePoint): GesturePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angle(a: GesturePoint, b: GesturePoint) {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

function normalizeAngle(value: number) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

/**
 * Pointer-event based mobile gesture recognizer.
 *
 * It deliberately does not hijack ordinary one-finger taps/drags, so existing
 * buttons, links, canvas editors and timeline interactions continue to work.
 * Multi-touch gestures are recognized from the same pointer stream.
 */
export function useMobileGestures<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handlers: MobileGestureHandlers,
  enabled = true,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    const pointers = new Map<number, PointerState>();
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressPointer: number | null = null;
    let longPressStart: GesturePoint | null = null;
    let longPressFired = false;

    let gestureStartCount = 0;
    let gestureStartAt = 0;
    let gestureStartCenter: GesturePoint | null = null;
    let gestureStartDistance = 0;
    let gestureStartAngle = 0;
    let lastCenter: GesturePoint | null = null;
    let currentCenter: GesturePoint | null = null;
    let lastDistance = 0;
    let lastAngle = 0;
    let multiTouchMoved = false;

    const clearLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressPointer = null;
      longPressStart = null;
    };

    const cancelLongPress = () => {
      clearLongPress();
      longPressFired = false;
    };

    const beginMultiTouch = () => {
      if (pointers.size < 2) return;

      cancelLongPress();
      multiTouchMoved = false;

      const list = Array.from(pointers.values());
      const a = list[0];
      const b = list[1];

      gestureStartCount = pointers.size;
      gestureStartAt = performance.now();
      gestureStartCenter = pointers.size === 2
        ? midpoint(a, b)
        : { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };
      gestureStartDistance = distance(a, b);
      gestureStartAngle = angle(a, b);
      lastCenter = gestureStartCenter;
      currentCenter = gestureStartCenter;
      lastDistance = gestureStartDistance;
      lastAngle = gestureStartAngle;
      handlersRef.current.onMultiTouchStart?.(gestureStartCenter, pointers.size);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;

      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, { ...point, id: event.pointerId, downAt: performance.now() });

      if (pointers.size === 1) {
        longPressFired = false;
        longPressPointer = event.pointerId;
        longPressStart = point;
        longPressTimer = setTimeout(() => {
          const current = pointers.get(event.pointerId);
          if (!current || pointers.size !== 1 || !longPressStart) return;
          longPressFired = true;
          handlersRef.current.onLongPress?.(longPressStart);
        }, LONG_PRESS_MS);
      } else if (pointers.size === 2) {
        beginMultiTouch();
      } else if (pointers.size === 3) {
        beginMultiTouch();
      } else {
        cancelLongPress();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = pointers.get(event.pointerId);
      if (!current) return;

      const next = { ...current, x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, next);

      if (longPressStart && distance(longPressStart, next) > TAP_MAX_MOVE) {
        cancelLongPress();
      }

      if (pointers.size < 2 || !gestureStartCenter) return;

      multiTouchMoved = true;
      const list = Array.from(pointers.values());
      const a = list[0];
      const b = list[1];
      const center = pointers.size === 2
        ? midpoint(a, b)
        : { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length };

      if (pointers.size === 2) {
        const currentDistance = distance(a, b);
        if (gestureStartDistance > 1) {
          const incrementalScale = lastDistance > 1 ? currentDistance / lastDistance : 1;
          handlersRef.current.onPinch?.(incrementalScale, center);
          lastDistance = currentDistance;
        }

        const currentAngle = angle(a, b);
        handlersRef.current.onRotate?.(
          normalizeAngle(currentAngle - lastAngle),
          center,
        );
        lastAngle = currentAngle;

        if (lastCenter) {
          handlersRef.current.onTwoFingerPan?.(
            { x: center.x - lastCenter.x, y: center.y - lastCenter.y },
            center,
          );
        }
      }

      lastCenter = center;
      currentCenter = center;
    };

    const finishPointer = (event: PointerEvent) => {
      const current = pointers.get(event.pointerId);
      if (!current) return;

      const now = performance.now();
      const elapsed = now - current.downAt;
      const moved = distance(current, { x: event.clientX, y: event.clientY });

      if (pointers.size === 1 && longPressPointer === event.pointerId && !longPressFired) {
        const start = longPressStart || current;
        clearLongPress();
        if (elapsed <= TAP_MAX_MS && moved <= TAP_MAX_MOVE) {
          // A normal tap intentionally has no gesture callback.
        } else if (moved >= SWIPE_MIN_DISTANCE) {
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          const direction = Math.abs(dx) >= Math.abs(dy)
            ? (dx < 0 ? 'left' : 'right')
            : (dy < 0 ? 'up' : 'down');
          handlersRef.current.onSwipe?.(direction, Math.max(Math.abs(dx), Math.abs(dy)));
        }
      }

      pointers.delete(event.pointerId);

      if (pointers.size === 0) {
        const count = gestureStartCount;
        const duration = now - gestureStartAt;

        if (!multiTouchMoved && duration <= TAP_MAX_MS && (count === 2 || count === 3) && gestureStartCenter) {
          if (count === 2) handlersRef.current.onTwoFingerTap?.(gestureStartCenter);
          if (count === 3) handlersRef.current.onThreeFingerTap?.(gestureStartCenter);
        } else if (multiTouchMoved && count === 3 && gestureStartCenter && currentCenter) {
          const dx = currentCenter.x - gestureStartCenter.x;
          const dy = currentCenter.y - gestureStartCenter.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN_DISTANCE) {
            const direction = Math.abs(dx) >= Math.abs(dy)
              ? (dx < 0 ? 'left' : 'right')
              : (dy < 0 ? 'up' : 'down');
            handlersRef.current.onThreeFingerSwipe?.(
              direction,
              Math.max(Math.abs(dx), Math.abs(dy)),
            );
          }
        }

        handlersRef.current.onMultiTouchEnd?.();
        gestureStartCount = 0;
        gestureStartCenter = null;
        gestureStartDistance = 0;
        gestureStartAngle = 0;
        lastCenter = null;
        currentCenter = null;
        lastDistance = 0;
        lastAngle = 0;
        multiTouchMoved = false;
        cancelLongPress();
      } else if (pointers.size === 1) {
        clearLongPress();
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      cancelLongPress();
      if (pointers.size === 0) {
        gestureStartCount = 0;
        gestureStartCenter = null;
        lastCenter = null;
        currentCenter = null;
        multiTouchMoved = false;
      }
    };

    node.addEventListener('pointerdown', handlePointerDown, { passive: true });
    node.addEventListener('pointermove', handlePointerMove, { passive: true });
    node.addEventListener('pointerup', finishPointer, { passive: true });
    node.addEventListener('pointercancel', handlePointerCancel, { passive: true });

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', finishPointer);
      node.removeEventListener('pointercancel', handlePointerCancel);
      clearLongPress();
    };
  }, [enabled, ref]);
}
