// content.js

(() => {
  class TaskTreeUI {
    constructor() {
      this.modal = null;
      this.cy = null;
      this.nodes = [];
      this.locked = new Set();
      this.currentNodeId = null;

      this.ensureModal();
      this.registerMessageHandler();
      console.log('Task Tree Modal ready');
    }

    registerMessageHandler() {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'TASK_TREE_TOGGLE') this.toggleModal();
      });
    }

    ensureModal() {
      if (this.modal) return;

      // Modal Grundgerüst (deckt deine CSS-Klassen ab) – Styles kommen aus modal.css
      const wrapper = document.createElement('div');
      wrapper.className = 'task-modal-overlay';
      wrapper.id = 'task-tree-modal';
      wrapper.innerHTML = `
        <div class="task-modal-content">
          <div class="task-modal-header">
            <h2>Learning Journey</h2>
            <div class="header-controls">
              <button class="task-btn task-btn-outline" id="task-tree-minimize">Min</button>
              <button class="task-modal-close" id="task-tree-close" title="Schließen">×</button>
            </div>
          </div>
          <div class="task-modal-body">
            <div class="task-layout-container">
              
              <!-- Linke Leiste (Trees – optional, einfach leer vorerst) -->
              <aside class="tree-selector-panel">
                <div class="panel-header">
                  <h3>Gespeicherte Bäume</h3>
                  <button class="task-btn task-btn-sm task-btn-outline" id="btn-clear-trees" title="Alle löschen">Leeren</button>
                </div>
                <div class="tree-list" id="tree-list">
                  <div class="empty-tree-list">
                    <p>Noch keine Bäume gespeichert.</p>
                    <button class="task-btn task-btn-outline" id="btn-load-last">Letzten laden</button>
                  </div>
                </div>
              </aside>

              <!-- Hauptbereich -->
              <main class="task-main-container">
                <section class="task-cytoscape-container">
                  <div id="cy" style="width:100%;height:100%;"></div>
                </section>
                
                <aside class="task-control-panel">
                  <div class="panel-section">
                    <h3>Baum erstellen</h3>

                    <div class="form-group">
                      <label for="learning-goal">Lernziel(e)</label>
                      <textarea id="learning-goal" placeholder="z.B. 'Grundlagen Neural Networks lernen, inkl. Backprop, Optimizer, Regularisierung'"></textarea>
                    </div>

                    <div class="form-group">
                      <label>
                        <input type="checkbox" id="use-llm" checked />
                        Mit AI (Azure OpenAI) generieren
                      </label>
                    </div>

                    <div id="azure-settings" style="display:block;">
                      <div class="form-group">
                        <label for="azure-endpoint">Azure Endpoint</label>
                        <input id="azure-endpoint" placeholder="https://YOUR-RESOURCE.openai.azure.com" />
                      </div>
                      <div class="form-group">
                        <label for="azure-deployment">Deployment Name</label>
                        <input id="azure-deployment" placeholder="gpt-4o-mini" />
                      </div>
                      <div class="form-group">
                        <label for="azure-version">API Version</label>
                        <input id="azure-version" value="2024-05-01-preview" />
                      </div>
                      <div class="form-group">
                        <label for="azure-key">API Key</label>
                        <input id="azure-key" type="password" placeholder="sk-..." />
                      </div>
                      <div class="form-actions">
                        <button class="task-btn task-btn-outline" id="btn-save-azure">Azure speichern</button>
                      </div>
                    </div>

                    <div id="manual-builder" style="display:none; margin-top:8px;">
                      <div class="form-group">
                        <label for="manual-root-title">Root-Titel</label>
                        <input id="manual-root-title" placeholder="Thema / Lernziel Root" />
                      </div>
                      <div class="form-actions">
                        <button class="task-btn task-btn-outline" id="btn-add-root">Root anlegen</button>
                      </div>
                    </div>

                    <div class="form-actions">
                      <button class="task-btn task-btn-primary" id="btn-generate">Baum generieren</button>
                      <button class="task-btn task-btn-secondary" id="btn-save-tree">Baum speichern</button>
                    </div>

                    <div id="generation-error" class="error-message" style="display:none;"></div>
                  </div>

                  <div class="panel-section">
                    <h3>Ausgewählter Knoten</h3>
                    <div id="node-info" class="node-info">
                      <div class="no-selection">Kein Knoten ausgewählt.</div>
                    </div>
                  </div>
                </aside>
              </main>
            </div>
          </div>
          <div class="task-modal-footer">
            <div class="stats-panel">
              <div class="stat-item"><span class="stat-value" id="stat-nodes">0</span><span class="stat-label">Knoten</span></div>
              <div class="stat-item"><span class="stat-value" id="stat-locked">0</span><span class="stat-label">Gesperrt</span></div>
              <div class="stat-item"><span class="stat-value" id="stat-unlocked">0</span><span class="stat-label">Freigeschaltet</span></div>
            </div>
          </div>
        </div>
      `;
      document.documentElement.appendChild(wrapper);
      this.modal = wrapper;

      // Events
      this.modal.querySelector('#task-tree-close').addEventListener('click', () => this.closeModal());
      this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeModal(); });
      this.modal.querySelector('#use-llm').addEventListener('change', (e) => {
        const use = e.target.checked;
        this.modal.querySelector('#azure-settings').style.display = use ? 'block' : 'none';
        this.modal.querySelector('#manual-builder').style.display = use ? 'none' : 'block';
      });
      this.modal.querySelector('#btn-save-azure').addEventListener('click', () => this.saveAzure());
      this.modal.querySelector('#btn-generate').addEventListener('click', () => this.generate());
      this.modal.querySelector('#btn-save-tree').addEventListener('click', () => this.saveTree());
      this.modal.querySelector('#btn-add-root').addEventListener('click', () => this.addManualRoot());
      this.modal.querySelector('#btn-clear-trees').addEventListener('click', () => this.clearTrees());
      this.modal.querySelector('#btn-load-last').addEventListener('click', () => this.loadLast());

      // Cytoscape init
      this.initCy();
      // Settings laden
      this.loadAzure();
    }

    toggleModal() {
      this.modal.classList.toggle('show');
      if (this.modal.classList.contains('show')) this.cy?.resize();
    }
    closeModal() { this.modal.classList.remove('show'); }

    async saveAzure() {
      const endpoint   = this.q('#azure-endpoint').value.trim();
      const deployment = this.q('#azure-deployment').value.trim();
      const apiVersion = this.q('#azure-version').value.trim();
      const apiKey     = this.q('#azure-key').value.trim();

      await chrome.storage.sync.set({ azureEndpoint:endpoint, azureDeployment:deployment, azureApiVersion:apiVersion, azureApiKey:apiKey });
      this.toast('Azure Einstellungen gespeichert');
    }
    async loadAzure() {
      const s = await chrome.storage.sync.get(['azureEndpoint','azureDeployment','azureApiVersion','azureApiKey']);
      if (s.azureEndpoint) this.q('#azure-endpoint').value = s.azureEndpoint;
      if (s.azureDeployment) this.q('#azure-deployment').value = s.azureDeployment;
      if (s.azureApiVersion) this.q('#azure-version').value = s.azureApiVersion;
      if (s.azureApiKey) this.q('#azure-key').value = s.azureApiKey;
    }

    q(sel){ return this.modal.querySelector(sel); }

    initCy() {
      const container = this.q('#cy');
      this.cy = cytoscape({
        container,
        elements: [],
        layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.1, padding: 20 },
        style: [
          { selector: 'node',
            style: {
              'background-color': '#3b82f6',
              'label': 'data(label)',
              'text-wrap': 'wrap',
              'text-max-width': 160,
              'font-size': 12,
              'color': '#fff'
            }},
          { selector: 'node.locked',
            style: { 'background-color': '#94a3b8' } },
          { selector: 'node#root',
            style: { 'background-color': '#10b981', 'font-weight': 'bold' } },
          { selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#cbd5e1',
              'target-arrow-color': '#cbd5e1',
              'target-arrow-shape': 'triangle'
            }}
        ]
      });

      this.cy.on('tap', 'node', (evt) => {
        const n = evt.target;
        const id = n.id();
        this.currentNodeId = id;

        if (id !== 'root' && this.locked.has(id)) {
          this.renderNodeInfo({ locked: true, node: this.nodes.find(x => x.id === id) });
          return;
        }
        this.renderNodeInfo({ locked: false, node: this.nodes.find(x => x.id === id) });
      });
    }

    addManualRoot() {
      const title = this.q('#manual-root-title').value.trim() || 'Thema';
      const root = { id: 'root', title, url: '', description: 'Manuell erstellter Root', parentId: null, questions: [] };
      this.renderGraph([root]);
    }

    async generate() {
      this.setError('');
      const goal = this.q('#learning-goal').value.trim();
      const useLLM = this.q('#use-llm').checked;

      if (!goal && useLLM) return this.setError('Bitte Lernziel(e) eingeben.');
      if (!useLLM) {
        // Minimal: manueller Root, weitere Knoten kannst du über Kontextmenü/Erweiterung ergänzen
        const root = { id: 'root', title: this.q('#manual-root-title').value.trim() || (goal || 'Thema'), url: '', description: 'Manuell erstellt', parentId: null, questions: [] };
        return this.renderGraph([root]);
      }

      // Azure Anfrage
      this.toggleGenerateBtn(true);
      try {
        const { ok, nodes, error } = await chrome.runtime.sendMessage({
          type: 'GENERATE_TREE_WITH_AZURE',
          payload: {
            goal,
            azure: {
              endpoint: this.q('#azure-endpoint').value.trim(),
              deployment: this.q('#azure-deployment').value.trim(),
              apiVersion: this.q('#azure-version').value.trim(),
              apiKey: this.q('#azure-key').value.trim()
            }
          }
        });

        if (!ok) throw new Error(error || 'Unbekannter Fehler bei Azure');

        if (!nodes || !nodes.length) {
          throw new Error('Azure lieferte keine Knoten.');
        }
        // Sanitize + fallback
        const sane = this.normalizeNodes(nodes);
        this.renderGraph(sane);
      } catch (e) {
        this.setError(String(e.message || e));
      } finally {
        this.toggleGenerateBtn(false);
      }
    }

    normalizeNodes(list) {
      // Stelle sicher, dass wir einen root haben & IDs stringifiziert sind
      const byId = new Map();
      let hasRoot = false;
      list.forEach((n,i) => {
        const id = String(n.id ?? `n${i}`);
        const parentId = n.parentId != null ? String(n.parentId) : null;
        const node = {
          id,
          parentId,
          title: String(n.title || id),
          url: n.url ? String(n.url) : '',
          description: String(n.description || ''),
          questions: Array.isArray(n.questions) ? n.questions.slice(0,3).map(q => ({ q:String(q.q||''), a:String(q.a||'') })) : []
        };
        if (id === 'root' || parentId === null) hasRoot = true;
        byId.set(id, node);
      });

      if (!hasRoot) {
        // Erzeuge künstlichen Root, hänge alle parentlosen drunter
        const root = { id: 'root', parentId: null, title: 'Lernpfad', url:'', description:'Root', questions: [] };
        byId.set('root', root);
        [...byId.values()].forEach(n => { if (n.id !== 'root' && (n.parentId == null || !byId.has(n.parentId))) n.parentId = 'root'; });
      }

      return [...byId.values()];
    }

    renderGraph(nodes) {
      this.nodes = nodes;
      this.cy.elements().remove();
      this.locked = new Set(nodes.filter(n => n.id !== 'root').map(n => n.id));

      // add nodes
      nodes.forEach(n => {
        this.cy.add({ group:'nodes', data:{ id:n.id, label:n.title, url:n.url } });
        if (n.id !== 'root' && this.locked.has(n.id)) this.cy.$(`#${CSS.escape(n.id)}`).addClass('locked');
      });
      // add edges
      nodes.forEach(n => {
        if (n.parentId && n.id !== n.parentId) {
          this.cy.add({ group:'edges', data:{ id:`e_${n.parentId}_${n.id}`, source:n.parentId, target:n.id }});
        } else if (n.id !== 'root' && (!n.parentId || n.parentId === null)) {
          this.cy.add({ group:'edges', data:{ id:`e_root_${n.id}`, source:'root', target:n.id }});
        }
      });

      this.cy.layout({ name:'breadthfirst', directed:true, spacingFactor: 1.1, padding: 20 }).run();
      this.updateStats();
    }

    renderNodeInfo({ locked, node }) {
      const host = this.q('#node-info');
      if (!node) {
        host.innerHTML = `<div class="no-selection">Kein Knoten ausgewählt.</div>`;
        return;
      }
      const lockBadge = locked ? `<span class="node-status status-pending">GESPERRT</span>` : `<span class="node-status status-in-progress">FREI</span>`;
      const urlPart = node.url ? `<div><a href="${node.url}" target="_blank" rel="noopener">🔗 Öffnen</a></div>` : '';
      const qHTML = (node.questions || []).map((qa, idx) => `
        <div class="form-group">
          <label>${idx+1}. ${qa.q}</label>
          <input data-qa="${idx}" class="quiz-input" placeholder="Antwort eingeben" />
        </div>
      `).join('');

      host.innerHTML = `
        <div class="node-title">${node.title}</div>
        <div class="node-description">${node.description || ''}</div>
        ${lockBadge}
        ${urlPart}
        ${node.questions?.length ? `<div style="margin-top:8px;"><button class="task-btn task-btn-success" id="btn-check-answers">Antworten prüfen</button></div>` : ''}
        ${node.questions?.length ? `<div style="margin-top:8px;">${qHTML}</div>` : ''}
      `;

      const btn = host.querySelector('#btn-check-answers');
      if (btn) btn.addEventListener('click', () => this.checkAnswers(node));
    }

    checkAnswers(node) {
      const inputs = [...this.q('#node-info').querySelectorAll('.quiz-input')];
      const ok = inputs.every((inp, i) => {
        const want = (node.questions[i]?.a || '').trim().toLowerCase();
        const got  = (inp.value || '').trim().toLowerCase();
        return want && got && (got === want);
      });
      if (!ok) {
        this.toast('Nicht alle Antworten korrekt. Versuch es erneut.');
        return;
      }
      // unlock
      this.locked.delete(node.id);
      this.cy.$(`#${CSS.escape(node.id)}`).removeClass('locked');
      this.renderNodeInfo({ locked:false, node });
      this.updateStats();
      this.toast(`"${node.title}" freigeschaltet ✨`);
    }

    updateStats() {
      const total = this.nodes.length;
      const locked = this.locked.size;
      const unlocked = Math.max(0, total - locked);
      this.q('#stat-nodes').textContent = String(total);
      this.q('#stat-locked').textContent = String(locked);
      this.q('#stat-unlocked').textContent = String(unlocked);
    }

    async saveTree() {
      const trees = (await chrome.storage.local.get(['trees'])).trees || [];
      trees.push({ ts: Date.now(), nodes: this.nodes });
      await chrome.storage.local.set({ trees });
      this.toast('Baum gespeichert');
      this.renderTreeList(trees);
    }

    async loadLast() {
      const trees = (await chrome.storage.local.get(['trees'])).trees || [];
      if (!trees.length) return this.toast('Kein gespeicherter Baum vorhanden');
      const last = trees[trees.length - 1];
      this.renderGraph(last.nodes || []);
      this.toast('Letzten Baum geladen');
    }

    async clearTrees() {
      await chrome.storage.local.set({ trees: [] });
      this.renderTreeList([]);
      this.toast('Gespeicherte Bäume geleert');
    }

    async renderTreeList(trees = null) {
      if (!trees) trees = (await chrome.storage.local.get(['trees'])).trees || [];
      const host = this.q('#tree-list');
      if (!trees.length) {
        host.innerHTML = `<div class="empty-tree-list">
          <p>Noch keine Bäume gespeichert.</p>
          <button class="task-btn task-btn-outline" id="btn-load-last">Letzten laden</button>
        </div>`;
        host.querySelector('#btn-load-last').addEventListener('click', () => this.loadLast());
        return;
      }
      host.innerHTML = trees.map((t, idx) => {
        const d = new Date(t.ts).toLocaleString();
        return `
          <div class="tree-item">
            <div class="tree-item-header">
              <div class="tree-item-name">Baum ${idx+1}</div>
              <div class="tree-item-stats">${new Date(t.ts).toLocaleDateString()}</div>
            </div>
            <div style="padding:8px;">
              <button class="task-btn task-btn-sm task-btn-primary" data-load="${idx}">Laden</button>
            </div>
          </div>
        `;
      }).join('');

      host.querySelectorAll('[data-load]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const idx = Number(e.currentTarget.getAttribute('data-load'));
          const trees2 = (await chrome.storage.local.get(['trees'])).trees || [];
          const item = trees2[idx];
          if (item) {
            this.renderGraph(item.nodes || []);
            this.toast(`Baum ${idx+1} geladen`);
          }
        });
      });
    }

    setError(msg) {
      const el = this.q('#generation-error');
      if (!msg) {
        el.style.display = 'none';
        el.textContent = '';
      } else {
        el.style.display = 'block';
        el.textContent = msg;
      }
    }

    toggleGenerateBtn(disabled) {
      this.q('#btn-generate').disabled = !!disabled;
      this.q('#btn-generate').textContent = disabled ? 'Generiere…' : 'Baum generieren';
    }

    toast(text) {
      // einfache, CSS-freie Mini-Toast
      const t = document.createElement('div');
      t.textContent = text;
      t.style.cssText = 'position:fixed;top:16px;right:16px;background:#111827;color:#fff;padding:10px 14px;border-radius:8px;z-index:1000000;opacity:0.96';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1800);
    }
  }

  // Init sofort (content script ist bereits per manifest geladen)
  const ui = new TaskTreeUI();
})();
