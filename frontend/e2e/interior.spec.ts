import { test, expect } from '@playwright/test';

test.describe('Interior Maps E2E', () => {
  test.skip('loads interior viewer when building with interior is clicked', async ({ page }) => {
    // This test requires full backend + frontend running
    // Placeholder for CI integration
    await page.goto('http://localhost:5173');
    // Click a building with has_interior=true
    // Expect Interior View panel to appear
    // Expect floor selector to show
    // Expect room polygons to render
  });

  test.skip('editor creates room polygon', async ({ page }) => {
    // Open interior viewer
    // Click "Edit" to open editor
    // Select "Room" tool
    // Click 4 points on map
    // Double-click to close polygon
    // Expect room to appear in the list
  });

  test.skip('floor selector changes visible rooms', async ({ page }) => {
    // Open interior viewer
    // Note rooms on ground floor
    // Click "1F" in floor selector
    // Expect different rooms to display
  });
});
