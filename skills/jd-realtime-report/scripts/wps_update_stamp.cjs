const { assertWorkbook } = require('./runtime.cjs');
const { activateWpsSheet, pressWpsCellKey, selectWpsRange } = require('./wps_selection.cjs');
const INPUT_SHEETS = ['商智实时', '实时推广费'];

class UpdateCompletion {
  constructor(sheets = INPUT_SHEETS) {
    if (!Array.isArray(sheets) || !sheets.length || new Set(sheets).size !== sheets.length ||
        sheets.some(sheet => !INPUT_SHEETS.includes(sheet))) throw new Error('Invalid update scope');
    this.sheets = [...sheets];
    this.completed = new Set();
    this.metadataReady = false;
  }

  invalidate(sheet, anchor) {
    if ((sheet === '商智实时' && anchor === 'A1') || (sheet === '实时推广费' && anchor === 'A3')) {
      this.completed.delete(sheet);
      if (sheet === '实时推广费') this.metadataReady = false;
    }
    if (sheet === '实时推广费' && anchor === 'B1') this.metadataReady = false;
  }

  record(sheet, anchor) {
    if ((sheet === '商智实时' && anchor === 'A1') || (sheet === '实时推广费' && anchor === 'A3')) this.completed.add(sheet);
    if (sheet === '实时推广费' && anchor === 'B1') this.metadataReady = true;
  }

  completedScope() {
    const missing = this.sheets.filter(sheet => !this.completed.has(sheet));
    if (missing.length) throw new Error('Update incomplete; timestamp unchanged. Missing: ' + missing.join(', '));
    if (this.sheets.includes('实时推广费') && !this.metadataReady) throw new Error('Promotion query metadata incomplete; timestamp unchanged');
    return [...this.sheets];
  }
}

function formatUpdateStamp(completedAt = new Date(), sheets = INPUT_SHEETS) {
  const date = new Date(completedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid completion time');
  new UpdateCompletion(sheets); // Validate scope before generating a label.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  const time = `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  if (sheets.length === 2) return `${time}更新`;
  return `${sheets[0] === '商智实时' ? '商智' : '推广'}${time}`;
}

async function writeUpdateStamp(page, sheets) {
  const url = new URL(page.url());
  assertWorkbook(page);
  const text = formatUpdateStamp(new Date(), sheets);
  const sheet = 'SPU投产小时投产';
  await activateWpsSheet(page, sheet);
  const context = page.context();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin });
  const receipt = page.getByText('粘贴成功', { exact: true });
  await receipt.waitFor({ state: 'hidden', timeout: 10000 });
  await selectWpsRange(page, 'A1', sheet);
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await pressWpsCellKey(page, { sheet, range: 'A1', key: 'Control+V' });
  await receipt.waitFor({ state: 'visible', timeout: 30000 });
  return { sheet, cell: 'A1', text, timestamp: new Date().toISOString() };
}

module.exports = { UpdateCompletion, formatUpdateStamp, writeUpdateStamp };
