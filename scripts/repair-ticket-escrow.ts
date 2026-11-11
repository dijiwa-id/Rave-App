// Perbaikan data sekali jalan: escrow tiket yang tercatat per ORDER (sebelum ticketing mengirim metadata event_id)
// dipindahkan ke escrow per EVENT, agar bisa dicairkan ke promotor dan direfund per event.
//
//   npx tsx scripts/repair-ticket-escrow.ts            # pratinjau (tidak mengubah apa pun)
//   npx tsx scripts/repair-ticket-escrow.ts --apply    # terapkan
//
// Per invoice, dalam satu transaksi: jurnal reklasifikasi liability:escrow:event:<order> → liability:escrow:event:<event>
// (idempoten per key), gabungkan baris escrow_holds, lengkapi invoices.metadata, dan bila event sudah selesai
// jadwalkan pencairan ke promotor. Idempoten: invoice yang sudah punya metadata.event_id dilewati.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://rave:rave@127.0.0.1:55432/rave';
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const legacy = (
  await db.query(
    `SELECT i.id AS invoice_id, i.reference_id AS order_id, i.escrow_amount, i.status AS invoice_status,
            o.event_id, e.org_id, e.status AS event_status, e.title
     FROM finance.invoices i
     LEFT JOIN ticketing.orders o ON o.id::text = i.reference_id
     LEFT JOIN ticketing.events e ON e.id = o.event_id
     WHERE i.purpose = 'TICKET_ORDER' AND NOT (i.metadata ? 'event_id')
     ORDER BY i.created_at`,
  )
).rows;

const rp = (n: number) => 'Rp ' + Number(n).toLocaleString('id-ID');
console.log(`${APPLY ? '▶ MENERAPKAN' : '▶ PRATINJAU (tambahkan --apply untuk menerapkan)'} — ${legacy.length} invoice tiket tanpa event_id\n`);

let fixed = 0;
for (const r of legacy) {
  if (!r.event_id) {
    console.log(`  ⚠ invoice ${r.invoice_id}: order ${r.order_id} tidak ditemukan di ticketing — dilewati (periksa manual)`);
    continue;
  }
  const from = `event:${r.order_id}`;
  const to = `event:${r.event_id}`;
  const hold = (await db.query(`SELECT * FROM finance.escrow_holds WHERE reference_id = $1`, [from])).rows[0];
  const bal = Number(
    (
      await db.query(
        `SELECT coalesce(sum(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END), 0)::bigint AS b FROM finance.ledger_entries WHERE account = $1`,
        [`liability:escrow:${from}`],
      )
    ).rows[0].b,
  );
  console.log(
    `  • ${r.title} (event ${r.event_status}) — invoice ${r.invoice_status} ${rp(r.escrow_amount)}\n` +
      `    escrow ${from} → ${to}: held ${rp(hold?.held ?? 0)}, released ${rp(hold?.released ?? 0)}, refunded ${rp(hold?.refunded ?? 0)}; saldo ledger ${rp(bal)}` +
      (r.event_status === 'COMPLETED' ? '\n    event sudah selesai → pencairan ke promotor dijadwalkan' : ''),
  );
  if (!APPLY) continue;

  await db.query('BEGIN');
  try {
    // Trigger ledger (keseimbangan debit = kredit) merujuk tabel tanpa schema → jalankan dalam schema finance.
    await db.query('SET LOCAL search_path TO finance, public');
    // Kunci invoice: proses paralel / eksekusi ulang tidak menggandakan perpindahan.
    const still = (await db.query(`SELECT 1 FROM finance.invoices WHERE id = $1 AND NOT (metadata ? 'event_id') FOR UPDATE`, [r.invoice_id])).rowCount;
    if (!still) {
      await db.query('ROLLBACK');
      continue;
    }
    if (bal !== 0) {
      const t = await db.query(
        `INSERT INTO finance.ledger_transactions (id, idempotency_key, kind, reference_id, description)
         VALUES (gen_random_uuid(), $1, 'escrow.reclass', $2, $3) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [`repair:escrow:${r.invoice_id}`, r.order_id, `Perbaikan data: escrow tiket per order → per event ${r.event_id}`],
      );
      if (t.rows[0]) {
        const side = bal > 0 ? ['DEBIT', 'CREDIT'] : ['CREDIT', 'DEBIT'];
        await db.query(`INSERT INTO finance.ledger_entries (txn_id, account, side, amount) VALUES ($1,$2,$3,$4), ($1,$5,$6,$4)`, [
          t.rows[0].id,
          `liability:escrow:${from}`,
          side[0],
          Math.abs(bal),
          `liability:escrow:${to}`,
          side[1],
        ]);
      }
    }
    if (hold) {
      await db.query(
        `INSERT INTO finance.escrow_holds (reference_id, kind, promotor_org_id, held, released, refunded, status)
         VALUES ($1, 'EVENT', $2, $3, $4, $5, 'HELD')
         ON CONFLICT (reference_id) DO UPDATE SET held = escrow_holds.held + EXCLUDED.held, released = escrow_holds.released + EXCLUDED.released,
           refunded = escrow_holds.refunded + EXCLUDED.refunded, promotor_org_id = coalesce(escrow_holds.promotor_org_id, EXCLUDED.promotor_org_id), updated_at = now()`,
        [to, r.org_id, hold.held, hold.released, hold.refunded],
      );
      await db.query(`DELETE FROM finance.escrow_holds WHERE reference_id = $1`, [from]);
    }
    await db.query(`UPDATE finance.invoices SET metadata = metadata || jsonb_build_object('event_id', $2::text, 'promotor_org_id', $3::text) WHERE id = $1`, [
      r.invoice_id,
      r.event_id,
      r.org_id,
    ]);
    // Event sudah selesai sebelum perbaikan: consumer ticketing.event.completed tidak menemukan hold ini dulu → jadwalkan sekarang.
    if (r.event_status === 'COMPLETED')
      await db.query(`UPDATE finance.escrow_holds SET release_at = coalesce(release_at, now()) WHERE reference_id = $1 AND status = 'HELD'`, [to]);
    await db.query('COMMIT');
    fixed++;
  } catch (e) {
    await db.query('ROLLBACK');
    console.error(`  ✗ invoice ${r.invoice_id} gagal diperbaiki:`, (e as Error).message);
    process.exitCode = 1;
  }
}

if (APPLY) console.log(`\n✓ ${fixed} invoice diperbaiki`);
await db.end();
