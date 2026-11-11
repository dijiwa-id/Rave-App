import { useDict } from '@/lib/i18n';
import { LegalPage, P, UL, type LegalSection } from './legal';

export default function Copyright() {
  const d = useDict('company').copyright;
  const s = d.sections;
  const sections: LegalSection[] = [
    { id: 'prinsip', title: s.prinsip.title, body: <P>{s.prinsip.p}</P> },
    { id: 'pengunggah', title: s.pengunggah.title, body: <UL items={[...s.pengunggah.items]} /> },
    {
      id: 'lapor',
      title: s.lapor.title,
      body: (
        <>
          <P>{s.lapor.p}</P>
          <UL items={[...s.lapor.items]} />
        </>
      ),
    },
    { id: 'proses', title: s.proses.title, body: <UL items={[...s.proses.items]} /> },
  ];
  return <LegalPage title={d.title} kicker={d.kicker} lead={d.lead} updated={d.updated} sections={sections} contactSubject="Laporan pelanggaran hak cipta" />;
}
