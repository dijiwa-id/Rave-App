import pg from 'pg';
import { assertBalanced, type LedgerLine } from '@rave/domain';
import { uuidv7, type Client, type Db } from '@rave/service-kit';

pg.types.setTypeParser(1082, (v) => v);

export const SOURCES = ['royalty', 'offair', 'ticket', 'merch', 'tip'] as const;
export type Source = (typeof SOURCES)[number];
export const payableAccount = (partyId: string, source: Source) => `liability:payable:${partyId}:${source}`;

/**
 * Posting transaksi ledger double-entry. Idempoten per `key` (mis. id event PG).
 * Mengembalikan id transaksi, atau null bila key sudah pernah diposting.
 */
export async function post(
  c: Client,
  t: { key: string; kind: string; referenceId?: string | null; description: string; lines: LedgerLine[] },
): Promise<string | null> {
  const lines = t.lines.filter((l) => l.amount !== 0);
  assertBalanced(lines);
  const id = uuidv7();
  const r = await c.query(
    `INSERT INTO ledger_transactions (id, idempotency_key, kind, reference_id, description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [id, t.key, t.kind, t.referenceId ?? null, t.description],
  );
  if (!r.rows[0]) return null;
  for (const l of lines) await c.query(`INSERT INTO ledger_entries (txn_id, account, side, amount) VALUES ($1,$2,$3,$4)`, [id, l.account, l.side, l.amount]);
  return id;
}

export const D = (account: string, amount: number): LedgerLine => ({ account, side: 'DEBIT', amount });
export const C = (account: string, amount: number): LedgerLine => ({ account, side: 'CREDIT', amount });

/** Saldo kredit-normal (liabilitas/pendapatan) sebuah akun. */
export async function creditBalance(c: Client | Db, account: string): Promise<number> {
  const q = `SELECT coalesce(sum(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END),0)::bigint AS b FROM ledger_entries WHERE account=$1`;
  const r: any = await (c as any).query(q, [account]);
  return Number((Array.isArray(r) ? r[0] : r.rows[0]).b);
}

export async function walletBalances(c: Client | Db, partyId: string) {
  const q = `SELECT split_part(account, ':', 4) AS source, sum(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END)::bigint AS b
             FROM ledger_entries WHERE account LIKE $1 GROUP BY 1`;
  const r: any = await (c as any).query(q, [`liability:payable:${partyId}:%`]);
  const rows = Array.isArray(r) ? r : r.rows;
  const balances: Record<string, number> = { royalty: 0, offair: 0, ticket: 0, merch: 0, tip: 0 };
  for (const x of rows) if (x.source in balances) balances[x.source] = Number(x.b);
  return { ...balances, total: Object.values(balances).reduce((a, b) => a + b, 0) } as Record<Source | 'total', number>;
}

/** Transaksi SERIALIZABLE dengan retry pada konflik serialisasi (40001). */
export async function serial<T>(db: Db, fn: (c: Client) => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await db.tx(fn, { isolation: 'serializable' });
    } catch (e: any) {
      if ((e?.code === '40001' || e?.code === '40P01') && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 20 * (i + 1) + Math.random() * 30));
        continue;
      }
      throw e;
    }
  }
}
