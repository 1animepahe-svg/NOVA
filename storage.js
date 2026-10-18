/* ============================================================
   storage.js — Hark AI
   All persistence: localStorage, memory, conversations,
   panels, tasks, projects, preferences, export/import.
   Everything stays in the browser. Zero servers.
   ============================================================ */

const STORAGE_KEY = 'hark_data_v1';

/** @typedef {{
 *   prefs: {
 *     theme: 'dark'|'light'|'auto',
 *     model: string,
 *     temperature: number,
 *     stream: boolean,
 *     userName: string,
 *     ttsEnabled: boolean,
 *     voiceURI: string|null,
 *   },
 *   memory: {
 *     about: string,
 *     preferences: string,
 *     workflows: string,
 *     facts: string[],
 *   },
 *   conversations: Array<{
 *     id: string,
 *     title: string,
 *     projectId: string|null,
 *     createdAt: number,
 *     updatedAt: number,
 *     messages: Array<{id:string, role:'user'|'assistant'|'system', content:string, ts:number, image?:string, toolCalls?:Array<any>}>
 *   }>,
 *   activeConversationId: string|null,
 *   projects: Array<{id:string, name:string, emoji:string, description:string, createdAt:number}>,
 *   activeProjectId: string|null,
 *   panels: Array<{id:string, type:string, title:string, value:string, description:string, data?:any}>,
 *   tasks: Array<{id:string, title:string, schedule:string, type:string, prompt?:string, createdAt:number, lastRun?:number}>,
 * }} HarkData */

const DEFAULT_DATA = () => ({
  prefs: {
    theme: 'dark',
    model: 'openai-large',
    temperature: 0.7,
    stream: true,
    userName: '',
    ttsEnabled: false,
    voiceURI: null,
  },
  memory: {
    about: '',
    preferences: '',
    workflows: '',
    facts: [],
  },
  conversations: [],
  activeConversationId: null,
  projects: [],
  activeProjectId: null,
  panels: [],
  tasks: [],
});

let data = DEFAULT_DATA();
let saveTimer = null;

/** Initialize storage — loads from localStorage or creates fresh. */
export function initStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Deep merge with defaults to handle new fields added in updates
      data = { ...DEFAULT_DATA(), ...parsed };
      data.prefs = { ...DEFAULT_DATA().prefs, ...(parsed.prefs || {}) };
      data.memory = { ...DEFAULT_DATA().memory, ...(parsed.memory || {}) };
      data.memory.facts = data.memory.facts || [];
      data.conversations = data.conversations || [];
      data.projects = data.projects || [];
      data.panels = data.panels || [];
      data.tasks = data.tasks || [];
    }
  } catch (e) {
    console.warn('Failed to load storage, starting fresh:', e);
    data = DEFAULT_DATA();
  }
  return data;
}

/** Schedule a save (debounced to avoid excessive writes). */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }, 120);
}

/** Save immediately (for important actions). */
export function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save:', e);
  }
}

/** Get a reference to the live data object. */
export function getData() { return data; }

/** Get preferences. */
export function getPrefs() { return data.prefs; }

/** Update preferences. */
export function updatePrefs(partial) {
  Object.assign(data.prefs, partial);
  save();
}

// ==================== CONVERSATIONS ====================

export function getConversation(id) {
  return data.conversations.find(c => c.id === id);
}

export function getActiveConversation() {
  if (!data.activeConversationId) return null;
  return getConversation(data.activeConversationId);
}

export function getAllConversations() {
  return [...data.conversations].sort((a,b) => b.updatedAt - a.updatedAt);
}

export function createConversation(title = 'New chat', projectId = null) {
  const id = uid();
  const convo = {
    id,
    title,
    projectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  data.conversations.unshift(convo);
  data.activeConversationId = id;
  save();
  return convo;
}

export function setActiveConversation(id) {
  data.activeConversationId = id;
  save();
}

export function deleteConversation(id) {
  data.conversations = data.conversations.filter(c => c.id !== id);
  if (data.activeConversationId === id) {
    data.activeConversationId = data.conversations[0]?.id || null;
  }
  save();
}

export function renameConversation(id, title) {
  const c = getConversation(id);
  if (c) { c.title = title; c.updatedAt = Date.now(); save(); }
}

export function addMessage(conversationId, message) {
  const c = getConversation(conversationId);
  if (!c) return;
  const msg = {
    id: uid(),
    ts: Date.now(),
    ...message,
  };
  c.messages.push(msg);
  c.updatedAt = Date.now();
  // Auto-title from first user message
  if (c.title === 'New chat' && message.role === 'user') {
    c.title = message.content.slice(0, 60).trim() || 'New chat';
  }
  save();
  return msg;
}

export function updateMessage(conversationId, messageId, updates) {
  const c = getConversation(conversationId);
  if (!c) return;
  const m = c.messages.find(m => m.id === messageId);
  if (m) {
    Object.assign(m, updates);
    c.updatedAt = Date.now();
    save();
  }
}

export function clearMessages(conversationId) {
  const c = getConversation(conversationId);
  if (c) { c.messages = []; save(); }
}

// ==================== PROJECTS ====================

export function getAllProjects() { return data.projects; }
export function getActiveProject() {
  if (!data.activeProjectId) return null;
  return data.projects.find(p => p.id === data.activeProjectId);
}
export function setActiveProject(id) {
  data.activeProjectId = id;
  save();
}
export function createProject(name, emoji = '📁', description = '') {
  const p = { id: uid(), name, emoji, description, createdAt: Date.now() };
  data.projects.push(p);
  data.activeProjectId = p.id;
  save();
  return p;
}
export function deleteProject(id) {
  data.projects = data.projects.filter(p => p.id !== id);
  // Unassign conversations belonging to this project
  data.conversations.forEach(c => { if (c.projectId === id) c.projectId = null; });
  if (data.activeProjectId === id) data.activeProjectId = null;
  save();
}

// ==================== PANELS ====================

export function getPanels() { return data.panels; }
export function addPanel(panel) {
  const p = { id: uid(), ...panel };
  data.panels.push(p);
  save();
  return p;
}
export function updatePanel(id, updates) {
  const p = data.panels.find(p => p.id === id);
  if (p) { Object.assign(p, updates); save(); }
}
export function deletePanel(id) {
  data.panels = data.panels.filter(p => p.id !== id);
  save();
}

// ==================== TASKS ====================

export function getTasks() { return data.tasks; }
export function addTask(task) {
  const t = { id: uid(), createdAt: Date.now(), ...task };
  data.tasks.push(t);
  save();
  return t;
}
export function deleteTask(id) {
  data.tasks = data.tasks.filter(t => t.id !== id);
  save();
}
export function updateTask(id, updates) {
  const t = data.tasks.find(t => t.id === id);
  if (t) { Object.assign(t, updates); save(); }
}

// ==================== MEMORY ====================

export function getMemory() { return data.memory; }
export function saveMemory(mem) {
  data.memory = { ...data.memory, ...mem };
  saveNow();
}
export function addFact(fact) {
  const f = fact.trim();
  if (f && !data.memory.facts.includes(f)) {
    data.memory.facts.push(f);
    save();
  }
}
export function removeFact(fact) {
  data.memory.facts = data.memory.facts.filter(f => f !== fact);
  save();
}
export function clearMemory() {
  data.memory = DEFAULT_DATA().memory;
  saveNow();
}

/**
 * Build the system prompt that injects user memory and instructions.
 */
export function buildSystemPrompt() {
  const { about, preferences, workflows, facts } = data.memory;
  const name = data.prefs.userName?.trim();

  let memoryBlock = '';
  if (about || preferences || workflows || facts.length) {
    memoryBlock = `
## About your human
${name ? `Their name is ${name}. Address them by name occasionally.` : 'They haven\'t shared their name yet.'}
${about ? `\nAbout them: ${about}` : ''}
${preferences ? `\nTheir preferences: ${preferences}` : ''}
${workflows ? `\nCustom workflows they've taught you (follow these):\n${workflows}` : ''}
${facts.length ? `\nSpecific facts you've learned:\n${facts.map(f => '- ' + f).join('\n')}` : ''}
`;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return `You are Hark, an exceptional personal AI assistant. You are capable, warm, concise when needed and thorough when helpful. You are talking to your single human — this is a private, one-on-one relationship.

## Current date & time
It is ${dateStr}, ${timeStr} (${tz}).

## What you can do
You are built to actually do things, not just chat. You can help with:
1. **Research** — deep web research, comparisons, news, fact checks, product picks. When asked to research, proactively use web search (tell the human you're searching and summarise what you find).
2. **Browse the web** — you have a real browser tool you can invoke. You can navigate sites, summarise pages.
3. **Shopping** — find products, recommend, build carts, check out (only with explicit go-ahead).
4. **Food** — recommend delivery, suggest restaurants, help with orders.
5. **Travel** — find and describe flights, hotels, plan full trips, give day-of travel help.
6. **Bookings** — advise on booking doctors, salons, services, tickets.
7. **Money** — find subscriptions to cancel, suggest ways to cut bills, help track orders.
8. **Email, calendar & files** — you can draft emails, manage calendars, help write documents and code. You work with Google/Microsoft, Slack, GitHub, Jira, Confluence, Linear (human connects these if needed).
9. **Make things** — websites/pages you can write as self-contained HTML the human can save, slide decks described in detail, PDFs via the human's browser, charts, spreadsheets (as CSV), images (via image generation tool), and working code.
10. **Video & audio** — explain editing steps, summarise videos if given a transcript/link, suggest trim points.
11. **Home panels** — you can suggest adding live tracker panels to the human's Home screen.
12. **Scheduled tasks** — you can help set up reminders and recurring checks.
13. **Projects** — you can create separate project spaces for big efforts like moves, job hunts or weddings.
14. **Memory** — remember preferences; learn workflows. If you learn something new about the human (e.g. a birthday, an allergy, a goal), mention it and offer to remember it.

## Your style
- Be smart, resourceful, and proactive. Don't just answer — *help*.
- Be warm but not overly chatty. Skip filler.
- Use markdown heavily: headers, bullet lists, bold, tables for comparisons.
- When giving product recommendations, be opinionated — pick winners.
- When researching, always cite your sources.
- If you don't know something, say so and offer to search.
- If the human asks you to create something (code, a page, a CSV), produce the full working output in a code block.
- You can generate images: if the human asks for an image, say you'll generate one, then on a new line write exactly: ![description](https://image.pollinations.ai/prompt/{URL-ENCODED-PROMPT}?width=1024&height=1024&nologo=true)
  - Width/height can vary (e.g. 1280x720 for landscape, 768x1024 for portrait). Add &seed=N for variation.

## What you will NOT do
- Make phone calls or text other people.
- Fake engagement (bot likes, views, follows) or suggest pirated content.
- Pay or send anything in the human's name without their explicit OK.
- Pretend to be the human.
- Give medical, legal or financial advice beyond general education — recommend consulting a professional.

## When tools are needed
For web searches, prefix the search query on its own line like this (the app will perform the search and inject the results into the conversation):
<<SEARCH: the actual search query here>>

For page fetching/summarising:
<<FETCH: https://example.com>>

For creating a home panel:
<<ADDPANEL: type|title|value|description>>
(type can be "price", "package", "score", "budget", "note")

For scheduling a task/reminder:
<<ADDTASK: title|schedule|prompt>>
(schedule can be "once", "daily", "weekly", or a description like "tomorrow 9am")

For creating a project:
<<ADDPROJECT: name|emoji|description>>

For remembering a fact:
<<REMEMBER: the fact to remember>>

You can use multiple tool calls in one response. After you write a tool call, wait for the result to come back as a system message before continuing.

## Memory and continuity
- You remember across conversations via the Memory section the human controls.
- If you need personal context (e.g. their home airport for travel), just ask.
${memoryBlock}

Be genuinely useful. The human is relying on you. Today is ${dateStr}.`;
}

// ==================== EXPORT / IMPORT / RESET ====================

export function exportAll() {
  const clone = JSON.parse(JSON.stringify(data));
  return clone;
}

export function downloadExport() {
  const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `hark-backup-${d.toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Validate minimum structure
        if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid file');
        data = { ...DEFAULT_DATA(), ...parsed };
        data.prefs = { ...DEFAULT_DATA().prefs, ...(parsed.prefs || {}) };
        data.memory = { ...DEFAULT_DATA().memory, ...(parsed.memory || {}) };
        data.memory.facts = data.memory.facts || [];
        data.conversations = data.conversations || [];
        data.projects = data.projects || [];
        data.panels = data.panels || [];
        data.tasks = data.tasks || [];
        saveNow();
        resolve(true);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function resetAll() {
  data = DEFAULT_DATA();
  saveNow();
}

// ==================== UTILITIES ====================

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/**
 * Downloads text content as a file.
 */
export function downloadText(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
