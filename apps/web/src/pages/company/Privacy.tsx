import { Link } from 'react-router-dom';
import { useDict } from '@/lib/i18n';
import { LegalPage, P, UL, type LegalSection } from './legal';

export default function Privacy() {
  const d = useDict('company').privacy;
  const s = d.sections;
  const sections: LegalSection[] = [
    {
      id: 'ringkas',
      title: s.ringkas.title,
      body: (
        <>
          <P>{s.ringkas.p}</P>
          <UL items={[...s.ringkas.items]} />
        </>
      ),
    },
    { id: 'data', title: s.data.title, body: <UL items={[...s.data.items]} /> },
    { id: 'penggunaan', title: s.penggunaan.title, body: <UL items={[...s.penggunaan.items]} /> },
    { id: 'berbagi', title: s.berbagi.title, body: <UL items={[...s.berbagi.items]} /> },
    {
      id: 'hak',
      title: s.hak.title,
      body: (
        <>
          <P>{s.hak.p}</P>
          <P>
            {s.hak.settings.before}
            <Link to="/app/settings" className="text-rave-primary-text underline decoration-2 underline-offset-4">
              {s.hak.settings.link}
            </Link>
            {s.hak.settings.after}
          </P>
        </>
      ),
    },
    { id: 'simpan', title: s.simpan.title, body: <P>{s.simpan.p}</P> },
    {
      id: 'cookie',
      title: s.cookie.title,
      body: (
        <P>
          {s.cookie.before}
          <Link to="/cookie" className="text-rave-primary-text underline decoration-2 underline-offset-4">
            {s.cookie.link}
          </Link>
          {s.cookie.after}
        </P>
      ),
    },
  ];
  return <LegalPage title={d.title} kicker={d.kicker} lead={d.lead} updated={d.updated} sections={sections} contactSubject="Permintaan data pribadi (UU PDP)" />;
}
