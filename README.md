# Hark — Your Personal AI Assistant

A premium, flagship-quality personal AI assistant that runs **100% free, forever**, in your browser. No account, no servers, no paywall, no API key required.

Built with just HTML, CSS, and vanilla JavaScript — no build step, no dependencies to install. Works perfectly on GitHub Pages, or any static host.

![Hark icon](icon.svg)

## ✨ Features

Hark Pro (free) — every feature unlocked, by default:

- 💬 **Chat** with a powerful AI using Pollinations' free text models (no key needed)
- 🔍 **Web research** via DuckDuckGo (free, no key)
- 🌐 **Fetch & summarize** real web pages
- 🛒 **Shopping, food, travel, bookings** guidance
- ✉️ **Email, calendar & docs** drafting help
- 🎨 **Make things** — websites (HTML you can download), code, spreadsheets, images
- 🖼️ **AI image generation** via Pollinations (free, no key)
- 🎙️ **Voice input** via Web Speech API (free, browser-native)
- 🔊 **Text-to-speech** to read responses aloud
- 📊 **Home Panels** — live trackers for prices, packages, budgets, notes
- ⏰ **Scheduled tasks & reminders** with browser notifications
- 📁 **Projects** — separate spaces for big efforts (wedding, move, job hunt)
- 🧠 **Long-term memory** — Hark remembers your preferences, facts, and custom workflows
- 📴 **Offline-capable** PWA — install it on your phone or desktop
- 🌓 **Dark & light themes** with system-auto option
- 💾 **Export / import** all your data as JSON, anytime
- 📱 **Fully responsive** for mobile, tablet, and desktop

### What Hark won't do
- Make phone calls or send SMS to other people
- Fake engagement (bot likes/views/follows) or get pirated content
- Pay or send anything in your name without your explicit go-ahead

## 🚀 Quick Start (no installation needed!)

Because Hark is pure static files, you don't need Node, npm, Python, or any server.

### Option 1: Open locally (fastest)
1. Download all 10 files into the same folder on your computer.
2. **Important:** Because some features (service worker, CORS-free fetches) work better over HTTP, open a terminal in that folder and run a quick local server:

   **If you have Python 3 installed** (most Mac/Linux):
   ```bash
   python3 -m http.server 8000
   ```

   **If you have Node installed**:
   ```bash
   npx serve .
   ```

   **Or just double-click `index.html`** — most features will still work directly from the file system.

3. Visit `http://localhost:8000` in your browser (Chrome or Edge recommended for full voice support).

### Option 2: Deploy to GitHub Pages (free, public URL)
1. Create a new GitHub repository.
2. Upload all 10 files to the root of the repository (do NOT put them in a subfolder).
3. Go to repository **Settings → Pages**.
4. Under "Source", select **Deploy from a branch**, choose `main` / root, and save.
5. Wait ~1 minute. Your Hark will be live at `https://<your-username>.github.io/<repo-name>/`.
6. On mobile Chrome/Edge, open the URL and tap "Add to Home screen" to install it as an app.

### Option 3: Drop onto any static host
Upload all 10 files to:
- Netlify Drop (drag-and-drop, free)
- Vercel
- Cloudflare Pages
- Neocities
- Any web hosting (Apache, Nginx, Caddy)

No server-side code, no environment variables, no database required.

## 📁 Files

| File | Purpose |
|------|---------|
| `index.html` | Main app shell & markup |
| `style.css` | All styling (dark/light themes, animations, responsive) |
| `app.js` | Main app logic: UI, screens, navigation, chat rendering |
| `ai.js` | AI model calls, streaming, image generation, voice recognition |
| `tools.js` | Web search, page fetch, file downloads, clipboard |
| `storage.js` | LocalStorage persistence, memory, export/import |
| `manifest.json` | PWA manifest for installing as an app |
| `sw.js` | Service worker for offline support |
| `icon.svg` | Beautiful gradient app icon |
| `README.md` | This file |

**Important:** All files must stay in the root (no subfolders) and keep their exact names.

## 🧠 How it works

### AI models
- Hark uses **[Pollinations.ai](https://pollinations.ai/)** — a community-run free AI inference service supporting OpenAI, Claude, and open-source models. No sign-up, no key, no rate-limits for reasonable personal use.
- Choose between three model presets in **Settings → AI Model**.
- Responses stream in real-time.
- If a model fails, Hark automatically falls back to an alternate.

### Web search
- Combines DuckDuckGo Instant Answers and DuckDuckGo HTML results (via a public CORS proxy `api.allorigins.win`).
- You can ask "search for X" or just "find me X" and Hark will run a live web search.

### Page fetch
- Fetches any public URL and extracts readable text, which the AI then uses for context.

### Image generation
- `generate me an image of…` uses Pollinations image API (also free, no key). Images appear directly in the chat and can be saved.

### Voice
- Voice input uses the browser's built-in Web Speech API (works best in Chrome/Edge).
- Text-to-speech uses your system's voices.

### Memory
- You can add facts about yourself, preferences, and custom workflows on the Memory screen.
- The AI can also proactively save facts during chat with your permission (using the `<<REMEMBER: fact>>` tool).

### Home Panels
- Quick trackers for things you want to keep an eye on. Ask Hark to "add a panel for the price of X" and it will appear on your home screen.

### Scheduled tasks
- Ask Hark to remind you, or set up daily/weekly tasks. Uses browser notifications.
- Note: scheduled tasks only fire while the app is open in a tab. For perfect delivery, install the PWA and keep it open, or use it regularly.

### Offline & PWA
- Install the app on Android/desktop via your browser's "Install app" button.
- The service worker caches the app shell so it works offline.
- Your data is stored locally in `localStorage`. Nothing is sent anywhere except AI requests to Pollinations and search requests to DuckDuckGo.

## 💾 Your data

- **Everything** stays in your browser's localStorage.
- No account, no sync, no tracking, no ads.
- Use **Settings → Export all data** to download a JSON backup anytime.
- Use **Settings → Delete everything** to wipe it all.

## ⌨️ Keyboard shortcuts

- `Enter` — Send message (Shift+Enter for new line)
- `Ctrl/Cmd + K` — New chat
- `Esc` — Stop generation / close menus / close modals

## 🔧 Optional customisation

Open `app.js` or `storage.js` and tweak:
- The system prompt in `storage.js` (`buildSystemPrompt()`) for personality changes
- Default model, temperature, theme in the `DEFAULT_DATA()` function
- The color theme in `style.css` at the top (CSS variables)

## ❓ Troubleshooting

**Voice input doesn't work?**
Chrome or Edge is required for Web Speech API. Also, voice input requires HTTPS (or localhost).

**Search isn't returning results?**
Some networks/DNS block the CORS proxy. Try a different network or VPN. You can always manually paste info into chat.

**AI seems slow?**
Free services can occasionally be slow or busy during peak times. Try switching the model in Settings.

**Images don't generate?**
Pollinations image generation sometimes takes 5-10 seconds. Wait for it.

**Lost data after clearing browser?**
All data is in localStorage. If you clear site data, you'll lose it. Use Export regularly for backups.

## 📜 License

Hark is for your personal use. Feel free to modify it for yourself. AI calls go to Pollinations.ai which has its own terms.

---

**Built for you — enjoy your forever-free personal assistant.** 🎉
