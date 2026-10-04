// Migrasi + seed data demo untuk semua service (berurutan). Idempoten.
import { available, run, waitExit } from './services.js';

const mode = process.argv[2] === 'migrate' ? 'migrate' : 'seed';
const list = available();
let i = 0;
for (const s of list) {
  const code = await waitExit(run(s, [mode], i++));
  if (code !== 0) {
    console.error(`✗ ${mode} ${s} gagal (exit ${code})`);
    process.exit(code);
  }
}
console.log(`✓ ${mode} selesai untuk: ${list.join(', ')}`);
