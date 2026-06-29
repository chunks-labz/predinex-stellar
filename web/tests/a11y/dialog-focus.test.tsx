import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from '../../components/ui/Dialog';

function DialogHarness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Test dialog">
        <button type="button">First action</button>
        <button type="button">Second action</button>
        <button type="button">Third action</button>
      </Dialog>
    </div>
  );
}

describe('Dialog a11y — focus trap & Escape', () => {
  beforeEach(() => {
    cleanup();
  });

  it('exposes role="dialog" and aria-modal when open', () => {
    render(<DialogHarness initialOpen />);
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('cycles focus inside the dialog when Tab reaches the last focusable', async () => {
    const user = userEvent.setup();
    render(<DialogHarness initialOpen />);

    const closeButton = screen.getByRole('button', { name: /close test dialog/i });
    const first = screen.getByRole('button', { name: 'First action' });
    const third = screen.getByRole('button', { name: 'Third action' });

    // Initial focus should land on the first focusable inside the dialog (the close button).
    expect(document.activeElement).toBe(closeButton);

    // Tab forward through to the third (last) button.
    await user.tab(); // -> First action
    expect(document.activeElement).toBe(first);
    await user.tab(); // -> Second action
    await user.tab(); // -> Third action
    expect(document.activeElement).toBe(third);

    // One more Tab should wrap back to the first focusable (close button).
    await user.tab();
    expect(document.activeElement).toBe(closeButton);
  });

  it('Shift+Tab from the first focusable wraps to the last', async () => {
    const user = userEvent.setup();
    render(<DialogHarness initialOpen />);

    const closeButton = screen.getByRole('button', { name: /close test dialog/i });
    const third = screen.getByRole('button', { name: 'Third action' });

    expect(document.activeElement).toBe(closeButton);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(third);
  });

  it('Escape closes the dialog and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    await user.click(opener);

    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Test dialog' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('clicking the backdrop closes the dialog by default', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    function StaticHarness() {
      return (
        <Dialog open onClose={onClose} title="Backdrop dialog">
          <p>Body</p>
        </Dialog>
      );
    }
    render(<StaticHarness />);

    const dialog = screen.getByRole('dialog', { name: 'Backdrop dialog' });
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on Escape when closeOnEscape is false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Dialog open onClose={onClose} title="Sticky dialog" closeOnEscape={false}>
        <p>Body</p>
      </Dialog>
    );

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
