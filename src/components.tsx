import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, LoaderCircle, Radio, RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { AnswerCard as AnswerCardData, Choice, RoomPhase } from '../shared/types';

export function Wordmark({ dark = false, small = false }: { dark?: boolean; small?: boolean }) {
  return <Link to="/" className={`wordmark ${dark ? 'wordmark--light' : ''} ${small ? 'wordmark--small' : ''}`} aria-label="Pairwise home">
    <svg className="brand-symbol" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true"><path d="M5 5.5h8v19H5zM17 5.5h8v19h-8z" fill="currentColor" /><path d="M11 12h8v6h-8z" fill="var(--accent)" /></svg>
    <span>pairwise<span className="wordmark-dot">.</span></span>
  </Link>;
}

export function Spinner({ size = 18 }: { size?: number }) { return <LoaderCircle size={size} className="spinner" aria-hidden="true" />; }

export function Tag({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <span className={`tag ${accent ? 'tag--accent' : ''}`}>{children}</span>;
}

export function InlineError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="inline-error" role="alert"><AlertCircle size={17} /><span>{children}</span></div>;
}

export function ConnectionNotice({ connected, dark = false }: { connected: boolean; dark?: boolean }) {
  if (connected) return null;
  return <div className={`connection-notice ${dark ? 'connection-notice--dark' : ''}`} role="status"><Radio size={16} /> Reconnecting. The last received state is still shown.</div>;
}

export function LoadingScreen({ label = 'Opening the room…', dark = false }: { label?: string; dark?: boolean }) {
  return <main className={`state-screen ${dark ? 'state-screen--dark' : ''}`}><Wordmark dark={dark} /><div className="state-screen__message"><Spinner size={25} /><p>{label}</p></div></main>;
}

export function ErrorScreen({ message, retry, dark = false }: { message: string; retry?: () => void; dark?: boolean }) {
  return <main className={`state-screen ${dark ? 'state-screen--dark' : ''}`}><Wordmark dark={dark} /><div className="state-screen__message"><span className="eyebrow">A little interruption</span><h1>Let’s find your room.</h1><p>{message}</p><div className="button-row">{retry && <button className="button button--accent" onClick={retry}><RefreshCw size={17} /> Try again</button>}<Link to="/" className="button button--quiet"><ArrowLeft size={17} /> Back to Pairwise</Link></div></div></main>;
}

const flow = [
  { label: 'Think', phases: ['collecting', 'analysing'] },
  { label: 'Reveal', phases: ['review'] },
  { label: 'Discuss', phases: ['discussion'] },
  { label: 'Try again', phases: ['retest', 'results', 'closed'] },
];

export function SessionProgress({ phase }: { phase: RoomPhase }) {
  const current = flow.findIndex(item => item.phases.includes(phase));
  return <ol className="session-progress" aria-label="Session progress">{flow.map((step, index) => <li key={step.label} className={`${index === current ? 'is-current' : ''} ${index < current ? 'is-complete' : ''}`} aria-current={index === current ? 'step' : undefined}><span className="session-progress__number">{index < current ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{step.label}</span>{index < flow.length - 1 && <span className="session-progress__line" />}</li>)}</ol>;
}

export function RoomQr({ url, size = 112 }: { url: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: size * 2, margin: 1, color: { dark: '#18201C', light: '#F5F2E9' } }).then(value => { if (active) setSrc(value); }).catch(() => {});
    return () => { active = false; };
  }, [url, size]);
  return src ? <img className="room-qr" src={src} width={size} height={size} alt="QR code to join this room" /> : null;
}

export function AnswerCard({ card, choices, revealed, compact = false }: { card: AnswerCardData; choices: Choice[]; revealed: boolean; compact?: boolean }) {
  const reduce = useReducedMotion();
  const [reading, setReading] = useState(false);
  const choice = choices.find(option => option.id === card.choiceId);
  useEffect(() => { if (!revealed) setReading(false); }, [revealed]);
  return <motion.article layout layoutId={`answer-${card.responseId}`} transition={{ duration: reduce ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] }} className={`answer-object ${revealed ? 'is-revealed' : ''} ${compact ? 'answer-object--compact' : ''}`}>
    <div className="answer-object__turn">
      <div className="answer-object__face answer-object__front" aria-hidden={revealed}>
        <span className="answer-object__alias">{card.alias}</span>
        <span className="answer-object__letter">{choice?.label ?? card.choiceId}</span>
        <span className="answer-object__choice">{choice?.text ?? 'Response received'}</span>
        {card.isDemo && <span className="answer-object__fixture">Example</span>}
      </div>
      <div className="answer-object__face answer-object__back" aria-hidden={!revealed}>
        <div className="answer-object__top"><span className="answer-object__alias">{card.alias}</span><span className="answer-object__small-letter">{choice?.label ?? card.choiceId}</span></div>
        <p className="answer-object__reason">“{card.reason ?? 'This explanation has not been shared yet.'}”</p>
        <div className="answer-object__footer"><span className="answer-object__fixture">{card.isDemo ? 'Example response' : 'Their own words'}</span><button className="answer-object__read" tabIndex={revealed ? 0 : -1} onClick={() => setReading(true)} aria-label={`Read ${card.alias}’s complete explanation`}>Read in full <ArrowRight size={12} /></button></div>
      </div>
    </div>
    {reading && revealed && <ReadingDialog card={card} choice={choice} onClose={() => setReading(false)} />}
  </motion.article>;
}

function ReadingDialog({ card, choice, onClose }: { card: AnswerCardData; choice?: Choice; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="reading-dialog" aria-label={`${card.alias}’s complete explanation`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="reading-dialog__content"><button className="icon-button reading-dialog__close" onClick={onClose} aria-label="Close explanation"><X size={21} /></button><span className="eyebrow">{card.alias} / {card.isDemo ? 'Authored example response' : 'Their own words'}</span><p className="reading-dialog__choice">{choice?.label ?? card.choiceId}<span>{choice?.text}</span></p><blockquote>“{card.reason}”</blockquote></div></dialog>;
}

export function EmptyResponses({ dark = false }: { dark?: boolean }) {
  return <div className={`empty-responses ${dark ? 'empty-responses--dark' : ''}`}><div className="empty-response-symbol" aria-hidden="true"><span /><span /><span /></div><h3>There’s more behind an answer.</h3><p>Responses will appear here as people share their thinking.</p></div>;
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="confirm-dialog" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="confirm-dialog__content"><button className="icon-button confirm-dialog__close" onClick={onClose} aria-label="Cancel"><X size={20} /></button><span className="eyebrow">Before you continue</span><h2>{title}</h2><p>{children}</p><div className="button-row"><button className="button button--accent" onClick={onConfirm}>{confirmLabel}<ArrowRight size={17} /></button><button className="button button--quiet" onClick={onClose}>Keep this session</button></div></div></dialog>;
}
