import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the API module
vi.mock('../../api/interior', () => ({
  getSources: vi.fn().mockResolvedValue([]),
  getRooms: vi.fn().mockResolvedValue([]),
  getWalls: vi.fn().mockResolvedValue([]),
  getFeatures: vi.fn().mockResolvedValue([]),
  getSummary: vi.fn().mockResolvedValue({
    building_id: 'test-id',
    source_count: 2,
    room_count: 5,
    wall_count: 10,
    feature_count: 3,
    has_extracted_data: true,
  }),
}));

// Mock maplibregl (no real map in tests)
vi.mock('maplibre-gl', () => ({
  default: { Map: vi.fn() },
}));

import { InteriorViewer } from '../InteriorViewer';

describe('InteriorViewer', () => {
  const defaultProps = {
    buildingId: 'test-building-id',
    mapInstance: null, // No real map in unit tests
    onClose: vi.fn(),
  };

  it('renders without crashing', () => {
    render(<InteriorViewer {...defaultProps} />);
    expect(screen.getByText('Interior View')).toBeTruthy();
  });

  it('shows loading state initially', () => {
    render(<InteriorViewer {...defaultProps} />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('shows back button that calls onClose', () => {
    const onClose = vi.fn();
    render(<InteriorViewer {...defaultProps} onClose={onClose} />);
    const backBtn = screen.getByText(/back to map/i);
    backBtn.click();
    expect(onClose).toHaveBeenCalled();
  });

  it('displays summary stats after loading', async () => {
    render(<InteriorViewer {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/5 rooms/i)).toBeTruthy();
    });
  });
});
