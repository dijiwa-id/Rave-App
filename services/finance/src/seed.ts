import { SEED } from '@rave/domain';
import type { ServiceContext } from '@rave/service-kit';
import { C, D, payableAccount, post } from './ledger.js';

/** Saldo awal wallet Senja Kolektif (royalti 2 bulan + tip) agar halaman Keuangan Studio terisi. Idempoten. */
export async function seed({ db, log }: ServiceContext) {
  const senja = SEED.orgs.senjaArtist;
  await db.tx(async (c) => {
    const items: [string, string, number, 'royalty' | 'tip', string][] = [
      ['seed:royalty:2026-08:senja', 'Statement royalti Agustus 2026 (UCPS)', 1_250_000, 'royalty', 'expense:royalty:streaming'],
      ['seed:royalty:2026-09:senja', 'Statement royalti September 2026 (UCPS)', 980_000, 'royalty', 'expense:royalty:streaming'],
      ['seed:tip:2026-09:senja', 'Dukungan langsung fan (tip) September 2026', 150_000, 'tip', 'asset:escrow_bank:mitra-sandbox'],
    ];
    for (const [key, desc, amount, source, debit] of items) {
      await post(c, { key, kind: `seed.${source}`, description: desc, lines: [D(debit, amount), C(payableAccount(senja, source), amount)] });
    }
  });
  log.info('seed finance selesai');
}
