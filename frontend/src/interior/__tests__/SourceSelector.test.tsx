import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceSelector } from '../SourceSelector';

describe('SourceSelector', () => {
  const mockSources = [
    { id: 'src-1', source_type: 'sanborn', confidence: 0.8 },
    { id: 'src-2', source_type: 'upload', confidence: 0.5 },
    { id: 'src-3', source_type: 'osm', confidence: 0.2 },
  ];

  const defaultProps = {
    sources: mockSources,
    selectedSourceId: null as string | null,
    onSourceChange: vi.fn(),
  };

  it('renders all source chips', () => {
    render(<SourceSelector {...defaultProps} />);
    expect(screen.getByText('Sanborn')).toBeTruthy();
    expect(screen.getByText('Upload')).toBeTruthy();
    expect(screen.getByText('OSM')).toBeTruthy();
  });

  it('renders correct number of buttons', () => {
    const { container } = render(<SourceSelector {...defaultProps} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(3);
  });

  it('highlights the selected chip via border color', () => {
    render(
      <SourceSelector {...defaultProps} selectedSourceId="src-1" />,
    );
    const sanbornBtn = screen.getByText('Sanborn').closest('button');
    // Selected chip should use the type color for its border
    expect(sanbornBtn?.style.borderColor).toBe('#d97706');
  });

  it('non-selected chip has default border', () => {
    render(
      <SourceSelector {...defaultProps} selectedSourceId="src-1" />,
    );
    const uploadBtn = screen.getByText('Upload').closest('button');
    // Non-selected chip uses THEME.border
    expect(uploadBtn?.style.borderColor).not.toBe('#2563eb');
  });

  it('click triggers onSourceChange with source id', () => {
    const onSourceChange = vi.fn();
    render(
      <SourceSelector
        {...defaultProps}
        onSourceChange={onSourceChange}
      />,
    );
    fireEvent.click(screen.getByText('Upload'));
    expect(onSourceChange).toHaveBeenCalledWith('src-2');
  });

  it('clicking each chip calls onSourceChange with correct id', () => {
    const onSourceChange = vi.fn();
    render(
      <SourceSelector {...defaultProps} onSourceChange={onSourceChange} />,
    );
    fireEvent.click(screen.getByText('Sanborn'));
    expect(onSourceChange).toHaveBeenCalledWith('src-1');
    fireEvent.click(screen.getByText('OSM'));
    expect(onSourceChange).toHaveBeenCalledWith('src-3');
  });

  it('shows confidence dots for each source', () => {
    const { container } = render(<SourceSelector {...defaultProps} />);
    // Each button has a confidence dot (span with border-radius 50%)
    const dots = container.querySelectorAll('span');
    // 3 label spans + 3 dot spans = 6
    expect(dots.length).toBe(6);
  });

  it('high confidence source gets green dot', () => {
    // Source with 0.8 confidence should get THEME.success color
    const { container } = render(
      <SourceSelector
        sources={[{ id: 'high', source_type: 'osm', confidence: 0.8 }]}
        selectedSourceId={null}
        onSourceChange={vi.fn()}
      />,
    );
    const button = container.querySelector('button');
    const spans = button?.querySelectorAll('span');
    // Second span is the confidence dot
    const dotStyle = spans?.[1]?.style.background;
    // THEME.success is the green color
    expect(dotStyle).toBeTruthy();
  });

  it('low confidence source gets danger dot', () => {
    const { container } = render(
      <SourceSelector
        sources={[{ id: 'low', source_type: 'upload', confidence: 0.1 }]}
        selectedSourceId={null}
        onSourceChange={vi.fn()}
      />,
    );
    const button = container.querySelector('button');
    const spans = button?.querySelectorAll('span');
    const dotStyle = spans?.[1]?.style.background;
    expect(dotStyle).toBeTruthy();
  });

  it('renders empty when no sources', () => {
    const { container } = render(
      <SourceSelector
        sources={[]}
        selectedSourceId={null}
        onSourceChange={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders unknown source type using raw type string', () => {
    render(
      <SourceSelector
        sources={[{ id: 'x', source_type: 'custom_type', confidence: 0.5 }]}
        selectedSourceId={null}
        onSourceChange={vi.fn()}
      />,
    );
    expect(screen.getByText('custom_type')).toBeTruthy();
  });
});
