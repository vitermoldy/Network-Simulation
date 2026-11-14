import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// On Windows the folder can be opened as c:\... or C:\...; pin the root to one spelling so
// modules never load twice.
