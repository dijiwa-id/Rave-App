// Inisialisasi DB untuk stack (Docker dev / CI): DB kosong → migrasi + seed demo; sudah berisi → migrasi saja.
// Sama dengan logika `./rave start`. Paksa seed ulang dengan SEED=1.
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://rave:rave@127.0.0.1:55432/rave';
const c = new pg.Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(`SELECT to_regclass('iam.users') IS NOT NULL AS ok`);
await c.end();
const seeded = rows[0]?.ok === true;
if (seeded && process.env.SEED !== '1') {
  console.log('→ DB sudah berisi data: migrasi saja');
  process.argv[2] = 'migrate';
} else {
  console.log('→ DB kosong: migrasi + seed data demo');
  process.argv[2] = 'seed';
}
await import('./seed-all.js');
