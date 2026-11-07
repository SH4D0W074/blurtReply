import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Copy, Eye, MessageCircle, Monitor, RefreshCw, RotateCcw, Users } from 'lucide-react';
import type { Pairing, RoomAction, RoomSnapshot } from '../../shared/types';
import { api, errorMessage } from '../api';
import { ConfirmDialog, ConnectionNotice, EmptyResponses, ErrorScreen, InlineError, LoadingScreen, RoomQr, SessionProgress, Spinner, Tag, Wordmark } from '../components';
import { useCopy, useRoom, useStatus } from '../hooks';

const phaseLabels: Record<string, string> = { collecting: 'Responses open', analysing: 'Reviewing responses', review: 'Ready to reveal', discussion: 'In conversation', retest: 'Fresh question open', results: 'Session reflection', closed: 'Session ended' };

function QuestionDisplay({ room, transfer = false }: { room: RoomSnapshot; transfer?: boolean }) {
  const question = transfer ? room.lesson.transfer : room.lesson.initial;
  return <section className="host-question"><div className="section-heading"><span className="eyebrow">{transfer ? 'A fresh application' : 'The question on the table'}</span><span className="quiet-label">{transfer ? 'Round 02' : 'Round 01'}</span></div>{question.context && <p className="question-context">{question.context}</p>}<h2>{question.prompt}</h2><div className="question-options">{question.options.map(option => <div className="question-option" key={option.id}><span>{option.label}</span><p>{option.text}</p></div>)}</div></section>;
}

function PairPreview({ pair, room }: { pair: Pairing; room: RoomSnapshot }) {
  return <article className="host-pair"><div className="host-pair__number">{String(pair.number).padStart(2, '0')}</div><div className="host-pair__body"><div className="host-pair__names">{pair.aliases.map((alias, index) => <span key={alias}>{index > 0 && <span className="pair-name-separator">↔</span>}{alias}</span>)}{pair.kind === 'solo' && <Tag>Individual reflection</Tag>}</div><div className="host-pair__quotes">{pair.participantIds.map(id => { const response = room.host?.responses.find(item => item.participantId === id && item.stage === 'initial'); return response ? <blockquote key={id}>“{response.reason}”</blockquote> : null; })}</div><p className="host-pair__prompt"><MessageCircle size={15} />{pair.prompt}</p><p className="host-pair__rationale">{pair.rationale}</p></div></article>;
}

function Reflection({ room }: { room: RoomSnapshot }) {
  const summary = room.summary;
  if (!summary) return <div className="empty-panel"><span className="eyebrow">Session ended</span><p>No fresh-question reflection was collected.</p></div>;
  return <section className="host-reflection"><span className="eyebrow">What the responses show</span><h2>A fresh question.<br /><em>A chance to think again.</em></h2><div className="reflection-counts"><div><span>First question</span><strong>{summary.initialExpected}<small> / {summary.initialTotal}</small></strong><p>chose the authored answer</p></div><ArrowRight size={24} /><div><span>Fresh question</span><strong>{summary.transferExpected}<small> / {summary.transferTotal}</small></strong><p>chose the authored answer</p></div></div><p className="reflection-caveat">{summary.explanation}</p><div className="section-heading"><h3>In their own words</h3><span className="quiet-label">{summary.matchedRespondents} responded to both</span></div>{summary.examples.length === 0 ? <p className="muted">No matched explanations are available yet.</p> : summary.examples.map((example, index) => <article className="reflection-example" key={`${example.alias}-${index}`}><div className="reflection-example__name">{example.alias}{example.isDemo && <Tag>Demo</Tag>}</div><div className="reflection-example__quotes"><div><span className="eyebrow">First question</span><blockquote>“{example.before}”</blockquote></div><div><span className="eyebrow">Fresh question</span><blockquote>“{example.after}”</blockquote></div></div></article>)}</section>;
}

export default function Host() {
  const { code = '' } = useParams();
  const { room, setRoom, loading, error, connected, refresh } = useRoom(code, 'host');
  const status = useStatus();
  const { copy, copied } = useCopy();
  const [pending, setPending] = useState<RoomAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'responses' | 'pairs'>('responses');
  const responses = useMemo(() => room?.host?.responses.filter(response => response.stage === (room.phase === 'retest' ? 'transfer' : 'initial')) ?? [], [room]);
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!room?.pairings.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'responses' : event.key === 'End' ? 'pairs' : activeTab === 'responses' ? 'pairs' : 'responses';
    setActiveTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  };

  const act = async (action: RoomAction) => {
    if (!room || pending) return;
    setPending(action);
    setActionError(null);
    try {
      const next = await api.action(code, action, room.version);
      setRoom(next);
      if (action === 'analyse' || action === 'fallback-pairs') setActiveTab('pairs');
      if (action === 'start-retest') setActiveTab('responses');
      if (action === 'restart-demo') { setActiveTab('responses'); setExpanded(null); }
    } catch (failure) { setActionError(errorMessage(failure)); void refresh(); }
    finally { setPending(null); }
  };
  if (loading && !room) return <LoadingScreen label="Preparing your teaching space…" />;
  if (!room) return <ErrorScreen message={error ?? 'This room could not be found.'} retry={() => void refresh()} />;
  if (!room.isHost) return <ErrorScreen message="This browser doesn’t have the lecturer controls for this room. You can join as a participant instead." />;

  const joinUrl = `${(status?.joinBaseUrl ?? window.location.origin).replace(/\/$/, '')}/join/${room.code}`;
  const isTransfer = room.phase === 'retest';
  const showReflection = room.phase === 'results' || room.phase === 'closed';
  const question = isTransfer ? room.lesson.transfer : room.lesson.initial;
  const responseCount = isTransfer ? room.transferCount : room.initialCount;
  const clarifications = room.host?.responses.filter(response => response.stage === 'initial' && response.clarification).length ?? 0;
  const actionForPhase = (): { label: string; action: RoomAction; disabled?: boolean; note: string } | null => {
    if (room.phase === 'collecting') return { label: 'Review the reasoning', action: 'analyse', disabled: room.initialCount === 0, note: 'Review the explanations before revealing them to the room.' };
    if (room.phase === 'analysing') return { label: 'Reviewing responses…', action: 'analyse', disabled: true, note: 'The answers are saved. We’re looking for useful differences to discuss.' };
    if (room.phase === 'review' && !room.revealed) return { label: 'Reveal the reasons', action: 'reveal', note: 'Explanations will become visible on the presentation wall.' };
    if (room.phase === 'review') return { label: 'Start the discussion', action: 'publish-pairs', disabled: room.pairings.length === 0, note: 'Send the suggested groups and discussion prompts to participants.' };
    if (room.phase === 'discussion') return { label: 'Open the fresh question', action: 'start-retest', note: 'Give everyone a new situation to think through independently.' };
    if (room.phase === 'retest') return { label: 'See the class reflection', action: 'show-results', disabled: room.transferCount === 0, note: 'Close the fresh question and compare the actual responses.' };
    if (room.phase === 'results') return { label: 'Finish this session', action: 'close', note: 'Your session reflection will remain available here.' };
    return null;
  };
  const primary = actionForPhase();

  return <div className="host-page">
    <header className="app-header host-header"><Wordmark /><div className="host-header__context"><span className="header-rule" /><span>Teaching workspace</span></div><div className="host-header__actions">{room.mode === 'demo' && <Tag accent>Demo session</Tag>}<Link className="button button--quiet button--small" target="_blank" to={`/join/${code}`}>Student view <ArrowUpRight size={15} /></Link><Link className="button button--ink button--small" to={`/board/${code}`} target="_blank"><Monitor size={16} /> Present <ArrowUpRight size={15} /></Link></div></header>
    <ConnectionNotice connected={connected} />
    <main id="main-content" className="host-main">
      <section className="host-workspace">
        <div className="host-title"><div className="eyebrow"><span className="status-dot" /> {phaseLabels[room.phase]}<span className="eyebrow-divider">/</span>{room.lesson.subject}</div><h1>{room.lesson.title}</h1><p>{room.lesson.subtitle}</p></div>
        <SessionProgress phase={room.phase} />
        {room.mode === 'demo' && <div className="demo-disclosure"><span className="demo-disclosure__mark">D</span><p><strong>Demonstration session.</strong> Labelled example responses and interpretations let you try the complete flow. Any real participants remain separately labelled.</p></div>}
        {showReflection ? <Reflection room={room} /> : <>
          <QuestionDisplay room={room} transfer={isTransfer} />
          <section className="response-workspace">
            <div className="response-workspace__header"><div className="workspace-tabs" role="tablist" aria-label="Session details"><button id="responses-tab" role="tab" aria-controls="responses-panel" aria-selected={activeTab === 'responses'} tabIndex={activeTab === 'responses' ? 0 : -1} onKeyDown={tabKeyDown} onClick={() => setActiveTab('responses')}>Responses <span>{responseCount}</span></button>{room.pairings.length > 0 && <button id="pairs-tab" role="tab" aria-controls="pairs-panel" aria-selected={activeTab === 'pairs'} tabIndex={activeTab === 'pairs' ? 0 : -1} onKeyDown={tabKeyDown} onClick={() => setActiveTab('pairs')}>Discussion groups <span>{room.pairings.length}</span></button>}</div><span className="quiet-label">{isTransfer ? 'Fresh responses private' : room.revealed ? <><Eye size={14} /> Reasons revealed</> : 'Reasons private to you'}</span></div>
            {activeTab === 'pairs' && room.pairings.length > 0 ? <div id="pairs-panel" role="tabpanel" aria-labelledby="pairs-tab" className="pair-preview-list"><div className="pair-preview-list__intro"><p>{room.phase === 'review' ? 'Check the reasons, then bring these people together.' : 'Give each group a little space to compare their thinking.'}</p><span className="quiet-label">{room.phase === 'review' ? 'Suggested groups · not yet sent' : 'Published discussion groups'}</span></div>{room.pairings.map(pair => <PairPreview key={pair.id} pair={pair} room={room} />)}{room.phase === 'review' && <button className="text-link fallback-link" disabled={!!pending || !connected} onClick={() => void act('fallback-pairs')}><RefreshCw size={14} /> Use comparison groups instead</button>}</div> : <div id="responses-panel" role="tabpanel" aria-labelledby="responses-tab">
              {responses.length === 0 ? <EmptyResponses /> : <div className="response-list">{responses.map(response => {
                const participant = room.host?.participants.find(person => person.id === response.participantId);
                const choice = question.options.find(option => option.id === response.choiceId);
                const isExpanded = expanded === response.id;
                return <article className={`response-row ${isExpanded ? 'is-expanded' : ''}`} key={response.id}><button className="response-row__summary" onClick={() => setExpanded(isExpanded ? null : response.id)} aria-expanded={isExpanded}><span className="response-row__answer">{choice?.label ?? response.choiceId}</span><span className="response-row__content"><span className="response-row__identity">{participant?.alias ?? 'Participant'}{participant?.isDemo && <span className="fixture-label">Demo</span>}{response.clarification && <span className="clarification-label">Clarification received</span>}</span><span className="response-row__reason">{response.reason}</span></span><ArrowUpRight size={16} /></button>{isExpanded && <div className="response-detail"><div><span className="eyebrow">Their complete explanation</span><p>{response.reason}</p></div>{response.analysis && <div className="response-detail__analysis"><span className="eyebrow">{response.analysis.source === 'demo' ? 'Authored interpretation' : response.analysis.source === 'fallback' ? 'Discussion fallback' : 'Suggested interpretation'}</span><strong>{response.analysis.categoryLabel}</strong><p>{response.analysis.note}</p>{response.analysis.quote && <blockquote>“{response.analysis.quote}”</blockquote>}{response.analysis.needsClarification && <span className="detail-note">A clarification may help. This interpretation is provisional.</span>}</div>}{response.clarification && <div><span className="eyebrow">Their clarification</span><p>{response.clarification}</p></div>}</div>}</article>;
              })}</div>}
            </div>}
          </section>
        </>}
      </section>
      <aside className="session-rail" aria-label="Session controls"><div className="session-rail__sticky">
        <section className="room-access"><div className="section-heading"><span className="eyebrow">Your room</span><span className="status-dot" /></div><div className="room-code">{room.code}</div><div className="room-access__counts"><Users size={16} /><span>{room.participantCount} {room.participantCount === 1 ? 'participant' : 'participants'}<span className="subtle-divider">/</span>{room.initialCount} initial responses</span></div>{status && !status.localOnly && <div className="room-access__qr"><RoomQr url={joinUrl} /></div>}<button className="copy-link" onClick={async () => { if (!await copy(joinUrl)) setActionError('The link could not be copied. Open the student view to use its address.'); }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Link copied' : 'Copy student link'}</button>{status?.localOnly && <p className="local-session-note">This session runs on this computer. Open the student view in another browser to take part.</p>}</section>
        <section className="next-step"><span className="eyebrow">{room.phase === 'closed' ? 'All wrapped up' : 'Your next move'}</span><h2>{room.phase === 'collecting' ? 'Let the room think.' : room.phase === 'analysing' ? 'A closer look.' : room.phase === 'review' ? 'Look beyond the vote.' : room.phase === 'discussion' ? 'Make room for dialogue.' : room.phase === 'retest' ? 'Let them try it alone.' : 'Keep the conversation.'}</h2>{primary && <><p>{primary.note}</p><button className="button button--accent button--full" disabled={!!pending || primary.disabled || !connected} onClick={() => void act(primary.action)}>{pending === primary.action || room.phase === 'analysing' ? <Spinner /> : null}<span>{primary.label}</span>{!pending && room.phase !== 'analysing' && <ArrowRight size={17} />}</button></>}{room.phase === 'closed' && <Link className="button button--accent button--full" to="/">Start another session <ArrowRight size={17} /></Link>}
          {room.phase === 'review' && clarifications > 0 && <button className="button button--quiet button--full" disabled={!!pending || !connected} onClick={() => void act('analyse')}><RefreshCw size={15} /> Review clarifications ({clarifications})</button>}
          {(room.aiStatus === 'failed' || (room.phase === 'review' && room.pairings.length === 0)) && <button className="button button--quiet button--full" disabled={!!pending || !connected} onClick={() => void act('fallback-pairs')}>Use comparison groups <ArrowRight size={15} /></button>}
          <InlineError>{actionError}</InlineError>
        </section>
        <section className="session-note"><span className="note-symbol" aria-hidden="true">↔</span><p>{room.phase === 'collecting' ? 'A correct answer can hide different assumptions. Their reasons make the conversation possible.' : room.phase === 'discussion' ? 'Give everyone time to explain, listen, and question. Agreement isn’t the only useful outcome.' : 'Treat interpretations as prompts for conversation, not judgements about a person.'}</p></section>
        {room.aiMessage && <p className="ai-status-note">{room.aiMessage}</p>}
        {room.mode === 'demo' && <button className="text-link restart-link" disabled={!!pending} onClick={() => setConfirmRestart(true)}><RotateCcw size={14} /> Restart the demo</button>}
      </div></aside>
    </main>
    <footer className="workspace-footer"><span>One room. Many perspectives.</span><span>Session {room.code}<span className="footer-divider">/</span>Pairwise</span></footer>
    {confirmRestart && <ConfirmDialog title="Start this demo again?" confirmLabel="Restart demo" onClose={() => setConfirmRestart(false)} onConfirm={() => { setConfirmRestart(false); void act('restart-demo'); }}>This clears the current answers and discussion groups, then brings back the labelled example responses. Participants keep their session aliases.</ConfirmDialog>}
  </div>;
}
