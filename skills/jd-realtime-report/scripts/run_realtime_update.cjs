const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const { required, workbookUrl, workbenchRoot } = require('./runtime.cjs');
const workbench = workbenchRoot();
const shanghaiClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium',
});
const clock = (time = new Date()) => shanghaiClock.format(time);
const report = (value) => console.log(JSON.stringify(value));
const commandSucceeded = (event) => event.event === 'commandComplete';

function loadShangzhiRecovery(events, runId) {
  const writes = events.flatMap((event, index) => {
    if (event.event !== 'commandStarted' || event.cmd !== 'overwriteFile') return [];
    const endIndex = events.findIndex((entry, position) => position > index && entry.event === 'commandStarted');
    const receipts = events.slice(index + 1, endIndex < 0 ? undefined : endIndex);
    return [{ event, receipts }];
  });
  const [promotion, metadata, sales] = writes;
  const completedWrite = (write, anchor, receipt) =>
    write.event.sheet === '实时推广费' && write.event.anchor === anchor &&
    write.receipts.some(({ event, sheet }) => event === receipt && sheet === '实时推广费') &&
    write.receipts.some(event => commandSucceeded(event) && event.cmd === 'overwriteFile');
  const failure = events.at(-1);
  if (writes.length !== 3 || !completedWrite(promotion, 'A3', 'skuCleanupComplete') ||
      !completedWrite(metadata, 'B1', 'pasteComplete') ||
      sales.event.sheet !== '商智实时' || sales.event.anchor !== 'A1' ||
      !sales.receipts.some(event => event.event === 'error' && event.message === 'Clipboard preflight failed; no cells cleared') ||
      sales.receipts.some(event => ['skuFormatComplete', 'pasteComplete', 'commandComplete'].includes(event.event)) ||
      events.some(event => event.event === 'updateStampComplete') ||
      failure?.event !== 'runFailed' || failure.stage !== '写入商智实时') {
    throw new Error('本轮回执不符合商智粘贴前恢复条件');
  }
  const ready = events.find(event => event.event === 'shangzhiReady');
  const start = events.find(event => event.event === 'runStarted');
  const recordedStart = runId.replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6+08:00');
  const startedAt = new Date(start?.startedAt ?? recordedStart);
  if (!ready || !Number.isFinite(startedAt.getTime())) throw new Error('缺少商智源或启动回执');
  return { startedAt, sales: { rows: ready.rows, period: [ready.period] } };
}

async function runUpdate(resumeId, scope = 'all') {
  workbookUrl();
  required('JZT_ACCESS_PIN');
  if (scope === 'all') required('JD_SHOP_NAME');
  const now = new Date();
  const runRoot = path.join(workbench, '临时', '实时投产表运行');
  if (resumeId && (!/^\d{8}_\d{6}$/.test(resumeId) ||
      !resumeId.startsWith(clock(now).slice(0, 10).replaceAll('-', '')) ||
      fs.readdirSync(runRoot).some(name => /^\d{8}_\d{6}$/.test(name) && name > resumeId))) {
    throw new Error('请使用当天最新的运行目录恢复');
  }
  const events = resumeId
    ? fs.readFileSync(path.join(runRoot, resumeId, '回执.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
    : [];
  const recovery = resumeId ? loadShangzhiRecovery(events, resumeId) : null;
  const startedAt = recovery?.startedAt ?? now;
  const localStart = clock(startedAt);
  const date = clock(now).slice(0, 10);
  const runId = resumeId ?? localStart.replaceAll('-', '').replaceAll(':', '').replace(' ', '_');
  const runDir = path.join(runRoot, runId);
  const python = process.env.JD_PYTHON || 'python';
  const profile = process.env.JD_AUTOMATION_PROFILE;
  if (!profile || !fs.existsSync(profile)) throw new Error('请提供已存在的专用 Chrome 配置目录');
  fs.mkdirSync(runRoot, {recursive:true});
  if (!recovery) fs.mkdirSync(runDir);
  const file = (name) => path.join(runDir, name);
  function record(event) {
    const entry = { ...event, observedAt: new Date().toISOString() };
    events.push(entry);
    fs.appendFileSync(file('回执.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  }
  const started = { event: recovery ? 'runResumed' : 'runStarted', date, localStart, runDir, startedAt: now.toISOString() };
  record(started);
  report(started);
  const host = spawn(process.execPath, [path.join(__dirname, 'jd_browser_host.cjs')], {
    env: { ...process.env, JD_RUN_DIR: runDir, TEMP: runDir, TMP: runDir,
      JD_START_URL: recovery || scope === 'promo' ? 'about:blank' : 'https://jdsz.jd.com/szweb/view/product/productDetail.html' },
    stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
  });
  const output = readline.createInterface({ input: host.stdout });
  let pending;
  const ready = new Promise((resolve, reject) => {
    pending = { resolve, reject, matches: (event) => event.status === 'ready' };
  });
  function failPending(error) {
    const waiting = pending;
    pending = undefined;
    waiting?.reject(error);
  }
  output.on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    record(event);
    if (!pending) return;
    if (event.event === 'error') {
      failPending(new Error(event.message));
    } else if (pending.matches(event)) {
      const waiting = pending;
      pending = undefined;
      waiting.resolve(event);
    }
  });
  const closed = new Promise((resolve) => host.once('close', resolve));
  host.on('error', failPending);
  host.once('exit', (code) => failPending(new Error('浏览器进程已退出，代码 ' + code)));
  host.stdin.on('error', failPending);
  function command(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, matches: (event) => commandSucceeded(event) && event.cmd === cmd };
      record({ event: 'commandStarted', cmd, ...args });
      host.stdin.write(JSON.stringify({ cmd, ...args, snapshot: false }) + '\n');
    });
  }
  async function pythonJson(script, ...args) {
    const { stdout } = await execute(python, ['-B', path.join(__dirname, script), ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
      timeout: 120000,
    });
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  }
  async function preparePromotion() {
    record({ event: 'promotionQueryStarted' });
    const promo = await pythonJson('fetch_jzt_sku.py', '--date', date, '--output', file('promo.json'));
    const importResult = await pythonJson('prepare_realtime_import.py', 'promo', file('promo.json'), file('promo.tsv'), '--date', date);
    const meta = promo.metadata;
    const checks = ['cost', 'impressions', 'clicks'].map((metric) => promo.overview_checks[metric]);
    if (meta.account !== required('JZT_ACCESS_PIN') || meta.conversion_window_days !== 15 ||
        meta.attribution !== 'click' || meta.exclude_gifts !== true || meta.order_scope !== 'completed' ||
        !meta.fetched_at.startsWith(date + 'T') || importResult.rows !== meta.merged_sku_count ||
        checks.some((check) => !check || !Number.isFinite(Number(check.difference)))) {
      throw new Error('京准通账号、抓取口径或汇总校验失败');
    }
    if (Math.abs(Number(checks[0].difference)) >= 100) {
      throw new Error('京准通 SKU 花费与账户汇总相差 ' + checks[0].difference + ' 元，需核对渠道覆盖');
    }
    fs.writeFileSync(file('promo_metadata.tsv'),
      '业务日期：' + date + '；旧渠道（含256）+shopSmart；15天/点击/不含赠品/成交订单；API抓取北京时间' +
      meta.fetched_at.slice(0, 19).replace('T', ' '), 'utf8');
    record({ event: 'promotionReady', rows: importResult.rows, fetchedAt: meta.fetched_at, checks: promo.overview_checks });
    return promo;
  }
  async function prepareShangzhi() {
    await command('downloadRole', { role: 'button', name: '确定', exact: true, fileName: 'shangzhi_source.xlsx' });
    const sales = await pythonJson('prepare_realtime_import.py', 'shangzhi', file('shangzhi_source.xlsx'), file('shangzhi.tsv'), '--date', date);
    if (!sales.period[0]?.startsWith(date + ' 00:00:00~') || sales.rows >= 1000) {
      throw new Error('商智快照范围异常或达到 1000 条下载上限');
    }
    record({ event: 'shangzhiReady', rows: sales.rows, period: sales.period[0] });
    return sales;
  }
  const overwrite = (sheet, clearRange, anchor, name) =>
    command('overwriteFile', { sheet, clearRange, anchor, path: file(name) });
  const cleanupCount = (sheet) =>
    events.find((event) => event.event === 'skuCleanupComplete' && event.sheet === sheet)?.replaced ?? 0;
  let stage = '启动专用 Chrome';
  try {
    await ready;
    let sales;
    let promo;
    if (recovery) {
      stage = '核对本轮已验证的数据和写入回执';
      const source = JSON.parse(fs.readFileSync(file('promo.json'), 'utf8'));
      const ready = events.find(event => event.event === 'promotionReady');
      if (!ready || source.metadata.fetched_at !== ready.fetchedAt ||
          !ready.fetchedAt.startsWith(date + 'T') || source.metadata.merged_sku_count !== ready.rows ||
          !recovery.sales.period[0]?.startsWith(date + ' 00:00:00~')) {
        throw new Error('本轮数据日期或来源回执不匹配');
      }
      sales = recovery.sales;
      promo = { ...source, totals: source.additive_metric_totals };
      await command('beginUpdate');
      await command('prepareRealtimeWorkbook');
    } else if (scope === 'promo') {
      stage = '准备推广费和金山文档';
      await command('beginUpdate', {sheets:['实时推广费']});
      await command('prepareRealtimeWorkbook');
      promo = await preparePromotion();
    } else {
      stage = '确认商智并打开导出设置';
      await command('checkRealtimeSource', { date });
      await command('beginUpdate');
      await command('clickRole', { role: 'tab', name: 'SKU', exact: true });
      await command('clickText', { text: '下载数据', exact: true });

      stage = '并行准备商智和京准通数据';
      const promoReady = preparePromotion().then(value => ({ value }), error => ({ error }));
      await command('prepareRealtimeWorkbook');
      const sources = await Promise.allSettled([prepareShangzhi(), promoReady]);
      if (sources[0].status === 'rejected') throw sources[0].reason;
      if (sources[1].value.error) throw sources[1].value.error;
      sales = sources[0].value;
      promo = sources[1].value.value;
    }

    stage = '确认目标金山文档';
    await command('useRealtimeWorkbook');
    if (clock().slice(0, 10) !== date) throw new Error('已跨北京时间业务日期');
    report({ event: 'sourcesValidated', shangzhiRows: sales?.rows ?? 0, promoRows: promo.metadata.merged_sku_count,
      cost: promo.totals.cost, overviewChecks: promo.overview_checks });
    if (recovery) {
      stage = '核对已写入的推广费查询说明';
      await command('resumePromotion');
    } else {
      stage = '写入实时推广费';
      await overwrite('实时推广费', 'A3:W1002', 'A3', 'promo.tsv');
      stage = '更新推广费查询说明';
      await overwrite('实时推广费', 'B1:W1', 'B1', 'promo_metadata.tsv');
    }
    if (scope === 'all') {
      stage = '写入商智实时';
      await overwrite('商智实时', 'A1:AA1001', 'A1', 'shangzhi.tsv');
    }
    stage = '记录小时投产完成时间';
    await command('completeUpdate');
    const stamp = events.find((event) => event.event === 'updateStampComplete');
    const finishedAt = new Date(stamp.timestamp);
    const elapsed = ((finishedAt - startedAt) / 1000).toFixed(1);
    const cutoff = sales?.period[0].split('~')[1] ?? null;
    const fetched = promo.metadata.fetched_at.slice(0, 19).replace('T', ' ');
    const checks = ['cost', 'impressions', 'clicks'].map((metric) => promo.overview_checks[metric].difference);
    stage = '保存运行记录';
    fs.writeFileSync(file('运行记录.md'), [
      '# ' + date + ' 实时投产更新',
      '',
      ...(sales ? ['- 商智累计至 ' + cutoff + '，' + sales.rows + ' 个唯一 SKU，完整 27 列。'] : []),
      '- 京准通 API 于 ' + fetched + ' 取得 ' + promo.metadata.merged_sku_count + ' 个唯一 SKU，花费 ' + promo.totals.cost + ' 元。',
      '- 京准通明细减账户汇总的差额为 ' + checks[0] + ' 元、' + checks[1] + ' 次展现、' + checks[2] + ' 次点击。',
      '- 执行模式 ' + scope + '。推广费 SKU 清理 ' + cleanupCount('实时推广费') + ' 处，商智 SKU 清理 ' + cleanupCount('商智实时') + ' 处。',
      ...(recovery ? ['- 商智首次粘贴前剪贴板读回不一致。核对推广费回执和当前查询说明后，从商智写入步骤恢复。'] : []),
      '- SPU投产小时投产 A1 显示 ' + stamp.text + '。开始于 ' + localStart +
        '，于 ' + clock(finishedAt) + ' 收到完成回执，用时 ' + elapsed + ' 秒。',
      '- 数据抓取、验证与写入的时间点见回执.jsonl。',
      '',
    ].join('\n'), 'utf8');
    fs.appendFileSync(path.join(workbench, '日志.md'), '\n- ' + clock(finishedAt) +
      ' 实时投产更新成功。商智 ' + (sales?.rows ?? 0) + ' 个 SKU，京准通 ' + promo.metadata.merged_sku_count +
      ' 个 SKU，花费 ' + promo.totals.cost + ' 元，A1 显示 ' + stamp.text +
      '，耗时 ' + elapsed + ' 秒。记录见 ' + path.relative(workbench, file('运行记录.md')) + '。\n', 'utf8');
    report({ event: 'runComplete', stamp: stamp.text, finishedAt: clock(finishedAt),
      elapsedSeconds: Number(elapsed), cutoff, fetchedAt: fetched, runDir });
  } catch (error) {
    record({ event: 'runFailed', stage, message: error.message.split('\n')[0] });
    report({ event: 'runFailed', stage, message: error.message.split('\n')[0], runDir });
    process.exitCode = 1;
  } finally {
    if (host.exitCode === null && !host.stdin.destroyed) {
      host.stdin.end('{"cmd":"close","snapshot":false}\n');
    }
    await closed;
  }
}

function options(args) {
  let scope = 'all';
  let resumeId;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--scope') scope = args[++index];
    else if (arg === '--resume') {
      resumeId = args[++index];
      if (!resumeId) throw new Error('Missing run directory for --resume');
    }
    else throw new Error('Unknown argument ' + arg);
  }
  if (!['all', 'promo'].includes(scope) || (resumeId && scope !== 'all')) {
    throw new Error('Use --scope all or --scope promo. Recovery uses --scope all.');
  }
  return {scope, resumeId};
}
async function main() {
  const args = options(process.argv.slice(2));
  await runUpdate(args.resumeId, args.scope);
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
