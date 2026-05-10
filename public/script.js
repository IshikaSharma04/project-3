let currentSessionId = null;

// DOM Elements
const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const chunkInfo = document.getElementById('chunkInfo');
const uploadBtn = document.getElementById('uploadBtn');
const uploadLoader = document.getElementById('uploadLoader');
const chatContainer = document.getElementById('chatContainer');
const emptyState = document.getElementById('emptyState');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

let selectedFile = null;

// Upload Box Interactions
uploadBox.addEventListener('click', () => fileInput.click());

uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
});

uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
});

uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    
    if (e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    chunkInfo.textContent = 'Ready to index';
    
    uploadBox.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    uploadBtn.classList.remove('hidden');
}

// Upload & Index API Call
uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.classList.add('hidden');
    uploadLoader.classList.remove('hidden');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            currentSessionId = data.sessionId;
            chunkInfo.textContent = \`\${data.totalChunks} chunks indexed\`;
            
            // Enable Chat
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatInput.focus();
            
            appendMessage('bot', \`Successfully indexed **\${selectedFile.name}**! You can now ask questions about this document.\`);
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        alert('Error: ' + error.message);
        uploadBtn.classList.remove('hidden');
        chunkInfo.textContent = 'Failed. Try again.';
    } finally {
        uploadLoader.classList.add('hidden');
    }
});

// Chat API Call
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const query = chatInput.value.trim();
    if (!query || !currentSessionId) return;

    // Clear input
    chatInput.value = '';
    
    // Add user message
    appendMessage('user', query);
    
    // Add thinking animation
    const thinkingId = addThinking();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query,
                sessionId: currentSessionId
            })
        });

        const data = await response.json();
        removeThinking(thinkingId);

        if (response.ok) {
            appendMessage('bot', data.answer, data.sources);
        } else {
            throw new Error(data.error || 'Failed to get answer');
        }
    } catch (error) {
        removeThinking(thinkingId);
        appendMessage('bot', \`**Error:** \${error.message}\`);
    }
});

// Message UI Functions
function appendMessage(role, content, sources = null) {
    emptyState.classList.add('hidden');

    const messageDiv = document.createElement('div');
    messageDiv.className = \`message \${role}\`;

    const icon = role === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    let sourcesHtml = '';
    if (sources && sources.length > 0) {
        const sourcesId = 'sources-' + Math.random().toString(36).substr(2, 9);
        
        let chunksHtml = sources.map((s, i) => 
            \`<div style="margin-bottom: 8px;">
                <strong>Chunk \${s.metadata.chunkIndex}</strong>: 
                \${s.text.substring(0, 150)}...
            </div>\`
        ).join('');

        sourcesHtml = \`
            <div class="sources">
                <button class="source-toggle" onclick="document.getElementById('\${sourcesId}').style.display = document.getElementById('\${sourcesId}').style.display === 'block' ? 'none' : 'block'">
                    <i class="fa-solid fa-layer-group"></i> View \${sources.length} Retrieved Sources
                </button>
                <div id="\${sourcesId}" class="source-content">
                    \${chunksHtml}
                </div>
            </div>
        \`;
    }

    messageDiv.innerHTML = \`
        <div class="avatar">\${icon}</div>
        <div class="bubble">
            \${marked.parse(content)}
            \${sourcesHtml}
        </div>
    \`;

    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function addThinking() {
    emptyState.classList.add('hidden');
    const id = 'think-' + Math.random().toString(36).substr(2, 9);
    
    const div = document.createElement('div');
    div.className = 'message bot';
    div.id = id;
    div.innerHTML = \`
        <div class="avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="bubble thinking">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        </div>
    \`;
    
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return id;
}

function removeThinking(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}
