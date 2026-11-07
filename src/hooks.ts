import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { PracticeSession, ServerStatus } from '../shared/types';
import { api, errorMessage } from './api';

export function usePractice(id: string) {
  const [session, updateSession] = useState<PracticeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const mounted = useRef(true);
  const activeId = useRef(id);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const accept = useCallback((next: PracticeSession) => {
    if (!mounted.current || activeId.current !== id) return;
    epoch.current += 1;
    inFlight.current = false;
    updateSession(previous => !previous || previous.version <= next.version ? next : previous);
    setLoading(false); setConnected(true); setError(null);
  }, [id]);
  const refresh = useCallback(async () => {
    if (inFlight.current || !id) return;
    inFlight.current = true;
    const requestEpoch = epoch.current;
    try {
      const next = await api.session(id);
      if (mounted.current && requestEpoch === epoch.current) {
        updateSession(previous => !previous || previous.version <= next.version ? next : previous);
        setConnected(true); setError(null);
      }
    } catch (failure) {
      if (mounted.current && requestEpoch === epoch.current) { setConnected(false); setError(errorMessage(failure)); }
    } finally {
      if (requestEpoch === epoch.current) { inFlight.current = false; if (mounted.current) setLoading(false); }
    }
  }, [id]);
  useEffect(() => {
    mounted.current = true; activeId.current = id; epoch.current += 1; inFlight.current = false;
    updateSession(null); setLoading(true); setError(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    const focus = () => void refresh();
    window.addEventListener('focus', focus); window.addEventListener('online', focus);
    return () => { mounted.current = false; epoch.current += 1; window.clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); };
  }, [id, refresh]);
  return { session, accept, loading, error, connected, refresh };
}

export function useStatus() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => { let active = true; api.status().then(value => { if (active) setStatus(value); }).catch(() => {}); return () => { active = false; }; }, []);
  return status;
}

export function useDraft<T>(key: string, initial: T) {
  const read = useCallback(() => { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T : initial; } catch { return initial; } }, [key]);
  const [value, update] = useState<T>(read);
  const valueRef = useRef(value);
  useEffect(() => { const next = read(); valueRef.current = next; update(next); }, [read]);
  const set = useCallback((next: SetStateAction<T>) => {
    const result = typeof next === 'function' ? (next as (previous: T) => T)(valueRef.current) : next;
    valueRef.current = result; update(result);
    try { localStorage.setItem(key, JSON.stringify(result)); } catch { /* The in-memory draft remains usable when storage is full. */ }
  }, [key]);
  return [value, set] as const;
}

export function submissionKey(sessionId: string, questionId: string, answer: string) {
  const storageKey = `vivacoach:submission:${sessionId}:${questionId}`;
  try {
    const previous = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (previous?.answer === answer && typeof previous?.key === 'string') return previous.key as string;
  } catch { /* A fresh identifier is safe before a successful submission. */ }
  const key = crypto.randomUUID();
  try { localStorage.setItem(storageKey, JSON.stringify({ key, answer })); } catch { /* The active submit still carries its identifier. */ }
  return key;
}
