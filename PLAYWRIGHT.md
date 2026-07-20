# Playwright (host-side dev tooling)

Playwright drives / screenshots the running workbench (the app on `:8686`) from the
**host**. It is a root-level `devDependency` — deliberately separate from the app:

- Lives in the repo-root `package.json` (`word-warehouse-tools`), **not** in `frontend/`
  (it's not part of the app bundle) and **not** in the Docker image (`node_modules/` is in
  `.dockerignore`; the app itself is pure-stdlib Python).
- Pinned to **1.61.1** to match the host's Node 18. (The container runs Node 22, but
  Playwright runs host-side against the exposed port, so the host version is what matters.)

> **Use it sparingly.** Reach for Playwright only when the outcome can't be reasoned out from
> the source, or when someone wants to *see* the rendered result. For CSS/layout work, read the
> `.css`/`.tsx` and do the math instead of screenshotting every step; a screenshot per
> intermediate change is slow and usually unnecessary.

## Usage — the normal way

Run anything from inside the repo; no `NODE_PATH` or `--no-install` tricks needed.

```bash
npx playwright --version
npx playwright screenshot --viewport-size=1280,800 http://localhost:8686/ shot.png
npx playwright codegen http://localhost:8686/        # needs a display; see note below
```

In a Node script (run with cwd anywhere in the repo — Node resolves `node_modules` up-tree):

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();          // headless is the default here
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:8686/', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: 'shot.png' });
  await browser.close();
})();
```

## Browsers

Binaries live in the shared cache (`~/.cache/ms-playwright`, the default location).

| Engine | Status |
|---|---|
| chromium | ✅ works |
| firefox  | ✅ works |
| webkit   | ⚠️ downloaded, but needs system libs — run the one command below once |

WebKit needs ~12 extra system libraries (gstreamer, enchant, hyphen, woff2, libsecret …).
Installing them needs root, so it's a one-time manual step:

```bash
sudo npx playwright install-deps webkit
```

After that, `webkit.launch()` works like the others. chromium/firefox already have their deps.

## Notes

- **Always headless** — the host has no X display, so headed launches (and `codegen`) fail
  unless you provide a virtual display (`xvfb-run …`, which also needs a sudo apt install).
- To add browsers later: `npx playwright install <name>` (downloads into the shared cache).
