// wrangler requires the assets directory to exist; create a placeholder for first-run dev.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
mkdirSync('web/dist', { recursive: true });
if (!existsSync('web/dist/index.html')) writeFileSync('web/dist/index.html', '<!doctype html><title>dev</title>Use the Vite dev server on :5173');
