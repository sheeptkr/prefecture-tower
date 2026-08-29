import { expect, test } from '@playwright/test';

test('shows the solo and online battle mode choices', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('#solo-button')).toBeVisible();
  await expect(page.locator('#battle-button')).toBeVisible();
  await page.locator('#battle-button').click();
  await expect(page.locator('#create-room-button')).toBeVisible();
  await expect(page.locator('#room-input')).toBeVisible();
});

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
  await expect(page.locator('#info-dialog .eyebrow')).toHaveText('目指せ47都道府県！');
  await expect(page.locator('#info-dialog')).toContainText('国土数値情報');
  await page.locator('.dialog-close').click();
  await drop.click();
  await expect(page.locator('#phase-label')).not.toHaveText('配置中');
});

test('touch controls prevent iOS-style text selection and callouts', async ({ page }) => {
  await page.goto('?seed=47');
  const left = page.locator('[data-action="left"]');
  const selectionStyles = await left.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      userSelect: styles.userSelect,
      webkitUserSelect: styles.webkitUserSelect,
    };
  });
  expect(selectionStyles).toEqual({ userSelect: 'none', webkitUserSelect: 'none' });
  const selectionPrevented = await left.evaluate((element) => {
    const event = new Event('selectstart', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(selectionPrevented).toBe(true);
});

test('two isolated browsers join a room and hand the turn over after a drop', async ({ browser, request }) => {
  const response = await request.post('http://127.0.0.1:8787/rooms');
  expect(response.ok()).toBe(true);
  const { roomId } = await response.json() as { roomId: string };
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await first.goto(`?room=${roomId}`);
  await second.goto(`?room=${roomId}`);
  await expect(first.locator('#waiting-room')).toBeHidden();
  await expect(second.locator('#waiting-room')).toBeHidden();
  const firstHasTurn = await first.locator('#turn-label').getByText('あなたの手番').isVisible();
  const actor = firstHasTurn ? first : second;
  const receiver = firstHasTurn ? second : first;
  await actor.locator('[data-action="drop"]').click();
  await expect(actor.locator('#phase-label')).toHaveText('落下中');
  await expect(receiver.locator('#turn-label')).toHaveText('あなたの手番');
  await expect(receiver.locator('#score')).toHaveText('1');
  await firstContext.close();
  await secondContext.close();
});

test('two tabs in the same browser profile join as separate players', async ({ context, request }) => {
  const response = await request.post('http://127.0.0.1:8787/rooms');
  expect(response.ok()).toBe(true);
  const { roomId } = await response.json() as { roomId: string };
  const first = await context.newPage();
  await first.goto(`?room=${roomId}`);
  await expect(first.locator('#waiting-room')).toBeVisible();

  const second = await context.newPage();
  await second.goto(`?room=${roomId}`);

  await expect(first.locator('#waiting-room')).toBeHidden();
  await expect(second.locator('#waiting-room')).toBeHidden();
  await expect(first.locator('#battle-strip')).toBeVisible();
  await expect(second.locator('#battle-strip')).toBeVisible();
});
