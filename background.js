// background.js (MV3 Service Worker)

// Öffnet/Toggle modal im aktiven Tab
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  const blocked = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'data:', 'file://'];
  if (blocked.some(p => tab.url.startsWith(p))) {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Nicht unterstützt',
      message: 'Auf Systemseiten kann die Erweiterung nicht geöffnet werden.'
    });
    return;
  }

  try {
    // Versuche Content Script zu pingen – wenn da, Modal togglen
    await chrome.tabs.sendMessage(tab.id, { type: 'TASK_TREE_TOGGLE' });
  } catch {
    // Noch nicht injiziert? content.js ist per manifest ohnehin aktiv.
    // Sende trotzdem den Toggle nach einem kleinen Delay.
    setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'TASK_TREE_TOGGLE' }).catch(()=>{}), 120);
  }
});

// RPC: vom Content-Skript gerufene Azure-Generierung
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'GENERATE_TREE_WITH_AZURE') {
    (async () => {
      try {
        // Settings aus Nachricht oder Storage
        const { goal, azure } = msg.payload || {};
        const store = await chrome.storage.sync.get([
          'azureEndpoint','azureDeployment','azureApiVersion','azureApiKey'
        ]);

        const endpoint     = (azure?.endpoint || store.azureEndpoint || '').replace(/\/+$/,'');
        const deployment   =  azure?.deployment || store.azureDeployment;
        const apiVersion   =  azure?.apiVersion || store.azureApiVersion || '2024-05-01-preview';
        const apiKey       =  azure?.apiKey || store.azureApiKey;

        if (!endpoint || !deployment || !apiKey) {
          throw new Error('Azure-Einstellungen unvollständig (Endpoint, Deployment, API Key).');
        }

        const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

        const system = [
          "Du bist ein Lernpfad-Planer.",
          "Gib ausschließlich JSON im Feld 'content' zurück (kein Markdown, kein Text).",
          "Struktur:",
          "{",
          ' "nodes":[{"id":"root","title":"...","url":"https://...","description":"...","parentId":null,"questions":[{"q":"...","a":"..."}]}, ...]',
          "}",
          "Regeln:",
          "- Fülle 8–15 Knoten aus (root + Teilthemen).",
          "- Für jeden Knoten: title, url (hochwertige Quellen), 1–3 kurze Fragen mit präzisen Antworten.",
          "- parentId=null für root; andere parentId auf übergeordneten Knoten setzen.",
        ].join("\n");

        const user = `Lernziele: "${goal}". Erzeuge thematische Teilknoten mit passenden Webseiten, die zusammen einen sinnvollen Lernpfad ergeben.`;

        const body = {
          messages: [
            { role: "system", content: system },
            { role: "user",   content: user }
          ],
          temperature: 0.2,
          response_format: { type: "json_object" }
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const t = await res.text().catch(()=> '');
          throw new Error(`Azure OpenAI Fehler: ${res.status} ${res.statusText} – ${t}`);
        }

        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content || '{}';

        // robustes JSON-Parsing
        let data;
        try { data = JSON.parse(content); }
        catch {
          // Falls Modell doch Text um das JSON herum generiert hat: naive Extraktion
          const m = content.match(/\{[\s\S]*\}/);
          data = m ? JSON.parse(m[0]) : { nodes: [] };
        }

        if (!Array.isArray(data.nodes)) data.nodes = [];

        sendResponse({ ok: true, nodes: data.nodes });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();

    // async response
    return true;
  }
});
