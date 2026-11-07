import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CornerDownLeft, MessageCircle, RefreshCw } from 'lucide-react';
import type { Question, RoomSnapshot, SubmittedResponse } from '../../shared/types';
import { api, errorMessage } from '../api';
import { ConnectionNotice, ErrorScreen, InlineError, LoadingScreen, Spinner, Tag, Wordmark } from '../components';
import { useDraft, useRoom } from '../hooks';

function JoinScreen() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); if (code.trim()) navigate(`/join/${encodeURIComponent(code.trim().toUpperCase())}`); };
  return <div className="student-page student-page--entry"><header className="student-header"><Wordmark small /><Link className="text-link" to="/">For lecturers <ArrowRight size={15} /></Link></header><main id="main-content" className="join-main"><div className="join-symbol" aria-hidden="true"><span /><span /></div><span className="eyebrow">Take your place</span><h1>A different<br /><em>perspective.</em><br />Yours.</h1><p>Enter the room code your lecturer shared.<br />No account. Just your thinking.</p><form onSubmit={submit} className="join-code-form"><label htmlFor="join-code">Room code</label><div><input id="join-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABC123" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} autoFocus /><button className="button button--accent" type="submit" disabled={!code.trim()} aria-label="Find this room"><ArrowRight size={22} /></button></div></form><span className="student-privacy-note">You’ll receive a session alias. Your name isn’t collected.</span></main><footer className="student-footer">Think for yourself. Learn together.</footer></div>;
}

function AnswerForm({ room, stage, connected, onUpdate }: { room: RoomSnapshot; stage: 'initial' | 'transfer'; connected: boolean; onUpdate: (room: RoomSnapshot) => void }) {
  const question = stage === 'initial' ? room.lesson.initial : room.lesson.transfer;
  const [draft, setDraft, clearDraft] = useDraft(`pairwise:${room.code}:${room.self?.participant.id}:${stage}`, { choiceId: '', reason: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.choiceId || !draft.reason.trim() || pending) return;
    setPending(true);
    setError(null);
    try { const next = await api.respond(room.code, stage, draft.choiceId, draft.reason.trim()); clearDraft(); onUpdate(next); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  };
  return <section className="student-answer-section"><div className="student-round-label"><span className="eyebrow">{stage === 'initial' ? '01 / Think for yourself' : '03 / A fresh question'}</span><span>{stage === 'initial' ? 'Before the conversation' : 'After the conversation'}</span></div><h1>{stage === 'initial' ? <>What do<br /><em>you think?</em></> : <>Try a different<br /><em>situation.</em></>}</h1><div className="student-question">{question.context && <p className="question-context">{question.context}</p>}<h2>{question.prompt}</h2></div><form onSubmit={submit} className="answer-form"><fieldset className="student-choices"><legend className="sr-only">Choose your answer</legend>{question.options.map(option => <label className={`student-choice ${draft.choiceId === option.id ? 'is-selected' : ''}`} key={option.id}><input type="radio" name={`choice-${stage}`} value={option.id} checked={draft.choiceId === option.id} onChange={() => setDraft({ ...draft, choiceId: option.id })} required disabled={pending} /><span className="student-choice__letter">{option.label}</span><span>{option.text}</span><span className="student-choice__check" aria-hidden="true">{draft.choiceId === option.id && <Check size={15} />}</span></label>)}</fieldset><label className="reason-label" htmlFor={`reason-${stage}`}>What led you to that answer?<span>A sentence is enough.</span></label><textarea id={`reason-${stage}`} placeholder="I chose this because…" value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} maxLength={1200} required disabled={pending} rows={4} /><div className="draft-note"><span>{draft.reason || draft.choiceId ? 'Draft saved on this device' : 'Your explanation makes the conversation possible.'}</span><span>{draft.reason.length} / 1,200</span></div><InlineError>{error}</InlineError><button className="button button--accent button--full button--large" type="submit" disabled={pending || !connected || !draft.choiceId || !draft.reason.trim()}>{pending ? <><Spinner /> Sending your response…</> : <>Send my response <ArrowRight size={19} /></>}</button><p className="student-sharing-note">Your lecturer may share your explanation with the room using your session alias. Once sent, your answer is saved for this round.</p></form></section>;
}

function OwnResponse({ response, question, title = 'Your response' }: { response: SubmittedResponse; question: Question; title?: string }) {
  const choice = question.options.find(option => option.id === response.choiceId);
  return <details className="own-response"><summary><span>{title}</span><span className="own-response__selection">{choice?.label} <ChevronDown size={16} /></span></summary><div><span className="own-response__choice">{choice?.text}</span><blockquote>“{response.reason}”</blockquote></div></details>;
}

function Clarification({ room, onUpdate, connected }: { room: RoomSnapshot; onUpdate: (room: RoomSnapshot) => void; connected: boolean }) {
  const initial = room.self?.initial;
  const [draft, setDraft, clearDraft] = useDraft(`pairwise:${room.code}:${initial?.id}:clarification`, '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!initial || (!initial.clarification && !initial.analysis?.probe)) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    setPending(true); setError(null);
    try { const next = await api.clarify(room.code, draft.trim()); clearDraft(); onUpdate(next); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(false); }
  };
  return <section className="clarification-section"><div className="section-heading"><span className="eyebrow">One small follow-up</span>{!initial.clarification && <Tag>Optional</Tag>}</div>{initial.analysis?.probe && <h2>{initial.analysis.probe}</h2>}{initial.clarification ? <div className="clarification-received" role="status"><span><Check size={16} /> Clarification received</span><blockquote>“{initial.clarification}”</blockquote></div> : <><p>A little more context can help your lecturer understand your meaning. You can also wait for the discussion.</p><form onSubmit={submit}><label className="sr-only" htmlFor="clarification">Your clarification</label><textarea id="clarification" value={draft} onChange={event => setDraft(event.target.value)} placeholder="What I mean is…" rows={3} maxLength={1200} disabled={pending} /><InlineError>{error}</InlineError><button className="button button--ink button--full" type="submit" disabled={!draft.trim() || pending || !connected}>{pending ? <Spinner /> : null}{pending ? 'Sending clarification…' : 'Add my clarification'}{!pending && <ArrowRight size={16} />}</button></form></>}</section>;
}

function Discussion({ room }: { room: RoomSnapshot }) {
  const pair = room.self?.pairing;
  const alias = room.self?.participant.alias;
  if (!pair) return <div className="student-wait"><Spinner size={24} /><h1>Your conversation<br /><em>is coming together.</em></h1><p>Your lecturer will share a group and a discussion prompt here.</p></div>;
  const others = pair.aliases.filter(name => name !== alias);
  return <section className="student-discussion"><span className="eyebrow">02 / Think together</span><div className="student-group-number"><span>{others.length ? 'Your group' : 'Your reflection'}</span><strong>{String(pair.number).padStart(2, '0')}</strong><svg width="104" height="17" viewBox="0 0 104 17" fill="none" aria-hidden="true"><path d="M0 8.5H104" stroke="currentColor" /><circle cx="52" cy="8.5" r="7" fill="currentColor" /></svg></div><h1>{others.length ? <>You’re with<br /><em>{others.join(' & ')}.</em></> : <>A moment for<br /><em>your own thinking.</em></>}</h1><p className="student-discussion__intro">{others.length ? 'Find the matching group number. Take turns explaining your answer before you try to agree.' : 'Use the prompt below to look at your answer from another angle.'}</p><div className="discussion-prompt"><MessageCircle size={22} /><span className="eyebrow">Start here</span><p>{pair.prompt}</p></div><div className="conversation-steps"><div><span>01</span><p>Explain what led you to your answer.</p></div><div><span>02</span><p>{others.length ? 'Ask about a difference you notice.' : 'Look for an assumption you made.'}</p></div><div><span>03</span><p>Consider what might change your mind.</p></div></div>{room.self?.initial && <OwnResponse response={room.self.initial} question={room.lesson.initial} title="Remember your first response" />}<p className="student-next-note"><span className="status-dot" /> A fresh question will appear when your lecturer is ready.</p></section>;
}

function StudentReflection({ room }: { room: RoomSnapshot }) {
  const self = room.self!;
  return <section className="student-reflection"><div className="completion-mark"><Check size={23} /></div><span className="eyebrow">A moment to reflect</span><h1>Keep the<br /><em>conversation.</em></h1><p className="student-lead">What, if anything, changed in your reasoning? What would you like to explore further?</p>{self.initial && <div className="student-reflection__quote"><span className="eyebrow">Your first explanation</span><blockquote>“{self.initial.reason}”</blockquote></div>}{self.transfer && <div className="student-reflection__quote"><span className="eyebrow">Your fresh explanation</span><blockquote>“{self.transfer.reason}”</blockquote></div>}<div className="student-closing"><span className="closing-asterisk" aria-hidden="true">↗</span><p>Two answers are a snapshot.<br />Good questions keep going.</p></div><Link className="button button--quiet button--full" to="/join">Join another conversation <ArrowRight size={17} /></Link></section>;
}

function StudentRoom({ code }: { code: string }) {
  const { room, setRoom, loading, error, connected, refresh } = useRoom(code, 'student');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const join = async () => {
    setJoining(true); setJoinError(null);
    try { setRoom(await api.join(code)); }
    catch (failure) { setJoinError(errorMessage(failure)); }
    finally { setJoining(false); }
  };
  if (loading && !room) return <LoadingScreen label="Finding your conversation…" />;
  if (!room) return <ErrorScreen message={error ?? 'This room could not be found.'} retry={() => void refresh()} />;
  const self = room.self;
  const showInitialForm = self && !self.initial && room.phase === 'collecting';
  const showTransferForm = self && !self.transfer && room.phase === 'retest';
  const ended = room.phase === 'results' || room.phase === 'closed';
  return <div className="student-page"><header className="student-header"><Wordmark small /><div className="student-header__room">{room.mode === 'demo' && <span className="fixture-label">Demo</span>}<span>{room.code}</span></div></header><ConnectionNotice connected={connected} /><main id="main-content" className="student-main">
    {self && <div className="student-identity"><span className="student-avatar" aria-hidden="true">{self.participant.alias.slice(0, 1)}</span><span>You’re <strong>{self.participant.alias}</strong></span><span className="student-identity__note">Your session alias</span></div>}
    {!self ? <section className="student-welcome"><span className="eyebrow">{room.lesson.subject} / {room.lesson.estimatedMinutes} minutes</span><h1>{room.phase === 'collecting' ? <>There’s room<br /><em>for your thinking.</em></> : <>This conversation<br /><em>is underway.</em></>}</h1><div className="student-welcome__lesson"><span className="eyebrow">Today’s conversation</span><h2>{room.lesson.title}</h2><p>{room.lesson.subtitle}</p></div>{room.phase === 'collecting' ? <><div className="student-welcome__details"><div><span>01</span><p>Choose an answer and explain what led you there.</p></div><div><span>02</span><p>Compare perspectives with a classmate.</p></div><div><span>03</span><p>Try a fresh question independently.</p></div></div><p className="student-disclosure">You’ll receive a session alias. Your name isn’t collected. Your lecturer may share your explanation with the room using that alias.</p><InlineError>{joinError}</InlineError><button className="button button--accent button--full button--large" disabled={joining || !connected} onClick={() => void join()}>{joining ? <><Spinner /> Taking your place…</> : <>Join the conversation <ArrowRight size={18} /></>}</button></> : <><p>New responses have closed. If you already joined, open the browser you used for this session.</p><Link to="/join" className="button button--quiet button--full"><ArrowLeft size={16} /> Use another room code</Link><button className="text-link student-refresh" onClick={() => void refresh()}><RefreshCw size={14} /> Check the room again</button></>}</section> : ended ? <StudentReflection room={room} /> : showInitialForm ? <AnswerForm room={room} stage="initial" connected={connected} onUpdate={setRoom} /> : showTransferForm ? <AnswerForm key="transfer" room={room} stage="transfer" connected={connected} onUpdate={setRoom} /> : room.phase === 'discussion' ? <Discussion room={room} /> : <section className="student-wait"><div className="completion-mark"><Check size={23} /></div><span className="eyebrow">{self.initial || self.transfer ? 'Response received' : 'This round has closed'}</span><h1>{self.transfer ? <>Thanks for<br /><em>thinking again.</em></> : self.initial ? <>Your thinking<br /><em>is in the room.</em></> : <>Stay for the<br /><em>conversation.</em></>}</h1><p>{!self.initial && !self.transfer ? 'Your first response was not submitted before the round closed. You can still take part in the fresh question.' : self.transfer ? 'Your fresh response is saved. Your lecturer will bring the conversation back together.' : room.phase === 'review' ? 'Your lecturer is looking at the reasons behind the answers. A conversation is on its way.' : 'Take a breath. Your lecturer will guide the next step.'}</p>{self.initial && room.phase === 'review' && (self.initial.clarification || self.initial.analysis?.needsClarification) && <Clarification room={room} onUpdate={setRoom} connected={connected} />}{self.transfer ? <OwnResponse response={self.transfer} question={room.lesson.transfer} /> : self.initial ? <OwnResponse response={self.initial} question={room.lesson.initial} /> : <p className="student-next-note">This round has closed. You can still take part in the fresh question.</p>}<div className="student-wait__line"><span /><MessageCircle size={19} /><span /></div><p className="student-next-note">This page updates when the session moves on.</p></section>}
  </main><footer className="student-footer"><span>Think for yourself. Learn together.</span><span>Pairwise</span></footer></div>;
}

export default function Student() {
  const { code } = useParams();
  return code ? <StudentRoom key={code} code={code.toUpperCase()} /> : <JoinScreen />;
}
