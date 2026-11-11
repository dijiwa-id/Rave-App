import { useDict } from '@/lib/i18n';
import { LegalPage, P, type LegalSection } from './legal';

type StorageType = 'essential' | 'preference' | 'functional' | 'session';

/** Penyimpanan lokal yang benar-benar dipakai aplikasi (sinkron dengan kode). Kegunaan per bahasa di kamus company.cookies.items. */
const ITEMS: [string, StorageType][] = [
  ['rave-auth', 'essential'],
  ['rave-quality', 'preference'],
  ['rave-dashboard-theme', 'preference'],
  ['rave-b2b-sidebar', 'preference'],
  ['rave-last-email', 'preference'],
  ['rave-dismissed-announcement', 'preference'],
  ['rave-shortlist', 'preference'],
  ['rave-gate', 'functional'],
  ['rave-live-viewer', 'session'],
  ['rave-chunk-reload', 'session'],
];

export default function Cookies() {
  const d = useDict('company').cookies;
  const s = d.sections;
  const items = d.items as Record<string, string>;
  const sections: LegalSection[] = [
    { id: 'apa', title: s.apa.title, body: <P>{s.apa.p}</P> },
    {
      id: 'daftar',
      title: s.daftar.title,
      body: (
        <div className="mt-5 overflow-x-auto border-2 border-rave-ink shadow-[4px_4px_0_#0b0a0c]">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-rave-primary text-rave-ink">
              <tr>
                {[d.columns.name, d.columns.type, d.columns.use].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-label text-[11px] font-bold tracking-[0.1em] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ITEMS.map(([k, t]) => (
                <tr key={k} className="border-t border-white/10 bg-[#1e1c1f] odd:bg-[#232026]">
                  <td className="px-4 py-3 font-label text-[12px] font-bold text-rave-primary-text">{k}</td>
                  <td className="px-4 py-3 text-white/70">{d.types[t]}</td>
                  <td className="px-4 py-3 text-white/75">{items[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    { id: 'kendali', title: s.kendali.title, body: <P>{s.kendali.p}</P> },
  ];
  return <LegalPage title={d.title} kicker={d.kicker} lead={d.lead} updated={d.updated} sections={sections} contactSubject="Pertanyaan Kebijakan Cookie" />;
}
