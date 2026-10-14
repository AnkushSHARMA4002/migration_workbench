(function () {
  const root = document.getElementById('app');
  const toastBox = document.getElementById('toasts');
  const store = {
    token: localStorage.getItem('mw_token'),
    email: localStorage.getItem('mw_email'),
    meta: null,
    project: null,
    tab: 'source',
    issues: [],
    logs: [],
    targetFilter: '',
    token_seq: 0
  };

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value' || key === 'disabled' || key === 'selected' || key === 'checked') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }

  function fill(el, ...children) {
    el.replaceChildren();
    append(el, children);
  }

  function mount(...nodes) {
    fill(root, nodes);
  }

  function toast(message, kind) {
    const el = h('div', { class: `toast ${kind || ''}` }, message);
    toastBox.append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
  }

  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }
    if (res.status === 401 && store.token && !path.startsWith('/login') && !path.startsWith('/register')) {
      signOut();
      throw new Error('Your session expired. Sign in again.');
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw new Error(data && data.error ? data.error.message : `Request failed (${res.status})`);
    return data;
  }

  async function busy(button, label, fn) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await fn();
    } catch (err) {
      toast(err.message, 'error');
      return undefined;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function signOut() {
    store.token = null;
    store.email = null;
    localStorage.removeItem('mw_token');
    localStorage.removeItem('mw_email');
    location.hash = '#/login';
    route();
  }

  function loading(text) {
    return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), text || 'Loading');
  }

  function chip(text, kind) {
    return h('span', { class: `chip ${kind || ''}` }, text);
  }

  function statusChip(status) {
    const map = { draft: ['Draft', ''], planned: ['Plan to review', 'warn'], approved: ['Plan approved', 'accent'], migrated: ['Migrated', 'accent'], reconciled: ['Reconciled', 'ok'] };
    const [label, kind] = map[status] || [status, ''];
    return chip(label, kind);
  }

  function topbar() {
    return h('header', { class: 'topbar' },
      h('a', { class: 'brand', onclick: () => { location.hash = '#/'; } }, 'Migration Workbench'),
      store.token ? h('div', { class: 'who' }, h('span', {}, store.email), h('button', { class: 'btn ghost small', onclick: signOut }, 'Sign out')) : null
    );
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function renderLogin() {
    let mode = 'login';
    const view = h('div', { class: 'auth' });
    function draw(errorMessage) {
      const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, value: view.dataset.email || '' });
      const password = h('input', { type: 'password', id: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
      const submit = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account');
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          view.dataset.email = email.value;
          if (!email.value.includes('@')) return draw('Enter a valid email address');
          if (password.value.length < 8) return draw('Password must be at least 8 characters');
          const result = await busy(submit, 'Please wait', async () => api(mode === 'login' ? '/login' : '/register', { method: 'POST', body: { email: email.value, password: password.value } }));
          if (!result) return;
          store.token = result.token;
          store.email = result.email;
          localStorage.setItem('mw_token', result.token);
          localStorage.setItem('mw_email', result.email);
          location.hash = '#/';
          route();
        }
      },
        h('h1', {}, mode === 'login' ? 'Sign in' : 'Create account'),
        h('p', { class: 'muted' }, 'Plan a data migration with an AI agent, approve what it proposes, then reconcile the result.'),
        errorMessage ? h('div', { class: 'banner bad', role: 'alert' }, errorMessage) : null,
        h('label', { class: 'field' }, h('span', {}, 'Email'), email),
        h('label', { class: 'field' }, h('span', {}, 'Password'), password),
        h('div', { class: 'row' },
          submit,
          h('button', { class: 'btn', type: 'button', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Create an account' : 'I have an account')
        ),
        mode === 'login' ? h('p', { class: 'muted', style: 'margin-top:16px' }, 'Reviewing? ',
          h('button', { class: 'btn small', type: 'button', onclick: () => { email.value = 'reviewer@example.com'; password.value = 'Review@123'; } }, 'Fill demo credentials')) : null
      );
      fill(view, form);
    }
    draw();
    mount(topbar(), h('div', { class: 'page' }, view));
  }

  async function renderProjects() {
    mount(topbar(), h('div', { class: 'page' }, loading('Loading projects')));
    let projects;
    try {
      store.meta = await api('/me');
      projects = (await api('/projects')).projects;
    } catch (err) {
      mount(topbar(), h('div', { class: 'page' }, h('div', { class: 'banner bad', role: 'alert' }, err.message), h('button', { class: 'btn', onclick: renderProjects }, 'Try again')));
      return;
    }

    const name = h('input', { type: 'text', id: 'p-name', placeholder: 'Legacy customers to CRM' });
    const keyField = h('input', { type: 'text', id: 'p-key', placeholder: 'customer_id' });
    const csv = h('textarea', { id: 'p-csv', placeholder: 'Paste CSV with a header row, or choose a file below' });
    const schema = h('textarea', { id: 'p-schema', placeholder: '[{"name":"customer_id","type":"string","required":true}]' });
    const file = h('input', {
      type: 'file', accept: '.csv,text/csv',
      onchange: async () => { if (file.files[0]) csv.value = await file.files[0].text(); }
    });
    const errors = { name: h('span', { class: 'error-text' }), csv: h('span', { class: 'error-text' }), schema: h('span', { class: 'error-text' }) };
    const create = h('button', { class: 'btn primary', type: 'submit' }, 'Create project');
    const sample = h('button', { class: 'btn', type: 'button' }, 'Create sample project');

    function setError(key, input, message) {
      errors[key].textContent = message || '';
      input.closest('.field').classList.toggle('invalid', Boolean(message));
    }

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        let ok = true;
        const nameValue = name.value.trim();
        if (nameValue.length < 3) { setError('name', name, 'Enter a name of at least 3 characters'); ok = false; } else setError('name', name, '');
        if (!csv.value.trim()) { setError('csv', csv, 'Add the source CSV'); ok = false; } else setError('csv', csv, '');
        let schemaValue = null;
        try { schemaValue = JSON.parse(schema.value); setError('schema', schema, ''); } catch { setError('schema', schema, 'Target schema must be valid JSON'); ok = false; }
        if (!ok) return;
        const result = await busy(create, 'Creating', () => api('/projects', { method: 'POST', body: { name: nameValue, sourceCsv: csv.value, targetSchema: schemaValue, keyField: keyField.value.trim() || null } }));
        if (result) { toast('Project created', 'ok'); location.hash = `#/p/${result.id}/source`; }
      }
    },
      h('label', { class: 'field' }, h('span', {}, 'Project name'), name, errors.name),
      h('label', { class: 'field' }, h('span', {}, 'Source CSV'), file, csv, errors.csv),
      h('label', { class: 'field' }, h('span', {}, 'Target schema (JSON)'), schema,
        h('span', { class: 'hint' }, 'Types: string, number, integer, boolean, date, email. Add "required": true where needed.'), errors.schema),
      h('label', { class: 'field' }, h('span', {}, 'Key field (optional)'), keyField,
        h('span', { class: 'hint' }, 'Target field that must be unique. Used to detect duplicates.')),
      h('div', { class: 'row' }, create, sample)
    );
    sample.addEventListener('click', async () => {
      const result = await busy(sample, 'Creating', () => api('/projects/sample', { method: 'POST' }));
      if (result) { toast('Sample project created', 'ok'); location.hash = `#/p/${result.id}/source`; }
    });

    const list = projects.length === 0
      ? h('div', { class: 'empty' }, h('h3', {}, 'No migration projects yet'), h('p', {}, 'Create one from your own CSV, or start with the sample legacy customer file to see the full workflow.'))
      : projects.map((p) => h('div', { class: 'project-item', tabindex: '0', role: 'link',
          onclick: () => { location.hash = `#/p/${p.id}/source`; },
          onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/p/${p.id}/source`; } },
          h('div', {}, h('strong', {}, p.name), h('span', { class: 'muted' }, `${p.rowCount} rows, updated ${formatDate(p.updatedAt)}`)),
          statusChip(p.status)));

    mount(topbar(), h('div', { class: 'page' },
      h('div', { class: 'layout-projects' },
        h('section', { class: 'card' }, h('h2', {}, 'New migration project'), form),
        h('section', {}, h('h2', {}, 'Your projects'), h('div', { class: 'card flat' }, list))
      )
    ));
  }

  const TABS = [['source', 'Source and target'], ['plan', 'Plan and review'], ['migrate', 'Migrate'], ['reconcile', 'Reconcile'], ['logs', 'Logs']];

  function stageState(p, key) {
    const pending = p.mappings.filter((m) => m.status === 'pending').length;
    const loaded = Object.values(p.targetCounts).reduce((a, b) => a + b, 0);
    if (key === 'source') return 'done';
    if (key === 'plan') return p.mappings.length === 0 ? '' : pending ? 'attention' : 'done';
    if (key === 'migrate') return loaded ? 'done' : '';
    if (key === 'reconcile') return !p.reconciliation ? '' : (p.issueCounts.pending ? 'attention' : 'done');
    return '';
  }

  async function renderProject(id, tab) {
    store.tab = tab;
    if (!store.project || store.project.id !== Number(id)) {
      mount(topbar(), h('div', { class: 'page' }, loading('Loading project')));
      try {
        store.project = (await api(`/projects/${id}`)).project;
        store.meta = store.meta || await api('/me');
      } catch (err) {
        store.project = null;
        mount(topbar(), h('div', { class: 'page' }, h('div', { class: 'banner bad', role: 'alert' }, err.message), h('button', { class: 'btn', onclick: () => { location.hash = '#/'; } }, 'Back to projects')));
        return;
      }
    }
    drawProject();
  }

  function drawProject() {
    const p = store.project;
    const stages = h('nav', { class: 'stages', 'aria-label': 'Workflow stages' },
      TABS.map(([key, label]) => h('button', { class: `stage ${store.tab === key ? 'active' : ''}`, onclick: () => { location.hash = `#/p/${p.id}/${key}`; } },
        h('span', { class: `dot ${stageState(p, key)}` }), label)));
    const body = h('div', {});
    mount(topbar(), h('div', { class: 'page' },
      h('div', { class: 'card-head' },
        h('div', {}, h('p', { class: 'muted', style: 'margin:0' }, h('a', { href: '#/' }, 'Projects')), h('h1', {}, p.name)),
        h('div', { class: 'row' }, statusChip(p.status),
          h('button', { class: 'btn danger small', onclick: async (e) => {
            if (!confirm(`Delete "${p.name}" and all of its data?`)) return;
            const done = await busy(e.target, 'Deleting', () => api(`/projects/${p.id}`, { method: 'DELETE' }));
            if (done) { store.project = null; toast('Project deleted', 'ok'); location.hash = '#/'; }
          } }, 'Delete'))),
      h('div', { class: 'workspace' }, stages, body)));
    const views = { source: viewSource, plan: viewPlan, migrate: viewMigrate, reconcile: viewReconcile, logs: viewLogs };
    (views[store.tab] || viewSource)(body, p);
  }

  function refresh(project) {
    if (project) store.project = project;
    drawProject();
  }

  function table(headers, rows, opts = {}) {
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows)));
  }

  function viewSource(body, p) {
    const cols = p.sourceColumns;
    body.append(
      h('section', { class: 'card' },
        h('h2', {}, 'Source data'),
        h('p', { class: 'muted' }, `${p.rowCount} rows and ${cols.length} columns. Showing the first ${p.sourceSample.length} rows.`),
        table(['#', ...cols], p.sourceSample.map((r) => h('tr', {}, h('td', { class: 'mono' }, r.rowIndex), cols.map((c) => h('td', { class: 'mono' }, r[c])))))),
      h('section', { class: 'card' },
        h('h2', {}, 'Target schema'),
        p.keyField ? h('p', { class: 'muted' }, `Key field: ${p.keyField}`) : h('p', { class: 'muted' }, 'No key field set, so duplicates will not be checked.'),
        table(['Field', 'Type', 'Required', 'Default'], p.targetSchema.map((f) => h('tr', {},
          h('td', { class: 'mono' }, f.name), h('td', {}, f.type), h('td', {}, f.required ? chip('required', 'warn') : 'optional'), h('td', { class: 'mono' }, f.default || '')))),
        h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn primary', onclick: () => { location.hash = `#/p/${p.id}/plan`; } }, 'Continue to planning')))
    );
  }

  function confidenceBar(value) {
    const pct = Math.round(value * 100);
    return h('span', { title: `${pct}% confidence` }, h('span', { class: `bar ${value < 0.6 ? 'low' : ''}` }, h('i', { style: `width:${pct}%` })), ' ', h('span', { class: 'muted' }, `${pct}%`));
  }

  function mappingStatusChip(status) {
    return chip({ pending: 'Needs review', approved: 'Approved', rejected: 'Rejected' }[status] || status, { pending: 'warn', approved: 'ok', rejected: 'bad' }[status]);
  }

  function viewPlan(body, p) {
    const llm = store.meta ? store.meta.llm : null;
    const agentNote = llm && llm.configured
      ? `The agent will use ${llm.provider} (${llm.model}).`
      : 'No LLM API key is configured on the server, so a rule-based fallback will draft the plan.';
    const generate = h('button', { class: 'btn primary' }, p.plan ? 'Regenerate plan' : 'Generate migration plan');
    generate.addEventListener('click', async () => {
      if (p.plan && !confirm('Regenerating clears every approval, migrated row and reconciliation result. Continue?')) return;
      body.querySelectorAll('.card').forEach((c) => { c.style.opacity = '0.6'; });
      const result = await busy(generate, 'Agent is planning', () => api(`/projects/${p.id}/plan`, { method: 'POST' }));
      if (result) { toast('Plan ready for your review', 'ok'); refresh(result.project); } else drawProject();
    });

    if (!p.plan) {
      body.append(h('section', { class: 'card' },
        h('div', { class: 'empty' },
          h('h3', {}, 'No plan yet'),
          h('p', {}, 'The agent reads your columns and sample rows, then proposes how each target field is filled. Nothing runs until you approve each mapping.'),
          h('p', { class: 'muted' }, agentNote), generate)));
      return;
    }

    const pending = p.mappings.filter((m) => m.status === 'pending').length;
    const approveConfident = h('button', { class: 'btn' }, 'Approve confident mappings');
    approveConfident.addEventListener('click', async () => {
      const result = await busy(approveConfident, 'Approving', () => api(`/projects/${p.id}/mappings/approve-confident`, { method: 'POST' }));
      if (result) { toast(`${result.approved} mapping(s) approved`, 'ok'); refresh(result.project); }
    });

    body.append(
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h2', {}, 'Agent plan'), h('p', { class: 'muted', style: 'margin:0' }, `Drafted by ${p.plan.source}`)),
          generate),
        h('p', {}, p.plan.summary),
        p.plan.risks.length ? [h('h3', {}, 'Risks to check'), h('ul', { class: 'plain' }, p.plan.risks.map((r) => h('li', {}, r)))] : null),
      h('section', { class: 'card flat' },
        h('div', { class: 'card-head', style: 'padding:16px 20px 0' },
          h('div', {}, h('h2', {}, 'Field mappings'),
            h('p', { class: 'muted' }, pending ? `${pending} mapping(s) still need a decision. Migration stays locked until you review them all.` : 'Every mapping has a decision.')),
          approveConfident),
        table(['Target field', 'Source column', 'Transform', 'Default', 'Confidence', 'Why', 'Status', 'Decision'],
          p.mappings.map((m) => mappingRow(p, m))))
    );
  }

  function mappingRow(p, m) {
    const field = p.targetSchema.find((f) => f.name === m.targetField);
    const source = h('select', { 'aria-label': `Source column for ${m.targetField}` },
      h('option', { value: '' }, 'No source column'),
      p.sourceColumns.map((c) => h('option', { value: c, selected: c === m.sourceField }, c)));
    const transform = h('select', { 'aria-label': `Transform for ${m.targetField}` },
      store.meta.transforms.map((t) => h('option', { value: t, selected: t === m.transform }, t)));
    const def = h('input', { type: 'text', 'aria-label': `Default for ${m.targetField}`, value: m.defaultValue || '' });
    const approve = h('button', { class: 'btn small primary' }, 'Approve');
    const reject = h('button', { class: 'btn small' }, 'Reject');

    function changes() {
      const out = {};
      if ((source.value || null) !== m.sourceField) out.sourceField = source.value;
      if (transform.value !== m.transform) out.transform = transform.value;
      if ((def.value || '') !== (m.defaultValue || '')) out.defaultValue = def.value;
      return out;
    }
    async function decide(button, decision, label) {
      const result = await busy(button, label, () => api(`/mappings/${m.id}`, { method: 'PATCH', body: { ...changes(), decision } }));
      if (result) refresh(result.project);
    }
    approve.addEventListener('click', () => decide(approve, 'approve', 'Saving'));
    reject.addEventListener('click', () => decide(reject, 'reject', 'Saving'));

    return h('tr', {},
      h('td', {}, h('span', { class: 'mono' }, m.targetField), h('div', { class: 'muted' }, `${field.type}${field.required ? ', required' : ''}`)),
      h('td', {}, source), h('td', {}, transform), h('td', {}, def),
      h('td', {}, confidenceBar(m.confidence)),
      h('td', { style: 'min-width:200px' }, m.rationale, m.edited ? h('div', {}, chip('edited by you', 'accent')) : null),
      h('td', {}, mappingStatusChip(m.status)),
      h('td', {}, h('div', { class: 'row' }, approve, reject)));
  }

  function viewMigrate(body, p) {
    const pending = p.mappings.filter((m) => m.status === 'pending').length;
    const approved = p.mappings.filter((m) => m.status === 'approved').length;
    const counts = p.targetCounts;
    const total = (counts.ok || 0) + (counts.failed || 0) + (counts.excluded || 0);
    let blocker = null;
    if (!p.mappings.length) blocker = 'Generate a plan first.';
    else if (pending) blocker = `${pending} mapping(s) still need review.`;
    else if (!approved) blocker = 'Approve at least one mapping.';

    const run = h('button', { class: 'btn primary', disabled: Boolean(blocker) }, total ? 'Run migration again' : 'Run migration');
    run.addEventListener('click', async () => {
      if (total && !confirm('Running again replaces the migrated rows and clears reconciliation results. Continue?')) return;
      const result = await busy(run, 'Migrating', () => api(`/projects/${p.id}/migrate`, { method: 'POST' }));
      if (result) {
        toast(`Migrated ${result.result.loaded} of ${result.result.total} rows`, 'ok');
        store.targetFilter = '';
        refresh(result.project);
      }
    });

    body.append(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Run the migration'),
        h('p', { class: 'muted', style: 'margin:0' }, 'Applies only the mappings you approved. Rows that fail validation are held back, not loaded.')), run),
      blocker ? h('div', { class: 'banner warn' }, blocker) : null));

    if (!total) {
      body.append(h('section', { class: 'card' }, h('div', { class: 'empty' }, h('h3', {}, 'Nothing migrated yet'), h('p', {}, 'Results will appear here once you run the migration.'))));
      return;
    }

    const holder = h('div', {}, loading('Loading rows'));
    const filter = h('select', { 'aria-label': 'Filter rows by state', onchange: () => { store.targetFilter = filter.value; loadRows(); } },
      [['', 'All rows'], ['ok', 'Loaded'], ['failed', 'Failed'], ['excluded', 'Excluded']].map(([v, l]) => h('option', { value: v, selected: v === store.targetFilter }, l)));
    const exportBtn = h('button', { class: 'btn', disabled: !counts.ok }, 'Download loaded rows (CSV)');
    exportBtn.addEventListener('click', () => busy(exportBtn, 'Preparing', async () => {
      const res = await fetch(`/api/projects/${p.id}/export`, { headers: { Authorization: `Bearer ${store.token}` } });
      if (!res.ok) throw new Error('Export failed. Run the migration and try again.');
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: `migrated_project_${p.id}.csv` });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast('CSV downloaded', 'ok');
    }));

    body.append(
      h('div', { class: 'stats' },
        h('div', { class: 'stat ok' }, h('b', {}, counts.ok || 0), 'loaded'),
        h('div', { class: `stat ${counts.failed ? 'bad' : ''}` }, h('b', {}, counts.failed || 0), 'failed validation'),
        h('div', { class: 'stat' }, h('b', {}, counts.excluded || 0), 'excluded by approved fix'),
        h('div', { class: 'stat' }, h('b', {}, p.rowCount), 'source rows')),
      h('section', { class: 'card flat' },
        h('div', { class: 'card-head', style: 'padding:16px 20px 0' }, h('h2', {}, 'Target rows'), h('div', { class: 'row' }, filter, exportBtn)),
        holder));

    async function loadRows() {
      fill(holder, loading('Loading rows'));
      try {
        const q = store.targetFilter ? `&state=${store.targetFilter}` : '';
        const data = await api(`/projects/${p.id}/target?limit=100${q}`);
        const names = p.targetSchema.map((f) => f.name);
        if (!data.rows.length) { fill(holder, h('div', { class: 'empty' }, 'No rows match this filter.')); return; }
        fill(holder, 
          table(['#', 'State', ...names, 'Problems'], data.rows.map((r) => h('tr', { class: r.state },
            h('td', { class: 'mono' }, r.rowIndex),
            h('td', {}, chip(r.state, { ok: 'ok', failed: 'bad', excluded: '' }[r.state])),
            names.map((n) => h('td', { class: 'mono' }, r.data[n] === '' ? '' : String(r.data[n]))),
            h('td', {}, r.errors.map((e) => h('div', {}, `${e.field}: ${e.message}`)))))),
          data.total > data.rows.length ? h('p', { class: 'muted', style: 'padding:12px 20px' }, `Showing ${data.rows.length} of ${data.total} rows.`) : null);
      } catch (err) {
        fill(holder, h('div', { class: 'banner bad', role: 'alert', style: 'margin:16px' }, err.message), h('button', { class: 'btn', style: 'margin:0 16px 16px', onclick: loadRows }, 'Try again'));
      }
    }
    loadRows();
  }

  const SEVERITY = { high: 'bad', medium: 'warn', low: '' };

  function issueCard(p, issue, holder) {
    const evidence = issue.evidence.length
      ? h('div', { class: 'evidence' }, issue.evidence.map((e) => h('div', {}, `row ${e.rowIndex}: ${e.raw === '' ? '(empty)' : e.raw} - ${e.message}`)))
      : null;
    let fixBox = null;
    if (issue.fix) {
      const label = { set_value: `Set ${issue.fix.field} to "${issue.fix.value}" on ${issue.rowIndexes.length} row(s)`, exclude_rows: `Exclude ${issue.rowIndexes.length} row(s) from the load`, none: 'No automatic fix. Needs a human decision.' }[issue.fix.action];
      fixBox = h('div', { class: 'fix-box' }, h('strong', {}, 'Proposed fix: '), label, h('div', { class: 'muted' }, issue.fix.rationale), h('div', { class: 'muted' }, `Source: ${issue.fixSource}`));
    }
    const actions = [];
    if (issue.status === 'pending') {
      const approve = h('button', { class: 'btn small primary', disabled: !issue.fix || issue.fix.action === 'none' }, 'Approve fix');
      const reject = h('button', { class: 'btn small' }, 'Reject');
      const decide = async (button, decision, label) => {
        const result = await busy(button, label, () => api(`/issues/${issue.id}/decision`, { method: 'POST', body: { decision } }));
        if (result) {
          store.issues = result.issues;
          toast(decision === 'approve' ? `Fix applied to ${result.affectedRows} row(s). Re-run reconciliation to refresh totals.` : 'Fix rejected', 'ok');
          refresh(result.project);
        }
      };
      approve.addEventListener('click', () => decide(approve, 'approve', 'Applying'));
      reject.addEventListener('click', () => decide(reject, 'reject', 'Saving'));
      actions.push(h('div', { class: 'row' }, approve, reject));
    }
    return h('div', { class: `issue ${issue.status}` },
      h('div', { class: 'row' }, chip(issue.severity, SEVERITY[issue.severity]), h('strong', {}, issue.description), h('span', { class: 'spacer' }),
        issue.status === 'applied' ? chip('Fix applied', 'ok') : issue.status === 'rejected' ? chip('Fix rejected') : null),
      evidence, fixBox, actions);
  }

  function viewReconcile(body, p) {
    const hasTarget = Object.values(p.targetCounts).reduce((a, b) => a + b, 0) > 0;
    const run = h('button', { class: 'btn primary', disabled: !hasTarget }, p.reconciliation ? 'Re-run reconciliation' : 'Run reconciliation');
    run.addEventListener('click', async () => {
      const result = await busy(run, 'Reconciling', () => api(`/projects/${p.id}/reconcile`, { method: 'POST' }));
      if (result) { store.issues = result.issues; toast('Reconciliation complete', 'ok'); refresh(result.project); }
    });
    body.append(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Reconciliation'),
        h('p', { class: 'muted', style: 'margin:0' }, 'Compares source and target: row counts, key uniqueness, field completeness, numeric totals and dropped columns.')), run),
      !hasTarget ? h('div', { class: 'banner warn' }, 'Run the migration before reconciling.') : null,
      p.reconciliation && p.status === 'migrated' ? h('div', { class: 'banner warn' }, 'Fixes were applied after the last reconciliation. Re-run it to refresh these numbers.') : null));
    if (!p.reconciliation) {
      if (hasTarget) body.append(h('section', { class: 'card' }, h('div', { class: 'empty' }, h('h3', {}, 'No reconciliation yet'), h('p', {}, 'Run it to see what the migration did to your data.'))));
      return;
    }
    const m = p.reconciliation;
    const holder = h('div', {}, loading('Loading issues'));
    body.append(
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, m.sourceRows), 'source rows'),
        h('div', { class: 'stat ok' }, h('b', {}, m.loaded), 'loaded'),
        h('div', { class: `stat ${m.failed ? 'bad' : ''}` }, h('b', {}, m.failed), 'failed'),
        h('div', { class: 'stat' }, h('b', {}, m.excluded), 'excluded'),
        h('div', { class: `stat ${m.unaccounted ? 'bad' : ''}` }, h('b', {}, m.unaccounted), 'unaccounted')),
      Object.keys(m.numericTotals).length ? h('section', { class: 'card flat' },
        h('div', { style: 'padding:16px 20px 0' }, h('h2', {}, 'Numeric totals'), h('p', { class: 'muted' }, 'Source totals use every row. Target totals use loaded rows. The gap is value that did not reach the target.')),
        table(['Field', 'Source total', 'Target total', 'Gap'], Object.entries(m.numericTotals).map(([f, t]) => h('tr', {}, h('td', { class: 'mono' }, f), h('td', { class: 'mono' }, t.sourceTotal), h('td', { class: 'mono' }, t.targetTotal), h('td', { class: 'mono' }, t.gap))))) : null,
      h('section', { class: 'card flat' },
        h('div', { style: 'padding:16px 20px 0' }, h('h2', {}, 'Field completeness (loaded rows)')),
        table(['Field', 'Filled', 'Empty', 'Required'], Object.entries(m.fieldStats).map(([f, s]) => h('tr', {}, h('td', { class: 'mono' }, f), h('td', {}, s.filled), h('td', {}, s.empty), h('td', {}, s.required ? 'yes' : 'no'))))),
      h('section', { class: 'card' }, h('h2', {}, 'Issues'), holder));

    async function loadIssues() {
      try {
        store.issues = (await api(`/projects/${p.id}/issues`)).issues;
      } catch (err) {
        fill(holder, h('div', { class: 'banner bad', role: 'alert' }, err.message), h('button', { class: 'btn', onclick: loadIssues }, 'Try again'));
        return;
      }
      drawIssues();
    }

    function drawIssues() {
      const actionable = store.issues.filter((i) => i.status !== 'info');
      const info = store.issues.filter((i) => i.status === 'info');
      const needFix = actionable.some((i) => i.status === 'pending' && !i.fix);
      const ask = h('button', { class: 'btn primary' }, 'Ask the agent for fix proposals');
      ask.addEventListener('click', async () => {
        const result = await busy(ask, 'Agent is working', () => api(`/projects/${p.id}/fixes/propose`, { method: 'POST' }));
        if (result) { store.issues = result.issues; toast(`${result.proposed} fix proposal(s) ready for review`, 'ok'); drawIssues(); }
      });
      fill(holder, 
        !store.issues.length ? h('div', { class: 'banner ok' }, 'No issues found. Source and target reconcile cleanly.') : null,
        needFix ? h('div', { class: 'row', style: 'margin-bottom:12px' }, ask, h('span', { class: 'muted' }, 'Nothing is changed until you approve each fix.')) : null,
        actionable.map((i) => issueCard(p, i, holder)),
        info.length ? [h('h3', { style: 'margin-top:16px' }, 'For awareness'), info.map((i) => issueCard(p, i, holder))] : null);
    }
    loadIssues();
  }

  async function viewLogs(body, p) {
    const holder = h('div', {}, loading('Loading logs'));
    const reload = h('button', { class: 'btn small' }, 'Refresh');
    body.append(h('section', { class: 'card flat' },
      h('div', { class: 'card-head', style: 'padding:16px 20px 0' }, h('div', {}, h('h2', {}, 'Structured logs'), h('p', { class: 'muted' }, 'Application and AI workflow events for this project, newest first.')), reload),
      holder));
    async function load() {
      fill(holder, loading('Loading logs'));
      try {
        const data = await api(`/projects/${p.id}/logs?limit=200`);
        if (!data.logs.length) { fill(holder, h('div', { class: 'empty' }, 'No log entries yet.')); return; }
        fill(holder, table(['Time', 'Level', 'Event', 'Details'], data.logs.map((l) => h('tr', {},
          h('td', { class: 'mono' }, new Date(l.ts).toLocaleTimeString()),
          h('td', {}, chip(l.level, { info: '', warn: 'warn', error: 'bad' }[l.level])),
          h('td', { class: 'mono' }, l.event),
          h('td', { class: 'mono' }, JSON.stringify(l.meta))))));
      } catch (err) {
        fill(holder, h('div', { class: 'banner bad', role: 'alert', style: 'margin:16px' }, err.message));
      }
    }
    reload.addEventListener('click', () => busy(reload, 'Loading', load));
    load();
  }

  function route() {
    const hash = location.hash || '#/';
    if (!store.token) {
      if (hash !== '#/login') { location.hash = '#/login'; return; }
      renderLogin();
      return;
    }
    if (hash === '#/login') { location.hash = '#/'; return; }
    const m = hash.match(/^#\/p\/(\d+)(?:\/(\w+))?$/);
    if (m) {
      if (store.project && store.project.id !== Number(m[1])) store.project = null;
      renderProject(m[1], TABS.some(([k]) => k === m[2]) ? m[2] : 'source');
      return;
    }
    store.project = null;
    renderProjects();
  }

  window.addEventListener('hashchange', route);
  route();
})();
