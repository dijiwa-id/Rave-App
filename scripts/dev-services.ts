// Jalankan semua microservice + gateway (opsional: + web dengan argumen "web").
import type { ChildProcess } from 'node:child_process';
import { available, run } from './services.js';

const withWeb = process.argv.includes('web');
const children: ChildProcess[] = [];
let i = 0;
for (const s of available()) children.push(run(s, [], i++));
children.push(run('gateway', [], i++));
if (withWeb) children.push(run('web', [], i++));

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
