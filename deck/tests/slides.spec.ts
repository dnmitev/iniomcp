import { test, expect } from '@playwright/test';

const slides = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];

test.describe('Slide Deck', () => {
  for (const slideId of slides) {
    test(`Slide ${slideId} renders without overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/#${slideId}`);

      await page.waitForTimeout(500);

      const slideElement = page.locator('div').first();
      const isVisible = await slideElement.isVisible();
      expect(isVisible).toBe(true);

      const textContent = await page.textContent('body');
      expect(textContent).toBeTruthy();
      expect(textContent!.length).toBeGreaterThan(10);

      const allElements = await page.locator('*').all();
      for (const element of allElements) {
        const box = await element.boundingBox();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(-1);
          expect(box.y).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width).toBeLessThanOrEqual(1921);
          expect(box.y + box.height).toBeLessThanOrEqual(1081);
        }
      }

      await page.screenshot({
        path: `artifacts/slide-${slideId}.png`,
        fullPage: false,
      });
    });
  }
});
