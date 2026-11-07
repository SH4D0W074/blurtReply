import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Maximize2, MessageCircle } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { AnswerCard, ConnectionNotice, ErrorScreen, LoadingScreen, Spinner, Tag, Wordmark } from '../components';
import { useRoom, useStatus } from '../hooks';

export default function Board() {
  const { code = '' } = useParams();
  const { room, loading, error, connected, refresh } = useRoom(code, 'board');
  const status = useStatus();
  const reduce = useReducedMotion();
  const [page, setPage] = useState(0);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { setPage(0); }, [room?.phase, room?.revealed]);

  if (loading && !room) return <LoadingScreen dark label="Opening the presentation wall…" />;
  if (!room) return <ErrorScreen dark message={error ?? 'This room could not be found.'} retry={() => void refresh()} />;

  const discussion = room.phase === 'discussion';
  const retest = room.phase === 'retest';
  const results = room.phase === 'results' || room.phase === 'closed';
  const revealed = room.revealed;
  const uniqueChoices = new Set(room.cards.map(card => card.choiceId)).size;
  const compactStage = viewport.height < 900 || viewport.width < 1100;
  const pageSize = discussion ? compactStage ? 1 : 2 : revealed ? viewport.width < 800 ? 2 : compactStage ? 3 : 6 : 6;
  const itemCount = discussion ? room.pairings.length : room.cards.length;
  const pages = Math.max(1, Math.ceil(itemCount / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visibleCards = room.cards.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const visiblePairs = room.pairings.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const question = retest ? room.lesson.transfer : room.lesson.initial;
  const enterFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return <div className={`board-page ${revealed ? 'board-page--revealed' : ''} ${discussion ? 'board-page--discussion' : ''} ${retest ? 'board-page--retest' : ''} ${results ? 'board-page--results' : ''}`}>
    <header className="board-header"><Wordmark dark /><div className="board-header__meta">{room.mode === 'demo' && <Tag>Authored demo</Tag>}<span className="board-room"><span>ROOM</span>{room.code}</span><button className="icon-button board-fullscreen" onClick={enterFullscreen} aria-label="Toggle full screen"><Maximize2 size={19} /></button></div></header>
    <ConnectionNotice connected={connected} dark />
    <main id="main-content" className="board-main">
      {results ? <>
        <div className="board-heading"><span className="eyebrow">04 / A moment to reflect</span><h1>Fresh question.<br /><em>Fresh thinking.</em></h1><p>What changed in the way you explained your answer?</p></div>
        {room.summary ? <div className="board-reflection"><div className="board-reflection__counts"><div><span>First question</span><strong>{room.summary.initialExpected}<small> / {room.summary.initialTotal}</small></strong></div><span className="board-reflection__arrow">↗</span><div><span>Fresh question</span><strong>{room.summary.transferExpected}<small> / {room.summary.transferTotal}</small></strong></div><p>Responses matching the authored answer.<br />Different questions, not a measure of learning gain.</p></div><div className="board-reflection__examples">{room.summary.examples.slice(0, 2).map((example, index) => <article className="board-reflection-example" key={`${example.alias}-${index}`}><div className="board-reflection-example__alias">{example.alias}{example.isDemo && <span>Demo response</span>}</div><div><span className="eyebrow">Before · first question</span><blockquote>“{example.before}”</blockquote></div><div><span className="eyebrow">After · fresh question</span><blockquote>“{example.after}”</blockquote></div></article>)}</div>{room.summary.examples.length === 0 && <p className="board-muted">No matched explanations are available for this session.</p>}</div> : <div className="board-empty"><h2>This session has ended.</h2><p>No fresh-question reflection was collected for this session.</p></div>}
      </> : retest ? <>
        <div className="board-heading board-heading--question"><span className="eyebrow">04 / A new situation. Your own answer.</span>{question.context && <p className="board-question-context">{question.context}</p>}<h1>{question.prompt}</h1></div>
        <div className="board-retest-content"><div className="board-options">{question.options.map(option => <div className="board-option" key={option.id}><span>{option.label}</span><p>{option.text}</p></div>)}</div><div className="board-retest-count"><strong>{String(room.transferCount).padStart(2, '0')}</strong><span>fresh {room.transferCount === 1 ? 'response' : 'responses'}</span><p>Take a moment to decide for yourself.<br />Your explanation matters as much as your choice.</p></div></div>
      </> : <>
        <div className={`board-heading ${!revealed ? 'board-heading--question' : ''}`}><div className="board-heading__top"><span className="eyebrow">{discussion ? '03 / Make room for another perspective' : revealed ? '02 / Look beneath the answer' : '01 / A moment to think'}</span><span className="board-response-count"><strong>{String(room.initialCount).padStart(2, '0')}</strong><span>{room.initialCount === 1 ? 'response' : 'responses'}</span></span></div>{discussion ? <><h1>Think together.<br /><em>Leave room for difference.</em></h1><p>Find your group. Explain your reasoning before you try to agree.</p></> : revealed ? <><h1>{uniqueChoices <= 1 ? 'Same answer.' : 'Every answer.'}<br /><em>{uniqueChoices <= 1 ? room.mode === 'demo' ? 'Different thinking.' : 'Hear the reasons.' : 'A reason behind it.'}</em></h1><p>{question.prompt}</p></> : <>{question.context && <p className="board-question-context">{question.context}</p>}<h1>{question.prompt}</h1></>}</div>
        <LayoutGroup id={`board-${code}`}>
          {discussion ? <div className="board-pairs">{visiblePairs.map(pair => <motion.section layout className={`board-pair ${pair.participantIds.length === 3 ? 'board-pair--trio' : ''} ${pair.kind === 'solo' ? 'board-pair--solo' : ''}`} key={pair.id} transition={{ duration: reduce ? 0 : 0.35 }}><div className="board-pair__label"><span>{pair.kind === 'solo' ? 'Reflection' : 'Group'} {String(pair.number).padStart(2, '0')}</span><p>{pair.prompt}</p></div><div className="board-pair__objects">{pair.participantIds.map((id, index) => { const card = room.cards.find(item => item.participantId === id); return <div className="board-pair__member" key={id}>{index > 0 && <div className="pair-connection" aria-hidden="true"><svg viewBox="0 0 100 8" preserveAspectRatio="none"><motion.path d="M0 4 H100" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.2 }} /></svg><span /></div>}{card ? <AnswerCard card={card} choices={room.lesson.initial.options} revealed={revealed} compact /> : <div className="missing-answer">{pair.aliases[index]}</div>}</div>; })}</div></motion.section>)}</div> : room.cards.length ? <div className="board-answer-grid">{visibleCards.map(card => <AnswerCard key={card.responseId} card={card} choices={room.lesson.initial.options} revealed={revealed} />)}</div> : <div className="board-empty"><div className="board-empty__line" aria-hidden="true"><span /><i /><span /></div><h2>The room is thinking.</h2><p>Choose an answer, then share what led you there.</p><span className="board-empty__code">Room {room.code}</span></div>}
        </LayoutGroup>
      </>}
    </main>
    <footer className="board-footer"><div className="board-footer__status"><span className="status-dot" />{results ? 'Different answers are an invitation to keep talking.' : retest ? 'Answer independently on your student screen.' : discussion ? <><MessageCircle size={16} /> Listen. Compare. Question.</> : room.phase === 'analysing' ? <><Spinner size={15} /> A closer look at the reasoning…</> : revealed ? 'These are their own words. What do you notice?' : 'The reasons will be revealed by your lecturer.'}</div>{!results && !retest && pages > 1 ? <div className="board-pagination"><span>{currentPage + 1} / {pages}</span><button className="icon-button" disabled={currentPage === 0} onClick={() => setPage(value => value - 1)} aria-label="Previous responses"><ArrowLeft size={17} /></button><button className="icon-button" disabled={currentPage >= pages - 1} onClick={() => setPage(value => value + 1)} aria-label="Next responses"><ArrowRight size={17} /></button></div> : <span className="board-footer__note">{room.mode === 'demo' ? 'Example responses · explicitly labelled' : status?.localOnly ? 'Local session · this computer' : 'Anonymous to the room'}</span>}</footer>
  </div>;
}
