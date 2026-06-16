# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mail-unread-probe.spec.js >> mail reader unread button hidden initially, shown after JS
- Location: tests/mail-unread-probe.spec.js:5:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "Mark unread"
Received string:    "{% trans %}labels.mark_unread{% endtrans %}"
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - complementary [ref=e3]: "{% include 'parts/sidebrand.html' %} {% include 'parts/appnav.html' %}"
  - main [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]:
        - link "" [ref=e7] [cursor=pointer]:
          - /url: /mail
          - generic [ref=e8]: 
        - button "" [ref=e9] [cursor=pointer]:
          - generic [ref=e10]: 
        - 'button "{% trans %}labels.archive{% endtrans %}" [ref=e11] [cursor=pointer]':
          - generic [ref=e12]: 
        - 'button "{% trans %}labels.delete{% endtrans %}" [ref=e13] [cursor=pointer]':
          - generic [ref=e14]: 
        - 'button "{% trans %}labels.mark_unread{% endtrans %}" [ref=e15] [cursor=pointer]':
          - generic [ref=e16]: 
          - generic [ref=e17]: "{% trans %}labels.mark_unread{% endtrans %}"
        - 'generic "{% trans %}labels.mail{% endtrans %}" [ref=e18]':
          - 'button "{% trans %}labels.previous_message{% endtrans %}" [disabled] [ref=e19]':
            - generic [ref=e20]: 
          - 'button "{% trans %}labels.next_message{% endtrans %}" [disabled] [ref=e21]':
            - generic [ref=e22]: 
      - text:    
      - generic [ref=e23]: "{% trans %}labels.mail_loading{% endtrans %}"
```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | const path = require('path');
  3  | const fs = require('fs');
  4  | 
  5  | test('mail reader unread button hidden initially, shown after JS', async ({ page }) => {
  6  |   const repoRoot = path.resolve(__dirname, '..');
  7  |   const twigHtml = fs.readFileSync(path.join(repoRoot, 'web/templates/mail_message.html'), 'utf8');
  8  |   const bodyMatch = twigHtml.match(/<div class="container-fluid mail-shell mail-read-shell">[\s\S]*?<\/section>\s*<\/main>\s*<\/div>/);
  9  |   const body = bodyMatch ? bodyMatch[0] : twigHtml;
  10 |   const fixtureHtml = '<!DOCTYPE html><html><head><link rel="stylesheet" href="file://' + path.join(repoRoot, 'web/public/dist/css/caldaver.css') + '"></head><body>' + body.replace(/{{\s*app\.url_generator\.generate\('([^']+)'\)\s*}}/g, '/$1').replace(/{{\s*csrf_token\.getValue\(\)\s*}}/g, 'mock').replace(/{{\s*account_id\s*}}/g, '1').replace(/{{\s*uid\s*}}/g, '42') + '</body></html>';
  11 |   const fixturePath = '/tmp/opencode/mail-reader-fixture.html';
  12 |   fs.writeFileSync(fixturePath, fixtureHtml);
  13 |   await page.goto('file://' + fixturePath);
  14 |   await page.setViewportSize({ width: 1280, height: 800 });
  15 |   await page.waitForTimeout(500);
  16 |   const unreadBtn = page.locator('#mail_reader_unread');
  17 |   const initialDisplay = await unreadBtn.evaluate(el => getComputedStyle(el).display);
  18 |   const initialHidden = await unreadBtn.evaluate(el => el.hidden);
  19 |   const initialText = await unreadBtn.textContent();
  20 |   console.log('INITIAL: hidden=' + initialHidden + ' display=' + initialDisplay + ' text=' + JSON.stringify(initialText.trim()));
  21 |   expect(initialDisplay).toBe('none');
  22 |   await unreadBtn.evaluate(el => { el.hidden = false; });
  23 |   await page.waitForTimeout(200);
  24 |   const afterDisplay = await unreadBtn.evaluate(el => getComputedStyle(el).display);
  25 |   const afterText = await unreadBtn.textContent();
  26 |   console.log('AFTER JS: display=' + afterDisplay + ' text=' + JSON.stringify(afterText.trim()));
> 27 |   expect(afterText.trim()).toContain('Mark unread');
     |                            ^ Error: expect(received).toContain(expected) // indexOf
  28 |   // Accept inline-flex or flex (the new .mail-reader-action-with-label uses display:inline-flex via the toolbar button rule)
  29 |   expect(['inline-flex', 'flex']).toContain(afterDisplay);
  30 | });
  31 | 
```