import { expect, test } from '@playwright/test';

test('loads from the configured base path and accepts controls', async ({ page }) => {
  await page.goto('?seed=20260401');
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#seed')).toHaveText('20260401');
  await expect(page.locator('#score')).toHaveText('0');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('Space');
  await expect(page.locator('#phase-label')).not.toHaveText('配置中');
  await expect(page.locator('#game-canvas')).toBeVisible();
});

test('touch controls and information dialog are usable', async ({ page }) => {
  await page.goto('?seed=47');
  const drop = page.locator('[data-action="drop"]');
  await expect(drop).toBeVisible();
  await page.locator('#info-button').click();
  await expect(page.locator('#info-dialog')).toBeVisible();
  await expect(page.locator('#info-dialog')).toContainText('国土数値情報');
  await page.locator('.dialog-close').click();
  await drop.click();
  await expect(page.locator('#phase-label')).not.toHaveText('配置中');
});
