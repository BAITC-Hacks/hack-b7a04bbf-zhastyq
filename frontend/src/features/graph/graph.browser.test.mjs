// Development-only browser harness. No test data is imported by the application.
// Start Vite first. Requires Playwright (or GRAPH_PLAYWRIGHT_MODULE pointing to its package).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = createRequire(import.meta.url)(process.env.GRAPH_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.GRAPH_QA_OUTPUT || join(tmpdir(), 'hackalem-graph-qa');
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('../../shared/api/fixtures/graph-slice.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: process.env.GRAPH_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1808, height: 1080 } });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.workerCreated = 0; window.workerAlive = 0; window.longTasks = []; window.layoutElapsed = 0; window.motionSamples = [];
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args); window.workerCreated++; window.workerAlive++; this.live = true;
      this.addEventListener('message', event => {
        window.layoutElapsed=event.data.elapsed; window.motionSamples=[]; const start=performance.now();
        const sample=()=>{const cy=document.querySelector('.aml-graph__canvas')?._cyreg?.cy;
          if(cy && !cy.destroyed() && cy.nodes().length) window.motionSamples.push({...cy.nodes()[0].position()});
          if(performance.now()-start<850)requestAnimationFrame(sample);
        }; requestAnimationFrame(sample);
      });
    }
    terminate() { if (this.live) { window.workerAlive--; this.live = false; } super.terminate(); }
  };
  new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
});
const url = process.env.GRAPH_QA_URL || 'http://127.0.0.1:5173';
const shot = async name => { await page.screenshot({ path: join(output, name + '.png') }); };
const state = () => page.locator('.aml-graph__canvas').evaluate(el => {
  const cy = el._cyreg.cy;
  return { nodes: cy.nodes().map(n => ({ id: n.id(), position: n.position(), shape: n.style('shape'),
    label: n.style('label'), border: n.style('border-style'), color: n.style('background-color'), classes: n.classes() })),
    pan: cy.pan(), zoom: cy.zoom(), created: window.workerCreated, alive: window.workerAlive };
});
const settled = async () => {
  // Let React commit prop changes and effects before testing the idle predicate.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => !document.querySelector('.aml-graph__settling') && window.workerAlive === 0);
  await page.waitForTimeout(180);
};
const range = async (name, value) => {
  await page.getByRole('slider', { name, exact: true }).fill(String(value));
  await settled();
};
try {
  if (!process.env.GRAPH_QA_HARNESS_ONLY) {
    await page.goto(url); await page.locator('.aml-graph').waitFor(); await settled();
    await shot('app-overview');
    const appBefore = await state();
    await page.getByRole('textbox', { name: 'Найти узел по gid', exact: true }).fill('1003');
    await page.getByRole('button', { name: 'Найти узел', exact: true }).click();
    await page.waitForTimeout(350);
    assert.match(await page.locator('.graph-panel > .graph-context').innerText(), /1003/);
    assert.equal((await state()).created, appBefore.created);
    results.push('Application parent callback and selection integration: passed');
  }

  const mainSource = await (await page.request.get(url + '/src/main.tsx')).text();
  const reactPath = mainSource.match(/\/node_modules\/\.vite\/deps\/react\.js[^"']*/)[0];
  const domPath = mainSource.match(/\/node_modules\/\.vite\/deps\/react-dom_client\.js[^"']*/)[0];
  await page.route('**/__graph_qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div>
    <script type="module">
      import React from '${reactPath}';
      import ReactDOM from '${domPath}';
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:GraphView}=await import('/src/features/graph/GraphView.tsx');
      import '/src/styles/tokens.css'; import '/src/styles/app.css';
      const root=ReactDOM.createRoot(document.getElementById('root')); window.fixture=${JSON.stringify(fixture)};
      function Harness(){ const [graph,setGraph]=React.useState(window.fixture);const [selected,setSelected]=React.useState(null);const [loading,setLoading]=React.useState(false);
        window.setGraph=setGraph;window.setSelected=setSelected;window.setLoading=setLoading;window.selections??=[];
        return React.createElement('div',{style:{display:'flex',height:'100dvh',minWidth:0}},React.createElement(GraphView,{graph,loading,selectedGid:selected,onSelectGid:gid=>{window.selections.push(gid);setSelected(gid)}})); }
      window.mount=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
      window.unmount=()=>root.render(null);window.mount();
    </script></body></html>` }));
  await page.goto(url + '/__graph_qa'); await page.locator('.aml-graph').waitFor(); await settled();
  await shot('overview-1808x1080');
  assert.deepEqual((await state()).nodes.map(n => n.shape), ['hexagon', 'ellipse', 'diamond', 'hexagon', 'round-rectangle', 'ellipse']);
  const initial = await state();
  const hit = await page.locator('.aml-graph__canvas').evaluate(el => {
    const p=el._cyreg.cy.getElementById('1003').renderedPosition(), r=el.getBoundingClientRect(); return {x:p.x+r.x,y:p.y+r.y};
  });
  await page.mouse.move(hit.x, hit.y); await page.getByRole('tooltip').waitFor(); await shot('hover-neighborhood');
  assert.equal((await state()).nodes.filter(n => n.classes.includes('is-hovered')).length, 1);
  await page.mouse.click(hit.x, hit.y); await page.mouse.move(10, 10); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.selections.at(-1)), '1003');
  assert.ok((await state()).nodes.find(n => n.id === '1003').classes.includes('is-selected'));
  assert.deepEqual((await state()).nodes.map(n => n.position), initial.nodes.map(n => n.position));
  assert.equal((await state()).created, initial.created);
  await shot('selected-node');
  await page.getByRole('button', { name: 'Фокус на выбранном узле' }).click(); await page.waitForTimeout(250);
  assert.ok((await state()).zoom >= 1.7); await shot('zoomed-node');
  const zoomBefore = await state(); await page.mouse.move(500, 500); await page.mouse.wheel(0, -120); await page.waitForTimeout(220);
  assert.ok((await state()).zoom > zoomBefore.zoom);
  await page.mouse.move(350, 500); await page.mouse.down(); await page.mouse.move(450, 550, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual((await state()).pan, zoomBefore.pan);
  results.push('Hover, persistent selection, exact string callback, unchanged layout on selection, zoom and pan: passed');

  await page.getByRole('button', {name:'Приблизить граф',exact:true}).click();
  await page.mouse.move(200,200); await page.mouse.down();
  await page.mouse.move(280,240,{steps:2}); await page.mouse.up();
  const panAfterDrag=(await state()).pan; await page.waitForTimeout(220);
  assert.deepEqual((await state()).pan,panAfterDrag);
  results.push('Dragging immediately after zoom cancels viewport interpolation without overriding the gesture: passed');

  const beforeReorder = await state();
  await page.evaluate(() => {
    window.previousCy=document.querySelector('.aml-graph__canvas')._cyreg.cy;
    window.setGraph({...window.fixture,nodes:[...window.fixture.nodes].reverse(),edges:[...window.fixture.edges].reverse()});
  });
  await page.waitForTimeout(300);
  const afterReorder = await state();
  assert.equal(afterReorder.created, beforeReorder.created);
  assert.equal(await page.evaluate(() => window.previousCy===document.querySelector('.aml-graph__canvas')._cyreg.cy), true);
  assert.deepEqual(afterReorder.pan, beforeReorder.pan); assert.equal(afterReorder.zoom, beforeReorder.zoom);
  assert.deepEqual(afterReorder.nodes.map(n=>n.position), beforeReorder.nodes.map(n=>n.position));
  results.push('Equivalent reordered slice preserves renderer, positions and viewport without restarting layout: passed');

  const beforeExternal = await state();
  await page.evaluate(() => {
    const cy = document.querySelector('.aml-graph__canvas')._cyreg.cy;
    cy.pan({ x: -5000, y: -5000 }); window.setSelected('1001');
  });
  await page.waitForTimeout(300);
  const afterExternal = await state();
  assert.equal(afterExternal.created, beforeExternal.created);
  assert.deepEqual(afterExternal.nodes.map(n => n.position), beforeExternal.nodes.map(n => n.position));
  assert.ok(afterExternal.nodes.find(n => n.id === '1001').classes.includes('is-selected'));
  assert.ok(await page.locator('.aml-graph__canvas').evaluate(el => {
    const cy = el._cyreg.cy; const p = cy.getElementById('1001').renderedPosition();
    return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 16 && p.x < cy.width() - 264 && p.y > 32 && p.y < cy.height() - 80;
  }));
  await page.evaluate(() => {
    document.querySelector('.aml-graph__canvas')._cyreg.cy.pan({ x: -4000, y: -4000 });
    window.setGraph({ ...window.fixture });
  });
  await page.waitForTimeout(300);
  assert.deepEqual((await state()).pan, { x: -4000, y: -4000 });
  assert.equal((await state()).created, beforeExternal.created);
  await page.getByRole('button', { name: 'Показать весь срез' }).click(); await page.waitForTimeout(250);
  results.push('New external offscreen selection focuses without layout; same-selection data refresh preserves manual viewport: passed');

  for (const [label, value] of [['К центру', 1.6], ['Отталкивание', 3], ['Сила связей', 2.5], ['Длина связей', 2.4]]) {
    const before = await state(); await range(label, value); const after = await state();
    assert.notDeepEqual(after.nodes.map(n => n.position), before.nodes.map(n => n.position));
    assert.equal(after.zoom, before.zoom); assert.deepEqual(after.pan, before.pan);
  }
  await page.getByRole('button', { name: 'Показать весь срез' }).click(); await page.waitForTimeout(250); await shot('modified-forces');
  results.push('All four force parameters rearrange nodes and retain viewport: passed');
  assert.ok(await page.evaluate(() => new Set(window.motionSamples.map(p=>JSON.stringify(p))).size > 3));

  await page.getByText('Фильтры', { exact: true }).click();
  await page.getByLabel('Роль', { exact: true }).selectOption('transit'); await settled(); await shot('filtered-graph');
  assert.equal((await state()).nodes.filter(n => !n.classes.includes('is-filtered')).length, 2);
  const beforeHiddenSelection = await state();
  await page.evaluate(() => window.setSelected('1004')); await page.waitForTimeout(250);
  assert.ok((await state()).nodes.find(n => n.id === '1004').classes.includes('is-filtered'));
  assert.deepEqual((await state()).pan, beforeHiddenSelection.pan);
  assert.equal((await state()).created, beforeHiddenSelection.created);
  await page.getByRole('button', { name: 'Показать скрытый узел', exact: true }).waitFor();
  results.push('External filtered selection keeps filters and viewport and offers explicit reveal: passed');
  await page.getByRole('textbox', { name: 'Найти узел по gid' }).fill('1005');
  await page.getByRole('button', { name: 'Найти узел', exact: true }).click();
  assert.match(await page.locator('.aml-graph__search').innerText(), /скрыт фильтрами/);
  await page.getByRole('button', { name: 'Показать узел', exact: true }).click(); await settled();
  assert.equal((await state()).nodes.filter(n => !n.classes.includes('is-filtered')).length, 6);
  await page.getByRole('textbox', { name: 'Найти узел по gid' }).fill('no-such-gid');
  await page.getByRole('button', { name: 'Найти узел', exact: true }).click();
  assert.match(await page.locator('.aml-graph__search').innerText(), /не найден в загруженном графе/);
  results.push('Role filters, hidden-result reveal and honest not-found status: passed');

  await page.evaluate(() => window.setGraph({ ...window.fixture, nodes: [...window.fixture.nodes,
    { ...window.fixture.nodes[0], gid: '9223372036854775807', role: 'peripheral', depth: 4, is_seed: true, cluster_id: 99 }],
    edges: [...window.fixture.edges, { source: '1005', target: '1001', sum_kzt: 0, n_tx: 0 }] }));
  await settled();
  await page.getByRole('textbox', { name: 'Найти узел по gid' }).fill('9223372036854775807');
  await page.getByRole('button', { name: 'Найти узел', exact: true }).click(); await page.waitForTimeout(250);
  const isolated = (await state()).nodes.find(n => n.id === '9223372036854775807');
  assert.equal(isolated.label, 'S 9223372036854775807'); assert.equal(isolated.border, 'double'); assert.equal(isolated.shape, 'octagon');
  await shot('isolated-node');
  await page.getByRole('switch', { name: 'Изолированные узлы' }).uncheck(); await settled();
  assert.ok((await state()).nodes.find(n => n.id === isolated.id).classes.includes('is-filtered'));
  await page.getByRole('button', { name: 'Показать скрытый узел' }).click(); await settled();
  assert.equal(await page.evaluate(() => window.selections.at(-1)), '9223372036854775807');
  results.push('Isolated node reveal, int64 string identity, seed double border, seed label, depth-four role and multiple components: passed');

  await page.getByText('Отображение', { exact: true }).click();
  const styleBefore = await state();
  await page.getByLabel('Цвет узлов', { exact: true }).selectOption('cluster');
  assert.match(await page.locator('.aml-graph__legend').innerText(), /Легенда · кластеры/);
  assert.equal((await state()).created, styleBefore.created);
  assert.deepEqual((await state()).nodes.map(n => n.position), styleBefore.nodes.map(n => n.position));
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--role-transit', '#aaccff');
    document.documentElement.style.setProperty('--color-surface', '#20242a');
    document.documentElement.style.setProperty('--color-surface-raised', '#292e36');
    document.documentElement.style.setProperty('--color-text', '#eef2f7');
    document.documentElement.style.setProperty('--color-text-secondary', '#ccd5e2');
    document.documentElement.style.setProperty('--graph-label-color', '#eef2f7');
    document.documentElement.style.setProperty('--graph-label-bg', '#20242a');
  });
  await page.getByLabel('Цвет узлов', { exact: true }).selectOption('role'); await page.waitForTimeout(150);
  assert.equal((await state()).nodes.find(n => n.id === '1003').color, 'rgb(170,204,255)');
  await shot('theme-token-refresh');
  await page.evaluate(() => document.documentElement.removeAttribute('style'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  assert.equal(await page.locator('.aml-graph__controls').isVisible(), false);
  await page.getByRole('button', { name: 'Показать весь срез' }).click(); await page.waitForTimeout(250); await shot('narrow-closed');
  await page.getByRole('button', { name: 'Открыть настройки графа' }).click(); await shot('narrow-open');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.getByRole('button', { name: 'Скрыть настройки графа' }).click();
  results.push('Color legend, style and theme updates without re-layout, narrow drawer without overflow: passed');

  for (const [value, text] of [[null, 'Граф пока не загружен'], [{center_gid:'',nodes:[],edges:[]}, 'В этом срезе нет узлов']]) {
    await page.evaluate(graph => window.setGraph(graph), value); await page.getByText(text, { exact: true }).waitFor(); await shot(value ? 'empty' : 'no-dataset');
  }
  await page.evaluate(() => window.setLoading(true)); await page.getByText('Загрузка графа…', { exact: true }).waitFor(); await shot('loading');
  await page.evaluate(() => { window.setLoading(false); window.setSelected(null); window.setGraph({ ...window.fixture, nodes: [window.fixture.nodes[0]], edges: [] }); });
  await settled(); await shot('single-node');
  await page.getByRole('button', { name: 'Открыть настройки графа' }).click();
  await page.getByRole('switch', { name: 'Только seed' }).check(); await page.getByText('Нет узлов по выбранным фильтрам').waitFor();
  await shot('empty-filters');
  await page.getByRole('button', { name: 'Сбросить настройки графа' }).click(); await settled();
  assert.equal((await state()).nodes.length, 1);
  await page.evaluate(() => { window.previousCy = document.querySelector('.aml-graph__canvas')._cyreg.cy; window.unmount(); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.previousCy.destroyed()), true);
  assert.equal(await page.evaluate(() => window.workerAlive), 0);
  await page.evaluate(() => window.mount()); await page.locator('.aml-graph').waitFor(); await settled();
  results.push('No dataset, empty slice, loading, single node, no filter matches, reset and StrictMode/unmount cleanup: passed');
  await page.setViewportSize({width:1808,height:1080});
  const profiler = process.env.GRAPH_PROFILE ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  await page.evaluate(() => {
    window.setSelected(null); window.longTasks=[];
    const roles=['consolidator','transit','distributor','terminal','coordinator','peripheral'];
    // Synthetic load fixture, never supplied as analytical results or imported into production.
    const nodes=Array.from({length:2248},(_,i)=>({...window.fixture.nodes[0],gid:'qa-'+i,role:roles[i%6],cluster_id:i%12,priority_score:(i%100)/100,is_seed:i<81}));
    const edges=Array.from({length:3119},(_,i)=>({source:'qa-'+(i<2147?Math.floor(i/2):i%2148),target:'qa-'+(i<2147?i+1:(i*73+19)%2148),sum_kzt:i+1,n_tx:1}));
    window.loadStart=performance.now();window.setGraph({center_gid:'qa-0',nodes,edges});
  });
  await page.waitForFunction(() => document.querySelector('.aml-graph__meta')?.textContent.includes('2248'));
  await page.waitForFunction(() => !document.querySelector('.aml-graph__settling') && window.workerAlive===0, null, {timeout:90000});
  const performanceReport=await page.evaluate(()=>({synthetic:true,nodes:2248,edges:3119,workerMs:Math.round(window.layoutElapsed),elapsedMs:Math.round(performance.now()-window.loadStart),longTasks:window.longTasks.map(Math.round)}));
  if (profiler) { const profile=await profiler.send('Profiler.stop'); await writeFile(join(output,'cpu-profile.json'),JSON.stringify(profile)); }
  await shot('synthetic-load-overview');
  results.push(performanceReport);
  await page.emulateMedia({reducedMotion:'reduce'});
  await range('К центру', 1.2);
  assert.ok(await page.evaluate(()=>new Set(window.motionSamples.map(p=>JSON.stringify(p))).size <= 2));
  results.push('Reduced motion does not interpolate layout frames: passed');

  // Hide an in-flight large layout; no background worker may survive invisibility.
  await page.getByRole('slider', {name:'К центру',exact:true}).fill('1.4');
  await page.waitForFunction(() => window.workerAlive===1);
  await page.locator('.aml-graph').evaluate(el=>{el.style.display='none'});
  await page.waitForFunction(() => window.workerAlive===0);
  await page.locator('.aml-graph').evaluate(el=>{el.style.display=''});
  await page.waitForFunction(() => window.workerAlive===1);
  await settled();
  results.push('Hidden block cancels an active worker and resumes safely on reveal: passed');

  await page.evaluate(() => {window.setGraph(window.fixture);window.setSelected(null)}); await settled();
  await page.evaluate(() => {window.Worker=class {constructor(){throw new Error('Simulated worker startup failure')}}});
  const beforeFailure=await state();
  await page.getByRole('slider', {name:'К центру',exact:true}).fill('1.6');
  await page.getByRole('alert').filter({hasText:'Раскладка недоступна'}).waitFor();
  assert.deepEqual((await state()).nodes.map(n=>n.position),beforeFailure.nodes.map(n=>n.position));
  assert.equal(await page.evaluate(()=>window.workerAlive),0);
  results.push('Worker failure retains nodes and positions and displays an actionable error: passed');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, output }, null, 2));
} finally { if(errors.length) console.error(errors); await browser.close(); }
