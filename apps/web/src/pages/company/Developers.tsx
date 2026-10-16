import { Braces, KeyRound, Link2, Radio, Repeat, ShieldCheck, Webhook } from 'lucide-react';
import { Cards, Checklist, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, useParam } from './shell';

const SURFACES = [
  { icon: Braces, title: 'REST API', body: 'Satu pintu masuk /v1 melalui API Gateway: katalog, profil artis, event, dan tiket dalam JSON.', meta: 'Akses mitra' },
  { icon: Radio, title: 'Ingest siaran', body: 'Kirim siaran dari OBS, Larix, atau encoder lain lewat RTMP; atau langsung dari browser tanpa aplikasi tambahan.', meta: 'Tersedia di Studio & Hub' },
  { icon: Link2, title: 'Tautan EPK', body: 'Tautan EPK bertoken untuk disematkan di proposal, situs, atau sistem internal promotor.', meta: 'Tersedia' },
  { icon: Webhook, title: 'Webhook pembayaran', body: 'Notifikasi status pembayaran bertanda tangan HMAC untuk mitra payment gateway dan rekening bersama.', meta: 'Mitra pembayaran' },
];

const CURL = `curl -s "$GEMA_API/v1/catalog/home" \\
  -H "Authorization: Bearer $GEMA_TOKEN"`;

const PROBLEM = `HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Terlalu banyak permintaan. Coba lagi dalam 12 detik."
}`;

const SIGNATURE = `X-PG-Signature: t=1760000000,v1=<hex>

v1 = HMAC_SHA256(secret, "<t>.<raw body>")
# tolak bila |now - t| > 300 detik atau v1 tidak cocok`;

function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0d]">
      <figcaption className="border-b border-white/10 px-5 py-3 text-xs font-bold tracking-[0.12em] text-white/45 uppercase">{label}</figcaption>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-white/85">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export default function Developers() {
  const rate = useParam('security.rate_limit_per_minute');
  return (
    <CompanyPage title="Developer">
      <PageHero
        kicker="Developer"
        title="Bangun di atas ekosistem musik GEMA."
        lead="GEMA dibangun API-first. Mitra — venue, platform tiket, media, kampus, dan penyedia pembayaran — dapat mengintegrasikan katalog, event, siaran langsung, dan EPK ke produk mereka."
        actions={<ContactCta subject="Developer">Minta akses API</ContactCta>}
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Permukaan integrasi" title="Apa yang bisa kamu hubungkan." body="API mitra dibuka bertahap. Ceritakan kasus penggunaanmu dan kami siapkan kredensial serta lingkungan uji." />
        <Cards items={SURFACES} cols={4} />
      </Section>

      <Section>
        <Heading kicker="Konvensi" title="Dapat diprediksi, sejak permintaan pertama." />
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <Code label="Permintaan">{CURL}</Code>
          <Code label="Error — RFC 9457">{PROBLEM}</Code>
        </div>
        <Checklist
          items={[
            { title: 'Autentikasi Bearer', body: 'Token akses JWT berumur pendek dengan refresh token yang berotasi. Token rusak ditolak di gateway.' },
            { title: 'Error yang konsisten', body: 'Semua error berformat application/problem+json (RFC 9457) dengan pesan yang bisa ditampilkan ke pengguna.' },
            { title: 'Idempotensi', body: 'Operasi yang membuat transaksi — seperti pemesanan tiket — wajib menyertakan header Idempotency-Key agar aman diulang.' },
            { title: 'Rate limit', body: `Batas umum ${rate} permintaan per menit per token atau IP, dengan batas lebih ketat untuk login dan pemesanan tiket.` },
          ]}
        />
      </Section>

      <Section className="border-t border-white/10">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <Heading kicker="Webhook" title="Tanda tangan di setiap notifikasi." body="Setiap webhook pembayaran ditandatangani dengan HMAC-SHA256 dan stempel waktu. Notifikasi yang sama boleh dikirim ulang; kami memprosesnya tepat satu kali." />
            <ul className="mt-8 space-y-4 text-[15px] text-white/70">
              {[
                [ShieldCheck, 'Toleransi waktu 5 menit untuk mencegah replay.'],
                [Repeat, 'Deduplikasi per event_id — aman dikirim ulang oleh penyedia.'],
                [KeyRound, 'Secret penandatangan diserahkan secara aman saat onboarding mitra.'],
              ].map(([Icon, t]) => {
                const I = Icon as typeof ShieldCheck;
                return (
                  <li key={t as string} className="flex items-center gap-3">
                    <I className="size-5 shrink-0 text-gema-primary-text" aria-hidden /> {t as string}
                  </li>
                );
              })}
            </ul>
          </div>
          <Code label="Verifikasi tanda tangan">{SIGNATURE}</Code>
        </div>
      </Section>

      <CtaBand title="Punya ide integrasi?" body="Kirim ringkasan produkmu, perkiraan volume, dan endpoint yang kamu butuhkan. Tim kami akan menghubungi untuk sesi teknis.">
        <ContactCta subject="Developer" variant="light">
          Hubungi tim developer
        </ContactCta>
      </CtaBand>
    </CompanyPage>
  );
}
