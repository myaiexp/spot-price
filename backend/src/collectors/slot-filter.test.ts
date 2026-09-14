// Tests filterValidSlots' keep/drop split and skip-count warning (finding #9606).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { filterValidSlots } from './slot-filter.js';

const isEven = (v: unknown): v is number => typeof v === 'number' && v % 2 === 0;

afterEach(() => vi.restoreAllMocks());

describe('filterValidSlots (finding #9606)', () => {
  it('keeps guard-accepted slots in order and warns with the skip count and source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(filterValidSlots([2, 3, 'x', 4, null], isEven, 'example.fi')).toEqual([2, 4]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Skipped 3 slot(s) with invalid fields from example.fi');
  });

  it('does not warn when every slot is valid, or when there are none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(filterValidSlots([2, 4], isEven, 'example.fi')).toEqual([2, 4]);
    expect(filterValidSlots([], isEven, 'example.fi')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns [] for an all-invalid list and leaves fatality to the caller', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(filterValidSlots([1, 3], isEven, 'example.fi')).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Skipped 2 slot(s) with invalid fields from example.fi');
  });
});
