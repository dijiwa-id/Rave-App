import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowDownUp, CheckCircle2, FileUp, Pause, Play, Rewind, Timer, Undo2 } from 'lucide-react';
import { Button, Select, Textarea, cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { activeRowAt, analyzeLyrics, formatLrcTime, isTimingRow, looksLikeLrc, nudgeRow, setRowTime, sortByTime, toPlain, toSyncedDraft, type LrcIssue, type LyricsMode } from '@/lib/lrc';
import './studio.css';

/**
 * Meja kerja lirik Artist Studio (terkontrol): teks biasa ↔ LRC tersinkron, impor .lrc/.txt, ketuk waktu sambil memutar
 * pratinjau (Enter/Spasi), geser ±100 ms, klik stempel untuk lompat, validasi per baris, dan pratinjau ala pemutar.
 * Penyimpanan dilakukan pemanggil (PUT /v1/studio/tracks/:id/lyrics — format tidak berubah: mode + text LRC).
 */

export interface LyricsValue {
  mode: LyricsMode;
  text: string;
  lang: string;
}
export const LYRIC_LANGS = ['id', 'en', 'jv', 'su', 'ms', 'ko', 'ja'];
export const NUDGE_MS = 100;

/** Jumlah masalah yang memblokir penyimpanan. */
export const lyricsErrors = (v: LyricsValue, durationMs = 0) => analyzeLyrics(v.mode, v.text, durationMs).issues.filter((i) => i.level === 'error').length;

export function LyricsWorkbench({
  value,
  onChange,
  audioSrc,
  loadAudio,
  durationMs = 0,
}: {
  value: LyricsValue;
  onChange: (v: LyricsValue) => void;
  /** URL audio yang langsung bisa diputar (mis. object URL berkas lokal). */
  audioSrc?: string | null;
  /** Ambil URL pratinjau dari server saat diminta (hemat: tidak memuat audio sebelum dibutuhkan). */
  loadAudio?: () => Promise<string | null>;
  durationMs?: number;
}) {
  const t = useDict('b2b').studio.release.lyrics;
  const { mode, text, lang } = value;
  const [tab, setTab] = useState<'tap' | 'text'>('tap');
  const [src, setSrc] = useState<string | null>(audioSrc ?? null);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(durationMs);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [cursor, setCursor] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const [audioErr, setAudioErr] = useState(false);
  const history = useRef<{ mode: LyricsMode; text: string }[]>([]);
  const audio = useRef<HTMLAudioElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const reduce = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    setSrc(audioSrc ?? null);
    setAudioErr(false);
  }, [audioSrc]);

  const { rows, issues } = useMemo(() => analyzeLyrics(mode, text, dur || durationMs), [mode, text, dur, durationMs]);
  const timing = useMemo(() => rows.filter(isTimingRow), [rows]);
  const issueAt = useMemo(() => {
    const m = new Map<number, LrcIssue>();
    for (const i of issues) if (i.index >= 0 && (!m.has(i.index) || i.level === 'error')) m.set(i.index, i);
    return m;
  }, [issues]);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const timedCount = timing.filter((r) => r.times?.length).length;
  const playingRow = mode === 'synced' ? activeRowAt(rows, time) : -1;

  // Kursor: baris pertama yang belum berwaktu (atau baris pertama).
  useEffect(() => {
    if (mode !== 'synced') return;
    if (cursor >= 0 && timing.some((r) => r.index === cursor)) return;
    setCursor((timing.find((r) => !r.times?.length) ?? timing[0])?.index ?? -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, timing.length]);

  // Jam LCD mulus selama diputar.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      if (audio.current) setTime(audio.current.currentTime * 1000);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  useEffect(() => {
    if (cursor < 0 || tab !== 'tap') return;
    list.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [cursor, tab, reduce]);

  function commit(next: Partial<LyricsValue>) {
    if ((next.text !== undefined && next.text !== text) || (next.mode !== undefined && next.mode !== mode)) {
      history.current.push({ mode, text });
      if (history.current.length > 80) history.current.shift();
    }
    onChange({ ...value, ...next });
  }
  function undo() {
    const prev = history.current.pop();
    if (prev) onChange({ ...value, ...prev });
  }

  async function ensureAudio() {
    if (src || !loadAudio) return;
    setLoading(true);
    try {
      setSrc(await loadAudio());
    } finally {
      setLoading(false);
    }
  }
  function toggle() {
    const a = audio.current;
    if (!a) return void ensureAudio();
    if (a.paused) void a.play().catch((e: unknown) => (e instanceof DOMException && e.name === 'NotAllowedError' ? undefined : setAudioErr(true)));
    else a.pause();
  }
  function seek(ms: number) {
    const a = audio.current;
    setTime(ms);
    if (a) a.currentTime = ms / 1000;
  }
  function moveCursor(step: number) {
    const i = timing.findIndex((r) => r.index === cursor);
    const n = timing[Math.max(0, Math.min(timing.length - 1, (i < 0 ? 0 : i) + step))];
    if (n) setCursor(n.index);
  }
  function stamp() {
    if (cursor < 0 || !audio.current) return;
    commit({
      text: setRowTime(text, cursor, audio.current.currentTime * 1000),
    });
    moveCursor(1);
  }
  function nudge(index: number, delta: number) {
    commit({ text: nudgeRow(text, index, delta) });
  }

  function setMode(m: LyricsMode) {
    if (m === mode) return;
    setNote(null);
    if (m === 'synced') {
      commit({
        mode: m,
        text: looksLikeLrc(text) ? text : toSyncedDraft(text),
      });
      setTab('tap');
      setCursor(-1);
    } else {
      const plain = toPlain(text);
      if (plain !== text.trim() && looksLikeLrc(text)) setNote(t.convertedToPlain);
      commit({ mode: m, text: plain });
    }
  }
  async function importFile(f: File) {
    const s = (await f.text()).replace(/\r\n?/g, '\n').trim();
    const m: LyricsMode = looksLikeLrc(s) ? 'synced' : 'plain';
    commit({ text: s, mode: m });
    setCursor(-1);
    setTab('tap');
  }
  function jumpTo(index: number) {
    if (mode === 'synced' && tab === 'tap') return setCursor(index);
    const el = area.current;
    if (!el || index < 0) return;
    const lines = text.split('\n');
    const start = lines.slice(0, index).reduce((a, l) => a + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[index]?.length ?? 0));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return undo();
    }
    if (e.ctrlKey || e.metaKey || e.altKey || mode !== 'synced' || tab !== 'tap') return;
    const onButton = el.tagName === 'BUTTON';
    const k = e.key;
    if ((k === 'Enter' || k === ' ') && !onButton) {
      e.preventDefault();
      stamp();
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      moveCursor(k === 'ArrowDown' ? 1 : -1);
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (cursor >= 0) nudge(cursor, k === 'ArrowLeft' ? -NUDGE_MS : NUDGE_MS);
    } else if (k.toLowerCase() === 'p' || k.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    } else if (k.toLowerCase() === 's') {
      const r = rows[cursor];
      if (r?.times?.length) {
        e.preventDefault();
        seek(Math.max(0, r.times[0]! - 1000));
      }
    } else if ((k === 'Backspace' || k === 'Delete') && cursor >= 0) {
      e.preventDefault();
      commit({ text: setRowTime(text, cursor, null) });
    }
  }

  const issueText = (i: LrcIssue) => {
    const msg = t.issue[i.code] as string | ((n: number) => string);
    return typeof msg === 'function' ? msg(i.index + 1) : msg;
  };

  // Pratinjau pemutar: baris aktif + tetangga.
  const content = rows.filter((r) => !r.meta && (mode === 'synced' ? isTimingRow(r) : r.text));
  const ci = mode === 'synced' ? content.findIndex((r) => r.index === (playingRow >= 0 ? playingRow : cursor)) : 0;

  return (
    <div className="space-y-3" onKeyDown={onKey}>
      {/* Bilah atas: mode, bahasa, impor */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t.modeLabel} className="st-seg">
          {(['plain', 'synced'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {m === 'plain' ? t.modePlain : t.modeSynced}
            </button>
          ))}
        </div>
        <Select aria-label={t.language} value={lang} onChange={(e) => commit({ lang: e.target.value })} className="h-9! w-24! py-1!">
          {LYRIC_LANGS.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </Select>
        <label className="rave-btn inline-flex h-8 cursor-pointer items-center gap-1.5 border-2 border-b2b-ink bg-b2b-card px-3 font-label text-[11px] font-bold tracking-[0.08em] text-b2b-ink uppercase focus-within:outline-2 focus-within:outline-rave-mustard">
          <FileUp className="size-3.5" /> {t.import}
          <input
            type="file"
            accept=".lrc,.txt,text/plain"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
        </label>
        <Button type="button" size="sm" variant="outline-ink" icon={<Undo2 />} onClick={undo} disabled={!history.current.length} title={t.undo} aria-label={t.undo} />
        <span className="ml-auto font-label text-[11px] font-bold tracking-wider text-b2b-muted uppercase tabular-nums">
          {mode === 'synced' ? t.timed(timedCount, timing.length) : t.lines(content.length)}
        </span>
      </div>
      <p className="text-xs text-b2b-muted">{mode === 'plain' ? t.plainHint : t.syncedHint}</p>
      {note && (
        <p className="flex items-center gap-2 border-l-4 border-rave-mustard bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          {note}
          <button type="button" className="font-bold underline" onClick={() => (undo(), setNote(null))}>
            {t.undo}
          </button>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-2">
          {mode === 'synced' && (
            <>
              {/* Transport: putar, mundur, jam LCD, seek, kecepatan, cap waktu */}
              <div className="st-transport">
                {src ? (
                  <>
                    <button type="button" className="deck-key deck-key--play" aria-label={playing ? t.pause : t.play} onClick={toggle}>
                      {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </button>
                    <button type="button" className="deck-key" aria-label={t.back3} title={t.back3} onClick={() => seek(Math.max(0, time - 3000))}>
                      <Rewind className="size-4" />
                    </button>
                    <span className="deck-lcd">
                      <span className="deck-lcd__time">{formatLrcTime(time)}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.round(dur || durationMs))}
                      step={10}
                      value={Math.round(time)}
                      onChange={(e) => seek(Number(e.target.value))}
                      aria-label={t.seek}
                    />
                    <select
                      aria-label={t.speed}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="h-[30px] border-0 bg-[#0a090c] px-1.5 font-label text-[11px] font-bold text-[#f4c21f]"
                    >
                      {[0.5, 0.75, 1].map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="white" icon={<Play />} loading={loading} disabled={!loadAudio} onClick={() => void ensureAudio()}>
                    {loadAudio ? t.loadAudio : t.noAudio}
                  </Button>
                )}
                <Button type="button" size="sm" variant="primary" icon={<Timer />} className="ml-auto" disabled={!src || cursor < 0 || tab !== 'tap'} onClick={stamp}>
                  {t.stamp} <span className="st-kbd ml-1 hidden sm:inline-grid">↵</span>
                </Button>
                {src && (
                  <audio
                    ref={audio}
                    src={src}
                    preload="metadata"
                    className="hidden"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onError={() => setAudioErr(true)}
                    onLoadedMetadata={(e) => {
                      e.currentTarget.playbackRate = rate;
                      if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration * 1000);
                    }}
                    onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime * 1000)}
                  />
                )}
              </div>
              <RateSync audio={audio} rate={rate} />
              {audioErr && (
                <p className="text-xs font-bold text-red-600" role="alert">
                  {t.audioError}
                </p>
              )}

              <div role="tablist" className="st-seg">
                {(['tap', 'text'] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                    {k === 'tap' ? t.tabTap : t.tabText}
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'synced' && tab === 'tap' ? (
            timing.length ? (
              <div ref={list} className="st-lrc" tabIndex={0} role="listbox" aria-label={t.tabTap} aria-activedescendant={cursor >= 0 ? `lrc-row-${cursor}` : undefined}>
                {timing.map((r, n) => {
                  const iss = issueAt.get(r.index);
                  const has = !!r.times?.length;
                  return (
                    <div
                      key={r.index}
                      id={`lrc-row-${r.index}`}
                      data-row={r.index}
                      role="option"
                      aria-selected={cursor === r.index}
                      className="st-lrc__row"
                      data-cursor={cursor === r.index}
                      data-playing={playingRow === r.index}
                      data-issue={iss?.level}
                      title={iss ? issueText(iss) : undefined}
                    >
                      <span className="st-lrc__n">{n + 1}</span>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="st-lrc__time"
                        disabled={!has}
                        onClick={() => {
                          setCursor(r.index);
                          if (has) seek(r.times![0]!);
                        }}
                        aria-label={has ? t.seekTo(formatLrcTime(r.times![0]!)) : t.noTimeLabel}
                      >
                        {has ? formatLrcTime(r.times![0]!) : '--:--.--'}
                      </button>
                      <span className="st-lrc__nudge">
                        <button type="button" tabIndex={-1} disabled={!has} aria-label={t.nudgeEarlier} title={t.nudgeEarlier} onClick={() => nudge(r.index, -NUDGE_MS)}>
                          −
                        </button>
                        <button type="button" tabIndex={-1} disabled={!has} aria-label={t.nudgeLater} title={t.nudgeLater} onClick={() => nudge(r.index, NUDGE_MS)}>
                          +
                        </button>
                      </span>
                      <span className={cx('st-lrc__text', !r.text && 'st-lrc__text--gap')} onClick={() => setCursor(r.index)}>
                        {r.text || t.gap}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border-2 border-dashed border-b2b-line px-4 py-8 text-center text-sm text-b2b-muted">
                {t.emptyTap}
                <div className="mt-3">
                  <Button type="button" size="sm" variant="outline-ink" onClick={() => setTab('text')}>
                    {t.tabText}
                  </Button>
                </div>
              </div>
            )
          ) : (
            <Textarea
              ref={area}
              rows={14}
              value={text}
              spellCheck={false}
              placeholder={mode === 'plain' ? t.placeholderPlain : t.placeholderSynced}
              onChange={(e) => commit({ text: e.target.value })}
              className={cx('font-mono text-[13px] leading-relaxed', errors.length > 0 && text.trim() && 'border-red-500')}
              aria-invalid={errors.length > 0}
              aria-label={mode === 'plain' ? t.modePlain : t.tabText}
            />
          )}

          {mode === 'synced' && tab === 'tap' && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-b2b-muted">
              <span>
                <span className="st-kbd">↵</span> / <span className="st-kbd">Spasi</span> {t.keys.stamp}
              </span>
              <span>
                <span className="st-kbd">↑</span>
                <span className="st-kbd">↓</span> {t.keys.move}
              </span>
              <span>
                <span className="st-kbd">←</span>
                <span className="st-kbd">→</span> {t.keys.nudge}
              </span>
              <span>
                <span className="st-kbd">P</span> {t.keys.play}
              </span>
              <span>
                <span className="st-kbd">S</span> {t.keys.seek}
              </span>
              <span>
                <span className="st-kbd">⌫</span> {t.keys.clear}
              </span>
            </p>
          )}
        </div>

        {/* Pratinjau + validasi */}
        <div className="min-w-0 space-y-3">
          <div className="st-karaoke" aria-label={t.preview}>
            <span className="st-karaoke__kicker">{mode === 'synced' ? t.preview : t.previewPlain}</span>
            {content.length ? (
              mode === 'synced' ? (
                <>
                  <p className="st-karaoke__line st-karaoke__line--dim">{content[ci - 1]?.text || ' '}</p>
                  <p className="st-karaoke__line st-karaoke__line--on">{(ci >= 0 ? content[ci]?.text : null) || '♪'}</p>
                  <p className="st-karaoke__line st-karaoke__line--dim">{content[ci + 1]?.text || ' '}</p>
                </>
              ) : (
                content.slice(0, 4).map((r, i) => (
                  <p key={r.index} className={cx('st-karaoke__line', i === 0 ? 'text-[15px]' : 'st-karaoke__line--dim')}>
                    {r.text}
                  </p>
                ))
              )
            ) : (
              <p className="st-karaoke__line st-karaoke__line--dim">{t.previewEmpty}</p>
            )}
          </div>

          <div className="border-2 border-b2b-line p-3" aria-live="polite">
            {!text.trim() ? (
              <p className="text-xs text-b2b-muted">{t.emptyHint}</p>
            ) : (
              <>
                <p className={cx('flex items-center gap-1.5 text-xs font-bold', errors.length ? 'text-red-600' : 'text-emerald-600')}>
                  {errors.length ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {errors.length ? t.issueSummary(errors.length) : t.ready}
                  {warns.length > 0 && <span className="font-semibold text-amber-700">· {t.warnSummary(warns.length)}</span>}
                </p>
                {issues.length > 0 && (
                  <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs">
                    {issues.slice(0, 30).map((i, n) => (
                      <li key={n}>
                        <button
                          type="button"
                          disabled={i.index < 0}
                          onClick={() => jumpTo(i.index)}
                          className={cx('text-left hover:underline disabled:no-underline', i.level === 'error' ? 'text-red-600' : 'text-amber-700')}
                        >
                          {issueText(i)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {issues.some((i) => i.code === 'order') && (
                  <Button type="button" size="sm" variant="outline-ink" icon={<ArrowDownUp />} className="mt-2" onClick={() => commit({ text: sortByTime(text) })}>
                    {t.sort}
                  </Button>
                )}
                {issues.some((i) => i.code === 'looks_lrc') && (
                  <Button type="button" size="sm" variant="outline-ink" className="mt-2" onClick={() => (commit({ mode: 'synced' }), setTab('tap'))}>
                    {t.usePlainAsLrc}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Terapkan kecepatan putar ke elemen audio (atribut playbackRate tidak reaktif di React). */
function RateSync({ audio, rate }: { audio: React.RefObject<HTMLAudioElement | null>; rate: number }) {
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [audio, rate]);
  return null;
}
