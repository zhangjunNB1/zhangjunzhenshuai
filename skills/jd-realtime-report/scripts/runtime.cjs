const os = require('node:os');
const path = require('node:path');
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Missing local setting ' + name);
  return value;
}
function workbenchRoot() {
  return path.resolve(process.env.JD_REPORT_WORKDIR || path.join(os.homedir(), '.jd-reports'));
}
function workbookUrl() {
  const target = new URL(required('JD_KDOCS_URL'));
  if (target.origin !== 'https://www.kdocs.cn' || !/^\/l\/[A-Za-z0-9]+$/.test(target.pathname) ||
      target.search || target.hash) throw new Error('JD_KDOCS_URL must identify one KDocs workbook');
  return target.origin + target.pathname;
}
function assertWorkbook(page) {
  const target = new URL(page.url());
  if (target.origin + target.pathname !== workbookUrl()) throw new Error('Wrong workbook');
}
module.exports = { required, workbenchRoot, workbookUrl, assertWorkbook };
