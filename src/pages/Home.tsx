import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, CornerDownLeft, Play, RefreshCw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { PublicLesson, RoomMode } from '../../shared/types';
import { api, errorMessage } from '../api';
import { InlineError, Spinner, Wordmark } from '../components';
import { useStatus } from '../hooks';

function Preview() {
  const [revealed, setRevealed] = useState(false);
  const examples = [
    { alias: 'Birch', quote: 'More independent responses can reduce random uncertainty about club members, but recruitment still excludes other students.' },
    { alias: 'Cedar', quote: 'No, because increasing sample size never reduces random error.' },
  ];
  return <section className={`home-preview ${revealed ? 'is-revealed' : ''}`} aria-label="An illustrative preview of the reasoning reveal">
    <div className="home-preview__top"><span className="eyebrow">A look inside</span><span className="preview-dot" /><span className="home-preview__demo-label">Authored demo</span></div>
    <h2>Same answer.<br /><em>Different thinking.</em></h2>
    <p className="home-preview__question">Can a bigger sample fix recruitment bias?</p>
    <div className="home-preview__objects">{examples.map((example, index) => <div className={`preview-object preview-object--${index + 1}`} key={example.alias}><div className="preview-object__turn"><div className="preview-object__face preview-object__front" aria-hidden={revealed}><span>{example.alias}</span><strong>No.</strong><span className="preview-object__bottom">Same choice</span></div><div className="preview-object__face preview-object__back" aria-hidden={!revealed}><span>{example.alias}</span><p>“{example.quote}”</p><span className="preview-object__bottom">Their reasoning</span></div></div></div>)}</div>
    <div className="home-preview__connector" aria-hidden="true"><span /><i /><span /></div>
    <button className="preview-reveal" onClick={() => setRevealed(value => !value)}><span>{revealed ? 'Back to the answers' : 'Look beneath the answers'}</span><ArrowRight size={20} className={revealed ? 'turn-back' : ''} /></button>
    <span className="home-preview__footnote">Two example responses. A conversation waiting to happen.</span>
  </section>;
}

export default function Home() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const status = useStatus();
  const [lessons, setLessons] = useState<PublicLesson[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomMode | null>(null);
  const [code, setCode] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.lessons();
      setLessons(next);
      setSelected(current => next.some(lesson => lesson.id === current) ? current : next[0]?.id ?? '');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const create = async (mode: RoomMode) => {
    if (!selected || pending) return;
    setPending(mode);
    setError(null);
    try { const room = await api.create(selected, mode); navigate(`/host/${room.code}`); }
    catch (failure) { setError(errorMessage(failure)); setPending(null); }
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) navigate(`/join/${encodeURIComponent(code.trim().toUpperCase())}`);
  };

  return <div className="home-page">
    <header className="app-header home-header"><Wordmark /><div className="home-header__right"><span className="quiet-label">A little more understanding.</span><Link to="/join" className="text-link">Join a room <ArrowUpRight size={17} /></Link></div></header>
    <main id="main-content" className="home-main">
      <motion.section className="home-workspace" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <div className="eyebrow home-overline"><span className="small-line" /> For the next good conversation</div>
        <h1>Start a class<br /><em>conversation.</em></h1>
        <p className="home-description">Go beyond the vote. Hear the reasons, bring different perspectives together, and try a fresh question.</p>
        <fieldset className="lesson-picker"><legend>01 <span>Choose your starting point</span></legend>
          {loading && <div className="lessons-loading"><Spinner /><span>Finding your lessons…</span></div>}
          {!loading && lessons.map(lesson => <label key={lesson.id} className={`lesson-option ${selected === lesson.id ? 'is-selected' : ''}`}><input type="radio" name="lesson" value={lesson.id} checked={selected === lesson.id} onChange={() => setSelected(lesson.id)} /><span className="lesson-option__marker" aria-hidden="true">{selected === lesson.id && <Check size={14} />}</span><span className="lesson-option__text"><span className="lesson-option__title">{lesson.title}</span><span className="lesson-option__meta">{lesson.subject}<span>·</span>{lesson.estimatedMinutes} min conversation</span></span><ChevronRight size={18} className="lesson-option__arrow" /></label>)}
          {!loading && !lessons.length && !error && <p className="muted">No lessons are available yet.</p>}
        </fieldset>
        <InlineError>{error}</InlineError>
        {error && !lessons.length && <button className="button button--quiet" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>}
        <div className="home-start-actions"><button className="button button--accent button--large" disabled={!selected || !!pending} onClick={() => void create('live')}>{pending === 'live' ? <><Spinner /> Opening your room…</> : <>Start a session <ArrowUpRight size={20} /></>}</button><button className="demo-button" disabled={!selected || !!pending} onClick={() => void create('demo')}>{pending === 'demo' ? <Spinner size={16} /> : <Play size={15} />}<span>{pending === 'demo' ? 'Preparing the demo…' : 'Try the demo'}</span></button></div>
        <p className="home-demo-note">The demo uses labelled example responses. No class required.</p>
        <div className="home-join"><div><span className="eyebrow">Here to take part?</span><p>Your lecturer has a room code.</p></div><form onSubmit={join} className="code-form"><label className="sr-only" htmlFor="home-code">Room code</label><input id="home-code" autoCapitalize="characters" spellCheck={false} autoComplete="off" value={code} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} placeholder="ROOM CODE" aria-label="Room code" /><button type="submit" disabled={!code.trim()} aria-label="Join this room"><CornerDownLeft size={20} /></button></form></div>
      </motion.section>
      <motion.div className="home-preview-wrap" initial={reduce ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.1 }}><Preview /></motion.div>
    </main>
    <footer className="home-footer"><span>Think for yourself. Learn together.</span><span><span className="status-dot" />{status?.localOnly ? 'Your local workspace' : 'Anonymous participation'}<span className="footer-divider">/</span>Built for the room.</span></footer>
  </div>;
}
