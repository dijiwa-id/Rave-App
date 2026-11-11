import { Link } from 'react-router-dom';
import { useDict } from '@/lib/i18n';
import { LegalPage, P, UL, type LegalSection } from './legal';

export default function Terms() {
  const d = useDict('company').terms;
  const s = d.sections;
  const sections: LegalSection[] = [
    {
      id: 'layanan',
      title: s.layanan.title,
      body: (
        <>
          <P>{s.layanan.p}</P>
          <UL items={[...s.layanan.items]} />
        </>
      ),
    },
    {
      id: 'akun',
      title: s.akun.title,
      body: (
        <>
          <P>{s.akun.p}</P>
          <UL items={[...s.akun.items]} />
        </>
      ),
    },
    {
      id: 'konten',
      title: s.konten.title,
      body: (
        <>
          <P>{s.konten.p}</P>
          <P>
            {s.konten.takedown.before}
            <Link to="/hak-cipta" className="text-rave-primary-text underline decoration-2 underline-offset-4">
              {s.konten.takedown.link}
            </Link>
            {s.konten.takedown.after}
          </P>
        </>
      ),
    },
    {
      id: 'premium',
      title: s.premium.title,
      body: (
        <>
          <P>{s.premium.p}</P>
          <UL items={[...s.premium.items]} />
        </>
      ),
    },
    {
      id: 'tiket',
      title: s.tiket.title,
      body: (
        <>
          <P>{s.tiket.p}</P>
          <UL items={[...s.tiket.items]} />
        </>
      ),
    },
    {
      id: 'booking',
      title: s.booking.title,
      body: (
        <>
          <P>{s.booking.p}</P>
          <UL items={[...s.booking.items]} />
        </>
      ),
    },
    { id: 'larangan', title: s.larangan.title, body: <UL items={[...s.larangan.items]} /> },
    { id: 'tanggung-jawab', title: s.tanggungJawab.title, body: <P>{s.tanggungJawab.p}</P> },
    { id: 'perubahan', title: s.perubahan.title, body: <P>{s.perubahan.p}</P> },
  ];
  return <LegalPage title={d.title} kicker={d.kicker} lead={d.lead} updated={d.updated} sections={sections} contactSubject="Pertanyaan Ketentuan Layanan" />;
}
