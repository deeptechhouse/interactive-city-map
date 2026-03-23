import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFloorLevel } from '../hooks/useFloorLevel';
import type { InteriorRoom } from '../../api/interior';

/**
 * Helper to create minimal InteriorRoom objects for testing.
 */
function makeRoom(level: number, id?: string): InteriorRoom {
  return {
    id: id ?? `room-${level}`,
    building_id: 'building-1',
    floor_plan_id: null,
    source_id: null,
    level,
    room_type: 'office',
    name: `Room ${level}`,
    area_sqm: 25,
    capacity: 10,
    metadata: null,
    geom: null,
    created_at: null,
    updated_at: null,
  };
}

describe('useFloorLevel', () => {
  it('derives available levels from rooms', () => {
    const rooms = [makeRoom(0), makeRoom(1), makeRoom(2)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.availableLevels).toEqual([0, 1, 2]);
  });

  it('sorts levels numerically', () => {
    const rooms = [makeRoom(2), makeRoom(-1), makeRoom(0), makeRoom(1)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.availableLevels).toEqual([-1, 0, 1, 2]);
  });

  it('deduplicates levels', () => {
    const rooms = [
      makeRoom(0, 'r1'),
      makeRoom(0, 'r2'),
      makeRoom(1, 'r3'),
      makeRoom(1, 'r4'),
    ];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.availableLevels).toEqual([0, 1]);
  });

  it('starts at level 0 by default', () => {
    const rooms = [makeRoom(0), makeRoom(1)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.currentLevel).toBe(0);
  });

  it('formats ground level as G', () => {
    const rooms = [makeRoom(0)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.levelName(0)).toBe('G');
  });

  it('formats positive levels as NF', () => {
    const rooms = [makeRoom(1)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.levelName(1)).toBe('1F');
    expect(result.current.levelName(5)).toBe('5F');
  });

  it('formats negative levels as BN', () => {
    const rooms = [makeRoom(-1)];
    const { result } = renderHook(() => useFloorLevel(rooms));
    expect(result.current.levelName(-1)).toBe('B1');
    expect(result.current.levelName(-3)).toBe('B3');
  });

  it('setLevel changes current level', () => {
    const rooms = [makeRoom(0), makeRoom(1), makeRoom(2)];
    const { result } = renderHook(() => useFloorLevel(rooms));

    act(() => {
      result.current.setLevel(2);
    });
    expect(result.current.currentLevel).toBe(2);
  });

  it('setLevel ignores invalid level not in available levels', () => {
    const rooms = [makeRoom(0), makeRoom(1)];
    const { result } = renderHook(() => useFloorLevel(rooms));

    act(() => {
      result.current.setLevel(99);
    });
    // Should remain at 0 (the default)
    expect(result.current.currentLevel).toBe(0);
  });

  it('resets to first available level when current becomes invalid', () => {
    const initialRooms = [makeRoom(0), makeRoom(1), makeRoom(2)];
    const { result, rerender } = renderHook(
      ({ rooms }) => useFloorLevel(rooms),
      { initialProps: { rooms: initialRooms } },
    );

    // Set level to 2
    act(() => {
      result.current.setLevel(2);
    });
    expect(result.current.currentLevel).toBe(2);

    // Rerender with rooms that don't include level 2
    rerender({ rooms: [makeRoom(0), makeRoom(1)] });

    // Should reset to first available level (0)
    expect(result.current.currentLevel).toBe(0);
  });

  it('returns empty availableLevels when no rooms', () => {
    const { result } = renderHook(() => useFloorLevel([]));
    expect(result.current.availableLevels).toEqual([]);
  });

  it('allows setLevel when availableLevels is empty', () => {
    const { result } = renderHook(() => useFloorLevel([]));

    act(() => {
      result.current.setLevel(5);
    });
    // With empty available levels, the hook permits the set
    expect(result.current.currentLevel).toBe(5);
  });
});
