import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import CountdownTimer from '@/components/CountdownTimer';

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the initial countdown and ticks down each second', () => {
    render(<CountdownTimer secondsRemaining={90} />);

    // 1m 30s remaining (under an hour → minutes/seconds format).
    expect(screen.getByRole('timer')).toHaveTextContent('1m 30s');

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('1m 25s');
  });

  it('transitions to the Expired state when time runs out', () => {
    render(<CountdownTimer secondsRemaining={3} />);

    expect(screen.getByRole('timer')).toHaveTextContent('0m 3s');

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByRole('timer')).toHaveTextContent('Expired');
  });

  it('renders the Expired state immediately for a null countdown', () => {
    render(<CountdownTimer secondsRemaining={null} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Expired');
  });

  it('shows a static Settled label for settled pools', () => {
    render(<CountdownTimer secondsRemaining={500} settled />);
    expect(screen.getByRole('status')).toHaveTextContent('Settled');
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('exposes an accessible announcement of the remaining time', () => {
    render(<CountdownTimer secondsRemaining={2 * 3600 + 30 * 60} />);
    // sr-only live region uses the verbose, minute-granular description.
    expect(screen.getByRole('timer')).toHaveTextContent('2 hours, 30 minutes remaining');
  });
});
