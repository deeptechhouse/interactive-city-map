import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api/interior', () => ({
  createRoom: vi.fn().mockResolvedValue({ id: 'new-room' }),
  createWall: vi.fn().mockResolvedValue({ id: 'new-wall' }),
  createFeature: vi.fn().mockResolvedValue({ id: 'new-feature' }),
  deleteRoom: vi.fn().mockResolvedValue(undefined),
  deleteWall: vi.fn().mockResolvedValue(undefined),
  deleteFeature: vi.fn().mockResolvedValue(undefined),
}));

import { InteriorEditor } from '../InteriorEditor';

describe('InteriorEditor', () => {
  const defaultProps = {
    buildingId: 'test-building',
    level: 0,
    mapInstance: null,
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders toolbar with all tool buttons', () => {
    render(<InteriorEditor {...defaultProps} />);
    expect(screen.getByText('Select')).toBeTruthy();
    expect(screen.getByText('Wall')).toBeTruthy();
    expect(screen.getByText('Room')).toBeTruthy();
    expect(screen.getByText('Feature')).toBeTruthy();
    expect(screen.getByText('Measure')).toBeTruthy();
  });

  it('shows room type selector when draw-room is active', () => {
    render(<InteriorEditor {...defaultProps} />);
    fireEvent.click(screen.getByText('Room'));
    expect(screen.getByText('Room Type')).toBeTruthy();
  });

  it('shows feature type selector when draw-feature is active', () => {
    render(<InteriorEditor {...defaultProps} />);
    fireEvent.click(screen.getByText('Feature'));
    expect(screen.getByText('Feature Type')).toBeTruthy();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<InteriorEditor {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalled();
  });

  it('undo/redo buttons are initially disabled', () => {
    render(<InteriorEditor {...defaultProps} />);
    const undoBtn = screen.getByText('Undo');
    const redoBtn = screen.getByText('Redo');
    expect(
      undoBtn.hasAttribute('disabled') || (undoBtn as HTMLButtonElement).disabled,
    ).toBeTruthy();
    expect(
      redoBtn.hasAttribute('disabled') || (redoBtn as HTMLButtonElement).disabled,
    ).toBeTruthy();
  });
});
