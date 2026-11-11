import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BadgeCheck, CalendarCheck, FileSignature, Headphones, LifeBuoy, MessageCircle, Mic2, Newspaper, QrCode, ShieldCheck, Ticket, Webhook } from 'lucide-react';
import { DEFAULT_BRAND } from '@/lib/platform';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { Vinyl } from '@/pages/public/Vinyl';
import roleArtist from '@/assets/landing/role-artist.webp';
import rolePromotor from '@/assets/landing/role-promotor.webp';
import roleFan from '@/assets/landing/role-fan.webp';
import gigCables from '@/assets/landing/gig-jakarta-pub.webp';
import gigCrowd from '@/assets/landing/gig-jakarta.webp';
import gigDiy from '@/assets/landing/gig-diy.webp';
import stage from '@/assets/landing/hero-stage.webp';
import halftone from '@/assets/brand/paper-halftone.webp';
import folded from '@/assets/brand/hero-poster-folded.webp';

const TAPE =
  '[clip-path:polygon(0_10%,8%_0,18%_12%,30%_2%,44%_10%,58%_0,72%_9%,86%_1%,100%_10%,97%_55%,100%_92%,86%_100%,70%_91%,54%_100%,38%_92%,22%_100%,8%_92%,0_100%,3%_50%)]';

/** Kartu mengambang kolase (tinta atau kertas), muncul halus lalu melayang pelan. */
function Float({ className, delay = 0, drift = 7, paper, children }: { className?: string; delay?: number; drift?: number; paper?: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cx('absolute z-20 border-2 border-rave-ink p-3 shadow-[5px_5px_0_#0b0a0c]', paper ? 'bg-rave-paper text-rave-ink' : 'bg-[#1e1c1f] text-rave-paper', className)}
      initial={{ opacity: 0, y: 20 }}
      animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -drift, 0] }}
      transition={{ opacity: { duration: 0.6, delay }, y: reduce ? { duration: 0.6, delay } : { duration: 6, delay, repeat: Infinity, ease: 'easeInOut' } }}
    >
      {children}
    </motion.div>
  );
}

/** Bingkai kolase bersama: vinyl di belakang, foto poster punk (fotokopi + duotone + lipatan + halftone), selotip, cap. */
function Collage({ src, alt, stamp, children }: { src: string; alt: string; stamp: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto mt-6 aspect-[4/5] w-full max-w-[440px] lg:mt-0" aria-hidden={false}>
      <Vinyl className="absolute top-1/2 left-[38%] -z-10 w-[150%] -translate-y-1/2" discClassName="animate-[rave-spin_9s_linear_infinite] motion-reduce:animate-none" />
      <div className="absolute inset-y-0 right-0 left-[8%] overflow-hidden border-[5px] border-rave-paper shadow-[10px_10px_0_#F4C21F] [rotate:1.5deg]">
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover grayscale contrast-[1.25] brightness-[1.05]" />
        <span className="absolute inset-0 bg-cover bg-center opacity-80 mix-blend-overlay" style={{ backgroundImage: `url(${folded})` }} aria-hidden />
        <span className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-multiply" style={{ backgroundImage: `url(${halftone})` }} aria-hidden />
        <span className="absolute inset-0 bg-rave-purple opacity-30 mix-blend-color" aria-hidden />
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" aria-hidden />
        <span className="rave-stamp absolute right-4 bottom-4 bg-rave-ink/60 text-rave-paper [--stamp-r:-3deg]">{stamp}</span>
      </div>
      <span className={cx('pointer-events-none absolute -top-3 left-[24%] z-20 h-7 w-28 -rotate-[8deg] bg-rave-paper/75 shadow-[0_1px_2px_rgba(0,0,0,0.4)]', TAPE)} aria-hidden />
      <span className={cx('pointer-events-none absolute -top-2 right-[6%] z-20 h-7 w-24 rotate-[10deg] bg-rave-paper/75 shadow-[0_1px_2px_rgba(0,0,0,0.4)]', TAPE)} aria-hidden />
      {children}
    </div>
  );
}

/** Ilustrasi header "Untuk Artis": EPK pendengar per kota, stiker fee cair, kontrak tertandatangani. */
export function ArtistHeroArt() {
  const cities: [string, number][] = [
    ['Bandung', 100],
    ['Jakarta', 62],
    ['Yogya', 41],
    ['Malang', 28],
  ];
  const d = useDict('company').heroArt.artist;
  return (
    <Collage src={roleArtist} alt={d.alt} stamp="RV-Studio">
      <Float paper className="top-[8%] -left-[4%] w-[58%]" delay={0.4} drift={6}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.epk}</p>
        <ul className="mt-2 space-y-1.5">
          {cities.map(([c, v]) => (
            <li key={c} className="flex items-center gap-2 text-[11px] font-bold">
              <span className="w-14 shrink-0">{c}</span>
              <span className="h-2.5 flex-1 border border-rave-ink bg-white">
                <span className="block h-full bg-rave-purple" style={{ width: `${v}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </Float>
      <span className="absolute top-[44%] -right-[3%] z-30 rotate-[7deg] border-2 border-rave-ink bg-rave-primary px-3 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
        <span className="block font-display text-2xl leading-none uppercase">{d.feeTitle}</span>
        <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{d.feeSub}</span>
      </span>
      <Float className="bottom-[9%] left-[2%] w-[60%]" delay={0.7} drift={9}>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center border-2 border-rave-ink bg-rave-purple">
            <FileSignature className="size-4 text-rave-primary-text" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{d.contract}</span>
            <span className="block font-label text-[10px] font-bold tracking-[0.08em] text-white/60 uppercase">{d.signed}</span>
          </span>
          <BadgeCheck className="ml-auto size-5 shrink-0 text-rave-primary-text" />
        </div>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Untuk Promotor": skor Audience Match, sobekan tiket QR, stiker DP aman escrow. */
export function PromoterHeroArt() {
  const d = useDict('company').heroArt.promoter;
  return (
    <Collage src={rolePromotor} alt={d.alt} stamp="RV-Hub">
      <Float paper className="top-[8%] -left-[4%] w-[60%]" delay={0.4} drift={6}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">Audience Match</p>
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">Senja Kolektif</span>
            <span className="block text-[11px] text-rave-ink/60">Bandung · indie-pop</span>
          </span>
          <span className="font-display text-4xl leading-none text-rave-purple">92%</span>
        </div>
        <span className="mt-2 block h-2.5 border border-rave-ink bg-white">
          <span className="block h-full w-[92%] bg-rave-primary" />
        </span>
      </Float>
      <span className="absolute top-[46%] -right-[3%] z-30 -rotate-[6deg] border-2 border-rave-ink bg-rave-paper px-3 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
        <span className="flex items-center justify-center gap-1.5 font-display text-2xl leading-none uppercase">
          <ShieldCheck className="size-5" /> {d.dpTitle}
        </span>
        <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{d.dpSub}</span>
      </span>
      <Float className="bottom-[9%] left-[2%] w-[62%] [clip-path:polygon(0_0,100%_0,100%_38%,96%_50%,100%_62%,100%_100%,0_100%,0_62%,4%_50%,0_38%)]" delay={0.7} drift={9}>
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center bg-rave-paper text-rave-ink">
            <QrCode className="size-7" />
          </span>
          <span className="min-w-0 border-l-2 border-dashed border-white/20 pl-3">
            <span className="block font-label text-[10px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{d.ticket}</span>
            <span className="block truncate text-sm font-bold">{d.event}</span>
            <span className="block text-[11px] text-white/55">{d.qr}</span>
          </span>
        </div>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Tentang Iklan": iklan audio berlabel jelas, kartu penargetan kota/usia/genre, stiker brand safe. */
export function AdvertiseHeroArt() {
  const reduce = useReducedMotion();
  const d = useDict('company').heroArt.advertise;
  return (
    <Collage src={roleFan} alt={d.alt} stamp="RV-Ads">
      <Float className="top-[8%] -left-[4%] w-[62%]" delay={0.4} drift={6}>
        <div className="flex items-center gap-2">
          <span className="border-2 border-rave-ink bg-rave-paper px-1.5 py-px font-label text-[9px] font-bold tracking-[0.1em] text-rave-ink uppercase">{d.adLabel}</span>
          <span className="font-label text-[10px] font-bold tracking-[0.08em] text-white/60 uppercase">{d.duration}</span>
        </div>
        <p className="mt-2 truncate text-sm font-bold">{d.spot}</p>
        <span className="mt-2 block h-1.5 overflow-hidden border border-rave-ink bg-white/10">
          <motion.span
            className="block h-full bg-rave-primary"
            initial={{ width: '20%' }}
            animate={reduce ? undefined : { width: ['20%', '85%'] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          />
        </span>
      </Float>
      <span className="absolute top-[45%] -right-[3%] z-30 rotate-[6deg] border-2 border-rave-ink bg-rave-primary px-3 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
        <span className="flex items-center justify-center gap-1.5 font-display text-2xl leading-none uppercase">
          <ShieldCheck className="size-5" /> {d.safeTitle}
        </span>
        <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{d.safeSub}</span>
      </span>
      <Float paper className="bottom-[9%] left-[2%] w-[60%]" delay={0.7} drift={9}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.target}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['Bandung', '18–24', 'Indie'].map((t) => (
            <span key={t} className="border-2 border-rave-ink bg-white px-2 py-0.5 font-label text-[10px] font-bold uppercase">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-2 font-display text-3xl leading-none text-rave-purple">{d.reach}</p>
        <p className="text-[11px] text-rave-ink/60">{d.reachLabel}</p>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Developer": terminal permintaan /v1 + respons JSON, stiker API-first, kartu webhook HMAC. */
export function DeveloperHeroArt() {
  const reduce = useReducedMotion();
  const d = useDict('company').heroArt.developer;
  return (
    <Collage src={gigCables} alt={d.alt} stamp="RV-API">
      <Float className="top-[7%] -left-[5%] w-[70%] !bg-[#0b0b0d] !p-0" delay={0.4} drift={6}>
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
          {['#8a2f3f', '#f4c21f', '#1f5c52'].map((c) => (
            <span key={c} className="size-2 rounded-full" style={{ background: c }} />
          ))}
          <span className="ml-2 font-label text-[9px] font-bold tracking-[0.12em] text-white/45 uppercase">terminal</span>
        </div>
        <pre className="overflow-hidden px-3 py-2.5 font-label text-[10.5px] leading-[1.55] whitespace-pre text-white/80">
          <span className="text-white/40">$ </span>curl $RAVE_API<span className="text-rave-primary-text">/v1/events</span>
          {'\n'}
          <span className="text-[#7fd1a7]">200 OK</span>
          <span className="text-white/40"> · 84 ms</span>
          {'\n'}
          {'{ '}
          <span className="text-[#c9a6db]">"title"</span>: <span className="text-rave-primary-text">"Gigs Kampus"</span>,{'\n'}
          {'  '}
          <span className="text-[#c9a6db]">"city"</span>: <span className="text-rave-primary-text">"Bandung"</span> {'}'}
          <motion.span
            className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-rave-paper"
            animate={reduce ? undefined : { opacity: [1, 0, 1] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
          />
        </pre>
      </Float>
      <span className="absolute top-[47%] -right-[3%] z-30 rotate-[6deg] border-2 border-rave-ink bg-rave-primary px-3 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
        <span className="block font-display text-2xl leading-none uppercase">API-first</span>
        <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">REST · JSON · /v1</span>
      </span>
      <Float paper className="bottom-[9%] left-[2%] w-[62%]" delay={0.7} drift={9}>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center border-2 border-rave-ink bg-rave-purple">
            <Webhook className="size-4 text-rave-primary-text" />
          </span>
          <span className="min-w-0">
            <span className="block font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">Webhook · payment</span>
            <span className="block truncate text-sm font-bold">{d.verified}</span>
            <span className="block text-[11px] text-rave-ink/60">{d.dedup}</span>
          </span>
          <BadgeCheck className="ml-auto size-5 shrink-0 text-rave-purple" />
        </div>
      </Float>
    </Collage>
  );
}

/** Stiker miring (mustard atau paper) di tepi kanan kolase. */
function Sticker({ top, bottom, paper, r = 6, icon }: { top: string; bottom: string; paper?: boolean; r?: number; icon?: ReactNode }) {
  return (
    <span
      className={cx('absolute top-[46%] -right-[3%] z-30 border-2 border-rave-ink px-3 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]', paper ? 'bg-rave-paper' : 'bg-rave-primary')}
      style={{ rotate: `${r}deg` }}
    >
      <span className="flex items-center justify-center gap-1.5 font-display text-2xl leading-none uppercase">
        {icon}
        {top}
      </span>
      <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{bottom}</span>
    </span>
  );
}

/** Ilustrasi header "Investor": lingkaran nilai RAVE (dengar → booking → panggung → tiket) + peta jalan fase. */
export function InvestorHeroArt() {
  const d = useDict('company').heroArt.investor;
  const loop = [Headphones, CalendarCheck, Mic2, Ticket].map((Icon, i): [typeof Headphones, string] => [Icon, d.loop[i]]);
  return (
    <Collage src={gigCrowd} alt={d.alt} stamp="RV-IR">
      <Float paper className="top-[7%] -left-[5%] w-[68%]" delay={0.4} drift={6}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.loopTitle}</p>
        <ol className="mt-2 flex items-center justify-between gap-1">
          {loop.map(([Icon, l], i) => (
            <li key={l} className="flex items-center gap-1">
              <span className="flex flex-col items-center gap-1">
                <span className="grid size-8 place-items-center border-2 border-rave-ink bg-rave-purple">
                  <Icon className="size-4 text-rave-primary-text" />
                </span>
                <span className="text-[10px] font-bold">{l}</span>
              </span>
              {i < loop.length - 1 && <ArrowRight className="mb-4 size-3 shrink-0 text-rave-ink/50" />}
            </li>
          ))}
        </ol>
      </Float>
      <Sticker top={d.stickerTop} bottom={d.stickerBottom} />
      <Float className="bottom-[9%] left-[2%] w-[64%]" delay={0.7} drift={9}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{d.roadmap}</p>
        <ol className="mt-2.5 flex items-center">
          {[0, 1, 2, 3, 4].map((n) => (
            <li key={n} className="flex flex-1 items-center last:flex-none">
              <span className="grid size-6 shrink-0 place-items-center border-2 border-rave-ink bg-rave-paper font-label text-[10px] font-bold text-rave-ink">{n}</span>
              {n < 4 && <span className="h-0.5 flex-1 bg-white/25" />}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-white/60">{d.phases}</p>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Tentang": lagu sedang diputar → gig kotamu, stiker Dengar · Datang · Dukung. */
export function AboutHeroArt() {
  const reduce = useReducedMotion();
  const d = useDict('company').heroArt.about;
  return (
    <Collage src={stage} alt={d.alt} stamp="RV-001">
      <Float className="top-[7%] -left-[5%] w-[64%]" delay={0.4} drift={6}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-white/55 uppercase">{d.nowPlaying}</p>
        <p className="mt-1 truncate text-sm font-bold">Hujan di Dago</p>
        <p className="truncate text-[11px] text-white/60">Senja Kolektif</p>
        <span className="mt-2 flex h-4 items-end gap-[3px]" aria-hidden>
          {[0.4, 0.9, 0.6, 1, 0.5, 0.8, 0.35, 0.7, 0.55, 0.95, 0.45, 0.75].map((h, k) => (
            <motion.span
              key={k}
              className="w-[3px] bg-rave-primary"
              style={{ height: `${h * 100}%`, originY: 1 }}
              animate={reduce ? undefined : { scaleY: [0.4, 1, 0.6, 0.9, 0.4] }}
              transition={{ duration: 1.4 + (k % 4) * 0.2, repeat: Infinity, ease: 'easeInOut', delay: k * 0.05 }}
            />
          ))}
        </span>
      </Float>
      <Sticker top={d.stickerTop} bottom={d.stickerBottom} r={-6} />
      <Float paper className="bottom-[9%] left-[2%] w-[60%]" delay={0.7} drift={9}>
        <div className="flex items-center gap-3">
          <span className="grid w-11 shrink-0 place-items-center border-2 border-rave-ink bg-white py-1 leading-none">
            <span className="font-display text-xl">14</span>
            <span className="font-label text-[8px] font-bold uppercase">{d.month}</span>
          </span>
          <span className="min-w-0">
            <span className="block font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.gigInCity}</span>
            <span className="block truncate text-sm font-bold">Senja Kolektif · Bandung</span>
          </span>
        </div>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Karier": crew pass backstage + daftar bidang tim. */
export function CareersHeroArt({ teams }: { teams: string[] }) {
  const d = useDict('company').heroArt.careers;
  return (
    <Collage src={gigDiy} alt={d.alt} stamp="RV-Crew">
      <Float paper className="top-[6%] -left-[5%] w-[52%] !p-0" delay={0.4} drift={6}>
        <span className="mx-auto mt-2 block h-2 w-8 rounded-full border-2 border-rave-ink bg-rave-ink/10" aria-hidden />
        <div className="mt-2 bg-rave-purple px-3 py-1.5 font-display text-2xl leading-none text-rave-paper uppercase">{d.pass}</div>
        <div className="px-3 py-2.5">
          <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.access}</p>
          <p className="mt-1 text-sm font-bold">{d.yourName}</p>
          <span className="mt-2 block h-5 bg-[repeating-linear-gradient(90deg,#181818_0_2px,transparent_2px_4px,#181818_4px_5px,transparent_5px_8px)]" aria-hidden />
        </div>
      </Float>
      <Sticker top={d.stickerTop} bottom={d.stickerBottom} />
      <Float className="bottom-[8%] left-[2%] w-[64%]" delay={0.7} drift={9}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{d.teams}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <li key={t} className="border border-white/25 px-2 py-0.5 text-[11px] font-bold">
              {t}
            </li>
          ))}
        </ul>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Bantuan": percakapan bantuan + kartu topik. */
export function HelpHeroArt({ topics }: { topics: string[] }) {
  const d = useDict('company').heroArt.help;
  return (
    <Collage src={roleFan} alt={d.alt} stamp="RV-Help">
      <Float className="top-[7%] -left-[5%] w-[66%]" delay={0.4} drift={6}>
        <p className="flex items-center gap-1.5 font-label text-[10px] font-bold tracking-[0.1em] text-white/55 uppercase">
          <MessageCircle className="size-3.5" /> {d.label}
        </p>
        <p className="mt-2 ml-auto w-fit max-w-[85%] bg-white/10 px-2.5 py-1.5 text-[12px]">{d.question}</p>
        <p className="mt-1.5 w-fit max-w-[90%] border-2 border-rave-ink bg-rave-primary px-2.5 py-1.5 text-[12px] font-bold text-rave-ink">{d.answer}</p>
      </Float>
      <Sticker top={d.stickerTop} bottom={d.stickerBottom} paper icon={<LifeBuoy className="size-5" />} />
      <Float paper className="bottom-[9%] left-[2%] w-[58%]" delay={0.7} drift={9}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.popular}</p>
        <ul className="mt-1.5 space-y-1">
          {topics.map((t) => (
            <li key={t} className="flex items-center justify-between gap-2 border-b border-rave-ink/15 pb-1 text-[12px] font-bold last:border-0">
              {t} <ArrowRight className="size-3 shrink-0" />
            </li>
          ))}
        </ul>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header "Ruang media": press kit (logo resmi) + kliping tagline. */
export function PressHeroArt() {
  const d = useDict('company').heroArt.press;
  return (
    <Collage src={roleArtist} alt={d.alt} stamp="RV-Press">
      <Float paper className="top-[7%] -left-[5%] w-[56%]" delay={0.4} drift={6}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.kit}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <span className="flex h-12 min-w-0 items-center justify-center overflow-hidden border-2 border-rave-ink bg-white p-2">
            <img src={DEFAULT_BRAND.logo} alt="" className="h-7 w-auto max-w-full object-contain" />
          </span>
          <span className="flex h-12 min-w-0 items-center justify-center overflow-hidden border-2 border-rave-ink bg-rave-ink p-2">
            <img src={DEFAULT_BRAND.logoDark} alt="" className="h-7 w-auto max-w-full object-contain" />
          </span>
        </div>
        <p className="mt-1.5 font-label text-[9px] font-bold tracking-[0.08em] text-rave-ink/60 uppercase">{d.kitSub}</p>
      </Float>
      <Sticker top={d.stickerTop} bottom={d.stickerBottom} r={-5} paper icon={<Newspaper className="size-5" />} />
      <Float className="bottom-[9%] left-[2%] w-[64%]" delay={0.7} drift={9}>
        <p className="font-label text-[10px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{d.clipping}</p>
        <p className="mt-1 font-display text-2xl leading-[0.95] uppercase">{d.tagline}</p>
      </Float>
    </Collage>
  );
}

/** Ilustrasi header dokumen legal: tumpukan kertas bergaris, cap UU PDP, tanggal pembaruan. Hanya desktop. */
export function LegalHeroArt({ updated, kicker }: { updated: string; kicker: string }) {
  const d = useDict('company').heroArt.legal;
  return (
    <div className="relative mx-auto hidden aspect-[4/5] w-full max-w-[360px] lg:block" aria-hidden>
      <div className="absolute inset-[6%_10%_10%_14%] rotate-[-5deg] border-2 border-rave-ink bg-[#cfc9c1] shadow-[6px_6px_0_#0b0a0c]" />
      <div className="absolute inset-[3%_6%_12%_10%] rotate-[3deg] border-2 border-rave-ink bg-[#e2ddd5]" />
      <div className="rave-grain absolute inset-[0_8%_14%_6%] overflow-hidden border-2 border-rave-ink bg-rave-paper p-6 text-rave-ink shadow-[8px_8px_0_#F4C21F]">
        <p className="font-label text-[10px] font-bold tracking-[0.14em] text-rave-purple uppercase">{kicker}</p>
        <div className="mt-3 h-3 w-3/4 bg-rave-ink" />
        <div className="mt-5 space-y-2.5">
          {[100, 92, 97, 60, 0, 88, 95, 70, 0, 94, 82].map((w, i) =>
            w ? <div key={i} className="h-1.5 bg-rave-ink/20" style={{ width: `${w}%` }} /> : <div key={i} className="h-2" />,
          )}
        </div>
        <p className="absolute bottom-5 left-6 font-label text-[9px] font-bold tracking-[0.12em] text-rave-ink/55 uppercase">{d.updated(updated)}</p>
      </div>
      <span className={cx('pointer-events-none absolute -top-2 left-[34%] z-20 h-7 w-28 -rotate-[6deg] bg-rave-paper/75 shadow-[0_1px_2px_rgba(0,0,0,0.4)]', TAPE)} />
      <span className="absolute right-[2%] bottom-[18%] z-30 grid size-28 rotate-[-12deg] place-items-center rounded-full border-[3px] border-double border-rave-berry text-center text-rave-berry">
        <span className="font-display text-xl leading-none uppercase">
          {d.stampTop}
          <br />
          {d.stampBottom}
        </span>
      </span>
      <span className="absolute bottom-[2%] left-[4%] z-30 flex items-center gap-1.5 border-2 border-rave-ink bg-rave-primary px-2.5 py-1 font-label text-[10px] font-bold tracking-[0.12em] text-rave-ink uppercase shadow-[3px_3px_0_#0b0a0c]">
        <ShieldCheck className="size-3.5" /> {d.plain}
      </span>
    </div>
  );
}
