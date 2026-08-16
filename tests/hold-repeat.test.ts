import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginRepeatedAction } from '../src/hold-repeat';

describe('held touch control input', () => {
  afterEach(() => vi.useRealTimers());

  it('starts immediately, repeats after a delay, and stops on release', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const stop = beginRepeatedAction(action, true);

    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(279);
    expect(action).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(180);
    expect(action).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(1_000);
    expect(action).toHaveBeenCalledTimes(4);
  });

  it('keeps the drop action as a single input', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const stop = beginRepeatedAction(action, false);

    vi.advanceTimersByTime(1_000);
    expect(action).toHaveBeenCalledTimes(1);
    stop();
  });
});
