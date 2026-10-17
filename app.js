/* =====================================================================
   NOVA — personal AI assistant (plain JavaScript, no build step)
   Works on GitHub Pages. All data is saved in this browser (localStorage).
   ===================================================================== */

/* ---------- 1. Settings you may want to change ---------- */
const GEMINI_MODEL = 'gemini-2.5-flash-lite';        // Google Gemini model (free tier)
const GROQ_MODEL = 'openai/gpt-oss-120b';      // Groq backup model (free tier)
const STORE_KEY = 'nova.data.v1';                  // where data is saved in the browser
const HISTORY_SENT = 16;                           // how many recent messages are sent as context

/* ---------- 2. Data storage ---------- */
const defaults = () => ({
  settings: { geminiKey: '', groqKey: '', name: 'NOVA', user: '', persona: 'Warm, smart, encouraging and straight to the point. Uses simple language.', speak: false, theme: 'dark' },
  chat: [], tasks: [], reminders: [], notes: [], memory: [], money: []
});
let db = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!d) return defaults();
    const base = defaults();
    return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  } catch (e) { return defaults(); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 3. Small helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(d) { if (!d) return ''; const x = new Date(d); return isNaN(x) ? d : x.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function localISO(date = new Date()) { const p = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`; }
function money(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

/* Tiny, safe Markdown renderer (bold, italic, code, lists, headings, links) */
function md(text) {
  const blocks = [];
  let s = esc(text).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, code) => { blocks.push(`<pre><code>${code}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
       .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
       .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
       .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = s.split('\n'); let out = '', inList = false;
  for (const line of lines) {
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (h) out += `<p><b>${h[1]}</b></p>`;
    else if (line.trim()) out += `<p>${line}</p>`;
  }
  if (inList) out += '</ul>';
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

/* ---------- 4. Navigation ---------- */
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  if (view === 'money') renderMoney();
}
$$('.nav').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
$('#settingsBtn').addEventListener('click', () => show('settings'));
$('#newChatBtn').addEventListener('click', () => {
  if (db.chat.length && !confirm('Start a new chat? Your tasks, notes and memory stay.')) return;
  db.chat = []; save(); renderChat(); show('chat');
});

/* ---------- 5. The AI brain ---------- */
function systemPrompt() {
  const s = db.settings, now = new Date();
  const openTasks = db.tasks.filter(t => !t.done).map(t => `- ${t.text}${t.due ? ' (due ' + t.due + ')' : ''}${t.priority === 'high' ? ' [HIGH]' : ''}`).join('\n') || 'none';
  const rems = db.reminders.filter(r => !r.fired || r.repeat !== 'none').map(r => `- ${r.text} at ${r.time}${r.repeat !== 'none' ? ' (' + r.repeat + ')' : ''}`).join('\n') || 'none';
  const mem = db.memory.map(m => '- ' + m.text).join('\n') || 'nothing yet';
  const month = now.toISOString().slice(0, 7);
  const spent = db.money.filter(m => m.type === 'expense' && m.date.startsWith(month)).reduce((a, m) => a + Number(m.amount), 0);
  const earned = db.money.filter(m => m.type === 'income' && m.date.startsWith(month)).reduce((a, m) => a + Number(m.amount), 0);
  return `You are ${s.name}, a premium personal AI assistant for ${s.user || 'the user'}.
Personality: ${s.persona}
Current local date and time: ${now.toString()} (ISO local: ${localISO(now)}).

What you know about the user:
${mem}

Open tasks:
${openTasks}

Upcoming reminders:
${rems}

Money this month: spent ${money(spent)}, earned ${money(earned)}.

You can take real actions in the app. When the user asks you to add/complete a task, set a reminder, save a note, remember something, or log money, do it by adding ONE block at the very end of your reply, exactly like this:
<actions>[{"type":"add_task","text":"Buy data","due":"2026-10-20","priority":"normal"}]</actions>
Allowed action types and fields:
- add_task: text, due (YYYY-MM-DD or ""), priority (high|normal|low)
- complete_task: text (words from the task name)
- add_reminder: text, time (local "YYYY-MM-DDTHH:MM", work it out from the current time), repeat (none|daily|weekly)
- add_note: title, body
- remember: fact (a lasting fact about the user worth remembering)
- add_money: kind (expense|income), amount (number), category
Only include the block when an action is needed. Never show or explain the block; just confirm in plain words what you did.
For a "daily brief", summarise today's tasks, reminders and money, and end with one short motivational line.
Be concise, friendly and useful. Use short paragraphs or bullet points.`;
}

function buildHistory() {
  return db.chat.slice(-HISTORY_SENT).filter(m => !m.error);
}

async function callGemini(history, useSearch = true) {
  const key = db.settings.geminiKey.trim();
  const contents = history.map(m => {
    const parts = [];
    if (m.file && m.file.data) parts.push({ inline_data: { mime_type: m.file.type, data: m.file.data } });
    parts.push({ text: m.text || '(see attachment)' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });
  const body = { systemInstruction: { parts: [{ text: systemPrompt() }] }, contents };
  if (useSearch) body.tools = [{ google_search: {} }];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // If web search is not allowed for this key/model, try again without it
    if (useSearch && res.status === 400) return callGemini(history, false);
    const err = new Error(data.error?.message || ('Gemini error ' + res.status)); err.status = res.status; throw err;
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean).slice(0, 5);
  if (!text) throw new Error('Gemini returned an empty reply' + (cand?.finishReason ? ' (' + cand.finishReason + ')' : ''));
  return { text, sources, by: 'Gemini' };
}

async function callGroq(history) {
  const key = db.settings.groqKey.trim();
  const messages = [{ role: 'system', content: systemPrompt() }].concat(
    history.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '(attachment not supported on backup model)' })));
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.7 })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error?.message || ('Groq error ' + res.status)); err.status = res.status; throw err; }
  return { text: (data.choices?.[0]?.message?.content || '').trim(), sources: [], by: 'Groq' };
}

/* Try Gemini first, then Groq as backup */
async function askAI(history) {
  const s = db.settings, errors = [];
  if (!s.geminiKey && !s.groqKey) throw new Error('NO_KEY');
  if (!navigator.onLine) throw new Error('You seem to be offline. Check your internet and try again.');
  if (s.geminiKey) { try { return await callGemini(history); } catch (e) { errors.push('Gemini: ' + friendly(e)); } }
  if (s.groqKey) { try { return await callGroq(history); } catch (e) { errors.push('Groq: ' + friendly(e)); } }
  throw new Error(errors.join('\n'));
}
function friendly(e) {
  if (e.status === 400 || e.status === 401 || e.status === 403) return 'the key looks wrong or not allowed. ' + e.message;
  if (e.status === 429) return 'free limit reached for now, wait a minute and try again.';
  if (e.message === 'Failed to fetch') return 'could not connect (check internet).';
  return e.message;
}

/* ---------- 6. Actions the AI can perform ---------- */
function runActions(text) {
  const m = text.match(/<actions>([\s\S]*?)<\/actions>/i);
  const clean = text.replace(/<actions>[\s\S]*?<\/actions>/gi, '').trim();
  const done = [];
  if (m) {
    let list = [];
    try { list = JSON.parse(m[1].trim()); if (!Array.isArray(list)) list = [list]; } catch (e) { list = []; }
    for (const a of list) {
      try {
        if (a.type === 'add_task' && a.text) { db.tasks.unshift({ id: uid(), text: a.text, due: a.due || '', priority: a.priority || 'normal', done: false, created: Date.now() }); done.push('✅ Task added: ' + a.text); }
        else if (a.type === 'complete_task' && a.text) {
          const t = db.tasks.find(t => !t.done && t.text.toLowerCase().includes(String(a.text).toLowerCase()));
          if (t) { t.done = true; done.push('☑️ Completed: ' + t.text); }
        }
        else if (a.type === 'add_reminder' && a.text && a.time) { db.reminders.push({ id: uid(), text: a.text, time: a.time, repeat: a.repeat || 'none', fired: false }); done.push('⏰ Reminder set: ' + fmtDate(a.time) + ', ' + a.text); askNotify(); }
        else if (a.type === 'add_note' && (a.body || a.title)) { db.notes.unshift({ id: uid(), title: a.title || 'Note', body: a.body || '', created: Date.now() }); done.push('📝 Note saved: ' + (a.title || 'Note')); }
        else if (a.type === 'remember' && a.fact) { db.memory.push({ id: uid(), text: a.fact }); done.push('🧠 Remembered: ' + a.fact); }
        else if (a.type === 'add_money' && a.amount) { const kind = a.kind === 'income' ? 'income' : 'expense'; db.money.unshift({ id: uid(), type: kind, amount: Number(a.amount), category: a.category || 'other', date: localISO() }); done.push((kind === 'income' ? '🟢 Income ' : '💰 Spent ') + money(a.amount) + ' (' + (a.category || 'other') + ')'); }
      } catch (e) { /* skip a broken action */ }
    }
    save(); renderAll();
  }
  return { clean, done };
}

/* ---------- 7. Chat screen ---------- */
let pendingFile = null, busy = false;

function renderChat() {
  const box = $('#messages'); box.innerHTML = '';
  if (!db.chat.length) {
    box.innerHTML = `<div class="welcome"><img src="./icon.svg" alt=""><h1>Hi${db.settings.user ? ', ' + esc(db.settings.user) : ''} 👋</h1><p>I'm ${esc(db.settings.name)}. Ask me anything, or say things like<br>“remind me at 7pm to study” or “I spent 1500 on lunch”.</p>${(!db.settings.geminiKey && !db.settings.groqKey) ? '<p><b>First, add your free API key in ⚙️ Settings.</b></p>' : ''}</div>`;
  }
  db.chat.forEach((m, i) => box.appendChild(bubble(m, i)));
  box.scrollTop = box.scrollHeight;
}

function bubble(m, i) {
  const el = document.createElement('div');
  el.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
  let html = '';
  if (m.file && m.file.preview) html += `<img class="thumb" src="${m.file.preview}" alt="">`;
  else if (m.file) html += `<div class="hint">📎 ${esc(m.file.name)}</div>`;
  html += m.role === 'user' ? esc(m.text).replace(/\n/g, '<br>') : md(m.text);
  if (m.done && m.done.length) html += `<div class="action-card">${m.done.map(esc).join('<br>')}</div>`;
  if (m.sources && m.sources.length) html += `<div class="sources">${m.sources.map(s => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || 'source')}</a>`).join('')}</div>`;
  html += `<div class="meta">${fmtTime(m.ts)}${m.by ? ' · ' + m.by : ''}`;
  if (m.role !== 'user') html += ` <button data-copy="${i}">Copy</button> <button data-regen="${i}">↻ Retry</button> <button data-speak="${i}">🔊</button> <button data-rem="${i}">🧠</button>`;
  html += '</div>';
  el.innerHTML = html;
  return el;
}

$('#messages').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.copy) { navigator.clipboard.writeText(db.chat[b.dataset.copy].text); toast('Copied'); }
  if (b.dataset.speak) speak(db.chat[b.dataset.speak].text);
  if (b.dataset.rem) { const t = prompt('Remember this about you:', db.chat[b.dataset.rem].text.slice(0, 200)); if (t) { db.memory.push({ id: uid(), text: t }); save(); renderMemory(); toast('Saved to memory'); } }
  if (b.dataset.regen) { const i = Number(b.dataset.regen); db.chat.splice(i, 1); save(); renderChat(); reply(); }
});

async function send(text) {
  text = (text || '').trim();
  if ((!text && !pendingFile) || busy) return;
  db.chat.push({ role: 'user', text, ts: Date.now(), file: pendingFile });
  pendingFile = null; $('#attachPreview').classList.add('hidden'); $('#fileInput').value = '';
  $('#chatInput').value = ''; autoGrow();
  save(); renderChat(); reply();
}

async function reply() {
  busy = true; $('#sendBtn').disabled = true;
  const box = $('#messages');
  const typing = document.createElement('div'); typing.className = 'msg bot typing'; typing.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(typing); box.scrollTop = box.scrollHeight;
  try {
    const r = await askAI(buildHistory());
    const { clean, done } = runActions(r.text);
    db.chat.push({ role: 'bot', text: clean || 'Done.', done, sources: r.sources, by: r.by, ts: Date.now() });
    if (db.settings.speak) speak(clean);
  } catch (e) {
    const msg = e.message === 'NO_KEY'
      ? 'I need a free API key before I can chat. 🔑 Tap ⚙️ at the top right and paste your Gemini key from Google AI Studio.\n\nTasks, reminders, notes and money still work without a key.'
      : '⚠️ ' + e.message;
    db.chat.push({ role: 'bot', text: msg, ts: Date.now(), error: true });
  }
  // keep stored images small: drop old image data
  db.chat.forEach((m, i) => { if (m.file && i < db.chat.length - 4) { delete m.file.data; } });
  save(); typing.remove(); renderChat();
  busy = false; $('#sendBtn').disabled = false;
}

$('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); send($('#chatInput').value); });
$('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); send($('#chatInput').value); } });
$('#chatInput').addEventListener('input', autoGrow);
function autoGrow() { const t = $('#chatInput'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }
$$('.chip').forEach(c => c.addEventListener('click', () => send(c.dataset.prompt)));

/* Attach image or PDF (sent to Gemini) */
$('#fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 8 * 1024 * 1024) { toast('File too big (max 8 MB)'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    pendingFile = { name: f.name, type: f.type, data: dataUrl.split(',')[1], preview: f.type.startsWith('image/') ? dataUrl : '' };
    const p = $('#attachPreview'); p.innerHTML = `📎 ${esc(f.name)} <button type="button" id="rmFile">✕</button>`; p.classList.remove('hidden');
    $('#rmFile').onclick = () => { pendingFile = null; p.classList.add('hidden'); $('#fileInput').value = ''; };
  };
  reader.readAsDataURL(f);
});

/* ---------- 8. Voice ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$('#micBtn').addEventListener('click', () => {
  if (!SR) { toast('Voice input is not supported in this browser. Try Chrome.'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  $('#micBtn').classList.add('recording');
  rec.onresult = (e) => { $('#chatInput').value = Array.from(e.results).map(r => r[0].transcript).join(''); autoGrow(); };
  rec.onend = () => { $('#micBtn').classList.remove('recording'); const t = $('#chatInput').value; rec = null; if (t.trim()) send(t); };
  rec.onerror = () => { $('#micBtn').classList.remove('recording'); rec = null; };
  rec.start();
});
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/[*#`_>]/g, '').slice(0, 1500));
  u.lang = navigator.language || 'en-US'; speechSynthesis.speak(u);
}

/* ---------- 9. Tasks ---------- */
let taskFilter = 'open';
$('#taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  db.tasks.unshift({ id: uid(), text: $('#taskText').value.trim(), due: $('#taskDue').value, priority: $('#taskPri').value, done: false, created: Date.now() });
  e.target.reset(); save(); renderTasks();
});
$$('#taskFilters .filter').forEach(b => b.addEventListener('click', () => { taskFilter = b.dataset.f; $$('#taskFilters .filter').forEach(x => x.classList.toggle('active', x === b)); renderTasks(); }));
function renderTasks() {
  const list = $('#taskList');
  const items = db.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.done : !t.done))
    .sort((a, b) => (a.done - b.done) || ((b.priority === 'high') - (a.priority === 'high')) || String(a.due || '9').localeCompare(String(b.due || '9')));
  list.innerHTML = items.length ? items.map(t => `<li class="${t.done ? 'done' : ''} pri-${t.priority}"><input type="checkbox" data-tick="${t.id}" ${t.done ? 'checked' : ''}><div class="grow"><div class="title">${esc(t.text)}</div><small>${t.due ? '📅 ' + esc(t.due) : ''} ${t.priority === 'high' ? '🔴 High' : ''}</small></div><button data-del="${t.id}">🗑️</button></li>`).join('') : '<p class="hint">No tasks here. Add one above or tell NOVA in chat.</p>';
}
$('#taskList').addEventListener('click', (e) => {
  const tick = e.target.dataset.tick, del = e.target.dataset.del;
  if (tick) { const t = db.tasks.find(x => x.id === tick); t.done = !t.done; save(); renderTasks(); }
  if (del) { db.tasks = db.tasks.filter(x => x.id !== del); save(); renderTasks(); }
});

/* ---------- 10. Reminders ---------- */
$('#remForm').addEventListener('submit', (e) => {
  e.preventDefault();
  db.reminders.push({ id: uid(), text: $('#remText').value.trim(), time: $('#remTime').value, repeat: $('#remRepeat').value, fired: false });
  e.target.reset(); save(); renderReminders(); askNotify(); toast('Reminder set');
});
function renderReminders() {
  const items = [...db.reminders].sort((a, b) => a.time.localeCompare(b.time));
  $('#remList').innerHTML = items.length ? items.map(r => `<li class="${r.fired && r.repeat === 'none' ? 'done' : ''}"><span>⏰</span><div class="grow"><div class="title">${esc(r.text)}</div><small>${fmtDate(r.time)}${r.repeat !== 'none' ? ' · repeats ' + r.repeat : ''}</small></div><button data-snooze="${r.id}" title="Snooze 10 min">💤</button><button data-del="${r.id}">🗑️</button></li>`).join('') : '<p class="hint">No reminders yet.</p>';
}
$('#remList').addEventListener('click', (e) => {
  const id = e.target.dataset.del || e.target.dataset.snooze; if (!id) return;
  if (e.target.dataset.del) db.reminders = db.reminders.filter(r => r.id !== id);
  else { const r = db.reminders.find(x => x.id === id); r.time = localISO(new Date(Date.now() + 10 * 60000)); r.fired = false; toast('Snoozed 10 minutes'); }
  save(); renderReminders();
});
function askNotify() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
function checkReminders() {
  const now = localISO();
  let changed = false;
  for (const r of db.reminders) {
    if (!r.fired && r.time <= now) {
      notify('⏰ ' + db.settings.name + ' reminder', r.text);
      if (r.repeat === 'daily' || r.repeat === 'weekly') {
        const d = new Date(r.time); do { d.setDate(d.getDate() + (r.repeat === 'daily' ? 1 : 7)); } while (localISO(d) <= now);
        r.time = localISO(d);
      } else r.fired = true;
      changed = true;
    }
  }
  if (changed) { save(); renderReminders(); }
}
async function notify(title, body) {
  toast(title + ': ' + body);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) reg.showNotification(title, { body, icon: './icon.svg' }); else new Notification(title, { body }); }
    catch (e) { try { new Notification(title, { body }); } catch (_) {} }
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
setInterval(checkReminders, 20000);

/* ---------- 11. Notes ---------- */
$('#noteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  db.notes.unshift({ id: uid(), title: $('#noteTitle').value.trim() || 'Note', body: $('#noteBody').value.trim(), created: Date.now() });
  e.target.reset(); save(); renderNotes();
});
$('#noteSearch').addEventListener('input', renderNotes);
function renderNotes() {
  const q = $('#noteSearch').value.toLowerCase();
  const items = db.notes.filter(n => (n.title + ' ' + n.body).toLowerCase().includes(q));
  $('#noteList').innerHTML = items.length ? items.map(n => `<li><div class="grow"><div class="title"><b>${esc(n.title)}</b></div><small style="white-space:pre-wrap">${esc(n.body)}</small></div><button data-del="${n.id}">🗑️</button></li>`).join('') : '<p class="hint">No notes yet.</p>';
}
$('#noteList').addEventListener('click', (e) => { const id = e.target.dataset.del; if (id) { db.notes = db.notes.filter(n => n.id !== id); save(); renderNotes(); } });

/* ---------- 12. Money ---------- */
$('#moneyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  db.money.unshift({ id: uid(), type: $('#moneyType').value, amount: Number($('#moneyAmt').value), category: $('#moneyCat').value.trim() || 'other', date: localISO() });
  e.target.reset(); save(); renderMoney();
});
function renderMoney() {
  const now = new Date(), month = localISO(now).slice(0, 7);
  const weekAgo = localISO(new Date(Date.now() - 7 * 864e5));
  const sum = (f) => db.money.filter(f).reduce((a, m) => a + Number(m.amount), 0);
  const mSpent = sum(m => m.type === 'expense' && m.date.startsWith(month));
  const mEarned = sum(m => m.type === 'income' && m.date.startsWith(month));
  const wSpent = sum(m => m.type === 'expense' && m.date >= weekAgo);
  $('#moneyStats').innerHTML = `<div class="stat"><b>${money(wSpent)}</b><span>Spent this week</span></div><div class="stat"><b>${money(mSpent)}</b><span>Spent this month</span></div><div class="stat"><b>${money(mEarned - mSpent)}</b><span>Balance this month</span></div>`;
  $('#moneyList').innerHTML = db.money.length ? db.money.slice(0, 60).map(m => `<li><span>${m.type === 'income' ? '🟢' : '🔴'}</span><div class="grow"><div class="title">${esc(m.category)}</div><small>${fmtDate(m.date)}</small></div><b>${m.type === 'income' ? '+' : '-'}${money(m.amount)}</b><button data-del="${m.id}">🗑️</button></li>`).join('') : '<p class="hint">Nothing logged yet. Try telling NOVA “I spent 1500 on lunch”.</p>';
  drawChart();
}
$('#moneyList').addEventListener('click', (e) => { const id = e.target.dataset.del; if (id) { db.money = db.money.filter(m => m.id !== id); save(); renderMoney(); } });
function drawChart() {
  const c = $('#moneyChart'); if (!c.offsetWidth) return;
  const dpr = window.devicePixelRatio || 1; c.width = c.offsetWidth * dpr; c.height = 160 * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const W = c.offsetWidth, H = 160, days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = localISO(d).slice(0, 10); days.push({ k, label: d.toLocaleDateString([], { weekday: 'short' }), v: db.money.filter(m => m.type === 'expense' && m.date.startsWith(k)).reduce((a, m) => a + Number(m.amount), 0) }); }
  const max = Math.max(1, ...days.map(d => d.v)); const bw = W / 7;
  const css = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H); ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  days.forEach((d, i) => {
    const h = (d.v / max) * (H - 50); const x = i * bw + bw * 0.25, y = H - 24 - h;
    const g = ctx.createLinearGradient(0, y, 0, H - 24); g.addColorStop(0, '#7c5cff'); g.addColorStop(1, '#22d3ee');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw * 0.5, Math.max(h, 2), 6) : ctx.rect(x, y, bw * 0.5, Math.max(h, 2)); ctx.fill();
    ctx.fillStyle = css.getPropertyValue('--muted'); ctx.fillText(d.label, i * bw + bw / 2, H - 8);
    if (d.v) ctx.fillText(money(d.v), i * bw + bw / 2, y - 5);
  });
}

/* ---------- 13. Memory ---------- */
$('#memForm').addEventListener('submit', (e) => { e.preventDefault(); db.memory.push({ id: uid(), text: $('#memText').value.trim() }); e.target.reset(); save(); renderMemory(); });
function renderMemory() {
  $('#memList').innerHTML = db.memory.length ? db.memory.map(m => `<li><span>🧠</span><div class="grow">${esc(m.text)}</div><button data-edit="${m.id}">✏️</button><button data-del="${m.id}">🗑️</button></li>`).join('') : '<p class="hint">NOVA hasn\'t saved anything about you yet.</p>';
}
$('#memList').addEventListener('click', (e) => {
  const { del, edit } = e.target.dataset;
  if (del) db.memory = db.memory.filter(m => m.id !== del);
  if (edit) { const m = db.memory.find(x => x.id === edit); const t = prompt('Edit memory', m.text); if (t !== null) m.text = t.trim(); }
  save(); renderMemory();
});

/* ---------- 14. Settings ---------- */
function fillSettings() {
  const s = db.settings;
  $('#setGemini').value = s.geminiKey; $('#setGroq').value = s.groqKey;
  $('#setName').value = s.name; $('#setUser').value = s.user; $('#setPersona').value = s.persona;
  $('#setSpeak').checked = s.speak; $('#setLight').checked = s.theme === 'light';
  $('#brandName').textContent = s.name;
}
const cleanKey = (v) => v.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
$('#saveKeys').addEventListener('click', () => {
  db.settings.geminiKey = cleanKey($('#setGemini').value); db.settings.groqKey = cleanKey($('#setGroq').value);
  save(); fillSettings(); toast('Keys saved on this device'); renderChat();
});
$('#testKeys').addEventListener('click', async () => {
  db.settings.geminiKey = cleanKey($('#setGemini').value); db.settings.groqKey = cleanKey($('#setGroq').value); save();
  const st = $('#keyStatus'); st.textContent = 'Testing…';
  const msgs = [{ role: 'user', text: 'Reply with just: OK' }]; const out = [];
  if (db.settings.geminiKey) { try { await callGemini(msgs, false); out.push('Gemini ✅ working'); } catch (e) { out.push('Gemini ❌ ' + friendly(e)); } }
  if (db.settings.groqKey) { try { await callGroq(msgs); out.push('Groq ✅ working'); } catch (e) { out.push('Groq ❌ ' + friendly(e)); } }
  st.textContent = out.join(' · ') || 'Paste a key first.';
});
$('#savePersona').addEventListener('click', () => {
  const s = db.settings;
  s.name = $('#setName').value.trim() || 'NOVA'; s.user = $('#setUser').value.trim(); s.persona = $('#setPersona').value.trim() || defaults().settings.persona;
  s.speak = $('#setSpeak').checked; s.theme = $('#setLight').checked ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', s.theme !== 'light');
  save(); fillSettings(); renderChat(); toast('Saved');
});
$('#exportBtn').addEventListener('click', () => {
  const copy = JSON.parse(JSON.stringify(db)); copy.settings.geminiKey = ''; copy.settings.groqKey = '';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }));
  a.download = 'nova-backup-' + localISO().slice(0, 10) + '.json'; a.click(); toast('Backup downloaded (keys not included)');
});
$('#importInput').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => { const d = JSON.parse(t); const keys = { geminiKey: db.settings.geminiKey, groqKey: db.settings.groqKey }; db = { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings, ...keys } }; save(); renderAll(); toast('Backup restored'); })
    .catch(() => toast('That file is not a NOVA backup'));
});
$('#wipeBtn').addEventListener('click', () => { if (confirm('Delete ALL NOVA data on this device, including keys?')) { localStorage.removeItem(STORE_KEY); db = defaults(); renderAll(); toast('All data wiped'); } });

/* ---------- 15. Start ---------- */
function renderAll() { fillSettings(); renderChat(); renderTasks(); renderReminders(); renderNotes(); renderMemory(); if ($('#view-money').classList.contains('active')) renderMoney(); }
renderAll(); checkReminders();
if (!db.settings.geminiKey && !db.settings.groqKey) setTimeout(() => toast('Tip: add your free API key in ⚙️ Settings'), 800);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.addEventListener('resize', () => { if ($('#view-money').classList.contains('active')) drawChart(); });
