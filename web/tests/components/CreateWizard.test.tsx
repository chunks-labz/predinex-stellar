import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCreateWizard, CREATE_MARKET_DRAFT_KEY } from '../../app/create/_wizard/useCreateWizard';
import { StepIndicator } from '../../app/create/_wizard/StepIndicator';

describe('useCreateWizard (#429)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.removeItem(CREATE_MARKET_DRAFT_KEY);
  });

  it('starts at step 1 with an empty draft and cannot advance', () => {
    const { result } = renderHook(() => useCreateWizard());
    expect(result.current.step).toBe(1);
    expect(result.current.draft.title).toBe('');
    expect(result.current.canAdvance).toBe(false);
  });

  it('blocks step 1 advancement when title is missing', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.errors.title).toBeTruthy();
  });

  it('flags identical outcomes as an error on step 1', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.setField('title', 'A bold market question'));
    act(() => result.current.setField('description', 'This is a sufficiently long description.'));
    act(() => result.current.setField('outcomeA', 'Yes'));
    act(() => result.current.setField('outcomeB', 'YES'));
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
    expect(result.current.errors.outcomeB).toMatch(/different/i);
  });

  it('advances through all three steps with valid data', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.setField('title', 'Will BTC be above $100k?'));
    act(() => result.current.setField('description', 'Resolves at end of 2025.'));
    act(() => result.current.setField('outcomeA', 'Yes'));
    act(() => result.current.setField('outcomeB', 'No'));
    act(() => result.current.next());
    expect(result.current.step).toBe(2);

    act(() => result.current.setField('duration', '86400'));
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
    expect(result.current.isFinalStep).toBe(true);
  });

  it('rejects forward jumping past an invalid step via goTo', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.goTo(3));
    expect(result.current.step).toBe(1);
    expect(result.current.errors.title).toBeTruthy();
  });

  it('allows backward jumping freely', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.setField('title', 'A solid question'));
    act(() => result.current.setField('description', 'A solid description.'));
    act(() => result.current.setField('outcomeA', 'Yes'));
    act(() => result.current.setField('outcomeB', 'No'));
    act(() => result.current.next());
    act(() => result.current.setField('duration', '86400'));
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
    act(() => result.current.goTo(1));
    expect(result.current.step).toBe(1);
  });

  it('resetDraft clears state and returns to step 1', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.setField('title', 'Something'));
    act(() => result.current.resetDraft());
    expect(result.current.step).toBe(1);
    expect(result.current.draft.title).toBe('');
  });
});

describe('StepIndicator (#429)', () => {
  beforeEach(() => cleanup());

  it('marks the current step with aria-current', () => {
    render(<StepIndicator current={2} onJump={() => {}} />);
    const current = screen.getByRole('button', { name: /Parameters/i });
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('calls onJump when a step pill is clicked', async () => {
    const user = userEvent.setup();
    let jumped: number | null = null;
    render(<StepIndicator current={3} onJump={(s) => (jumped = s)} />);
    await user.click(screen.getByRole('button', { name: /Question/i }));
    expect(jumped).toBe(1);
  });
});
