/* ============================================================
   ai.js — Hark AI
   AI model calls, streaming, tool execution, fallbacks.
   Uses Pollinations.ai (free, no API key needed) for text
   and image generation. Fully client-side.
   ============================================================ */

import {
  getData, save, addMessage, updateMessage,
  addFact, addPanel, addTask, createProject, buildSystemPrompt
} from './storage.js';
import { runTool, searchWeb, fetchPage } from './tools.js';

// Model name mapping — Pollinations exposes popular open models for free.
const MODELS = {
  'openai': 'openai',
  'openai-large': 'openai-large',
  'claude': 'claude-hybridspace',
};

const POLLINATIONS_CHAT_ENDPOINT = 'https://text.pollinations.ai/';
// OpenAI-compatible endpoint is more reliable for streaming
const POLLINATIONS_OPENAI_ENDPOINT = 'https://text.pollinations.ai/openai';

let abortController = null;

/* ---- Fix for HTTP 429: use your own free Groq key, retry the free service ---- */
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
function getGroqKey() {
  let k = localStorage.getItem('groq_key') || '';
  if (!k) { try { k = JSON.parse(localStorage.getItem('nova.data.v1') || '{}').settings?.groqKey || ''; } catch (e) {} }
  if (!k && !localStorage.getItem('groq_key_asked')) {
    localStorage.setItem('groq_key_asked', '1');
    k = (prompt('Paste your free Groq API key (gsk_...) so the AI never hits the free limit. It stays on this phone only. Leave empty to skip.') || '').trim();
  }
  if (k) localStorage.setItem('groq_key', k);
  return k;
}
async function aiFetch(init) {
  const key = getGroqKey();
  if (key) {
    const b = JSON.parse(init.body); b.model = GROQ_MODEL; delete b.cache;
    const r = await fetch(GROQ_ENDPOINT, { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(b) });
    if (r.ok) return r;
    if (r.status === 401) localStorage.removeItem('groq_key'); // bad key: fall back to the free service
  }
  let r;
  for (const wait of [0, 3000, 7000, 15000]) {
    if (wait) await new Promise(res => setTimeout(res, wait));
    r = await fetch(POLLINATIONS_OPENAI_ENDPOINT, init);
    if (r.status !== 429) return r;
  }
  return r;
}


/**
 * Send a message to the AI and stream the response into the UI.
 *
 * @param {string} conversationId The conversation ID to add messages to.
 * @param {string} userText The user's message text.
 * @param {object} opts { onStart, onToken, onDone, onError, onTool }
 * @returns {Promise<string>} The full response text.
 */
export async function sendMessage(conversationId, userText, opts = {}) {
  const prefs = getData().prefs;
  const model = MODELS[prefs.model] || 'openai-large';
  const temperature = prefs.temperature ?? 0.7;
  const shouldStream = prefs.stream !== false;

  // Build up the messages array for the API
  const convo = getData().conversations.find(c => c.id === conversationId);
  if (!convo) throw new Error('Conversation not found');

  // If this is the very first message, we'll inject the system prompt fresh.
  // We keep system prompt out of stored messages to save space and allow it to
  // reflect latest memory/preferences.
  const apiMessages = [
    { role: 'system', content: await buildDynamicSystemPrompt() },
  ];

  // Last ~20 messages to keep context manageable (the user message was already
  // added by the UI layer before calling us, so it's already in convo.messages)
  const history = convo.messages.slice(-20);
  for (const m of history) {
    apiMessages.push({
      role: m.role,
      content: m.content,
    });
  }

  // Create a placeholder assistant message that we will stream into
  const assistantMsgId = addMessage(conversationId, { role: 'assistant', content: '' }).id;

  abortController = new AbortController();
  let fullContent = '';
  let toolCalls = [];
  let currentToolCall = null;

  opts.onStart?.(assistantMsgId);

  try {
    if (shouldStream) {
      const response = await aiFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          temperature,
          stream: true,
          cache: false,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;

            // Content tokens
            if (delta.content) {
              fullContent += delta.content;
              opts.onToken?.(assistantMsgId, fullContent, delta.content);
              updateMessage(conversationId, assistantMsgId, { content: fullContent });
            }
          } catch (e) {
            // Skip malformed chunks — they happen with free proxies
          }
        }
      }
    } else {
      // Non-streaming
      const response = await aiFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          temperature,
          stream: false,
          cache: false,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const json = await response.json();
      fullContent = json.choices?.[0]?.message?.content || '(No response)';
      opts.onToken?.(assistantMsgId, fullContent, fullContent);
      updateMessage(conversationId, assistantMsgId, { content: fullContent });
    }

    // ============================================================
    // TOOL EXECUTION PASS
    // Parse any <<TOOL: args>> patterns in the response and execute them.
    // We re-inject tool results as system messages and generate a follow-up.
    // ============================================================
    const toolRegex = /<<(SEARCH|FETCH|ADDPANEL|ADDTASK|ADDPROJECT|REMEMBER):\s*([\s\S]*?)>>/g;
    const toolsToRun = [];
    let match;

    // Find all tool calls
    const contentAfterTools = fullContent.replace(toolRegex, (_, cmd, args) => {
      toolsToRun.push({ cmd: cmd.toUpperCase(), args: args.trim() });
      return ''; // Remove tool call syntax from visible response
    });

    if (toolsToRun.length > 0) {
      // Notify UI we're running tools
      opts.onTools?.(assistantMsgId, toolsToRun);

      let toolResults = [];
      for (const tool of toolsToRun) {
        try {
          const result = await executeTool(tool.cmd, tool.args, opts);
          toolResults.push({ cmd: tool.cmd, args: tool.args, result });
          opts.onToolResult?.(assistantMsgId, tool, result);
        } catch (err) {
          toolResults.push({ cmd: tool.cmd, args: tool.args, error: err.message });
        }
      }

      // Update message with tool results noted, and cleaned content
      let cleanedContent = contentAfterTools.trim();
      updateMessage(conversationId, assistantMsgId, {
        content: cleanedContent,
        toolCalls: toolResults,
      });
      fullContent = cleanedContent;

      // Now we add a system message with the tool results and continue the conversation
      const systemContent = buildToolResultContext(toolResults);

      // Add the tool result as a system message, then let the AI continue
      const followUp = await continueAfterTools(
        conversationId,
        assistantMsgId,
        apiMessages.concat([
          { role: 'assistant', content: fullContent },
          { role: 'system', content: systemContent },
        ]),
        { model, temperature, shouldStream, opts, priorContent: cleanedContent }
      );

      if (followUp && followUp.trim()) {
        fullContent = cleanedContent + (cleanedContent ? '\n\n' : '') + followUp;
      } else {
        fullContent = cleanedContent;
      }
    } else {
      // Clean up any lingering artifacts (no actual tool call matched)
      fullContent = contentAfterTools.trim();
      updateMessage(conversationId, assistantMsgId, { content: fullContent });
    }

    // Trigger TTS if enabled
    if (prefs.ttsEnabled && fullContent) {
      speak(fullContent);
    }

    opts.onDone?.(assistantMsgId, fullContent);
    return fullContent;

  } catch (err) {
    if (err.name === 'AbortError') {
      opts.onAbort?.(assistantMsgId);
      return fullContent;
    }
    console.error('AI error:', err);
    // Fallback — try once more with a different model
    if (!opts._retry) {
      console.warn('Primary model failed, retrying with fallback...');
      return sendMessage(conversationId, userText, { ...opts, _retry: true, _useFallback: true });
    }
    const errorMsg = `*Sorry, I ran into an issue connecting to the AI service (${err.message}). This is a free service — please try again in a moment, or check your connection.*`;
    updateMessage(conversationId, assistantMsgId, { content: errorMsg });
    opts.onError?.(assistantMsgId, err);
    return errorMsg;
  } finally {
    abortController = null;
    save();
  }
}

/**
 * After executing tools, we get a follow-up response from the model
 * that incorporates the tool results.
 */
async function continueAfterTools(conversationId, assistantMsgId, apiMessages, ctx) {
  const { model, temperature, shouldStream, opts, priorContent } = ctx;
  let followUpContent = '';
  const ac = new AbortController();

  try {
    const body = {
      model,
      messages: apiMessages,
      temperature,
      stream: shouldStream,
      cache: false,
    };

    const response = await aiFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!response.ok) throw new Error('Follow-up failed');

    if (shouldStream) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              followUpContent += delta;
              const combined = (priorContent ? priorContent + '\n\n' : '') + followUpContent;
              opts.onToken?.(assistantMsgId, combined, delta);
              updateMessage(conversationId, assistantMsgId, { content: combined });
            }
          } catch (e) {}
        }
      }
    } else {
      const json = await response.json();
      followUpContent = json.choices?.[0]?.message?.content || '';
    }
    return followUpContent;
  } catch (e) {
    console.warn('Follow-up generation failed:', e);
    return '';
  }
}

/**
 * Execute a single tool call.
 */
async function executeTool(cmd, args, opts) {
  switch (cmd) {
    case 'SEARCH': {
      const results = await searchWeb(args);
      return formatSearchResults(results, args);
    }
    case 'FETCH': {
      const content = await fetchPage(args);
      return content;
    }
    case 'ADDPANEL': {
      const [type, title, value, description] = args.split('|').map(s => s.trim());
      const p = addPanel({ type: type || 'note', title: title || 'Panel', value: value || '', description: description || '' });
      return `✓ Panel added: "${p.title}". It will appear on the Home Panels screen.`;
    }
    case 'ADDTASK': {
      const [title, schedule, prompt] = args.split('|').map(s => s.trim());
      const t = addTask({ title, schedule: schedule || 'once', prompt: prompt || title });
      return `✓ Task scheduled: "${t.title}" (${t.schedule}). It will appear in Scheduled Tasks.`;
    }
    case 'ADDPROJECT': {
      const [name, emoji, description] = args.split('|').map(s => s.trim());
      const p = createProject(name, emoji || '📁', description || '');
      return `✓ Project created: "${p.name}". You can switch to it from the sidebar.`;
    }
    case 'REMEMBER': {
      addFact(args);
      return `✓ Remembered: "${args}" Saved to your memory.`;
    }
    default:
      return `Unknown tool: ${cmd}`;
  }
}

function buildToolResultContext(results) {
  let out = `## Tool results (automatically executed — use this context in your reply, don't repeat the raw results unless helpful)\n\n`;
  for (const r of results) {
    out += `### ${r.cmd}: ${r.args}\n`;
    if (r.error) out += `ERROR: ${r.error}\n`;
    else out += r.result + '\n';
    out += '\n';
  }
  out += '\nNow write a natural, helpful reply incorporating these results. Cite sources if you used search. Do NOT include the <<TOOL:...>> syntax in your reply — you already executed the tools.\n';
  return out;
}

function formatSearchResults(results, query) {
  if (!results || results.length === 0) {
    return `No results found for "${query}".`;
  }
  let out = `Search results for "${query}":\n\n`;
  results.forEach((r, i) => {
    out += `${i+1}. **${r.title}**\n   ${r.snippet || ''}\n   ${r.url || ''}\n\n`;
  });
  out += `(Use this info to answer. Include source links when stating facts.)`;
  return out;
}

/**
 * Builds the dynamic system prompt (delegates to storage.js).
 */
async function buildDynamicSystemPrompt() {
  return buildSystemPrompt();
}

/** Abort the current generation. */
export function abort() {
  if (abortController) abortController.abort();
}

/**
 * Generate an image URL via Pollinations (free, no key).
 * Returns the URL. Does NOT use the chat API.
 */
export function generateImageURL(prompt, opts = {}) {
  const { width = 1024, height = 1024, seed = Math.floor(Math.random() * 1000000) } = opts;
  const encoded = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;
}

/**
 * Returns a promise that resolves with an Image element that has loaded.
 */
export function loadGeneratedImage(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = generateImageURL(prompt, opts);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error('Image generation failed'));
    img.src = url;
  });
}

// ============== SPEECH ==============

let currentUtterance = null;

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  stopSpeaking();
  const prefs = getData().prefs;

  // Strip markdown/links for speech
  const plain = text
    .replace(/```[\s\S]*?```/g, ' [code shown] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>]+/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .slice(0, 1500);

  const u = new SpeechSynthesisUtterance(plain);
  if (prefs.voiceURI) {
    const voices = speechSynthesis.getVoices();
    const v = voices.find(v => v.voiceURI === prefs.voiceURI);
    if (v) u.voice = v;
  }
  u.rate = 1.02;
  currentUtterance = u;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  currentUtterance = null;
}

export function isSpeaking() {
  return 'speechSynthesis' in window && speechSynthesis.speaking;
}

/**
 * Transcribe audio via Web Speech API (free, browser-native, no key).
 */
export function startRecognition(onResult, onEnd, onError) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.(new Error('Speech recognition not supported in this browser.'));
    return null;
  }
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';

  let finalTranscript = '';

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    onResult?.(finalTranscript + interim, !!finalTranscript);
  };
  rec.onend = () => onEnd?.(finalTranscript);
  rec.onerror = (e) => onError?.(e.error || e);
  rec.start();
  return rec;
}
