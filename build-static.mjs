import { cpSync, mkdirSync, rmSync } from 'node:fs';

const files = [
  'index.html',
  'styles.css',
  'landing.css',
  'desk.css',
  'app.js',
  'content.js',
  'icons.js',
  'live.js',
  'media.js',
  'model.js',
  'rounds.js',
  'flow-model.js',
  'panel-navigation.js',
  'timer-model.js',
  'timer-popup.js',
  'view-state.js',
  'device-store.js',
  'sync.js',
  'sync-config.js',
  'before-sync.js',
  'connection-badge.js',
  'game-timeline.js',
  'location-guide.js',
  'schedule.json',
  'manifest.webmanifest',
  'sw.js'
];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
files.forEach(file => cpSync(file, `dist/${file}`));
cpSync('assets', 'dist/assets', { recursive: true });
