import { cpSync, mkdirSync, rmSync } from 'node:fs';

const files = [
  'index.html',
  'styles.css',
  'landing.css',
  'app.js',
  'content.js',
  'icons.js',
  'live.js',
  'media.js',
  'model.js',
  'rounds.js',
  'timer-model.js',
  'timer-popup.js',
  'schedule.json',
  'manifest.webmanifest',
  'sw.js'
];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
files.forEach(file => cpSync(file, `dist/${file}`));
cpSync('assets', 'dist/assets', { recursive: true });
