import type { CourseInput, PracticeMode, PracticeSession, RecentPractice, SampleCourse, ServerStatus } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public code?: string, public status?: number) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}, timeout = 25000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(body?.error ?? 'The studio couldn’t complete that request. Please try again.', body?.code, response.status);
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('That request took too long. Your work is still here. Please check the connection and try again.');
    throw error;
  } finally { window.clearTimeout(timer); }
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const api = {
  status: () => request<ServerStatus>('/status'),
  samples: () => request<SampleCourse[]>('/samples'),
  recent: () => request<RecentPractice[]>('/practices'),
  create: (mode: PracticeMode, input: CourseInput) => request<PracticeSession>('/practices', json({ mode, ...input })),
  session: (id: string) => request<PracticeSession>(`/practices/${encodeURIComponent(id)}`, {}, 10000),
  answer: (id: string, questionId: string, answer: string, idempotencyKey: string) => request<PracticeSession>(`/practices/${encodeURIComponent(id)}/answers`, json({ questionId, answer, idempotencyKey })),
  finish: (id: string) => request<PracticeSession>(`/practices/${encodeURIComponent(id)}/finish`, json({})),
  transcribe: (id: string, audio: Blob) => request<{ text: string; model: string }>(`/practices/${encodeURIComponent(id)}/transcriptions`, { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio }, 65000),
  async questionAudio(id: string, questionId: string, signal: AbortSignal) {
    const response = await fetch(`/api/practices/${encodeURIComponent(id)}/question-audio`, { ...json({ questionId }), credentials: 'same-origin', signal });
    if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ?? 'Recorded question audio is unavailable.'); }
    return response.blob();
  },
};
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something interrupted that step. Please try again.'; }
