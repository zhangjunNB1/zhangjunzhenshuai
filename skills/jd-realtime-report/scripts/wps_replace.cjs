const { assertWorkbook } = require('./runtime.cjs');
const { activateWpsSheet, assertWpsSheet, selectWpsRange } = require('./wps_selection.cjs');
const NO_MATCH = '未找到与查询内容匹配的数据，无法替换';

function assertSkuRange(page, sheet, range) {
  assertWorkbook(page);
  const allowed = sheet === '实时推广费' ? /^A\d+(?::A\d+)?$/
    : sheet === '商智实时' ? /^B\d+(?::B\d+)?$/ : null;
  if (!allowed || !allowed.test(range)) throw new Error('Only authorized input SKU cells are allowed');
}

// Format the destination before pasting. Otherwise short SKU IDs become numbers
// while long IDs remain text, and exact-match lookups silently return zero.
async function setWpsSkuRangeText(page, { sheet, range }) {
  assertSkuRange(page, sheet, range);
  await activateWpsSheet(page, sheet);
  await selectWpsRange(page, range, sheet);
  const format = page.locator('.num-format-label:visible');
  if (await format.count() !== 1) throw new Error('Expected one WPS number-format selector');
  await format.click();
  const textOption = page.locator('span:text-is("文本"):visible:not(.num-format-label):not(.kd-button-children)');
  await textOption.waitFor({ state: 'visible' });
  if (await textOption.count() !== 1) throw new Error('Expected one text-format menu option');
  await assertWpsSheet(page, sheet);
  await textOption.click();
  return { sheet, range, format: 'text' };
}

// Use the actual WPS confirmation button and wait for its dialog to render.
async function confirmWpsReplace(page, { find, replacement, sheet, timeout = 12000 }) {
  const started = Date.now();
  const prompt = page.locator('.kd-confirm-text');
  const noMatch = page.getByText(NO_MATCH, { exact: true });
  const outcome = await Promise.any([
    prompt.waitFor({ state: 'visible', timeout }).then(() => 'confirm'),
    noMatch.waitFor({ state: 'visible', timeout }).then(() => 'no_match'),
  ]).catch(() => { throw new Error('WPS did not show a replace confirmation or a no-match result'); });
  if (outcome === 'no_match') return { status: 'no_match', elapsedMs: Date.now() - started };

  const message = await prompt.innerText();
  if (!message.startsWith('确定将') || !message.includes(`“${find}”替换为“${replacement}”`)) {
    throw new Error('Unexpected replacement confirmation; no click performed');
  }
  const button = page.locator('button.confirm-btn').filter({ hasText: /^\s*确定\s*$/ });
  await button.waitFor({ state: 'visible', timeout });
  if (await button.count() !== 1) throw new Error('WPS confirm button is not unique');
  if (sheet) await assertWpsSheet(page, sheet);
  await button.click({ timeout });
  await prompt.waitFor({ state: 'hidden', timeout });
  const result = page.locator('.kd-message-text').filter({ hasText: /^替换完成，已成功替换\s*\d+\s*处$/ });
  await result.waitFor({ state: 'visible', timeout });
  const text = await result.innerText();
  return { status: 'replaced', replaced: Number(text.match(/\d+/)[0]), elapsedMs: Date.now() - started };
}

async function replaceWpsRange(page, { sheet = '实时推广费', range, find, replacement }) {
  assertSkuRange(page, sheet, range);
  const start = Date.now();
  await activateWpsSheet(page, sheet);
  await selectWpsRange(page, range, sheet);
  await page.keyboard.press('Control+H');
  const search = page.locator('input.kd-input-inner[maxlength="1024"]');
  const replace = page.locator('input.kd-input-inner[maxlength="1000"]');
  await search.waitFor({ state: 'visible' });
  await search.fill(find);
  await replace.fill(replacement);
  await assertWpsSheet(page, sheet);
  await page.getByText('全部替换', { exact: true }).click();
  const result = await confirmWpsReplace(page, { find, replacement, sheet });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return { ...result, range, totalMs: Date.now() - start };
}

module.exports = { confirmWpsReplace, replaceWpsRange, setWpsSkuRangeText };
