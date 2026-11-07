import type { PublicLesson, RoomAction, RoomMode, RoomSnapshot, ServerStatus } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.method === 'POST' ? 45000 : 10000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal ?? controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(data?.error ?? 'That request could not be completed.', response.status, data?.code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('This is taking longer than expected. Please try again.', 0);
    }
    throw new ApiError('We cannot reach the session right now. Check the connection and try again.', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  status: () => request<ServerStatus>('/status'),
  lessons: () => request<PublicLesson[]>('/lessons'),
  create: (lessonId: string, mode: RoomMode) => request<RoomSnapshot>('/rooms', { method: 'POST', body: JSON.stringify({ lessonId, mode }) }),
  room: (code: string, view: 'host' | 'board' | 'student') => request<RoomSnapshot>(`/rooms/${encodeURIComponent(code)}?view=${view}`),
  join: (code: string) => request<RoomSnapshot>(`/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: '{}' }),
  action: (code: string, action: RoomAction, version?: number) => request<RoomSnapshot>(`/rooms/${encodeURIComponent(code)}/actions`, { method: 'POST', body: JSON.stringify({ action, version }) }),
  respond: (code: string, stage: 'initial' | 'transfer', choiceId: string, reason: string) => request<RoomSnapshot>(`/rooms/${encodeURIComponent(code)}/responses`, { method: 'POST', body: JSON.stringify({ stage, choiceId, reason }) }),
  clarify: (code: string, text: string) => request<RoomSnapshot>(`/rooms/${encodeURIComponent(code)}/clarification`, { method: 'POST', body: JSON.stringify({ text }) }),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
