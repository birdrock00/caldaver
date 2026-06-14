const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const baseURL = 'https://caldaver.example.invalid';
const username = 'REDACTED';
const password = 'REDACTED';
const screenshotDir = '/tmp/caldaver-week-view';

test.describe('week view vertical day separators', () => {
  test('time grid slats are transparent and vertical day separators render', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    fs.mkdirSync(screenshotDir, { recursive: true });

    // 1-2. Log in via POST to /login. page.request shares the cookie jar with
    // the browser context, so the session cookie carries into page.goto below.
    const loginResponse = await page.request.post(`${baseURL}/login`, {
      form: { user: username, password },
      maxRedirects: 0
    });
    expect(loginResponse.status()).toBeLessThan(400);

    // 3. Wait for the calendar to load.
    await page.goto(baseURL);
    await page.waitForSelector('#calendar_view .fc-view-container', { timeout: 30000 });

    // 4. Switch to week view.
    await page.locator('.fc-agendaWeek-button').click();

    // 5. Wait for the view to render.
    await page.waitForTimeout(1000);

    // 6. Screenshot the time grid area.
    await page.locator('.fc-time-grid').first().screenshot({
      path: path.join(screenshotDir, 'week-time-grid.png')
    });

    // 7. Computed-style checks in the browser.
    const styleReport = await page.evaluate(() => {
      const slats = Array.from(document.querySelectorAll('.fc-time-grid .fc-slats td'));
      const slatsTransparent = slats.every(cell => {
        const bg = window.getComputedStyle(cell).backgroundColor;
        return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
      });

      const bgCells = Array.from(document.querySelectorAll('.fc-time-grid .fc-bg td.fc-day'));
      const bgBorders = bgCells.map(cell => {
        const style = window.getComputedStyle(cell);
        return {
          width: parseFloat(style.borderLeftWidth),
          color: style.borderLeftColor,
          style: style.borderLeftStyle
        };
      });
      const bgBordersDrawn = bgBorders.length > 0 &&
        bgBorders.every(border => border.width > 0 && border.style !== 'none');

      return {
        slatsCount: slats.length,
        slatsTransparent,
        bgCellsCount: bgCells.length,
        bgBorders,
        bgBordersDrawn
      };
    });

    expect(styleReport.slatsCount, 'expected slats cells to exist').toBeGreaterThan(0);
    expect(styleReport.slatsTransparent, 'every slats cell must have a transparent background').toBe(true);
    expect(styleReport.bgCellsCount, 'expected bg day cells to exist').toBeGreaterThan(0);
    expect(styleReport.bgBordersDrawn, 'every bg day cell must draw a left border').toBe(true);

    // 8-9. Pixel-level check: crop the time-grid screenshot and scan for
    // vertical lines at each day column boundary. The separators are
    // #dadce0 (rgb 218,220,224) over a white background, so we count columns
    // of distinctly non-white pixels spanning most of the grid height.
    const gridBuffer = await page.locator('.fc-time-grid').first().screenshot();
    const verticalLineCount = await page.evaluate(async pngBase64 => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + pngBase64;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);

      const isSeparatorPixel = (offset) => {
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        // #dadce0 ~ rgb(218,220,224); treat light-but-not-white as a separator.
        return (255 - r) + (255 - g) + (255 - b) >= 18 && r < 250;
      };

      const minRunLength = Math.floor(height * 0.6);
      const lineColumns = [];
      let lastLineX = -10;

      for (let x = 0; x < width; x++) {
        let run = 0;
        for (let y = 0; y < height; y++) {
          if (isSeparatorPixel((y * width + x) * 4)) {
            run++;
          }
        }
        // A vertical separator column has a long run of separator pixels and
        // is separated from the previously detected line by several pixels.
        if (run >= minRunLength && x - lastLineX > 4) {
          lineColumns.push(x);
          lastLineX = x;
        }
      }

      return lineColumns.length;
    }, gridBuffer.toString('base64'));

    // A 7-day week has 6 internal boundaries plus edges; require at least 5.
    expect(verticalLineCount, 'expected at least 5 internal vertical separators').toBeGreaterThanOrEqual(5);

    // Save a full-page screenshot too for manual inspection.
    await page.screenshot({ path: path.join(screenshotDir, 'week-full.png'), fullPage: false });
  });
});
