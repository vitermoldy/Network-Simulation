import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// On Windows the folder can be opened as c:\... or C:\...; pin the root to one spelling so
// modules never load twice.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase());
// The MySQL server (npm run server) keeps run history and saved designs; dev and preview forward /api to it.
