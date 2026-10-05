const { test, expect } = require('@playwright/test');

// The path a first-time visitor takes: one click into the demo, open the group, see the best
// times. It runs the real client build against the real API and database, so it catches what unit
// and API tests can't: routing, the /api proxy, auth in the browser and time zone display.
test('a visitor opens the demo as the organizer and sees the best times', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try as organizer' }).click();

  // The dashboard, in Priya's zone (India): Tuesday 13:30 UTC is 19:00 there.
  await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  const groups = page.getByRole('list', { name: 'Groups' });
  await expect(groups.getByRole('listitem').first()).toContainText('Meets Tuesday 19:00 – 20:00');
  await expect(groups.getByRole('listitem').first()).toContainText('Most free: Thu 19:30 – 22:00 (4 of 5)');

  await groups.getByRole('link', { name: 'Algorithms study group' }).click();
  await expect(page.getByRole('heading', { name: 'Algorithms study group' })).toBeVisible();
  await expect(page.getByText('5 of 6 replied.')).toBeVisible();

  await page.getByRole('link', { name: 'Suggestions' }).click();
  const picks = page.getByRole('listitem').filter({ hasText: 'can come' });
  await expect(picks).toHaveCount(3);
  // The top pick is the confirmed weekly session, and Cal hasn't replied yet.
  await expect(picks.first()).toContainText('Tuesday 19:00 – 20:00');
  await expect(picks.first()).toContainText('Weekly session');
  await expect(page.getByText('Still waiting on Cal.')).toBeVisible();
});
