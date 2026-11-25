const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { chromium } = require('playwright');
const { activateWpsSheet, assertWpsSheet, pressWpsCellKey, selectWpsRange } = require('./wps_selection.cjs');
const { replaceWpsRange, setWpsSkuRangeText } = require('./wps_replace.cjs');
const { UpdateCompletion, writeUpdateStamp } = require('./wps_update_stamp.cjs');
const { required, workbookUrl, workbenchRoot: getWorkbenchRoot, assertWorkbook } = require('./runtime.cjs');
const realtimeWorkbookUrl = workbookUrl();

async function writeVerifiedClipboard(page, value) {
  const normalize = text => text.replace(/\r\n/g, '\n');
  const expected = normalize(value);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(text => navigator.clipboard.writeText(text), value);
    const clipboardValue = await page.evaluate(() => navigator.clipboard.readText());
    if (normalize(clipboardValue) === expected) return;
    if (attempt === 0) {
      console.log(JSON.stringify({event:'clipboardRetry',timestamp:new Date().toISOString()}));
    }
  }
  throw new Error('Clipboard preflight failed; no cells cleared');
}

(async () => {
  const profilePath = process.env.JD_AUTOMATION_PROFILE;
  if (!profilePath) throw new Error('JD_AUTOMATION_PROFILE is required');

  const workbenchRoot = getWorkbenchRoot();
  const downloadDir = path.resolve(process.env.JD_RUN_DIR || path.join(workbenchRoot, '临时', '实时投产表运行', new Date().toISOString().replace(/[:.]/g,'-')));
  const outputRelative = path.relative(workbenchRoot, downloadDir);
  if (!outputRelative || outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) throw new Error('Run output must stay inside AI工作台');
  fs.mkdirSync(downloadDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    acceptDownloads: true,
    downloadsPath: downloadDir,
    args: [
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  const pages = context.pages();
  let page = pages[0] || await context.newPage();
  let openingWorkbook = false;
  let workbookPage;
  let workbookNavigation;
  context.on('page', (newPage) => {
    if (!openingWorkbook) page = newPage;
  });
  await page.goto(process.env.JD_START_URL || 'https://jdsz.jd.com/szweb/view/product/productDetail.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  }).catch(() => {});

  console.log(JSON.stringify({
    status: 'ready',
    url: page.url(),
    title: await page.title().catch(() => ''),
    downloadDir,
  }));

  async function snapshot() {
    await page.waitForTimeout(800);
    const screenshotPath = path.join(downloadDir, 'current-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    const frames = [];
    for (const frame of page.frames()) {
      frames.push({
        url: frame.url(),
        text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 3000),
        buttons: (await frame.getByRole('button').evaluateAll(es => es.map(e => e.getAttribute('aria-label') || e.getAttribute('title') || [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()).filter(Boolean)).catch(() => [])).slice(0, 80),
        links: (await frame.getByRole('link').allTextContents().catch(() => [])).slice(0, 80),
        controls: (await frame.locator('input,textarea,[contenteditable="true"]').evaluateAll((elements) =>
          elements.slice(0, 120).map((element) => ({
            tag: element.tagName,
            type: element.getAttribute('type'),
            name: element.getAttribute('name'),
            placeholder: element.getAttribute('placeholder'),
            ariaLabel: element.getAttribute('aria-label'),
            title: element.getAttribute('title'),
            value: 'value' in element ? String(element.value).slice(0, 120) : '',
            className: String(element.className || '').slice(0, 160),
          }))).catch(() => [])).slice(0, 120),
      });
    }
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      frames,
      screenshotPath,
    };
  }

  async function findUnique(kind, value) {
    const matches = [];
    for (const frame of page.frames()) {
      const locator = kind === 'role'
        ? frame.getByRole(value.role, { name: value.name, exact: value.exact !== false })
        : frame.getByText(value.text, { exact: value.exact !== false });
      const count = await locator.count();
      if (count === 1) matches.push({ frame, locator });
      if (count > 1) throw new Error(`Ambiguous ${kind} locator in frame ${frame.url()}: ${count} matches`);
    }
    if (matches.length !== 1) throw new Error(`Expected one ${kind} locator, found ${matches.length}`);
    return matches[0];
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let updateRun = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let command;
    try {
      command = JSON.parse(line);
      if (command.cmd === 'beginUpdate') {
        updateRun = new UpdateCompletion(command.sheets);
        console.log(JSON.stringify({event:'updateStarted',sheets:updateRun.sheets,timestamp:new Date().toISOString()}));
      } else if (command.cmd === 'completeUpdate') {
        if (!updateRun) throw new Error('Call beginUpdate before recording a completion timestamp');
        const sheets = updateRun.completedScope();
        const result = await writeUpdateStamp(page,sheets);
        console.log(JSON.stringify({event:'updateStampComplete',...result}));
        updateRun = null;
      } else if (command.cmd === 'navigate') {
        await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } else if (command.cmd === 'newPage') {
        page = await context.newPage();
        await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } else if (command.cmd === 'inspect') {
        // Snapshot below is sufficient.
      } else if (command.cmd === 'checkRealtimeSource') {
        const checks = (date) => {
          const summary = document.body?.innerText ?? '';
          const cutoff = summary.match(/当前[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1];
          return {
            cutoff,
            dateMatches: !!cutoff?.startsWith(date.date + ' '),
            shopMatches: summary.replace(/\s/g, '').includes(date.shopName.replace(/\s/g, '')),
            realtimeVisible: /实时\s+昨天/.test(summary),
            allChannels: /品类\s+全部\s+渠道\s+全部/.test(summary),
            noSkuFilter: /0\s*\/\s*100\s+关键词/.test(summary),
          };
        };
        const deadline = Date.now() + 10000;
        let state;
        while (Date.now() < deadline) {
          if (new URL(page.url()).hostname === 'passport.jd.com') throw new Error('京东商智需要重新登录');
          state = await page.evaluate(checks, {date:command.date,shopName:required('JD_SHOP_NAME')});
          if (state.dateMatches && state.shopMatches && state.realtimeVisible &&
              state.allChannels && state.noSkuFilter) break;
          await page.getByText('下载数据', {exact:true}).waitFor({state:'visible',timeout:2000}).catch(() => {});
          await page.waitForTimeout(150);
        }
        if (new URL(page.url()).hostname !== 'jdsz.jd.com' || !state?.dateMatches || !state.shopMatches ||
            !state.realtimeVisible || !state.allChannels || !state.noSkuFilter) {
          throw new Error('商智店铺、日期或导出范围校验失败 ' + JSON.stringify(state));
        }
        const announcement = page.locator('.jd-modal-wrap .close-modal').filter({visible:true});
        if (await announcement.count() === 1) await announcement.click();
        console.log(JSON.stringify({event:'sourceReady',cutoff:state.cutoff,timestamp:new Date().toISOString()}));
      } else if (command.cmd === 'prepareRealtimeWorkbook') {
        openingWorkbook = true;
        try {
          workbookPage = await context.newPage();
        } finally {
          openingWorkbook = false;
        }
        workbookNavigation = workbookPage.goto(realtimeWorkbookUrl, {
          waitUntil: 'domcontentloaded', timeout: 60000,
        }).then(() => null, error => error);
      } else if (command.cmd === 'useRealtimeWorkbook') {
        if (!workbookNavigation) throw new Error('Call prepareRealtimeWorkbook first');
        const navigationError = await workbookNavigation;
        if (navigationError) throw navigationError;
        const target = new URL(workbookPage.url());
        if (target.origin + target.pathname !== realtimeWorkbookUrl) throw new Error('Wrong workbook or WPS sign-in required');
        for (const sheet of ['商智实时', '实时推广费', 'SPU投产小时投产']) {
          await workbookPage.locator('.sheet-name[data-name=' + JSON.stringify(sheet) + ']')
            .waitFor({state:'attached',timeout:15000});
        }
        page = workbookPage;
      } else if (command.cmd === 'resumePromotion') {
        if (!updateRun || !updateRun.sheets.includes('实时推广费') ||
            new URL(page.url()).origin + new URL(page.url()).pathname !== realtimeWorkbookUrl) {
          throw new Error('Wrong workbook or update scope for recovery');
        }
        const sheet = '实时推广费';
        const expected = fs.readFileSync(path.join(downloadDir, 'promo_metadata.tsv'), 'utf8').trim();
        if (!expected) throw new Error('Missing promotion metadata for recovery');
        await activateWpsSheet(page, sheet);
        await selectWpsRange(page, 'B1', sheet);
        await context.grantPermissions(['clipboard-read','clipboard-write'], { origin: new URL(page.url()).origin });
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.keyboard.press('Control+C');
        await page.waitForFunction(async () => !!(await navigator.clipboard.readText()), null, { timeout: 10000 });
        const current = await page.evaluate(() => navigator.clipboard.readText());
        await assertWpsSheet(page, sheet);
        if (current.trim() !== expected) throw new Error('Promotion query metadata no longer matches this run');
        updateRun.record(sheet, 'A3');
        updateRun.record(sheet, 'B1');
        console.log(JSON.stringify({event:'promotionResumeVerified',sheet,timestamp:new Date().toISOString()}));
      } else if (command.cmd === 'traceStart') {
        await context.tracing.start({screenshots:true,snapshots:true,sources:false});
      } else if (command.cmd === 'traceStop') {
        const tracePath=path.resolve(command.path);
        await context.tracing.stop({path:tracePath});
        console.log(JSON.stringify({event:'traceSaved',path:tracePath}));
      } else if (command.cmd === 'replaceWpsRange') {
        const result=await replaceWpsRange(page,command);
        console.log(JSON.stringify({event:'replaceComplete',...result,timestamp:new Date().toISOString()}));
      } else if (command.cmd === 'domInfo') {
        console.log(JSON.stringify({event:'domInfo', geometry: await page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})), elements: await page.locator(command.selector).evaluateAll(es => es.slice(0,30).map(e => ({tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),title:e.getAttribute('title'),className:String(e.className),text:e.innerText,html:e.outerHTML.slice(0,5000),rect:e.getBoundingClientRect().toJSON()})))}));
      } else if (command.cmd === 'overwriteFile') {
        if (updateRun) updateRun.invalidate(command.sheet,command.anchor || 'A1');
        const targetUrl = new URL(page.url());
        assertWorkbook(page);
        if (!['商智实时','实时推广费'].includes(command.sheet)) throw new Error('Unsupported input sheet');
        const anchor = command.anchor || 'A1';
        const sourcePath = path.resolve(command.path);
        const value = fs.readFileSync(sourcePath,'utf8');
        if (!value.trim()) throw new Error('Empty import; no cells cleared');
        const sourceRows = value.trimEnd().split(/\r?\n/);
        const shape = command.sheet === '商智实时'
          ? {start:'A1',end:'AA',firstRow:1,columns:27}
          : anchor === 'A3' ? {start:'A3',end:'W',firstRow:3,columns:23}
          : anchor === 'B1' ? {start:'B1',end:'W',firstRow:1,columns:1} : null;
        if (!shape || anchor !== shape.start) throw new Error('Wrong input anchor');
        const rangeMatch = new RegExp(`^${shape.start}:${shape.end}(\\d+)$`).exec(command.clearRange);
        if (!rangeMatch || Number(rangeMatch[1]) < shape.firstRow + sourceRows.length - 1) throw new Error('Clear range is invalid or too small');
        if (sourceRows[0].split('\t').length !== shape.columns) throw new Error('Wrong import column count');
        if (anchor === 'B1' && sourceRows.length !== 1) throw new Error('Metadata must occupy one row');
        await activateWpsSheet(page, command.sheet);
        await page.bringToFront();
        const origin=new URL(page.url()).origin;
        await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
        await writeVerifiedClipboard(page, value);
        const skuRange = command.sheet === '商智实时' ? `B2:B${sourceRows.length}`
          : anchor === 'A3' ? `A3:A${sourceRows.length+2}` : null;
        if (skuRange) {
          const result = await setWpsSkuRangeText(page,{sheet:command.sheet,range:skuRange});
          console.log(JSON.stringify({event:'skuFormatComplete',...result,timestamp:new Date().toISOString()}));
        }
        await page.getByText('粘贴成功',{exact:true}).waitFor({state:'hidden',timeout:10000});
        await selectWpsRange(page, anchor, command.sheet);
        await writeVerifiedClipboard(page, value);
        await pressWpsCellKey(page, {sheet:command.sheet,range:anchor,key:'Control+V'});
        await page.getByText('粘贴成功',{exact:true}).waitFor({state:'visible',timeout:30000});
        await assertWpsSheet(page, command.sheet);
        console.log(JSON.stringify({event:'pasteComplete',sheet:command.sheet,timestamp:new Date().toISOString()}));
        const nextRow = shape.firstRow + sourceRows.length;
        const lastRow = Number(rangeMatch[1]);
        const tailRange = anchor === 'B1' ? 'C1:W1' :
          nextRow <= lastRow ? `A${nextRow}:${shape.end}${lastRow}` : null;
        if (tailRange) {
          await selectWpsRange(page, tailRange, command.sheet);
          await pressWpsCellKey(page, {sheet:command.sheet,range:tailRange,key:'Delete'});
          console.log(JSON.stringify({event:'tailClearComplete',sheet:command.sheet,range:tailRange,timestamp:new Date().toISOString()}));
        }
        if (skuRange) {
          const result = await replaceWpsRange(page,{sheet:command.sheet,range:skuRange,find:"'",replacement:''});
          console.log(JSON.stringify({event:'skuCleanupComplete',sheet:command.sheet,...result,timestamp:new Date().toISOString()}));
        }
        if (updateRun) updateRun.record(command.sheet,anchor);
      } else if (command.cmd === 'clickRole') {
        const match = await findUnique('role', command);
        await match.locator.click({ timeout: 30000 });
      } else if (command.cmd === 'clickText') {
        const match = await findUnique('text', command);
        await match.locator.click({ timeout: 30000 });
      } else if (command.cmd === 'clickSelector') {
        const locator = page.locator(command.selector);
        const count = await locator.count();
        if (count !== 1) throw new Error(`Expected one selector match, found ${count}`);
        await locator.click({ timeout: 30000 });
      } else if (command.cmd === 'fillSelector') {
        const locator = page.locator(command.selector);
        const count = await locator.count();
        if (count !== 1) throw new Error(`Expected one selector match, found ${count}`);
        await locator.fill(command.value, { timeout: 30000 });
      } else if (command.cmd === 'clickXY') {
        await page.mouse.click(Number(command.x), Number(command.y));
      } else if (command.cmd === 'press') {
        await page.keyboard.press(command.key);
      } else if (command.cmd === 'readRange') {
        const nameBox = page.locator('input.edit-box');
        if (await nameBox.count() !== 1) throw new Error('Expected one WPS name box');
        await selectWpsRange(page, command.range);
        const origin = new URL(page.url()).origin;
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.keyboard.press('Control+C');
        await page.waitForFunction(async () => (await navigator.clipboard.readText()).length > 0, null, { timeout: 10000 });
        const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
        console.log(JSON.stringify({ event: 'clipboard', kind: 'range', range: command.range, clipboardText }));
      } else if (command.cmd === 'readFormula') {
        const nameBox = page.locator('input.edit-box');
        if (await nameBox.count() !== 1) throw new Error('Expected one WPS name box');
        await selectWpsRange(page, command.cell);
        await page.keyboard.press('F2');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Control+C');
        const origin = new URL(page.url()).origin;
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
        await page.keyboard.press('Escape');
        console.log(JSON.stringify({ event: 'clipboard', kind: 'formula', cell: command.cell, clipboardText }));
      } else if (command.cmd === 'pasteFile') {
        const filePath = path.resolve(command.path);
        const value = fs.readFileSync(filePath, 'utf8');
        const origin = new URL(page.url()).origin;
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await page.evaluate(async (text) => navigator.clipboard.writeText(text), value);
        await page.keyboard.press('Control+V');
      } else if (command.cmd === 'downloadRole') {
        const match = await findUnique('role', command);
        const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
        await match.locator.click({ timeout: 30000 });
        const download = await downloadPromise;
        const fileName = command.fileName || download.suggestedFilename();
        const savedPath = path.join(downloadDir, fileName);
        await download.saveAs(savedPath);
        console.log(JSON.stringify({ event: 'download', savedPath }));
      } else if (command.cmd === 'wait') {
        await page.waitForTimeout(Math.min(Number(command.ms) || 1000, 60000));
      } else if (command.cmd === 'close') {
        await context.close();
        break;
      } else {
        throw new Error(`Unknown command: ${command.cmd}`);
      }
      if (command.snapshot !== false) console.log(JSON.stringify({ event: 'snapshot', timestamp: new Date().toISOString(), ...(await snapshot()) }));
      console.log(JSON.stringify({event:'commandComplete',cmd:command.cmd,timestamp:new Date().toISOString()}));
    } catch (error) {
      console.log(JSON.stringify({ event: 'error', message: String(error.message || error) }));
    }
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
