import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloorSelector } from '../FloorSelector';

describe('FloorSelector', () => {
  const defaultProps = {
    levels: [-1, 0, 1, 2],
    selectedLevel: 0,
    onLevelChange: vi.fn(),
  };

  it('renders all floor level buttons', () => {
    render(<FloorSelector {...defaultProps} />);
    expect(screen.getByText('B1')).toBeTruthy();
    expect(screen.getByText('G')).toBeTruthy();
    expect(screen.getByText('1F')).toBeTruthy();
    expect(screen.getByText('2F')).toBeTruthy();
  });

  it('highlights the selected level', () => {
    render(<FloorSelector {...defaultProps} />);
    const gButton = screen.getByText('G');
    // Check that selected button has accent background
    expect(gButton.closest('button')?.style.background).toContain('#58a6ff');
  });

  it('calls onLevelChange when clicking a level', () => {
    const onChange = vi.fn();
    render(<FloorSelector {...defaultProps} onLevelChange={onChange} />);
    fireEvent.click(screen.getByText('1F'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('renders empty when no levels provided', () => {
    const { container } = render(
      <FloorSelector levels={[]} selectedLevel={0} onLevelChange={vi.fn()} />,
    );
    // Should render container but no buttons
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('handles negative levels (basements)', () => {
    render(
      <FloorSelector levels={[-2, -1]} selectedLevel={-1} onLevelChange={vi.fn()} />,
    );
    expect(screen.getByText('B2')).toBeTruthy();
    expect(screen.getByText('B1')).toBeTruthy();
  });
});
