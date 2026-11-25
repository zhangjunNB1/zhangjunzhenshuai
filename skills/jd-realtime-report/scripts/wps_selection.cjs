// WPS applies Enter navigation asynchronously. Do not let the next fill or
// shortcut race that navigation and send range text into the cell editor.
const activeSheetSelector = '.item-content.selected > .sheet-name';

async function assertWpsSheet(page, sheet) {
  const names = await page.locator(activeSheetSelector).evaluateAll(tabs => tabs.map(tab => tab.dataset.name));
  if (names.length !== 1 || names[0] !== sheet) {
    throw new Error(`Wrong active sheet: expected ${sheet}, found ${names.join(', ') || '(none)'}`);
  }
}

async function activateWpsSheet(page, sheet) {
  const name = `[data-name=${JSON.stringify(sheet)}]`;
  await page.locator('.sheet-name' + name).click({ timeout: 10000 });
  await page.locator(activeSheetSelector + name)
    .waitFor({ state: 'visible', timeout: 10000 });
  await assertWpsSheet(page, sheet);
}

async function selectWpsRange(page, range, sheet) {
  if (!/^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(range)) throw new Error('Invalid WPS range');
  await page.bringToFront();
  if (sheet) await assertWpsSheet(page, sheet);
  const box = page.locator('input.edit-box');
  await box.click();
  await box.fill(range);
  await box.press('Enter');
  await page.waitForFunction(anchor => {
    const input = document.querySelector('input.edit-box');
    return document.activeElement?.classList.contains('edit-proxy-runs') &&
      input?.value === anchor;
  }, range.split(':')[0], {timeout:10000, polling:100});
  if (sheet) await assertWpsSheet(page, sheet);
}

// Recheck the live tab and address in the key event as well as before sending it.
async function pressWpsCellKey(page, { sheet, range, key }) {
  const anchor = range.split(':')[0];
  await page.evaluate(({ selector, sheet, anchor, key }) => {
    const atTarget = () => {
      const tabs = document.querySelectorAll(selector);
      return tabs.length === 1 && tabs[0].dataset.name === sheet &&
        document.querySelector('input.edit-box')?.value === anchor &&
        document.activeElement?.classList.contains('edit-proxy-runs');
    };
    if (!atTarget()) throw new Error('WPS target changed before ' + key);
    const guard = { blocked: false };
    guard.listener = event => {
      const matches = key === 'Delete' ? event.key === 'Delete' : event.ctrlKey && event.code === 'KeyV';
      if (matches && !atTarget()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        guard.blocked = true;
      }
    };
    window.__jdWpsCellGuard = guard;
    window.addEventListener('keydown', guard.listener, true);
  }, { selector: activeSheetSelector, sheet, anchor, key });
  let blocked;
  try {
    await page.keyboard.press(key);
  } finally {
    blocked = await page.evaluate(() => {
      const guard = window.__jdWpsCellGuard;
      if (!guard) throw new Error('WPS page changed during write');
      window.removeEventListener('keydown', guard.listener, true);
      delete window.__jdWpsCellGuard;
      return guard.blocked;
    });
  }
  if (blocked) throw new Error(`WPS target changed during ${key}`);
  await assertWpsSheet(page, sheet);
}

module.exports = { activateWpsSheet, assertWpsSheet, pressWpsCellKey, selectWpsRange };
