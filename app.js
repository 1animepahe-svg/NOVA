/* ============================================================
   app.js — Hark AI
   Main app: startup, screens, navigation, chat UI, rendering.
   Vanilla JS, no framework. Zero build step.
   ============================================================ */

import {
  initStorage, save, saveNow, getData, getPrefs, updatePrefs,
  getAllConversations, getActiveConversation, createConversation,
  setActiveConversation, deleteConversation, renameConversation,
  addMessage, updateMessage,
  getAllProjects, getActiveProject, setActiveProject, createProject, deleteProject,
  getPanels, addPanel, deletePanel, updatePanel,
  getTasks, addTask, deleteTask,
  getMemory, saveMemory, addFact, removeFact, clearMemory,
  downloadExport, importFromFile, resetAll, uid,
} from './storage.js';

import {
  sendMessage, abort, startRecognition, stopSpeaking, speak, generateImageURL, isSpeaking
} from './ai.js';

import { copyToClipboard, extractImages, requestNotificationPermission, downloadHTML, downloadCSV, notify } from './tools.js';

// ==================== GLOBAL STATE ====================
let currentScreen = 'chat';
let recognition = null;
let isRecognizing = false;
let activeMessageElement = null;
let currentTheme = 'dark';

// ==================== DOM REFS ====================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ==================== INIT ====================
async function init() {
  initStorage();
  applyTheme();
  setupMarked();
  populateVoices();
  bindGlobalEvents();
  bindChatEvents();
  bindSettingsEvents();
  bindMemoryEvents();
  bindPanelEvents();
  bindTaskEvents();
  bindProjectEvents();
  bindCapabilityCards();
  ensureActiveConversation();
  renderAll();
  registerServiceWorker();
  runScheduledTaskLoop();

  // Voices load async
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }
}

// ==================== THEME ====================
function applyTheme() {
  let t = getPrefs().theme || 'dark';
  if (t === 'auto') {
    t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  currentTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  $$('#theme-segment button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === getPrefs().theme);
  });
}

// ==================== MARKED SETUP ====================
function setupMarked() {
  if (!window.marked) return;
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: function(code, lang) {
      if (window.hljs) {
        try {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return hljs.highlightAuto(code).value;
        } catch (e) {}
      }
      return code;
    }
  });
}

function renderMarkdown(text) {
  if (!text || !text.trim()) return '';
  try {
    let raw = marked.parse(text);
    // Sanitize
    if (window.DOMPurify) raw = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
    // Make links open in new tab
    const temp = document.createElement('div');
    temp.innerHTML = raw;
    temp.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    return temp.innerHTML;
  } catch (e) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ==================== NAVIGATION ====================
function navigate(screen) {
  currentScreen = screen;
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`#screen-${screen}`);
  if (el) el.classList.add('active');

  $$('.nav-item[data-screen]').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === screen);
  });

  const titles = {
    'chat': 'Chat',
    'home-panels': 'Home Panels',
    'scheduled': 'Scheduled Tasks',
    'projects': 'Projects',
    'memory': 'Memory',
    'settings': 'Settings',
  };
  $('#screen-title').textContent = titles[screen] || 'Hark';

  // Render the screen
  if (screen === 'home-panels') renderPanels();
  if (screen === 'scheduled') renderTasks();
  if (screen === 'projects') renderProjects();
  if (screen === 'memory') renderMemory();
  if (screen === 'settings') renderSettings();
  if (screen === 'chat') renderMessages();

  // Close mobile sidebar
  closeSidebar();
}

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar-overlay').classList.add('show');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('show');
}

// ==================== CONVERSATIONS ====================
function ensureActiveConversation() {
  const active = getActiveConversation();
  if (!active) {
    const convos = getAllConversations();
    if (convos.length === 0) {
      createConversation('New chat', getActiveProject()?.id || null);
    } else {
      setActiveConversation(convos[0].id);
    }
  }
}

function renderHistory() {
  const list = $('#history-list');
  const convos = getAllConversations();
  const activeId = getData().activeConversationId;

  if (convos.length === 0) {
    list.innerHTML = '<div class="history-empty">No chats yet</div>';
    return;
  }

  list.innerHTML = '';
  convos.slice(0, 50).forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'history-item' + (c.id === activeId ? ' active' : '');
    btn.innerHTML = `
      <span class="history-title">${escapeHtml(c.title || 'New chat')}</span>
      <button class="history-delete" title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    `;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.history-delete')) return;
      setActiveConversation(c.id);
      navigate('chat');
      renderAll();
    });
    btn.querySelector('.history-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
      ensureActiveConversation();
      renderAll();
    });
    list.appendChild(btn);
  });
}

// ==================== CHAT RENDERING ====================
function renderMessages() {
  const container = $('#messages');
  const welcome = $('#welcome-screen');
  const convo = getActiveConversation();

  if (!convo || convo.messages.length === 0) {
    container.innerHTML = '';
    welcome.classList.remove('hidden');
    return;
  }
  welcome.classList.add('hidden');
  container.innerHTML = '';

  for (const msg of convo.messages) {
    const el = renderMessageElement(msg);
    container.appendChild(el);
  }

  scrollToBottom(false);
}

function renderMessageElement(msg) {
  const wrap = document.createElement('div');
  wrap.className = `message ${msg.role}`;
  wrap.dataset.msgId = msg.id;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  if (msg.role === 'assistant') {
    avatar.textContent = 'H';
    avatar.style.fontWeight = '700';
    avatar.style.fontFamily = 'var(--font-sans)';
  } else {
    const initials = (getPrefs().userName || 'You').charAt(0).toUpperCase();
    avatar.textContent = initials;
  }

  const body = document.createElement('div');
  body.className = 'message-body';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (msg.role === 'assistant') {
    bubble.innerHTML = renderMarkdown(msg.content) || '<span style="opacity:.5">…</span>';
    // Add generated image if image URL in content
    const imgs = extractImages(msg.content);
    imgs.forEach(img => {
      const genWrap = document.createElement('div');
      genWrap.className = 'generated-image';
      const i = document.createElement('img');
      i.src = img.url;
      i.alt = img.alt;
      i.loading = 'lazy';
      genWrap.appendChild(i);
      bubble.appendChild(genWrap);
    });

    // Apply highlight.js
    bubble.querySelectorAll('pre code').forEach(block => {
      if (window.hljs) hljs.highlightElement(block);
    });
  } else {
    bubble.textContent = msg.content;
  }

  body.appendChild(bubble);

  // Tool call pills (visual)
  if (msg.toolCalls && msg.toolCalls.length) {
    const toolsDiv = document.createElement('div');
    toolsDiv.style.marginTop = '6px';
    toolsDiv.style.display = 'flex';
    toolsDiv.style.flexWrap = 'wrap';
    toolsDiv.style.gap = '6px';
    msg.toolCalls.forEach(tc => {
      const chip = document.createElement('span');
      chip.className = 'tool-call';
      chip.style.animation = 'none';
      const icon = tc.cmd === 'SEARCH' ? '🔍' : tc.cmd === 'FETCH' ? '🌐' : tc.cmd === 'ADDPANEL' ? '📊' : tc.cmd === 'ADDTASK' ? '⏰' : tc.cmd === 'ADDPROJECT' ? '📁' : '💾';
      chip.innerHTML = `${icon} ${tc.cmd.toLowerCase()}: ${escapeHtml(tc.args.slice(0, 40))}${tc.args.length > 40 ? '…' : ''}`;
      toolsDiv.appendChild(chip);
    });
    body.appendChild(toolsDiv);
  }

  // Message actions
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  if (msg.role === 'assistant') {
    actions.innerHTML = `
      <button class="action-btn copy-btn" title="Copy">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="action-btn regen-btn" title="Regenerate">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <button class="action-btn speak-btn" title="Read aloud">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      </button>
    `;
    actions.querySelector('.copy-btn').addEventListener('click', () => {
      copyToClipboard(msg.content);
      toast('Copied');
    });
    actions.querySelector('.regen-btn').addEventListener('click', () => regenerateLast(msg.id));
    actions.querySelector('.speak-btn').addEventListener('click', () => speak(msg.content));
  } else {
    actions.innerHTML = `
      <button class="action-btn edit-btn" title="Edit">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    `;
  }

  body.appendChild(actions);
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function scrollToBottom(smooth = true) {
  const area = $('#chat-area');
  area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function showTyping(text = 'Thinking…') {
  const el = $('#typing-indicator');
  $('#typing-text').textContent = text;
  el.classList.add('show');
  scrollToBottom();
}
function hideTyping() {
  $('#typing-indicator').classList.remove('show');
}

// ==================== SENDING MESSAGES ====================
async function handleSend() {
  const input = $('#composer-input');
  const text = input.value.trim();
  if (!text) return;

  let convo = getActiveConversation();
  if (!convo) {
    convo = createConversation('New chat', getActiveProject()?.id || null);
  }

  // Hide welcome, add user message instantly
  $('#welcome-screen').classList.add('hidden');
  const userMsg = addMessage(convo.id, { role: 'user', content: text });
  const userEl = renderMessageElement(userMsg);
  $('#messages').appendChild(userEl);
  input.value = '';
  input.style.height = 'auto';
  updateSendButton();
  scrollToBottom();

  // Lock UI
  const sendBtn = $('#send-btn');
  sendBtn.disabled = true;
  showTyping('Thinking…');

  try {
    await sendMessage(convo.id, text, {
      onStart: (assistantId) => {
        // Add placeholder assistant message
        const placeholder = { id: assistantId, role: 'assistant', content: '' };
        const el = renderMessageElement(placeholder);
        $('#messages').appendChild(el);
        activeMessageElement = el;
      },
      onToken: (assistantId, fullContent, delta) => {
        // Update the last assistant bubble
        const lastMsg = $('#messages').querySelector(`.message.assistant[data-msg-id="${assistantId}"] .bubble`);
        if (lastMsg) {
          lastMsg.innerHTML = renderMarkdown(fullContent);
          lastMsg.classList.add('stream-cursor');
          lastMsg.querySelectorAll('pre code').forEach(block => {
            if (window.hljs) {
              delete block.dataset.highlighted;
              hljs.highlightElement(block);
            }
          });
        }
        scrollToBottom();
      },
      onTools: (assistantId, tools) => {
        const names = tools.map(t => {
          if (t.cmd === 'SEARCH') return 'Searching the web…';
          if (t.cmd === 'FETCH') return 'Fetching page…';
          if (t.cmd === 'ADDPANEL') return 'Adding panel…';
          if (t.cmd === 'ADDTASK') return 'Scheduling task…';
          if (t.cmd === 'ADDPROJECT') return 'Creating project…';
          if (t.cmd === 'REMEMBER') return 'Remembering…';
          return 'Working…';
        });
        showTyping(names[0] || 'Working…');
      },
      onDone: (assistantId, fullContent) => {
        hideTyping();
        const lastMsg = $('#messages').querySelector(`.message.assistant[data-msg-id="${assistantId}"] .bubble`);
        if (lastMsg) {
          lastMsg.innerHTML = renderMarkdown(fullContent);
          lastMsg.classList.remove('stream-cursor');
          lastMsg.querySelectorAll('pre code').forEach(block => {
            if (window.hljs) { delete block.dataset.highlighted; hljs.highlightElement(block); }
          });
          // Images
          const imgs = extractImages(fullContent);
          imgs.forEach(img => {
            const existing = lastMsg.querySelector(`.generated-image img[src="${img.url}"]`);
            if (existing) return;
            const genWrap = document.createElement('div');
            genWrap.className = 'generated-image';
            const iEl = document.createElement('img');
            iEl.src = img.url;
            iEl.alt = img.alt;
            iEl.loading = 'lazy';
            genWrap.appendChild(iEl);
            lastMsg.appendChild(genWrap);
          });
        }
        // Re-render the full message to get tool chips
        const convo = getActiveConversation();
        const msg = convo?.messages.find(m => m.id === assistantId);
        if (msg) {
          const newEl = renderMessageElement(msg);
          const oldEl = $(`[data-msg-id="${assistantId}"]`);
          if (oldEl) oldEl.replaceWith(newEl);
        }
        renderHistory();
        scrollToBottom();
        updateSendButton();
      },
      onError: () => {
        hideTyping();
        updateSendButton();
        toast('Something went wrong, try again', 'error');
      },
      onAbort: () => {
        hideTyping();
        updateSendButton();
      },
    });
  } catch (err) {
    console.error(err);
    hideTyping();
    updateSendButton();
  }
}

async function regenerateLast(userMsgId) {
  const convo = getActiveConversation();
  if (!convo) return;
  // Find the user message BEFORE this assistant message
  const idx = convo.messages.findIndex(m => m.id === userMsgId);
  if (idx <= 0) return;
  const userMsg = convo.messages[idx - 1];
  if (!userMsg || userMsg.role !== 'user') return;

  // Remove messages from this assistant msg onwards
  convo.messages = convo.messages.slice(0, idx);
  save();
  renderMessages();
  // Resend
  const input = $('#composer-input');
  input.value = userMsg.content;
  handleSend();
}

function stopGeneration() {
  abort();
  hideTyping();
  stopSpeaking();
  updateSendButton();
}

// ==================== EVENTS ====================
function bindGlobalEvents() {
  // Sidebar
  $('#sidebar-toggle').addEventListener('click', openSidebar);
  $('#sidebar-close').addEventListener('click', closeSidebar);
  $('#sidebar-overlay').addEventListener('click', closeSidebar);

  // New chat
  $('#new-chat-btn').addEventListener('click', () => {
    createConversation('New chat', getActiveProject()?.id || null);
    navigate('chat');
    renderAll();
  });

  // Nav items
  $$('.nav-item[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });

  // Theme toggle (top bar)
  $('#theme-toggle').addEventListener('click', () => {
    const current = getPrefs().theme;
    // Quick toggle: dark <-> light
    const next = current === 'dark' ? 'light' : 'dark';
    updatePrefs({ theme: next });
    applyTheme();
    renderSettings();
  });

  // Profile button shows settings
  $('#profile-btn').addEventListener('click', () => navigate('settings'));

  // Modal close
  $$('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', () => {
      el.closest('.modal').classList.add('hidden');
    });
  });

  // Capabilities button
  $('#show-capabilities').addEventListener('click', showCapabilitiesModal);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopGeneration();
      $$('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
      closeSidebar();
    }
    // Ctrl/Cmd+K new chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      createConversation('New chat', getActiveProject()?.id || null);
      navigate('chat');
      renderAll();
      $('#composer-input').focus();
    }
  });

  // Navigate on nav item clicks
  $$('.nav-item[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });
}

function bindChatEvents() {
  const input = $('#composer-input');
  const sendBtn = $('#send-btn');
  const micBtn = $('#mic-btn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    updateSendButton();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', () => {
    if (sendBtn.dataset.mode === 'stop') {
      stopGeneration();
    } else {
      handleSend();
    }
  });

  micBtn.addEventListener('click', toggleVoice);
  updateSendButton();
}

function updateSendButton() {
  const btn = $('#send-btn');
  const input = $('#composer-input');
  const text = input.value.trim();
  if (_isGenerating) {
    btn.dataset.mode = 'stop';
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  } else {
    btn.dataset.mode = 'send';
    btn.disabled = text.length === 0;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
}

function bindCapabilityCards() {
  $$('.capability-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      const input = $('#composer-input');
      input.value = prompt;
      input.focus();
      updateSendButton();
      handleSend();
    });
  });
}

// ==================== VOICE / SPEECH ====================
function toggleVoice() {
  if (isRecognizing) {
    stopRecognition();
    return;
  }
  if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
    toast('Voice input not supported in this browser (try Chrome).', 'error');
    return;
  }
  const btn = $('#mic-btn');
  btn.classList.add('listening');
  isRecognizing = true;

  recognition = startRecognition(
    (text, isFinal) => {
      $('#composer-input').value = text;
      $('#composer-input').dispatchEvent(new Event('input'));
    },
    (finalText) => {
      stopRecognition();
      if (finalText?.trim()) {
        $('#composer-input').value = finalText.trim();
        updateSendButton();
        handleSend();
      }
    },
    (err) => {
      console.warn('Recognition error:', err);
      stopRecognition();
      if (err !== 'no-speech' && err !== 'aborted') {
        toast('Voice recognition error. Try again.', 'error');
      }
    }
  );
}

function stopRecognition() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  isRecognizing = false;
  $('#mic-btn')?.classList.remove('listening');
}

function populateVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  const select = $('#voice-select');
  if (!select) return;
  select.innerHTML = '';
  const enVoices = voices.filter(v => v.lang.startsWith('en'));
  const voicesToUse = enVoices.length ? enVoices : voices;
  voicesToUse.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    select.appendChild(opt);
  });
  const saved = getPrefs().voiceURI;
  if (saved) select.value = saved;
}

// ==================== SETTINGS SCREEN ====================
function bindSettingsEvents() {
  // Theme segmented
  $$('#theme-segment button').forEach(b => {
    b.addEventListener('click', () => {
      updatePrefs({ theme: b.dataset.theme });
      applyTheme();
      $$('#theme-segment button').forEach(b2 => b2.classList.toggle('active', b2 === b));
    });
  });

  $('#model-select').addEventListener('change', (e) => {
    updatePrefs({ model: e.target.value });
  });

  $('#creativity').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    updatePrefs({ temperature: val });
    $('#creativity-val').textContent = val.toFixed(1);
  });

  $('#stream-toggle').addEventListener('change', (e) => {
    updatePrefs({ stream: e.target.checked });
  });

  $('#tts-toggle').addEventListener('change', (e) => {
    updatePrefs({ ttsEnabled: e.target.checked });
  });

  $('#voice-select').addEventListener('change', (e) => {
    updatePrefs({ voiceURI: e.target.value });
  });

  $('#user-name-input').addEventListener('input', (e) => {
    updatePrefs({ userName: e.target.value });
    $('#profile-name').textContent = e.target.value || 'You';
    const initial = (e.target.value || 'H').charAt(0).toUpperCase();
    $('#user-avatar').textContent = initial;
  });

  $('#export-all').addEventListener('click', () => {
    downloadExport();
    toast('Exported as JSON');
  });

  $('#import-all').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importFromFile(file);
      toast('Data imported! Refreshing…', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  });

  $('#delete-all').addEventListener('click', () => {
    if (confirm('Delete ALL data? This cannot be undone.')) {
      resetAll();
      toast('All data deleted.', 'success');
      setTimeout(() => location.reload(), 600);
    }
  });
}

function renderSettings() {
  const p = getPrefs();
  $('#model-select').value = p.model;
  $('#creativity').value = p.temperature;
  $('#creativity-val').textContent = p.temperature.toFixed(1);
  $('#stream-toggle').checked = p.stream;
  $('#tts-toggle').checked = p.ttsEnabled;
  $('#user-name-input').value = p.userName || '';
  $$('#theme-segment button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === p.theme);
  });
}

// ==================== MEMORY SCREEN ====================
function bindMemoryEvents() {
  $('#save-memory').addEventListener('click', () => {
    saveMemory({
      about: $('#memory-about').value,
      preferences: $('#memory-prefs').value,
      workflows: $('#memory-workflows').value,
    });
    toast('Memory saved', 'success');
  });
  $('#export-memory').addEventListener('click', () => {
    downloadExport();
    toast('Exported all data');
  });
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#clear-memory').addEventListener('click', () => {
    if (confirm('Clear all memory? Facts and preferences will be removed.')) {
      clearMemory();
      renderMemory();
      toast('Memory cleared');
    }
  });
}

function renderMemory() {
  const mem = getMemory();
  $('#memory-about').value = mem.about || '';
  $('#memory-prefs').value = mem.preferences || '';
  $('#memory-workflows').value = mem.workflows || '';

  const factsEl = $('#learned-facts');
  factsEl.innerHTML = '';
  if (mem.facts.length === 0) {
    factsEl.innerHTML = '<p style="color:var(--text-tertiary); font-size:13px;">No learned facts yet. As we chat, I\'ll save things you teach me here.</p>';
  } else {
    mem.facts.forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'fact-chip';
      chip.innerHTML = `${escapeHtml(f)} <button title="Remove">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        removeFact(f);
        renderMemory();
      });
      factsEl.appendChild(chip);
    });
  }
}

// ==================== PANELS ====================
function bindPanelEvents() {
  $('#add-panel-btn').addEventListener('click', addPanelFlow);
}

function renderPanels() {
  const grid = $('#panels-grid');
  const panels = getPanels();
  grid.innerHTML = '';
  if (panels.length === 0) {
    grid.innerHTML = '<div class="panels-empty">No panels yet. Ask me to watch a price, track a package, or create a quick note panel.</div>';
    return;
  }
  const icons = { price: '💰', package: '📦', score: '🏆', budget: '💳', note: '📝' };
  panels.forEach(p => {
    const card = document.createElement('div');
    card.className = 'panel-card';
    card.innerHTML = `
      <button class="panel-delete icon-btn" title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
      <div class="panel-title">${icons[p.type] || '📊'} ${escapeHtml(p.title)}</div>
      <div class="panel-value">${escapeHtml(p.value || '—')}</div>
      <div class="panel-desc">${escapeHtml(p.description || '')}</div>
    `;
    card.querySelector('.panel-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deletePanel(p.id);
      renderPanels();
    });
    grid.appendChild(card);
  });
}

function addPanelFlow() {
  showPromptModal('Add Home Panel', [
    { name: 'type', label: 'Type', type: 'select', options: [['price','Price'],['package','Package'],['score','Score'],['budget','Budget'],['note','Note']] },
    { name: 'title', label: 'Title', type: 'text', placeholder: 'e.g. AirPods Pro price' },
    { name: 'value', label: 'Current value (optional)', type: 'text' },
    { name: 'description', label: 'Description (optional)', type: 'textarea' },
  ], (values) => {
    if (!values.title?.trim()) return;
    addPanel({
      type: values.type || 'note',
      title: values.title.trim(),
      value: values.value?.trim() || '',
      description: values.description?.trim() || '',
    });
    renderPanels();
    toast('Panel added', 'success');
  });
}

// ==================== TASKS ====================
function bindTaskEvents() {
  $('#add-task-btn').addEventListener('click', addTaskFlow);
}

function renderTasks() {
  const list = $('#tasks-list');
  const tasks = getTasks();
  list.innerHTML = '';
  if (tasks.length === 0) {
    list.innerHTML = '<div class="tasks-empty">No scheduled tasks yet. Ask me to set a reminder, daily briefing, or price check.</div>';
    return;
  }
  const icons = { once: '⏰', daily: '🔁', weekly: '📅' };
  tasks.forEach(t => {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.innerHTML = `
      <div class="task-icon">${icons[t.type] || icons[t.schedule] || '⏰'}</div>
      <div class="task-info">
        <div class="task-name">${escapeHtml(t.title)}</div>
        <div class="task-schedule">${escapeHtml(t.schedule || 'Once')}${t.prompt && t.prompt !== t.title ? ' · ' + escapeHtml(t.prompt.slice(0, 80)) : ''}</div>
      </div>
      <button class="task-delete icon-btn" title="Delete">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    `;
    card.querySelector('.task-delete').addEventListener('click', () => {
      deleteTask(t.id);
      renderTasks();
    });
    list.appendChild(card);
  });
}

function addTaskFlow() {
  showPromptModal('Schedule a Task', [
    { name: 'title', label: 'Task name', type: 'text', placeholder: 'e.g. Daily morning briefing' },
    { name: 'schedule', label: 'Schedule', type: 'select', options: [['once','Once'],['daily','Daily'],['weekly','Weekly'],['morning','Every morning at 8am'],['evening','Every evening at 7pm']] },
    { name: 'prompt', label: 'What should I do?', type: 'textarea', placeholder: 'e.g. Give me a 3-bullet morning news briefing' },
  ], (values) => {
    if (!values.title?.trim()) return;
    addTask({
      title: values.title.trim(),
      schedule: values.schedule || 'once',
      type: ['daily','weekly'].includes(values.schedule) ? values.schedule : 'once',
      prompt: values.prompt?.trim() || values.title.trim(),
    });
    requestNotificationPermission();
    renderTasks();
    toast('Task scheduled', 'success');
  });
}

/**
 * Run the scheduled task loop — checks every minute if any tasks are due.
 */
function runScheduledTaskLoop() {
  setInterval(async () => {
    const tasks = getTasks();
    const now = new Date();
    for (const task of tasks) {
      if (task.type === 'once') continue;
      // Simple hourly/daily trigger logic
      const lastRun = task.lastRun ? new Date(task.lastRun) : null;
      if (task.type === 'daily') {
        if (!lastRun || now.getDate() !== lastRun.getDate()) {
          // Run daily tasks (we just show a notification; user can click to act)
          notify(task.title, task.prompt || '');
          updateTaskRan(task.id);
        }
      }
      if (task.type === 'weekly') {
        const weekAgo = Date.now() - 7*24*60*60*1000;
        if (!lastRun || lastRun.getTime() < weekAgo) {
          notify(task.title, task.prompt || '');
          updateTaskRan(task.id);
        }
      }
    }
  }, 60000);
}

function updateTaskRan(id) {
  const tasks = getTasks();
  const t = tasks.find(tt => tt.id === id);
  if (t) { t.lastRun = Date.now(); save(); }
}

// ==================== PROJECTS ====================
function bindProjectEvents() {
  $('#add-project-btn').addEventListener('click', addProjectFlow);
}

function renderProjects() {
  const grid = $('#projects-grid');
  const projects = getAllProjects();
  const activeId = getData().activeProjectId;
  grid.innerHTML = '';
  if (projects.length === 0) {
    grid.innerHTML = '<div class="projects-empty">No projects yet. Create spaces for things like "Move to Berlin", "Wedding planning", or "Job hunt".</div>';
    return;
  }
  projects.forEach(p => {
    const card = document.createElement('button');
    card.className = 'project-card' + (p.id === activeId ? ' active' : '');
    card.innerHTML = `
      <button class="project-delete icon-btn" title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
      <div class="project-emoji">${p.emoji || '📁'}</div>
      <div class="project-name">${escapeHtml(p.name)}</div>
      <div class="project-desc">${escapeHtml(p.description || 'No description')}</div>
      <div class="project-meta">
        ${p.id === activeId ? '<span style="color:var(--accent)">● Current project</span>' : 'Tap to switch'}
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-delete')) return;
      setActiveProject(p.id);
      setActiveProjectContext();
      renderProjects();
      renderHistory();
      toast(`Switched to project: ${p.name}`, 'success');
      navigate('chat');
    });
    card.querySelector('.project-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (confirm(`Delete project "${p.name}"? Conversations will be kept but unassigned.`)) {
        deleteProject(p.id);
        setActiveProjectContext();
        renderProjects();
        renderHistory();
      }
    });
    grid.appendChild(card);
  });
}

function setActiveProjectContext() {
  const project = getActiveProject();
  const el = $('#project-context');
  if (project) {
    el.textContent = `${project.emoji} ${project.name}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function addProjectFlow() {
  showPromptModal('New Project', [
    { name: 'name', label: 'Project name', type: 'text', placeholder: 'e.g. Wedding planning' },
    { name: 'emoji', label: 'Emoji (single character)', type: 'text', placeholder: '💍' },
    { name: 'description', label: 'Description (optional)', type: 'textarea' },
  ], (values) => {
    if (!values.name?.trim()) return;
    createProject(values.name.trim(), values.emoji?.trim().slice(0, 2) || '📁', values.description?.trim() || '');
    setActiveProjectContext();
    renderProjects();
    renderHistory();
    toast('Project created & selected', 'success');
  });
}

// ==================== CAPABILITIES MODAL ====================
function showCapabilitiesModal() {
  const caps = [
    ['Research', 'deep web research, comparisons, news, fact checks, product picks.'],
    ['Use a real browser', 'sign in to sites, fill forms, create accounts, and act on sites I\'ve never seen.'],
    ['Shopping', 'find products, build carts, and check out with your go-ahead. Includes Amazon, groceries, flowers and gifts.'],
    ['Food', 'order delivery or pickup, and book restaurant tables.'],
    ['Travel', 'find and book flights and hotels, plan full trips, help on travel day with delays and check-in.'],
    ['Bookings', 'doctors, dentists, salons, home services, movie and event tickets, rides.'],
    ['Money', 'find subscriptions to cancel, cut bills, chase refunds, and track orders and returns.'],
    ['Email, calendar and files', 'connect Google or Microsoft 365 to draft/send email, manage calendars, edit Docs/Sheets/Drive. Also works with Slack, GitHub, Jira, Confluence, Linear.'],
    ['Make things', 'Pages (websites), slide decks, PDFs, charts, spreadsheets, images, code.'],
    ['Video and audio', 'edit, trim, crop for social, clean up, convert, make GIFs, summarise YouTube videos.'],
    ['Home panels', 'live trackers on your Home screen for prices, packages, scores and budgets.'],
    ['Scheduled tasks', 'reminders and recurring checks, like a daily briefing or price watch.'],
    ['Projects', 'separate spaces for big efforts like a move, job hunt or wedding.'],
    ['Memory and specialties', 'I remember your preferences, and you can teach me workflows to repeat your way.'],
  ];
  const wontDo = [
    'Make phone calls or text other people.',
    'Fake engagement (bot likes, views, follows) or get pirated content.',
    'Pay or send anything in your name without your OK.',
  ];
  const list = $('#capabilities-list');
  list.innerHTML = caps.map(([name, desc]) => `<li><div><strong>${name}</strong><span>${desc}</span></div></li>`).join('');
  $('#wont-do-list').innerHTML = wontDo.map(x => `<li>${x}</li>`).join('');
  $('#capabilities-modal').classList.remove('hidden');
}

// ==================== GENERIC MODAL / PROMPTER ====================
function showPromptModal(title, fields, onSubmit) {
  const modal = $('#generic-modal');
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'modal-form';
  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-form-group';
    const label = document.createElement('label');
    label.textContent = f.label;
    label.setAttribute('for', `mp-${f.name}`);
    wrap.appendChild(label);
    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
    } else if (f.type === 'select') {
      input = document.createElement('select');
      f.options.forEach(([val, label]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = label;
        input.appendChild(o);
      });
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.id = `mp-${f.name}`;
    input.name = f.name;
    wrap.appendChild(input);
    form.appendChild(wrap);
  });
  const actions = document.createElement('div');
  actions.className = 'modal-form-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => modal.classList.add('hidden'));
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-btn';
  submit.textContent = 'Confirm';
  actions.appendChild(cancel);
  actions.appendChild(submit);
  form.appendChild(actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = {};
    fields.forEach(f => {
      values[f.name] = form.elements[f.name]?.value ?? '';
    });
    modal.classList.add('hidden');
    onSubmit(values);
  });
  body.appendChild(form);
  modal.classList.remove('hidden');
  setTimeout(() => {
    const firstInput = form.querySelector('input, textarea, select');
    if (firstInput) firstInput.focus();
  }, 100);
}

// ==================== TOAST ====================
let toastTimer = null;
function toast(message, type = 'success') {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
  }, 2600);
}

// ==================== RENDER ALL ====================
function renderAll() {
  renderHistory();
  renderMessages();
  setActiveProjectContext();

  // Settings
  const prefs = getPrefs();
  $('#profile-name').textContent = prefs.userName || 'You';
  $('#user-avatar').textContent = (prefs.userName || 'H').charAt(0).toUpperCase();
  renderSettings();
}

// ==================== SERVICE WORKER ====================
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW registration failed:', e);
    }
  }
}

// ==================== UTILITIES ====================
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Generation state (kept in sync by send button UI logic)
let _isGenerating = false;

// Boot
document.addEventListener('DOMContentLoaded', init);

// Keep send button state in sync with typing indicator visibility
setInterval(() => {
  const typingShown = $('#typing-indicator')?.classList.contains('show');
  _isGenerating = !!typingShown;
  const btn = $('#send-btn');
  const input = $('#composer-input');
  if (!btn || !input) return;
  if (_isGenerating) {
    btn.dataset.mode = 'stop';
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  } else {
    btn.dataset.mode = 'send';
    const text = input.value.trim();
    btn.disabled = text.length === 0;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
}, 120);
