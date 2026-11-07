import { Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Host from './pages/Host';
import Board from './pages/Board';
import Student from './pages/Student';
import { ErrorScreen } from './components';

export default function App() {
  return <><a className="skip-link" href="#main-content">Skip to content</a><Routes><Route path="/" element={<Home />} /><Route path="/host/:code" element={<Host />} /><Route path="/board/:code" element={<Board />} /><Route path="/join" element={<Student />} /><Route path="/join/:code" element={<Student />} /><Route path="*" element={<ErrorScreen message="That page isn’t here. Your next class conversation is one step away." />} /></Routes></>;
}
