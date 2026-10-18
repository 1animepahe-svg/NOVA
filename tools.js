/* ============================================================
   tools.js — Hark AI
   Actions the assistant can perform:
   - Web search (DuckDuckGo Instant Answer + CORS-friendly scraping)
   - Web page fetch & summarisation prep
   - File generation (CSV, HTML download helpers)
   - Notification helpers
   All free, no keys required.
   ============================================================ */

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const DUCKDUCKGO_INSTANT = 'https://api.duckduckgo.com/';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/?q=';

/**
 * Search the web. Tries DuckDuckGo instant answer first, then falls back
 * to scraping the HTML results page via a CORS proxy.
 *
 * @param {string} query
 * @returns {Promise<Array<{title:string, snippet:string, url:string}>>}
 */
export async function searchWeb(query) {
  // Try DuckDuckGo instant answer first (fast, direct)
  try {
    const instant = await fetchDuckDuckGoInstant(query);
    if (instant.length > 0) return instant;
  } catch (e) {
    console.warn('DDG instant failed, trying HTML...', e);
  }
  // Fall back to HTML results via CORS proxy
  try {
    const html = await fetchDuckDuckGoHTML(query);
    return html;
  } catch (e) {
    console.warn('DDG HTML failed:', e);
    return [];
  }
}

async function fetchDuckDuckGoInstant(query) {
  const url = `${DUCKDUCKGO_INSTANT}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=HarkAI`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('DuckDuckGo instant failed');
  const data = await res.json();
  const results = [];

  // Abstract
  if (data.Abstract || data.Heading) {
    results.push({
      title: data.Heading || query,
      snippet: data.Abstract || data.AbstractText || '',
      url: data.AbstractURL || '',
    });
  }
  // Related topics / instant results
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
          snippet: topic.Text,
          url: topic.FirstURL,
        });
      }
      if (results.length >= 8) break;
    }
  }
  // Results (if any from DDG)
  if (Array.isArray(data.Results)) {
    for (const r of data.Results) {
      results.push({
        title: r.Text?.split(' - ')[0] || '',
        snippet: r.Text || '',
        url: r.FirstURL || '',
      });
    }
  }
  return results.filter(r => r.url || r.snippet).slice(0, 10);
}

async function fetchDuckDuckGoHTML(query) {
  const targetUrl = DUCKDUCKGO_HTML + encodeURIComponent(query);
  const proxiedUrl = CORS_PROXY + encodeURIComponent(targetUrl);
  const res = await fetch(proxiedUrl);
  if (!res.ok) throw new Error('Failed to fetch DDG HTML');
  const html = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results = [];

  const resultEls = doc.querySelectorAll('.result__body');
  for (const el of resultEls) {
    const a = el.querySelector('.result__a');
    const snippet = el.querySelector('.result__snippet');
    if (!a) continue;
    const title = a.textContent.trim();
    let url = a.getAttribute('href') || '';
    // DDG redirect URLs
    if (url.startsWith('/')) {
      // Try duckduckgo.com/l/?uddg=...
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
      else url = 'https://duckduckgo.com' + url;
    }
    results.push({
      title,
      snippet: snippet ? snippet.textContent.trim() : '',
      url,
    });
    if (results.length >= 8) break;
  }
  return results;
}

/**
 * Fetch and extract readable text from a web page.
 * Uses a CORS proxy to bypass same-origin.
 *
 * @param {string} url
 * @returns {Promise<string>} Extracted text (max ~4000 chars)
 */
export async function fetchPage(url) {
  try {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    const proxiedUrl = CORS_PROXY + encodeURIComponent(targetUrl);
    const res = await fetch(proxiedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove unwanted elements
    const removeSelectors = [
      'script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header',
      'aside', '.ad', '.ads', '.advertisement', '.sidebar', '.comments',
      'nav', 'footer', 'form', 'button', 'svg'
    ];
    removeSelectors.forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

    // Try article first
    let mainEl = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.body;
    let text = mainEl ? mainEl.innerText : doc.body.innerText;

    // Clean whitespace
    text = text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    if (text.length > 4000) {
      text = text.slice(0, 4000) + '\n\n[Content truncated to 4000 chars. Ask the human if you need more details.]';
    }

    if (!text || text.length < 50) {
      return `Could not extract meaningful content from ${targetUrl}. The page may require JavaScript rendering or block automated access.`;
    }
    return `Content from ${targetUrl}:\n\n${text}`;
  } catch (err) {
    return `Failed to fetch ${url}: ${err.message}. Note that some sites block automated access — I can still help you interpret the page if you paste relevant text.`;
  }
}

/**
 * Generate a CSV file for the human to download.
 */
export function downloadCSV(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [esc(headers).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => esc(row[h] ?? '')).join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

/**
 * Download a standalone HTML page (for "Make things" / Pages feature).
 */
export function downloadHTML(filename, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.html') ? filename : filename + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

/**
 * Schedule a browser notification.
 */
export function notify(title, body, options = {}) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: 'icon.svg', ...options });
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

/**
 * Copy text to clipboard.
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e2) {
      ta.remove();
      return false;
    }
  }
}

/**
 * Extract image URLs (Pollinations) from markdown content.
 */
export function extractImages(markdown) {
  const imgs = [];
  const re = /!\[([^\]]*)\]\((https:\/\/image\.pollinations\.ai\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    imgs.push({ alt: m[1], url: m[2] });
  }
  return imgs;
}

/**
 * RunTool — unified tool dispatch for external callers (used by ai.js).
 * Kept here for symmetry; ai.js already calls searchWeb/fetchPage directly
 * but this provides a single entry point.
 */
export async function runTool(name, args) {
  switch (name) {
    case 'search': return await searchWeb(args);
    case 'fetch': return await fetchPage(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
