import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, FileText, History, Plus, Upload, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { PracticeMode, RecentPractice, SampleCourse } from '../shared/types';
import { api, errorMessage } from './api';
import { Badge, Brand, ErrorNotice, Spinner, VoiceForm } from './components';
import { useDraft, useStatus } from './hooks';
import { readMaterial } from './importMaterial';

interface MaterialDraft { title: string; text: string; sourceName: string; origin: 'paste' | 'upload' }
const emptyMaterial: MaterialDraft = { title: '', text: '', sourceName: '', origin: 'paste' };

export default function Home() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const status = useStatus();
  const [samples, setSamples] = useState<SampleCourse[]>([]);
  const [recent, setRecent] = useState<RecentPractice[]>([]);
  const [selected, setSelected] = useState('');
  const [sourceType, setSourceType] = useState<'sample' | 'material'>('sample');
  const [material, setMaterial] = useDraft('vivacoach:material', emptyMaterial);
  const [mode, setMode] = useState<PracticeMode>('demo');
  const modeChosen = useRef(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const liveAvailable = !!status?.aiEnabled && !!status?.aiConfigured && status.remainingTextCalls > 0;
  useEffect(() => { if (status && !modeChosen.current) { setMode(liveAvailable ? 'live' : 'demo'); modeChosen.current = true; } }, [status, liveAvailable]);
  const load = async () => {
    setLoading(true); setError(null);
    const results = await Promise.allSettled([api.samples(), api.recent()]);
    if (results[0].status === 'fulfilled') { setSamples(results[0].value); setSelected(current => current || results[0].status === 'fulfilled' && results[0].value[0]?.id || ''); }
    else setError(errorMessage(results[0].reason));
    if (results[1].status === 'fulfilled') setRecent(results[1].value);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const text = await readMaterial(file);
      setMaterial(previous => ({ ...previous, text, sourceName: file.name.slice(0, 160), origin: 'upload', title: previous.title || file.name.replace(/\.[^.]+$/, '').slice(0, 100) }));
      setSourceType('material');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setUploading(false); event.target.value = ''; }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (pending) return;
    setError(null); setPending(true);
    try {
      const input = sourceType === 'sample' ? { sampleId: selected } : { title: material.title.trim() || 'My course revision', sourceName: material.sourceName || 'Pasted course notes', text: material.text.trim(), origin: material.origin };
      const session = await api.create(mode, input);
      navigate(`/practice/${session.id}`);
    } catch (failure) { setError(errorMessage(failure)); setPending(false); }
  };
  const materialValid = material.text.trim().length >= 80 && material.text.length <= 30000;
  const canCreate = (sourceType === 'sample' ? !!selected : materialValid) && (mode === 'demo' || liveAvailable) && !pending && !uploading;

  return <div className="home-page"><header className="studio-header"><Brand /><div className="header-meta"><span className="tiny-dot" /><span>Your revision studio</span><a href="#recent-practice" className="icon-button" aria-label="Recent practice"><History size={18} /></a></div></header>
    <main id="main-content"><section className="home-intro"><motion.div initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55 }}><span className="eyebrow">A little less memorising. A little more understanding.</span><h1>blurtReply<span>.</span></h1><div className="home-intro__caption"><p>Find the words.<br /><em>Find the gaps.</em></p><span>Practise explaining your course.<br />Follow the evidence. Try again.</span></div></motion.div><motion.div className="home-intro__voice" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .15 }}><VoiceForm large /><a className="voice-caption intro-start" href="#setup">Set up your practice <ArrowDown size={15} /></a></motion.div></section>
      <section id="setup" className="setup" aria-labelledby="setup-title"><div className="setup-intro"><span className="eyebrow">01 / Set the scene</span><h2 id="setup-title">What are we<br /><em>revising?</em></h2><p>Bring a chapter, a set of notes, or a subject you’re ready to explore.</p><div className="practice-promise"><span>Three concepts.</span><span>Six answers.</span><span>A clearer next step.</span><ArrowDown size={18} /></div></div><form className="setup-form" onSubmit={create}><div className="source-tabs" aria-label="Course source"><button type="button" aria-pressed={sourceType === 'sample'} className={sourceType === 'sample' ? 'is-active' : ''} onClick={() => setSourceType('sample')}>Try a subject</button><button type="button" aria-pressed={sourceType === 'material'} className={sourceType === 'material' ? 'is-active' : ''} onClick={() => setSourceType('material')}>Bring your material <Plus size={14} /></button></div>
        {sourceType === 'sample' ? <fieldset className="sample-list"><legend className="sr-only">Choose a sample subject</legend>{loading ? <div className="loading-line"><Spinner /><span>Opening the subjects…</span></div> : samples.map((sample, index) => <label className={`sample-choice ${selected === sample.id ? 'is-selected' : ''}`} key={sample.id}><input type="radio" name="sample" value={sample.id} checked={selected === sample.id} onChange={() => setSelected(sample.id)} /><span className="sample-choice__number">0{index + 1}</span><span className="sample-choice__body"><span className="sample-choice__subject">{sample.subject}</span><strong>{sample.title}</strong><span className="sample-choice__description">{sample.description}</span></span><span className="sample-choice__check">{selected === sample.id ? <Check size={15} /> : <ChevronRight size={17} />}</span></label>)}{!loading && !samples.length && <button type="button" className="text-button" onClick={() => void load()}>Reload sample subjects <ArrowRight size={16} /></button>}</fieldset> : <div className="material-input"><label htmlFor="course-title">Course or topic <span>Optional</span></label><input id="course-title" placeholder="e.g. Foundations of psychology" value={material.title} maxLength={100} onChange={event => setMaterial({ ...material, title: event.target.value })} /><div className="material-input__label"><label htmlFor="course-material">Your source material</label><input ref={uploadRef} type="file" accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf" className="sr-only" tabIndex={-1} onChange={event => void upload(event)} /><button type="button" className="text-button" onClick={() => uploadRef.current?.click()} disabled={uploading}>{uploading ? <Spinner size={14} /> : <Upload size={14} />}{uploading ? 'Reading file…' : 'Upload a file'}</button></div><textarea id="course-material" placeholder="Paste the section you want to explain. Include the definitions, examples, and relationships you’re revising…" value={material.text} maxLength={30000} rows={6} onChange={event => setMaterial({ ...material, text: event.target.value, origin: 'paste', sourceName: 'Pasted course notes' })} /><div className="material-input__meta"><span>{material.origin === 'upload' ? <><FileText size={12} /> {material.sourceName}</> : 'Selectable PDF, text, or Markdown · no scanned pages'}</span><span>{material.text.length.toLocaleString()} / 30,000</span></div>{material.text && <div className="material-saved"><span>Draft saved on this device.</span><button type="button" className="text-button" onClick={() => setMaterial(emptyMaterial)}><X size={12} /> Clear</button></div>}</div>}
        <fieldset className="mode-picker"><legend>Choose your practice</legend><label className={`mode-choice ${mode === 'live' ? 'is-selected' : ''} ${!liveAvailable ? 'is-unavailable' : ''}`}><input type="radio" name="mode" value="live" checked={mode === 'live'} disabled={!liveAvailable} onChange={() => { modeChosen.current = true; setMode('live'); }} /><span className="radio-marker">{mode === 'live' && <span />}</span><span><strong>Live AI practice</strong><small>{liveAvailable ? 'Spoken questions. Follow-ups shaped by your answer.' : status ? 'Unavailable in this studio right now.' : 'Checking availability…'}</small></span>{liveAvailable && <span className="mode-available">Available</span>}</label><label className={`mode-choice ${mode === 'demo' ? 'is-selected' : ''}`}><input type="radio" name="mode" value="demo" checked={mode === 'demo'} onChange={() => { modeChosen.current = true; setMode('demo'); }} /><span className="radio-marker">{mode === 'demo' && <span />}</span><span><strong>Free guided demo</strong><small>Labelled examples and a guided path. No AI calls.</small></span></label></fieldset>
        <ErrorNotice>{error}</ErrorNotice><div className="setup-submit"><p>{mode === 'live' ? `Live practice sends your notes, answers, and recorded audio to OpenAI.${status?.voiceProvider === 'elevenlabs' ? ' Question playback sends question text to ElevenLabs when new audio is needed.' : ''} The app runs locally; these services are online.` : 'The free demo uses authored feedback. Explore it with example answers or type your own. Voice sessions are available in live practice.'}</p><button className="button button--accent button--large" disabled={!canCreate} type="submit">{pending ? <><Spinner /> Preparing your practice…</> : <>{mode === 'demo' ? 'Start free demo' : 'Start practising'}<ArrowUpRight size={20} /></>}</button></div>
      </form></section>
      <section className="recent-section" id="recent-practice"><div className="section-heading"><span className="eyebrow">Pick up the thread</span><h2>Recent practice<span>.</span></h2><span className="muted">Saved for this browser</span></div>{recent.length ? <div className="recent-list">{recent.slice(0, 6).map(item => <Link to={`/practice/${item.id}`} className="recent-row" key={item.id}><div><strong>{item.title}</strong><span>{item.turnCount} of {item.totalQuestions} answers · {item.phase === 'complete' ? 'Review ready' : 'In progress'}</span></div><Badge>{item.mode === 'demo' ? 'Free demo' : 'Live AI'}</Badge><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(item.updatedAt))}</time><ArrowUpRight size={18} /></Link>)}</div> : <p className="recent-empty">Your revision sessions will be saved here, ready to return to.</p>}</section>
    </main><footer className="studio-footer"><span>Understanding sounds like you.</span><span>English-language practice<span className="footer-separator">/</span>blurtReply</span></footer>
  </div>;
}
