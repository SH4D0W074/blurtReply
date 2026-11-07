import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, FileText, LoaderCircle, Radio, X } from 'lucide-react';
import type { AgentEvent, Feedback, SourceExcerpt, Turn } from '../shared/types';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={`brand ${compact ? 'brand--compact' : ''}`} to="/" aria-label="VivaCoach home"><svg viewBox="0 0 36 36" width="32" height="32" fill="none" aria-hidden="true"><path d="m5 11 11 19h4l11-19" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" /><path d="M13 8v10m5-14v17m5-13v10" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></svg><span>VivaCoach<span className="brand-period">.</span></span></Link>;
}
export function Spinner({ size = 17 }: { size?: number }) { return <LoaderCircle size={size} className="spinner" aria-hidden="true" />; }
export function Badge({ children, accent = false }: { children: ReactNode; accent?: boolean }) { return <span className={`badge ${accent ? 'badge--accent' : ''}`}>{children}</span>; }
export function ErrorNotice({ children }: { children: ReactNode }) { return children ? <div className="error-notice" role="alert"><AlertCircle size={17} /><span>{children}</span></div> : null; }
export function ConnectionNotice({ connected }: { connected: boolean }) { return connected ? null : <div className="connection-notice" role="status"><Radio size={16} /> Reconnecting. Your draft and the last saved practice are still here.</div>; }
export function LoadingPage({ label = 'Opening your rehearsal…' }: { label?: string }) { return <div className="state-page"><Brand /><main id="main-content"><Spinner size={25} /><p>{label}</p></main></div>; }
export function ErrorPage({ message, retry }: { message: string; retry?: () => void }) { return <div className="state-page"><Brand /><main id="main-content"><span className="eyebrow">A small interruption</span><h1>Let’s find your<br /><em>place again.</em></h1><p>{message}</p><div className="button-row">{retry && <button className="button button--accent" onClick={retry}>Try again <ArrowRight size={16} /></button>}<Link className="button button--quiet" to="/">Back to the studio</Link></div></main></div>; }

export function VoiceForm({ level = 0, recording = false, large = false }: { level?: number; recording?: boolean; large?: boolean }) {
  const strands = useMemo(() => Array.from({ length: 29 }, (_, strand) => {
    const offset = (strand - 14) / 14;
    const points = Array.from({ length: 101 }, (_, index) => {
      const x = 20 + index * 5.6;
      const position = index / 100;
      const envelope = Math.sin(position * Math.PI) ** 1.8;
      const amplitude = 51 + level * 62;
      const twist = Math.sin(position * Math.PI * (2.25 + level * .8) + offset * 1.4);
      const y = 140 + envelope * (twist * amplitude + offset * (46 + level * 18) * Math.cos(position * Math.PI * 1.6));
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { path: points.join(' '), opacity: .2 + (1 - Math.abs(offset)) * .5 };
  }), [level]);
  return <div className={`voice-form ${large ? 'voice-form--large' : ''} ${recording ? 'is-listening' : ''}`} aria-hidden="true"><svg viewBox="0 0 600 280" fill="none" preserveAspectRatio="xMidYMid meet"><path d="M0 140H600" className="voice-form__axis" />{strands.map((strand, index) => <path d={strand.path} key={index} stroke="currentColor" strokeWidth={index === 14 ? 1.5 : .85} opacity={strand.opacity} />)}<circle cx="20" cy="140" r="2" fill="currentColor" /><circle cx="580" cy="140" r="2" fill="currentColor" /></svg></div>;
}

const agentLabels = { planner: 'Curriculum planner', examiner: 'Examiner', verifier: 'Evidence checker', coach: 'Revision coach' };
export function AgentActivity({ events, thinking = false }: { events: AgentEvent[]; thinking?: boolean }) {
  const latest = events.at(-1);
  const activeId = thinking && latest?.state === 'working' ? latest.id : null;
  return <div className="agent-activity"><div className="inspector-heading"><span className="eyebrow">Agent handoffs</span>{thinking && <Spinner size={14} />}</div>{!events.length ? <p className="inspector-empty">{thinking ? 'Your practice is being prepared. Agent activity will appear as it happens.' : 'The next handoff will appear after you submit an answer.'}</p> : <ol className="agent-events">{events.slice(-7).map(event => <li className={`agent-event agent-event--${event.id === activeId ? 'working' : event.state === 'working' ? 'started' : event.state}`} key={event.id}><span className="agent-event__mark">{event.id === activeId ? <Spinner size={12} /> : event.state === 'complete' ? <Check size={11} /> : <span />}</span><div><span className="agent-event__name">{agentLabels[event.agent]}<span>{event.id === activeId ? 'Working' : event.state === 'working' ? 'Started' : event.state === 'complete' ? 'Complete' : event.state === 'limited' ? 'Limited' : 'Interrupted'}</span></span><strong>{event.label}</strong>{event.detail && <p>{event.detail}</p>}{event.sourceIds.length > 0 && <small>{event.sourceIds.length} source {event.sourceIds.length === 1 ? 'excerpt' : 'excerpts'} referenced</small>}</div></li>)}</ol>}</div>;
}

const assessments: Record<Feedback['assessment'], string> = { supported: 'Supported by your material', partial: 'Partly supported', revisit: 'Worth revisiting', unclear: 'A clarification would help' };
export function Evidence({ turn, sources, openSource }: { turn: Turn; sources: SourceExcerpt[]; openSource: (source: SourceExcerpt, quote?: string) => void }) {
  const feedback = turn.feedback;
  const source = sources.find(excerpt => excerpt.id === feedback.sourceId);
  return <div className="evidence"><div className="evidence__status"><span className="status-dot" />{assessments[feedback.assessment]}</div><p className="evidence__observation">{feedback.observation}</p>{feedback.claimQuote && <div className="evidence-quote"><span className="eyebrow">The claim in your answer</span><blockquote>“{feedback.claimQuote}”</blockquote></div>}{feedback.sourceQuote && <div className="evidence-quote evidence-quote--source"><span className="eyebrow">The passage in your material</span><blockquote>“{feedback.sourceQuote}”</blockquote>{source && <button className="source-link" onClick={() => openSource(source, feedback.sourceQuote ?? undefined)}><FileText size={13} />{source.label}{source.page ? ` · p. ${source.page}` : ''}<ArrowRight size={13} /></button>}</div>}<div className="evidence__followup"><span className="eyebrow">The next question</span><p>{feedback.followUp}</p></div><div className="evidence__provenance"><span>{feedback.source === 'demo' ? 'Authored demo feedback' : feedback.source === 'fallback' ? 'Fallback feedback · no AI judgement' : 'Live AI feedback'}</span><span>{feedback.reviewStatus === 'checked' ? 'Evidence checked' : feedback.reviewStatus === 'needs-review' ? 'Needs review' : 'Evidence check unavailable'}</span></div></div>;
}

export function SourceDialog({ source, quote, onClose }: { source: SourceExcerpt; quote?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const quoteIndex = quote ? source.text.indexOf(quote) : -1;
  return <dialog className="source-dialog" ref={ref} aria-label={source.label} onCancel={onClose} onClick={event => { if (event.currentTarget === event.target) onClose(); }}><div className="dialog-content"><button className="icon-button dialog-close" onClick={onClose} aria-label="Close source"><X size={21} /></button><span className="eyebrow">Your source material{source.page ? ` / Page ${source.page}` : ''}</span><h2>{source.label}</h2><div className="source-text">{quote && quoteIndex >= 0 ? <>{source.text.slice(0, quoteIndex)}<mark>{quote}</mark>{source.text.slice(quoteIndex + quote.length)}</> : source.text}</div></div></dialog>;
}
export function ConfirmDialog({ title, children, confirm, onConfirm, onClose }: { title: string; children: ReactNode; confirm: string; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="confirm-dialog" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-content"><button className="icon-button dialog-close" onClick={onClose} aria-label="Keep practising"><X size={21} /></button><span className="eyebrow">Your practice, your pace</span><h2>{title}</h2><p>{children}</p><div className="button-row"><button className="button button--accent" onClick={onConfirm}>{confirm}<ArrowRight size={17} /></button><button className="button button--quiet" onClick={onClose}>Keep practising</button></div></div></dialog>;
}
export function Toast({ message, close }: { message: string | null; close: () => void }) {
  useEffect(() => { if (!message) return; const timer = window.setTimeout(close, 6500); return () => window.clearTimeout(timer); }, [message, close]);
  return message ? <div className="toast" role="status"><Check size={17} /><span>{message}</span><button className="icon-button" onClick={close} aria-label="Dismiss notification"><X size={16} /></button></div> : null;
}
