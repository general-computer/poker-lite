# Poker Lite — Static Deployment

Texas Hold'em poker game in the browser. No server required — works by opening
`dist/index.html` directly or uploading the `dist/` folder to any static host.

## Quick Start

```bash
# Install dependencies
npm install

# Development (auto-reload at http://localhost:8080)
npm run dev

# Production build
npm run build
# Output in dist/ — open dist/index.html or upload dist/ to a host
```

## Deploy to a Static Host

The `dist/` folder is a self-contained static site. Upload it to any host:

| Host | Instructions |
|------|-------------|
| **Netlify** | Drag `dist/` onto the Netlify drop zone, or set publish directory to `dist` |
| **GitHub Pages** | Push `dist/` contents to `gh-pages` branch |
| **Vercel** | Set output directory to `dist` |
| **Apache / shared host** | Upload `dist/` contents via FTP/SFTP. The included `.htaccess` enables caching and compression |
| **rsync** | `rsync -avz dist/ user@host:/var/www/poker/` |
| **Local** | Open `dist/index.html` in any browser |

## Relative Paths

All asset references use relative paths (`./style.css`, `./bundle.js`).
The app works when served from a subdirectory (e.g. `example.com/games/poker/`).

## Project Structure

```
src/
  engine/     → Texas Hold'em rules, deck, hand evaluation, betting
  bot/        → Bot AI strategies (TAG, loose-passive, maniac, rock, balanced)
  ui/         → Browser table UI, controls, game flow
  index.js    → App entry point (bundler root)
public/
  index.html  → HTML shell
  style.css   → Table styles
tests/        → Node test runner test suite
dist/         → Build output (gitignored): index.html, style.css, bundle.js, bundle.js.map
```

## Tech Stack

- **Game engine**: Pure JavaScript ES modules (no dependencies)
- **Bot AI**: Pluggable strategy system
- **UI**: Vanilla JS DOM manipulation
- **Bundler**: [esbuild](https://esbuild.github.io/)
- **Tests**: Node.js native test runner (`node --test`)
