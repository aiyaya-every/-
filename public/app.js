'use strict';

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(iso) {
  if (!iso) return '未提供';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString('zh-CN', { hour12: false });
}

function fieldLabel(f) {
  return { requirements: '岗位要求', deadline: '截止时间', status: '招聘状态' }[f] || f;
}

function valText(v, field) {
  if (v == null || v === '') return '未提供';
  if (field === 'status') return v === 'closed' ? '已关闭' : v === 'open' ? '招聘中' : String(v);
  return String(v);
}

function statusBadge(status, isReplay) {
  if (status === 'closed') return '<span class="badge closed">已关闭</span>';
  if (status === 'open') return '<span class="badge open">招聘中</span>';
  return '<span class="badge">未提供</span>';
}

let toastTimer = null;
function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

// ---------- API ----------
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) {
    showLogin();
    throw new Error((data && data.error) || '未登录');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || ('请求失败 (' + res.status + ')'));
  }
  return data;
}

// ---------- state ----------
let currentUser = null;

// ---------- auth / shell ----------
function showLogin() {
  currentUser = null;
  $('#topbar').classList.add('hidden');
  $('#view').innerHTML = '';
  $('#login-view').classList.remove('hidden');
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#user-name').textContent = currentUser.displayName + '（' + (currentUser.role === 'maintainer' ? '数据维护' : '普通用户') + '）';
  $('#nav-collect').classList.toggle('hidden', currentUser.role !== 'maintainer');
  route();
}

async function init() {
  try {
    const { user } = await api('GET', '/api/auth/me');
    currentUser = user;
    showApp();
  } catch {
    showLogin();
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#login-error');
  errEl.classList.add('hidden');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { user } = await api('POST', '/api/auth/login', {
      username: $('#login-username').value.trim(),
      password: $('#login-password').value,
    });
    currentUser = user;
    location.hash = '#/search';
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch {}
  showLogin();
});

// ---------- router ----------
function route() {
  const hash = location.hash || '#/search';
  const [pathPart] = hash.slice(1).split('?');
  const seg = pathPart.split('/').filter(Boolean); // e.g. ['job','12']
  setActiveNav(seg[0] || 'search');
  if (seg[0] === 'job' && seg[1]) return renderDetail(Number(seg[1]));
  if (seg[0] === 'follows') return renderFollows();
  if (seg[0] === 'feed') return renderFeed();
  if (seg[0] === 'collect') return renderCollect();
  return renderSearch();
}

function setActiveNav(name) {
  document.querySelectorAll('#main-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
}

window.addEventListener('hashchange', () => {
  if (currentUser) route();
});

// ---------- search ----------
let cities = [];

async function renderSearch() {
  $('#view').innerHTML = `
    <div class="panel">
      <div class="search-bar">
        <div class="field">
          <label>关键词（匹配岗位名称或岗位要求）</label>
          <input id="s-kw" placeholder="如 后端 / Java / 产品">
        </div>
        <div class="field">
          <label>城市</label>
          <input id="s-city" list="city-list" placeholder="如 深圳">
          <datalist id="city-list"></datalist>
        </div>
        <div class="field">
          <label>来源</label>
          <select id="s-source">
            <option value="">全部来源</option>
            <option value="company_careers">官方招聘网站</option>
            <option value="recruitment_platform">招聘平台</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn btn-primary" id="s-btn">搜索</button>
        </div>
      </div>
      <div class="row mt">
        <label>保存为筛选方案：</label>
        <input id="f-name" placeholder="方案名称" style="max-width:220px">
        <button class="btn" id="f-save">保存</button>
        <span class="spacer"></span>
        <select id="f-select" style="max-width:260px"><option value="">— 已保存的方案 —</option></select>
        <button class="btn btn-sm" id="f-use">使用</button>
        <button class="btn btn-sm btn-danger" id="f-del">删除</button>
      </div>
    </div>
    <div class="panel">
      <h2>岗位列表 <span id="job-count" class="muted small"></span></h2>
      <div id="job-results"></div>
    </div>`;

  try {
    const { cities: cs } = await api('GET', '/api/jobs/cities');
    cities = cs || [];
    $('#city-list').innerHTML = cities.map((c) => `<option value="${esc(c)}">`).join('');
  } catch {}

  $('#s-btn').addEventListener('click', doSearch);
  $('#s-kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#s-city').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#f-save').addEventListener('click', saveFilter);
  $('#f-use').addEventListener('click', useFilter);
  $('#f-del').addEventListener('click', delFilter);

  await loadFilters();
  await doSearch();
}

async function doSearch() {
  const params = new URLSearchParams();
  const kw = $('#s-kw').value.trim();
  const city = $('#s-city').value.trim();
  const source = $('#s-source').value;
  if (kw) params.set('keyword', kw);
  if (city) params.set('city', city);
  if (source) params.set('sourceType', source);

  const results = $('#job-results');
  results.innerHTML = '<div class="muted">加载中…</div>';
  try {
    const { jobs } = await api('GET', '/api/jobs?' + params.toString());
    $('#job-count').textContent = '共 ' + jobs.length + ' 条';
    if (!jobs.length) {
      results.innerHTML = `
        <div class="empty">
          <p>暂无匹配的岗位数据。</p>
          <p class="small">首次使用请先由<strong>数据维护账号</strong>在「采集管理」中从真实来源采集岗位，
          或导入标注清晰的回放快照（仅用于验证变更逻辑，不替代真实采集）。</p>
          ${currentUser.role === 'maintainer' ? '<a class="btn btn-primary" href="#/collect">去采集</a>' : ''}
        </div>`;
      return;
    }
    results.innerHTML = '<div class="job-list">' + jobs.map(jobCard).join('') + '</div>';
    results.querySelectorAll('[data-follow]').forEach((b) => b.addEventListener('click', onFollow));
  } catch (err) {
    results.innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
  }
}

function jobCard(j) {
  return `
    <div class="job-card">
      <div class="row1">
        <a class="title" href="#/job/${j.id}">${esc(j.title)}</a>
        ${statusBadge(j.status)}
        ${j.is_replay ? '<span class="badge replay">回放</span>' : ''}
      </div>
      <div class="meta">
        <span>🏢 ${esc(j.company)}</span>
        <span>📍 ${esc(valText(j.city))}</span>
        <span>来源：${esc(j.source_name)}</span>
        <span>抓取：${fmtTime(j.last_collected_at)}</span>
      </div>
      ${j.requirements ? `<div class="req">${esc(j.requirements)}</div>` : '<div class="req muted">岗位要求：未提供</div>'}
      <div class="actions">
        <button class="btn btn-sm ${j.followed ? 'btn-danger' : ''}" data-follow="${j.id}" data-followed="${j.followed ? 1 : 0}">
          ${j.followed ? '取消关注' : '关注'}
        </button>
        ${j.detail_url ? `<a class="btn btn-sm" href="${esc(j.detail_url)}" target="_blank" rel="noopener">原始链接 ↗</a>` : ''}
      </div>
    </div>`;
}

async function onFollow(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.follow;
  const followed = btn.dataset.followed === '1';
  btn.disabled = true;
  try {
    await api(followed ? 'DELETE' : 'POST', `/api/jobs/${id}/follow`);
    toast(followed ? '已取消关注' : '已关注');
    await doSearch();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
}

// ---------- saved filters ----------
async function loadFilters() {
  const sel = $('#f-select');
  try {
    const { filters } = await api('GET', '/api/filters');
    sel.innerHTML = '<option value="">— 已保存的方案 —</option>' +
      filters.map((f) => `<option value="${f.id}">${esc(f.name)}${f.keyword || f.city ? '（' + [f.keyword, f.city].filter(Boolean).join(' / ') + '）' : ''}</option>`).join('');
  } catch {}
}

async function saveFilter() {
  const name = $('#f-name').value.trim();
  if (!name) return toast('请填写方案名称', true);
  try {
    await api('POST', '/api/filters', { name, keyword: $('#s-kw').value.trim(), city: $('#s-city').value.trim() });
    toast('已保存筛选方案');
    $('#f-name').value = '';
    await loadFilters();
  } catch (err) { toast(err.message, true); }
}

async function useFilter() {
  const id = $('#f-select').value;
  if (!id) return toast('请先选择一个方案', true);
  try {
    const { filters } = await api('GET', '/api/filters');
    const f = filters.find((x) => String(x.id) === String(id));
    if (!f) return toast('方案不存在', true);
    $('#s-kw').value = f.keyword || '';
    $('#s-city').value = f.city || '';
    await doSearch();
    toast('已使用方案：' + f.name);
  } catch (err) { toast(err.message, true); }
}

async function delFilter() {
  const id = $('#f-select').value;
  if (!id) return toast('请先选择一个方案', true);
  try {
    await api('DELETE', '/api/filters/' + id);
    toast('已删除方案');
    await loadFilters();
  } catch (err) { toast(err.message, true); }
}

// ---------- detail ----------
async function renderDetail(id) {
  $('#view').innerHTML = '<div class="panel muted">加载中…</div>';
  try {
    const { job, changes } = await api('GET', '/api/jobs/' + id);
    $('#view').innerHTML = `
      <div class="panel">
        <div class="row">
          <h2 style="margin:0">${esc(job.title)}</h2>
          ${statusBadge(job.status)}
          ${job.is_replay ? '<span class="badge replay">回放</span>' : ''}
          <span class="spacer"></span>
          <button class="btn ${job.followed ? 'btn-danger' : 'btn-primary'}" id="d-follow" data-followed="${job.followed ? 1 : 0}">
            ${job.followed ? '取消关注' : '关注该岗位'}
          </button>
        </div>
        <div class="kv mt">
          <div class="k">公司</div><div class="v">${esc(job.company || '未提供')}</div>
          <div class="k">城市</div><div class="v">${esc(valText(job.city))}</div>
          <div class="k">岗位要求</div><div class="v">${esc(valText(job.requirements))}</div>
          <div class="k">截止时间</div><div class="v">${esc(valText(job.deadline))}</div>
          <div class="k">招聘状态</div><div class="v">${valText(job.status, 'status')}</div>
          <div class="k">来源</div><div class="v">${esc(job.source_name)}（${job.source_type === 'company_careers' ? '官方招聘网站' : '招聘平台'}）</div>
          <div class="k">原始链接</div><div class="v">${job.detail_url ? `<a href="${esc(job.detail_url)}" target="_blank" rel="noopener">${esc(job.detail_url)}</a>` : '未提供'}</div>
          <div class="k">最近抓取</div><div class="v">${fmtTime(job.last_collected_at)}</div>
        </div>
      </div>
      <div class="panel">
        <h2>变更历史</h2>
        ${changes.length ? `
          <table>
            <thead><tr><th>时间</th><th>字段</th><th>修改前</th><th>修改后</th><th>依据</th></tr></thead>
            <tbody>
              ${changes.map((c) => `
                <tr>
                  <td>${fmtTime(c.changed_at)}</td>
                  <td>${fieldLabel(c.field)}</td>
                  <td class="wrap">${esc(valText(c.before, c.field))}</td>
                  <td class="wrap">${esc(valText(c.after, c.field))}</td>
                  <td class="wrap">${esc(c.evidence || '')}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<p class="muted">暂无变更记录。</p>'}
      </div>`;
    $('#d-follow').addEventListener('click', async () => {
      const followed = $('#d-follow').dataset.followed === '1';
      try {
        await api(followed ? 'DELETE' : 'POST', `/api/jobs/${id}/follow`);
        toast(followed ? '已取消关注' : '已关注');
        renderDetail(id);
      } catch (err) { toast(err.message, true); }
    });
  } catch (err) {
    $('#view').innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- follows ----------
async function renderFollows() {
  $('#view').innerHTML = '<div class="panel muted">加载中…</div>';
  try {
    const { follows } = await api('GET', '/api/follows');
    if (!follows.length) {
      $('#view').innerHTML = '<div class="panel"><h2>我的关注</h2><div class="empty">尚未关注任何岗位。</div></div>';
      return;
    }
    $('#view').innerHTML = `
      <div class="panel">
        <h2>我的关注 <span class="muted small">共 ${follows.length} 条</span></h2>
        <div class="job-list">
          ${follows.map((f) => `
            <div class="job-card">
              <div class="row1">
                <a class="title" href="#/job/${f.job_id}">${esc(f.title)}</a>
                ${statusBadge(f.status)}
                ${f.is_replay ? '<span class="badge replay">回放</span>' : ''}
              </div>
              <div class="meta"><span>🏢 ${esc(f.company)}</span><span>📍 ${esc(valText(f.city))}</span><span>来源：${esc(f.source_name)}</span><span>关注于 ${fmtTime(f.followed_at)}</span></div>
              <div class="actions"><button class="btn btn-sm btn-danger" data-unfollow="${f.job_id}">取消关注</button></div>
            </div>`).join('')}
        </div>
      </div>`;
    $('#view').querySelectorAll('[data-unfollow]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api('DELETE', '/api/jobs/' + b.dataset.unfollow + '/follow');
        toast('已取消关注');
        renderFollows();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    $('#view').innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- feed ----------
async function renderFeed() {
  $('#view').innerHTML = '<div class="panel muted">加载中…</div>';
  try {
    const { events } = await api('GET', '/api/feed');
    if (!events.length) {
      $('#view').innerHTML = '<div class="panel"><h2>关注动态</h2><div class="empty">暂无关注动态。关注岗位后，其岗位要求/截止时间/招聘状态发生变化时会在此显示。</div></div>';
      return;
    }
    $('#view').innerHTML = `
      <div class="panel">
        <h2>关注动态 <span class="muted small">共 ${events.length} 条</span></h2>
        ${events.map((e) => `
          <div class="feed-item">
            <div class="row"><a class="title" href="#/job/${e.job_id}">${esc(e.job_title)}</a><span class="muted small">${esc(e.source_name)} · ${fmtTime(e.created_at)}</span></div>
            <div class="mt">${fieldLabel(e.field)}：
              <span class="diff"><span class="before">${esc(valText(e.before, e.field))}</span> → <span class="after">${esc(valText(e.after, e.field))}</span></span>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    $('#view').innerHTML = `<div class="error">加载失败：${esc(err.message)}</div>`;
  }
}

// ---------- collect (maintainer) ----------
async function renderCollect() {
  if (currentUser.role !== 'maintainer') {
    $('#view').innerHTML = '<div class="error">无权限：采集管理仅数据维护账号可访问。</div>';
    return;
  }
  $('#view').innerHTML = `
    <div class="panel">
      <h2>采集管理</h2>
      <div class="row">
        <button class="btn btn-primary" id="c-all">采集全部来源</button>
        <span class="muted small">手动触发，从真实公开来源抓取岗位。单个来源失败不会清空已有数据。</span>
      </div>
      <div id="c-sources" class="mt"></div>
    </div>
    <div class="panel">
      <h2>导入回放快照（仅验证变更逻辑，不冒充真实抓取）</h2>
      <div class="row">
        <select id="c-rp-source">
          <option value="tencent">腾讯招聘</option>
          <option value="zhaopin">智联招聘</option>
        </select>
        <input id="c-rp-label" placeholder="回放标注，如：回放-改要求" style="max-width:260px">
      </div>
      <textarea id="c-rp-jobs" class="mt" placeholder='JSON 快照 jobs 数组，形如：[{"identity":"100","title":"后端工程师","company":"腾讯","city":"深圳","requirements":"要求：熟悉 Go","deadline":null,"status":"open","detailUrl":"https://..."}]'></textarea>
      <div class="row mt">
        <button class="btn btn-primary" id="c-rp-go">导入回放</button>
        <button class="btn btn-danger" id="c-rp-fail">模拟该来源失败</button>
      </div>
    </div>
    <div class="panel">
      <h2>采集执行记录</h2>
      <div id="c-runs" class="mt"></div>
    </div>`;

  $('#c-all').addEventListener('click', async () => {
    $('#c-all').disabled = true;
    try {
      const { results } = await api('POST', '/api/collect', { all: true });
      toast('采集完成');
      renderCollect();
    } catch (err) { toast(err.message, true); $('#c-all').disabled = false; }
  });
  $('#c-rp-go').addEventListener('click', async () => {
    try {
      const jobs = JSON.parse($('#c-rp-jobs').value || '[]');
      if (!Array.isArray(jobs)) throw new Error('jobs 必须是数组');
      const r = await api('POST', '/api/collect/replay', { sourceId: $('#c-rp-source').value, jobs, label: $('#c-rp-label').value.trim() || '回放快照' });
      toast('回放完成：新增 ' + r.run.new_count + '，变更 ' + r.run.changed_count + '，无变化 ' + r.run.unchanged_count);
      renderCollect();
    } catch (err) { toast('回放失败：' + err.message, true); }
  });
  $('#c-rp-fail').addEventListener('click', async () => {
    try {
      await api('POST', '/api/collect/replay', { sourceId: $('#c-rp-source').value, label: $('#c-rp-label').value.trim() || '回放-来源失败', kind: 'source_failure', failureReason: '模拟来源超时' });
      toast('已记录来源失败（已有数据保留）');
      renderCollect();
    } catch (err) { toast(err.message, true); }
  });

  await renderSources();
  await renderRuns();
}

async function renderSources() {
  const el = $('#c-sources');
  try {
    const { sources } = await api('GET', '/api/sources');
    el.innerHTML = sources.map((s) => {
      const r = s.lastRun;
      const st = r ? (r.status === 'success' ? '成功' : r.status === 'partial' ? '部分成功' : '失败') : '未采集';
      return `
        <div class="job-card">
          <div class="row1"><span class="title">${esc(s.name)}</span>
            <span class="badge">${s.source_type === 'company_careers' ? '官方招聘网站' : '招聘平台'}</span>
            <span class="badge ${r && r.status === 'failed' ? 'closed' : 'open'}">${st}</span>
            ${r && r.is_replay ? '<span class="badge replay">回放</span>' : ''}
          </div>
          <div class="meta"><span>入口：${esc(s.entry_url)}</span>
            ${r ? `<span>新增 ${r.new_count} / 更新 ${r.changed_count} / 无变化 ${r.unchanged_count} / 失败 ${r.failed_count}</span><span>${fmtTime(r.finished_at || r.started_at)}</span>` : ''}
          </div>
          <div class="actions"><button class="btn btn-sm btn-primary" data-collect="${s.source_id}">采集该来源</button></div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-collect]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = '采集中…';
      try {
        const { run } = await api('POST', '/api/collect', { sourceId: b.dataset.collect });
        toast(run.status === 'failed' ? ('采集失败：' + (run.error_message || '')) : ('采集完成：新增 ' + run.new_count + '，更新 ' + run.changed_count));
        renderCollect();
      } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '采集该来源'; }
    }));
  } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

async function renderRuns() {
  const el = $('#c-runs');
  try {
    const { runs } = await api('GET', '/api/collect/runs');
    if (!runs.length) { el.innerHTML = '<p class="muted">暂无执行记录。</p>'; return; }
    el.innerHTML = `<table>
      <thead><tr><th>来源</th><th>类型</th><th>状态</th><th>HTTP</th><th>抓取</th><th>有效</th><th>新增</th><th>更新</th><th>无变化</th><th>失败</th><th>开始时间</th><th>错误</th></tr></thead>
      <tbody>${runs.map((r) => `
        <tr>
          <td>${esc(r.source_name)}</td>
          <td>${r.is_replay ? '<span class="badge replay">回放</span>' : '真实采集'}</td>
          <td>${r.status === 'success' ? '成功' : r.status === 'partial' ? '部分' : '失败'}</td>
          <td>${r.http_status != null ? r.http_status : '-'}</td>
          <td>${r.fetched_count}</td><td>${r.valid_count}</td><td>${r.new_count}</td><td>${r.changed_count}</td><td>${r.unchanged_count}</td><td>${r.failed_count}</td>
          <td>${fmtTime(r.started_at)}</td>
          <td class="wrap">${esc(r.error_message || '')}</td>
        </tr>`).join('')}</tbody></table>`;
  } catch (err) { el.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

// ---------- boot ----------
init();
