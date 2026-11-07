import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSnapshot, ServerStatus } from '../shared/types';
import { api, errorMessage } from './api';

export function useRoom(code: string, view: 'host' | 'board' | 'student') {
  const [room, updateRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const route = `${code}:${view}`;
  const activeRoute = useRef(route);
  const setRoom = useCallback((next: RoomSnapshot) => {
    if (!mounted.current || activeRoute.current !== route) return;
    // An acknowledged mutation supersedes every poll that began before it,
    // including polls with the same phase version as the new snapshot.
    generation.current += 1;
    inFlight.current = false;
    updateRoom(previous => !previous || previous.version <= next.version ? next : previous);
    setError(null);
    setConnected(true);
    setLoading(false);
  }, [route]);
  const refresh = useCallback(async () => {
    if (inFlight.current || !code) return;
    inFlight.current = true;
    const currentGeneration = generation.current;
    try {
      const next = await api.room(code, view);
      if (mounted.current && currentGeneration === generation.current) {
        updateRoom(previous => !previous || previous.version <= next.version ? next : previous);
        setError(null);
        setConnected(true);
      }
    } catch (failure) {
      if (mounted.current && currentGeneration === generation.current) {
        setError(errorMessage(failure));
        setConnected(false);
      }
    } finally {
      if (currentGeneration === generation.current) {
        inFlight.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, [code, view]);
  useEffect(() => {
    mounted.current = true;
    activeRoute.current = route;
    generation.current += 1;
    inFlight.current = false;
    updateRoom(null);
    setLoading(true);
    setError(null);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [refresh, route]);
  return { room, setRoom, error, loading, connected, refresh };
}

export function useStatus() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    let active = true;
    api.status().then(value => { if (active) setStatus(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return status;
}

export function useDraft<T>(key: string, initial: T): [T, (value: T) => void, () => void] {
  const read = () => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T : initial; }
    catch { return initial; }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => { setValue(read()); }, [key]);
  const update = (next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the current draft in memory when storage is unavailable. */ }
  };
  const clear = () => {
    setValue(initial);
    try { localStorage.removeItem(key); } catch { /* Storage can be unavailable in a private browser. */ }
  };
  return [value, update, clear];
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2200);
      return true;
    } catch { return false; }
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return { copied, copy };
}
