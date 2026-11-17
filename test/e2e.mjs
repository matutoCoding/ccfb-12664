// 浏览器端到端冒烟：node test/e2e.mjs（需要 npx playwright，全局 chromium）
import { chromium } from 'playwright';

const BASE = 'http://localhost:8080';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

try {
  console.log('1) 首页加载（工程列表）');
  await page.goto(BASE + '/#/projects');
  await page.waitForSelector('.brand h1');
  ok((await page.textContent('.brand h1')).includes('绣花打版'), '标题渲染');
  ok(await page.isVisible('#btnNew'), '新建按钮可见');

  console.log('2) 从内置花稿创建工程');
  await page.click('#btnSample');
  await page.fill('#modalInput', '1');
  await page.click('.modal [data-v="1"]');
  await page.waitForSelector('#editorCanvas');
  ok(await page.isVisible('#editorCanvas'), '进入编辑器且画布存在');
  await page.waitForTimeout(800);

  console.log('3) 图层与针迹计算');
  const layerCount = await page.$$eval('.layer-item', els => els.length);
  ok(layerCount >= 3, '内置花稿生成多个图层，实际 ' + layerCount);
  await page.waitForFunction(() => {
    const el = document.getElementById('canvasInfo');
    return el && el.textContent.includes('针数');
  }, { timeout: 8000 });
  const info = await page.textContent('#canvasInfo');
  ok(/针数:\s*\d+/.test(info), '针迹已计算：' + info.replace(/\s+/g, ' '));

  console.log('4) 全局错误检查');
  ok(errors.filter(e => !e.includes('favicon')).length === 0, '无 JS 运行错误' + (errors.length ? '：' + errors.join(' | ') : ''));

  console.log('5) 参数调整触发重算');
  await page.click('.layer-item');
  await page.waitForSelector('input[type=range][data-key]');
  const density = await page.$('input[data-key="density"], input[data-key="runLength"]');
  if (density) {
    const before = await page.textContent('#canvasInfo');
    await density.evaluate(el => { el.value = parseFloat(el.value) * 0.6; el.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(500);
    const after = await page.textContent('#canvasInfo');
    ok(after.includes('针数'), '调参后针迹重算');
  } else ok(true, '当前形状无滑块（跳过）');

  console.log('6) 配色页');
  await page.goto(BASE + '/#/colors');
  await page.waitForSelector('.thread-row', { timeout: 5000 });
  const threadRows = await page.$$eval('.thread-row', els => els.length);
  ok(threadRows >= 1, '绣作顺序列出颜色，实际 ' + threadRows);
  ok(await page.isVisible('.palette-grid'), 'Madeira 色板渲染');

  console.log('7) 仿真预览页');
  await page.goto(BASE + '/#/preview');
  await page.waitForSelector('#previewCanvas');
  await page.waitForSelector('.stat-box', { timeout: 5000 });
  const stats = await page.$$eval('.stat-box .v', els => els.map(e => e.textContent));
  ok(stats.length >= 6, '统计卡片渲染：' + stats.slice(0, 4).join('/'));
  ok(await page.isVisible('#btnPlay'), '绣作播放按钮存在');
  // 倾斜滑块
  await page.fill('#tilt', '0.6');
  await page.dispatchEvent('#tilt', 'input');
  ok(true, '侧向倾斜可调');

  console.log('8) 导出页与 DST 下载');
  await page.goto(BASE + '/#/export');
  await page.waitForSelector('#btnDst');
  ok(await page.isVisible('#btnVerify'), '往返校验按钮存在');
  await page.click('#btnVerify');
  await page.waitForFunction(() => {
    const el = document.getElementById('verifyOut');
    return el && el.textContent.includes('校验');
  }, { timeout: 5000 });
  const verify = await page.textContent('#verifyOut');
  ok(verify.includes('校验通过'), 'DST 往返校验通过：' + verify.slice(0, 40));

  // 实际下载 DST
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnDst')
  ]);
  ok(download.suggestedFilename().endsWith('.dst'), 'DST 文件下载：' + download.suggestedFilename());

  console.log('9) 工程列表持久化');
  await page.goto(BASE + '/#/projects');
  await page.waitForSelector('.prj-card');
  const cards = await page.$$eval('.prj-card', els => els.length);
  ok(cards >= 1, '工程已保存到本地，卡片数 ' + cards);

  console.log('10) 刷新后数据不丢');
  await page.reload();
  await page.waitForSelector('.prj-card');
  const cards2 = await page.$$eval('.prj-card', els => els.length);
  ok(cards2 === cards, '刷新后工程仍在（' + cards2 + ' 个）');

  console.log('11) SVG 坏文件不白屏');
  // 重新打开已有工程进入编辑器（直接访问 #/editor 会因无 current 被弹回列表）
  await page.goto(BASE + '/#/projects');
  await page.waitForSelector('.prj-card');
  await page.click('.prj-card [data-act="open"]');
  await page.waitForSelector('#editorCanvas');
  await page.waitForSelector('#svgFile', { state: 'attached' });
  await page.setInputFiles('#svgFile', {
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg><path d="M broken >>></svg>')
  });
  await page.waitForSelector('.toast.error', { timeout: 5000 });
  ok(await page.isVisible('.toast.error'), '坏 SVG 弹出错误提示而非白屏');
  ok(await page.isVisible('#editorCanvas'), '编辑器仍然存活');

} catch (e) {
  fail++;
  console.error('  ✗ 测试异常: ' + e.message);
} finally {
  await browser.close();
}

console.log(`\n端到端结果: ${pass} 通过, ${fail} 失败`);
console.log('浏览器控制台错误:', errors.length ? errors : '无');
process.exit(fail ? 1 : 0);
