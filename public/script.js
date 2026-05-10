let currentSessionId = null;

// ── DOM Refs ─────────────────────────────────────────────────────────────────
const uploadBox    = document.getElementById('uploadBox');
const fileInput    = document.getElementById('fileInput');
const browseBtn    = document.getElementById('browseBtn');
const dropIdle     = document.getElementById('dropIdle');
const dropFile     = document.getElementById('dropFile');
const fileNameEl   = document.getElementById('fileName');
const fileStatusEl = document.getElementById('fileStatus');
const uploadBtn    = document.getElementById('uploadBtn');
const uploadLoader = document.getElementById('uploadLoader');
const progressBar  = document.getElementById('progressBar');
const topbarTitle  = document.getElementById('topbarTitle');
const chatContainer= document.getElementById('chatContainer');
const emptyState   = document.getElementById('emptyState');
const chatForm     = document.getElementById('chatForm');
const chatInput    = document.getElementById('chatInput');
const sendBtn      = document.getElementById('sendBtn');

let selectedFile = null;
let progressInterval = null;

// ── Auto-resize textarea ─────────────────────────────────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
});

// ── Drag & Drop ───────────────────────────────────────────────────────────────
uploadBox.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

uploadBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragover'));

uploadBox.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadBox.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileSelect(e.target.files[0]);
});

function handleFileSelect(file) {
  if (file.type !== 'application/pdf') {
    showToast('Please upload a PDF file.');
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileStatusEl.textContent = 'Click "Index Document" to process';

  dropIdle.classList.add('hidden');
  dropFile.classList.remove('hidden');
  uploadBtn.classList.remove('hidden');
}

// ── Upload & Index ────────────────────────────────────────────────────────────
uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  uploadBtn.classList.add('hidden');
  uploadLoader.classList.remove('hidden');
  animateProgress();

  const formData = new FormData();
  formData.append('file', selectedFile);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed');

    currentSessionId = data.sessionId;
    fileStatusEl.textContent = `${data.totalChunks} chunks indexed ✓`;
    topbarTitle.textContent  = selectedFile.name;
    setProgress(100);

    chatInput.disabled = false;
    sendBtn.disabled   = false;
    chatInput.placeholder = 'Ask anything about your document…';
    chatInput.focus();

    appendMessage('bot',
      `📄 **${selectedFile.name}** has been processed into **${data.totalChunks} chunks** and indexed into Qdrant.\n\nAsk me anything about this document!`,
      []
    );

  } catch (err) {
    showToast('Error: ' + err.message);
    uploadBtn.classList.remove('hidden');
    fileStatusEl.textContent = 'Failed — try again';
  } finally {
    clearInterval(progressInterval);
    setTimeout(() => uploadLoader.classList.add('hidden'), 600);
  }
});

// ── Chat ──────────────────────────────────────────────────────────────────────
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = chatInput.value.trim();
  if (!query || !currentSessionId) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  appendMessage('user', query, null);

  const thinkId = addThinking();

  try {
    const res  = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sessionId: currentSessionId }),
    });
    const data = await res.json();
    removeThinking(thinkId);

    if (!res.ok) throw new Error(data.error || 'Chat failed');
    appendMessage('bot', data.answer, data.sources);

  } catch (err) {
    removeThinking(thinkId);
    appendMessage('bot', `**Error:** ${err.message}`, []);
  }
});

// ── Keyboard submit ───────────────────────────────────────────────────────────
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// ── Message Rendering ─────────────────────────────────────────────────────────
function appendMessage(role, content, sources) {
  emptyState.classList.add('hidden');

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const initials = role === 'user' ? 'U' : '✦';
  const avatarHtml = `<div class="msg-avatar ${role}">${initials}</div>`;

  // Render markdown safely
  const htmlContent = marked.parse(content || '');

  // Build sources block
  let sourcesHtml = '';
  if (role === 'bot' && sources && sources.length > 0) {
    const id = 'src-' + Math.random().toString(36).slice(2, 9);
    const cards = sources.map((s, i) => `
      <div class="source-card">
        <div class="source-card-header">
          <span class="source-chunk-label">Chunk ${(s.metadata?.chunkIndex ?? i) + 1}</span>
        </div>
        <p class="source-preview">${escapeHtml(s.text.slice(0, 200))}…</p>
      </div>
    `).join('');

    sourcesHtml = `
      <div class="sources-block">
        <button class="sources-btn" onclick="toggleSources('${id}', this)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          ${sources.length} source chunk${sources.length > 1 ? 's' : ''}
        </button>
        <div class="sources-list hidden" id="${id}">${cards}</div>
      </div>
    `;
  }

  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-content">
      <div class="msg-bubble">${htmlContent}</div>
      ${sourcesHtml}
    </div>
  `;

  chatContainer.appendChild(row);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ── Thinking ──────────────────────────────────────────────────────────────────
function addThinking() {
  const id = 'think-' + Math.random().toString(36).slice(2, 9);
  const div = document.createElement('div');
  div.className = 'thinking-row';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar bot">✦</div>
    <div class="thinking-dots">
      <div class="tdot"></div><div class="tdot"></div><div class="tdot"></div>
    </div>
  `;
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return id;
}

function removeThinking(id) {
  document.getElementById(id)?.remove();
}

// ── Source Toggle ─────────────────────────────────────────────────────────────
function toggleSources(id, btn) {
  const list = document.getElementById(id);
  const isHidden = list.classList.toggle('hidden');
  btn.style.color = isHidden ? '' : 'var(--accent-a)';
}

// ── Progress Bar ─────────────────────────────────────────────────────────────
function animateProgress() {
  let pct = 5;
  setProgress(pct);
  progressInterval = setInterval(() => {
    pct = Math.min(pct + Math.random() * 8, 88);
    setProgress(pct);
  }, 500);
}

function setProgress(pct) {
  progressBar.style.width = pct + '%';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:#1e293b; border:1px solid rgba(255,255,255,0.1);
    color:#f1f5f9; padding:12px 24px; border-radius:10px;
    font-family:Outfit,sans-serif; font-size:.88rem; z-index:9999;
    box-shadow:0 8px 32px rgba(0,0,0,0.5);
    animation:fadeUp .3s ease;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
