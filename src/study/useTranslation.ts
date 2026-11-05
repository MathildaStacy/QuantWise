import { useCallback, useEffect, useRef, useState } from 'react';
import { AiError } from '../ai/http';
import type { AppCore } from '../app/boot';
import type { Book, BookBlock, BookSection } from '../book/types';
import { loadTranslations, type BlockTranslation } from '../data/translationRepo';
import { translateBlocks } from './translate';
import { sectionTargets } from './translation';

/** 每个读书页拥有自己的请求，失焦/卸载即停止，迟到响应不污染下一节。 */
export function useTranslation(core: AppCore, book: Book, section: BookSection, blocks: BookBlock[], active: boolean) {
  const [entries, setEntries] = useState<Record<number, BlockTranslation>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [needsConfig, setNeedsConfig] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [cacheError, setCacheError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failed, setFailed] = useState<number | null>(null);
  const task = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const targets = useRef(blocks);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setLoading(true); setCacheError(false); setError('');
    loadTranslations(core.db, book.id, blocks).then(result => {
      if (!cancelled) setEntries(result);
    }).catch(() => { if (!cancelled) { setCacheError(true); setError('译文读取失败，请重试'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; task.current?.abort(); };
  }, [core, book.id, blocks, loadAttempt]);
  const stop = useCallback(() => { task.current?.abort(); }, []);
  useEffect(() => { if (!active) stop(); }, [active, stop]);

  // 「翻译本节」只译要译的段（不含脚注；中文为主的一节没有）；单段的「翻译此段」照常
  const run = async (selected: BookBlock[] = sectionTargets(section, blocks)) => {
    if (!active || task.current || loading || cacheError) return;
    const controller = new AbortController();
    task.current = controller;
    targets.current = selected;
    setBusy(true); setStopped(false); setError(''); setNeedsConfig(false); setFailed(null);
    let inFlight: number | null = null;
    try {
      await translateBlocks(core, book, section, selected, entries, controller.signal,
        (seq, result) => { if (alive.current) setEntries(old => ({ ...old, [seq]: result })); },
        seq => { inFlight = seq; if (alive.current) setCurrent(seq); });
    } catch (e) {
      if (!alive.current) return;
      if (controller.signal.aborted) setStopped(true);
      else {
        setFailed(inFlight);
        setError(e instanceof Error ? e.message : String(e));
        setNeedsConfig(e instanceof AiError && e.code === 'auth');
      }
    } finally {
      if (task.current === controller) task.current = null;
      if (alive.current) { setBusy(false); setCurrent(null); }
    }
  };
  return { entries, loading, busy, current, error, needsConfig, stopped, failed, cacheError, run,
    retry: () => cacheError ? setLoadAttempt(n => n + 1) : run(targets.current), stop };
}
