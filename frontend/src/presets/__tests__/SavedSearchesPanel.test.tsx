// @vitest-environment happy-dom
/**
 * End-to-end through the React wiring: a filter section, an external adapter, the panel.
 * Save → change everything → apply → everything is back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchStateContext, useSearchAdapter, useSearchSection } from '../SearchStateContext';
import { SearchStateStore, setSection } from '../searchState';
import { SavedSearchesPanel } from '../SavedSearchesPanel';
import { useSavedSearches } from '../useSavedSearches';

const FRUIT = setSection('test.fruit', ['apple', 'pear'], 'all');

function Harness() {
  const [fruit, setFruit] = useSearchSection(FRUIT);
  const [zoom, setZoom] = useState(1);
  useSearchAdapter('test.zoom', zoom, (raw) => typeof raw === 'number' && setZoom(raw));
  const saved = useSavedSearches(null, 'chicago');
  return (
    <>
      <output data-testid="fruit">{[...fruit].join(',')}</output>
      <output data-testid="zoom">{zoom}</output>
      <button onClick={() => setFruit(new Set(['pear']))}>only pear</button>
      <button onClick={() => setZoom(5)}>zoom 5</button>
      <SavedSearchesPanel saved={saved} />
    </>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('SavedSearchesPanel', () => {
  it('saves the current filters and restores them on apply', () => {
    render(
      <SearchStateContext.Provider value={new SearchStateStore()}>
        <Harness />
      </SearchStateContext.Provider>,
    );

    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(window.localStorage.getItem('citymap.savedSearches.v1')).toContain('"Start"');

    fireEvent.click(screen.getByText('only pear'));
    fireEvent.click(screen.getByText('zoom 5'));
    expect(screen.getByTestId('fruit').textContent).toBe('pear');
    expect(screen.getByTestId('zoom').textContent).toBe('5');

    act(() => {
      fireEvent.click(screen.getByTitle('Apply this preset'));
    });
    expect(screen.getByTestId('fruit').textContent).toBe('apple,pear');
    expect(screen.getByTestId('zoom').textContent).toBe('1');
  });

  it('labels the button "Update" for an existing name and deletes with two clicks', () => {
    render(
      <SearchStateContext.Provider value={new SearchStateStore()}>
        <Harness />
      </SearchStateContext.Provider>,
    );
    const input = screen.getByLabelText('Preset name');
    fireEvent.change(input, { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    fireEvent.change(input, { target: { value: 'mine' } });
    expect(screen.getByRole('button', { name: 'Update preset' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete preset Mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByTitle('Apply this preset')).toBeNull();
  });
});
