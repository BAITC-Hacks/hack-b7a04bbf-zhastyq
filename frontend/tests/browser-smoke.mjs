// Run against a disposable backend. Real AI calls are intercepted in this test.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const dataDir = resolve(process.env.DATA_DIR || '../backend/data');
const output = resolve(process.env.SMOKE_OUTPUT || '../backend/.tmp/browser-smoke');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const report = {};
try {
  // Block real AI before any UI interaction, even if the server has a key.
  let aiMode = 'success';
  await page.route('**/api/ask', async (route) => {
    const request = route.request().postDataJSON();
    if (aiMode === 'unavailable') return route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE', message: 'AI недоступен: тестовый отказ' } } });
    if (aiMode === 'stale') return route.fulfill({ status: 409, json: { error: { code: 'STALE_ANALYSIS', message: 'Снимок изменён' } } });
    return route.fulfill({ json: { analysis_id: request.analysis_id, answer: 'Тестовое объяснение <img src=x onerror=alert(1)> — гипотеза для проверки.', references: [{ gid: request.context_gids[0], facts: ['Проверяемая тестовая ссылка'] }], limitations: ['Наблюдаемая выборка неполна'] } });
  });
  await page.goto(base);
  await page.getByRole('heading', { name: 'За переводами — связи.' }).waitFor();
  report.health = await (await page.request.get(base + '/api/health')).json();
  assert.equal(report.health.status, 'ok');
  if (!report.health.analysis_ready) await page.getByText('Анализа пока нет.', { exact: false }).waitFor();
  for (const key of ['nodes', 'edges', 'transactions']) await page.locator(`input[aria-label="Выбрать ${key}.parquet"]`).setInputFiles(resolve(dataDir, key + '.parquet'));
  const uploaded = page.waitForResponse((response) => response.url().endsWith('/api/analyze') && response.request().method() === 'POST', { timeout: 300000 });
  const started = performance.now();
  await page.getByRole('button', { name: 'Загрузить и запустить' }).click();
  const uploadResponse = await uploaded;
  assert.equal(uploadResponse.status(), 200);
  report.upload_seconds = (performance.now() - started) / 1000;
  await page.getByText('Расчёт завершён', { exact: true }).waitFor();
  await page.getByTestId('analysis-summary').waitFor();
  let snapshot = await (await page.request.get(base + '/api/analysis')).json();
  assert.equal(snapshot.nodes.length, 2248); assert.equal(snapshot.edges.length, 3119);
  report.summary = snapshot.summary;
  const top = snapshot.top_nodes[0].gid;
  const outside = snapshot.nodes.find((node) => !snapshot.top_nodes.some((item) => item.gid === node.gid) && node.in_deg + node.out_deg > 0).gid;
  const isolated = snapshot.nodes.find((node) => node.in_deg === 0 && node.out_deg === 0).gid;
  const boundary = snapshot.nodes.find((node) => node.truncated_by_depth).gid;
  const find = async (gid) => {
    await page.getByLabel('Поиск по gid', { exact: true }).fill(gid);
    await page.getByLabel('Поиск по gid', { exact: true }).press('Enter');
    await page.locator('.node-card__gid').filter({ hasText: gid }).waitFor();
    await page.getByRole('heading', { name: 'Полнота наблюдения', exact: true }).waitFor();
    assert.equal(await page.locator('.node-card__gid').innerText(), gid);
  };
  for (const gid of [top, outside, isolated, boundary]) await find(gid);
  report.search = { top, outside, isolated, boundary };
  await page.getByText('Исходящие переводы за границей обхода неизвестны', { exact: false }).waitFor();
  await find(isolated);
  assert.match(await page.locator('.graph-count').innerText(), /1 узлов · 0 связей/);
  await find(top);
  const card = await (await page.request.get(base + '/api/nodes/' + top)).json();
  assert.ok(card.incoming.every((edge) => edge.dst === top));
  assert.ok(card.outgoing.every((edge) => edge.src === top));
  assert.ok(card.next_requests.every((request) => card.data_gaps.some((gap) => gap.code === request.gap_code)));
  const links = await page.locator('.edge-list .gid-link').allTextContents();
  for (const edge of [...card.incoming, ...card.outgoing]) assert.ok(links.includes(edge.src + ' → ' + edge.dst));
  assert.equal(await page.locator('.temporal-item').count(), card.temporal_patterns.items.length);
  // Inspect the rendered graph and click a real canvas node, rather than invoking React callbacks.
  await page.locator('.aml-graph__canvas canvas').first().waitFor();
  const canvas = page.locator('.aml-graph__canvas');
  const graphCheck = await canvas.evaluate((element) => {
    const cy = element._cyreg.cy;
    const edges = cy.edges();
    const candidate = cy.nodes().filter((node) => !node.hasClass('is-selected'))[0];
    return { arrow: edges[0]?.style('target-arrow-shape'), selected: candidate?.id(), position: candidate?.renderedPosition() };
  });
  assert.equal(graphCheck.arrow, 'triangle');
  if (graphCheck.selected) {
    await canvas.click({ position: graphCheck.position });
    await page.locator('.node-card__gid').filter({ hasText: graphCheck.selected }).waitFor();
  }
  report.graph_click = graphCheck.selected;
  await find(top);
  await page.getByRole('button', { name: /AI-помощник/ }).click();
  await page.getByRole('button', { name: 'Спросить AI', exact: true }).click();
  await page.getByRole('article', { name: 'Ответ AI' }).waitFor();
  assert.equal(await page.locator('.ai-answer img').count(), 0);
  assert.ok((await page.locator('.ai-answer').innerText()).includes('<img'));
  await page.getByRole('article', { name: 'Ответ AI' }).getByRole('button', { name: top, exact: true }).click();
  aiMode = 'unavailable';
  await page.getByRole('button', { name: 'Спросить AI', exact: true }).click();
  await page.getByText('AI недоступен: тестовый отказ', { exact: true }).waitFor();
  aiMode = 'stale';
  await page.getByRole('button', { name: 'Спросить AI', exact: true }).click();
  await page.getByText('Анализ изменился. Снимок обновлён; выберите узел и повторите вопрос.', { exact: true }).waitFor();
  report.ai_mock = 'plain text, reference navigation, unavailable, stale refresh';
  report.csv = {};
  for (const name of ['nodes_roles.csv', 'clusters.csv', 'top_nodes.csv']) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), name);
    await download.saveAs(resolve(output, name));
    assert.ok((await readFile(resolve(output, name), 'utf8')).length > 100);
    report.csv[name] = 'downloaded';
  }
  // A real Parquet file in the wrong slot passes the local envelope check but fails the backend schema.
  await page.locator('input[aria-label="Выбрать nodes.parquet"]').setInputFiles(resolve(dataDir, 'edges.parquet'));
  const failed = page.waitForResponse((response) => response.url().endsWith('/api/analyze'));
  await page.getByRole('button', { name: 'Загрузить и запустить' }).click();
  assert.equal((await failed).status(), 422);
  await page.locator('.pipeline-status--error').waitFor();
  assert.equal((await (await page.request.get(base + '/api/analysis')).json()).analysis_id, snapshot.analysis_id);
  assert.ok(await page.getByTestId('analysis-summary').isVisible());
  report.failed_upload_preserves_analysis = true;
  aiMode = 'success';
  if (await page.getByRole('button', { name: /AI-помощник/ }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: /AI-помощник/ }).click();
  await page.getByRole('button', { name: 'Спросить AI', exact: true }).click();
  await page.getByRole('article', { name: 'Ответ AI' }).waitFor();
  // Successful replacement changes snapshot and clears old AI/card state.
  await page.locator('input[aria-label="Выбрать nodes.parquet"]').setInputFiles(resolve(dataDir, 'nodes.parquet'));
  const replacement = page.waitForResponse((response) => response.url().endsWith('/api/analyze'), { timeout: 300000 });
  await page.getByRole('button', { name: 'Загрузить и запустить' }).click();
  assert.equal((await replacement).status(), 200);
  await page.getByText('Расчёт завершён', { exact: true }).waitFor();
  const newSnapshot = await (await page.request.get(base + '/api/analysis')).json();
  assert.notEqual(newSnapshot.analysis_id, snapshot.analysis_id);
  assert.equal(await page.getByRole('article', { name: 'Ответ AI' }).count(), 0);
  report.replacement = true;
  // Offline startup must offer retry without synthetic data.
  await page.route('**/api/analysis', (route) => route.abort());
  await page.reload();
  await page.getByText('Нет связи с сервером.', { exact: false }).waitFor();
  assert.equal(await page.locator('.top-item').count(), 0);
  await page.unroute('**/api/analysis');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByTestId('analysis-summary').waitFor();
  report.offline_retry = true;
  await page.screenshot({ path: resolve(output, 'workspace.png'), fullPage: true });
  assert.deepEqual(errors, []);
  report.browser_errors = errors;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
