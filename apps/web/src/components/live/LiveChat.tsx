import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowDown, MessageSquareOff, Send, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { LiveChatMessage, LiveChatPage } from '@/lib/types';
import { hasRole, useAuth } from '@/stores/auth';
import { cx, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';

const MAX_LEN = 300;
const MAX_KEEP = 500; // batasi pesan di memori

/**
 * Chat live berbasis polling (`GET .../chat?after=` tiap 2 dtk; jeda saat tab tersembunyi, backoff saat gagal).
 * Auto-scroll kecuali pengguna menggulir ke atas ("pesan baru ↓"). Admin melihat tombol hapus per pesan.
 * `theme="light"` memakai token b2b (dasbor studio/promotor), default gelap (aplikasi fan).
 */
export function LiveChat({ streamId, disabled, theme = 'dark', className }: { streamId: string; disabled?: boolean; theme?: 'dark' | 'light'; className?: string }) {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const isAdmin = hasRole(user, 'admin') && !!user?.roles.includes('admin');
  const loc = useLocation();
  const d = useDict('live');
  const [msgs, setMsgs] = useState<LiveChatMessage[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [slowmode, setSlowmode] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef<number | null>(null);
  const deleted = useRef(new Set<number>());

  const merge = (incoming: LiveChatMessage[]) => {
    if (!incoming.length) return;
    setMsgs((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const add = incoming.filter((m) => !seen.has(m.id) && !deleted.current.has(m.id));
      if (!add.length) return prev;
      if (!atBottom.current) setUnseen((n) => n + add.length);
      return [...prev, ...add].sort((a, b) => a.id - b.id).slice(-MAX_KEEP);
    });
  };

  // ---------- Polling ----------
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000;
    // Satu rantai polling saja: tab kembali terlihat saat permintaan masih berjalan tidak boleh memulai rantai kedua.
    let inFlight = false;
    lastId.current = null;
    setMsgs([]);
    setLoaded(false);
    const tick = async () => {
      if (stop) return;
      if (document.hidden) {
        timer = setTimeout(tick, 2000);
        return;
      }
      inFlight = true;
      try {
        const r = await api<LiveChatPage>(`/v1/live/streams/${streamId}/chat`, { query: { after: lastId.current ?? undefined, limit: 100 } });
        if (stop) return;
        setEnabled(r.chat_enabled);
        setSlowmode(r.slowmode_s ?? 0);
        if (r.last_id != null) lastId.current = Math.max(lastId.current ?? 0, r.last_id);
        merge(r.data);
        setLoaded(true);
        delay = 2000;
      } catch {
        delay = Math.min(delay * 2, 30_000);
      } finally {
        inFlight = false;
      }
      if (!stop) timer = setTimeout(tick, delay);
    };
    void tick();
    const onVis = () => {
      if (!document.hidden && !inFlight) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll bila pengguna di bawah.
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Hitung mundur slowmode.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= cooldownUntil) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current) setUnseen(0);
  };
  const jumpDown = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottom.current = true;
    setUnseen(0);
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || cooldown > 0) return;
    setSending(true);
    try {
      const m = await api<LiveChatMessage>(`/v1/live/streams/${streamId}/chat`, { body: { body } });
      setText('');
      atBottom.current = true;
      merge([{ ...m, mine: true }]);
      if (slowmode > 0) {
        setCooldownUntil(Date.now() + slowmode * 1000);
        setNow(Date.now());
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const wait = Number(err.problem.retry_after ?? err.problem.retry_after_s ?? slowmode) || 3;
        setCooldownUntil(Date.now() + wait * 1000);
        setNow(Date.now());
        toast.info(d.chat.slowmodeWait(wait));
      } else if (err instanceof ApiError && err.status === 403) {
        setEnabled(false);
        toast.error(err);
      } else toast.error(err);
    } finally {
      setSending(false);
    }
  }

  async function remove(id: number) {
    try {
      await api(`/v1/admin/live/chat/${id}`, { method: 'DELETE' });
      deleted.current.add(id);
      setMsgs((p) => p.filter((m) => m.id !== id));
    } catch (e) {
      toast.error(e);
    }
  }

  const dark = theme === 'dark';
  const t = dark
    ? { box: 'bg-rave-elevated text-white', line: 'border-white/10', muted: 'text-rave-muted', mine: 'bg-rave-primary/10', input: 'bg-white/10 text-white placeholder:text-rave-subtle focus:ring-white/30', name: 'text-white', btn: 'bg-rave-primary text-rave-on-primary' }
    : { box: 'bg-b2b-card text-b2b-ink border border-b2b-line', line: 'border-b2b-line', muted: 'text-b2b-muted', mine: 'bg-emerald-500/10', input: 'bg-b2b-bg text-b2b-ink placeholder:text-b2b-muted focus:ring-b2b-ink/20', name: 'text-b2b-ink', btn: 'bg-b2b-ink text-b2b-on-ink' };

  const chatOff = !enabled || disabled;

  return (
    <section className={cx('flex min-h-0 flex-col overflow-hidden rounded-none', t.box, className)} aria-label={d.chat.title}>
      <header className={cx('flex items-center justify-between border-b px-4 py-3', t.line)}>
        <h2 className="text-sm font-bold">{d.chat.title}</h2>
        {slowmode > 0 && !chatOff && <span className={cx('text-[11px]', t.muted)}>{d.chat.slowmode(slowmode)}</span>}
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={listRef} onScroll={onScroll} className="rave-scroll absolute inset-0 space-y-1 overflow-y-auto px-3 py-3" aria-live="polite">
          {loaded && !msgs.length && <p className={cx('px-1 py-6 text-center text-xs', t.muted)}>{chatOff ? d.chat.off : d.chat.empty}</p>}
          {msgs.map((m) => (
            <div key={m.id} className={cx('group flex items-start gap-2 rounded-none px-2 py-1 text-sm leading-snug', m.mine && t.mine)}>
              <p className="min-w-0 flex-1 break-words">
                <span className={cx('mr-1.5 font-bold', m.mine ? 'text-rave-primary-text' : t.name)}>{m.display_name}</span>
                <span className={dark ? 'text-white/85' : ''}>{m.body}</span>
              </p>
              {isAdmin && (
                <button onClick={() => remove(m.id)} aria-label={d.chat.deleteMsg(m.display_name)} title={d.chat.deleteTitle} className={cx('shrink-0 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-red-500', t.muted)}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {unseen > 0 && (
          <button onClick={jumpDown} className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-none bg-rave-primary px-3 py-1 text-xs font-bold text-rave-on-primary shadow-lg">
            {d.chat.newMessages(unseen)} <ArrowDown className="size-3.5" />
          </button>
        )}
      </div>
      <footer className={cx('border-t p-3', t.line)}>
        {chatOff ? (
          <p className={cx('flex items-center gap-2 text-xs', t.muted)}>
            <MessageSquareOff className="size-4" /> {d.chat.unavailable}
          </p>
        ) : !token ? (
          <p className={cx('text-xs', t.muted)}>
            <Link to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} className={cx('font-bold underline', t.name)}>
              {d.chat.login}
            </Link>{' '}
            {d.chat.loginSuffix}
          </p>
        ) : (
          <form onSubmit={send} className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{d.chat.writeMessage}</span>
              <input
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                maxLength={MAX_LEN}
                placeholder={cooldown > 0 ? d.chat.waitPlaceholder(cooldown) : d.chat.placeholder}
                disabled={cooldown > 0}
                className={cx('h-10 w-full rounded-none px-4 pr-12 text-sm focus:ring-2 focus:outline-none disabled:opacity-60', t.input)}
              />
              {text.length > MAX_LEN - 50 && <span className={cx('absolute top-1/2 right-3 -translate-y-1/2 text-[10px] tabular-nums', t.muted)}>{MAX_LEN - text.length}</span>}
            </label>
            <button type="submit" disabled={!text.trim() || sending || cooldown > 0} aria-label={d.chat.send} className={cx('grid size-10 shrink-0 place-items-center rounded-full font-bold transition disabled:opacity-40', t.btn)}>
              {cooldown > 0 ? <span className="text-xs tabular-nums">{cooldown}</span> : <Send className="size-4" />}
            </button>
          </form>
        )}
      </footer>
    </section>
  );
}
