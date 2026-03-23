import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomInfoPopup } from '../RoomInfoPopup';

describe('RoomInfoPopup', () => {
  const defaultRoom = {
    name: 'Main Office',
    room_type: 'office',
    area_sqm: 42.5,
    capacity: 15,
    level: 1,
  };

  const defaultProps = {
    room: defaultRoom,
    position: { x: 200, y: 300 },
    onClose: vi.fn(),
  };

  it('renders room name as title', () => {
    render(<RoomInfoPopup {...defaultProps} />);
    expect(screen.getByText('Main Office')).toBeTruthy();
  });

  it('renders room type', () => {
    render(<RoomInfoPopup {...defaultProps} />);
    expect(screen.getByText('office')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
  });

  it('shows area formatted with one decimal and m2', () => {
    render(<RoomInfoPopup {...defaultProps} />);
    // area_sqm.toFixed(1) = "42.5", followed by m\u00b2
    expect(screen.getByText('Area')).toBeTruthy();
    const areaValue = screen.getByText(/42\.5/);
    expect(areaValue).toBeTruthy();
  });

  it('shows capacity', () => {
    render(<RoomInfoPopup {...defaultProps} />);
    expect(screen.getByText('Capacity')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('shows level formatted as floor number', () => {
    render(<RoomInfoPopup {...defaultProps} />);
    expect(screen.getByText('Level')).toBeTruthy();
    expect(screen.getByText('1F')).toBeTruthy();
  });

  it('shows ground floor as G', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, level: 0 }}
      />,
    );
    expect(screen.getByText('G')).toBeTruthy();
  });

  it('shows basement as B1, B2', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, level: -2 }}
      />,
    );
    expect(screen.getByText('B2')).toBeTruthy();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<RoomInfoPopup {...defaultProps} onClose={onClose} />);
    // The close button contains the times symbol
    const closeBtn = screen.getByText('\u00d7');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('positions at given coordinates', () => {
    const { container } = render(
      <RoomInfoPopup {...defaultProps} position={{ x: 150, y: 250 }} />,
    );
    const popup = container.firstChild as HTMLElement;
    expect(popup.style.left).toBe('150px');
    expect(popup.style.top).toBe('250px');
  });

  it('uses room_type as title when name is null', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, name: null }}
      />,
    );
    // Falls back to room_type
    expect(screen.getByText('office')).toBeTruthy();
  });

  it('uses "Room" as title when both name and room_type are null', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, name: null, room_type: null }}
      />,
    );
    expect(screen.getByText('Room')).toBeTruthy();
  });

  it('hides area row when area_sqm is null', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, area_sqm: null }}
      />,
    );
    expect(screen.queryByText('Area')).toBeNull();
  });

  it('hides capacity row when capacity is null', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, capacity: null }}
      />,
    );
    expect(screen.queryByText('Capacity')).toBeNull();
  });

  it('hides room type row when room_type is null', () => {
    render(
      <RoomInfoPopup
        {...defaultProps}
        room={{ ...defaultRoom, name: 'Test', room_type: null }}
      />,
    );
    expect(screen.queryByText('Type')).toBeNull();
  });
});
