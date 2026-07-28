import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useCreateWizard,
  CREATE_POOL_DRAFT_KEY,
  CREATE_MARKET_DRAFT_KEY,
} from '../../app/create/_wizard/useCreateWizard';
import { StepIndicator } from '../../app/create/_wizard/StepIndicator';

const DRAFT_KEY = CREATE_POOL_DRAFT_KEY;

function fillBasics(
  setField: ReturnType<typeof useCreateWizard>['setField']
) {
  act(() => setField('title', 'Will BTC be above $100k?'));
  act(() => setField('description', 'Resolves at end of 2025 with clear criteria.'));
}

function fillOutcomes(
  setOutcome: ReturnType<typeof useCreateWizard>['setOutcome']
) {
  act(() => setOutcome(0, 'Yes'));
  act(() => setOutcome(1, 'No'));
}

function fillParameters(
  setField: ReturnType<typeof useCreateWizard>['setField']
) {
  act(() => setField('duration', '86400'));
  act(() => setField('depositDeadline', '82800'));
  act(() => setField('protocolFeeBps', '200'));
  act(() => setField('settlementType', 'twap'));
}

describe('useCreateWizard', () => {
  beforeEach(() => {
    cleanup();
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(CREATE_MARKET_DRAFT_KEY);
  });

  it('starts at step 1 with an empty draft and can advance from template step', () => {
    const { result } = renderHook(() => useCreateWizard());
    expect(result.current.step).toBe(1);
    expect(result.current.draft.title).toBe('');
    expect(result.current.canAdvance).toBe(true);
  });

  it('blocks step 2 advancement when title is missing', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.step).toBe(2);
    expect(result.current.errors.title).toBeTruthy();
  });

  it('flags duplicate outcomes as an error on step 3', () => {
    const { result } = renderHook(() => useCreateWizard());
    fillBasics(result.current.setField);
    act(() => result.current.next());
    act(() => result.current.setOutcome(0, 'Yes'));
    act(() => result.current.setOutcome(1, 'YES'));
    act(() => result.current.next());
    expect(result.current.step).toBe(3);
    expect(result.current.errors.outcome_1).toMatch(/unique/i);
  });

  it('advances through all five steps with valid data', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.next());
    expect(result.current.step).toBe(2);

    fillBasics(result.current.setField);
    act(() => result.current.next());
    expect(result.current.step).toBe(3);

    fillOutcomes(result.current.setOutcome);
    act(() => result.current.next());
    expect(result.current.step).toBe(4);

    fillParameters(result.current.setField);
    act(() => result.current.next());
    expect(result.current.step).toBe(5);
    expect(result.current.isFinalStep).toBe(true);
  });

  it('rejects forward jumping past an invalid step via goTo', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.goTo(5));
    expect(result.current.step).toBe(2);
    expect(result.current.errors.title).toBeTruthy();
  });

  it('allows backward jumping freely', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.next());
    fillBasics(result.current.setField);
    act(() => result.current.next());
    fillOutcomes(result.current.setOutcome);
    act(() => result.current.next());
    fillParameters(result.current.setField);
    act(() => result.current.next());
    expect(result.current.step).toBe(5);
    act(() => result.current.goTo(2));
    expect(result.current.step).toBe(2);
  });

  it('resetDraft clears state and returns to step 1', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.setField('title', 'Something'));
    act(() => result.current.resetDraft());
    expect(result.current.step).toBe(1);
    expect(result.current.draft.title).toBe('');
  });

  it('supports adding and removing outcomes within limits', () => {
    const { result } = renderHook(() => useCreateWizard());
    act(() => result.current.addOutcome());
    expect(result.current.draft.outcomes).toHaveLength(3);
    act(() => result.current.removeOutcome(2));
    expect(result.current.draft.outcomes).toHaveLength(2);
  });
});

describe('StepIndicator', () => {
  beforeEach(() => cleanup());

  it('marks the current step with aria-current', () => {
    render(<StepIndicator current={4} onJump={() => {}} />);
    const current = screen.getByRole('button', { name: /Parameters/i });
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('calls onJump when a step pill is clicked', async () => {
    const user = userEvent.setup();
    let jumped: number | null = null;
    render(<StepIndicator current={5} onJump={(s) => (jumped = s)} />);
    await user.click(screen.getByRole('button', { name: /Basics/i }));
    expect(jumped).toBe(2);
  });
});
