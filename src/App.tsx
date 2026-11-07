import { Route, Routes } from 'react-router-dom';
import Home from './Home';
import Practice from './Practice';
import { ErrorPage } from './components';

export default function App() {
  return <><a className="skip-link" href="#main-content">Skip to content</a><Routes><Route path="/" element={<Home />} /><Route path="/practice/:id" element={<Practice />} /><Route path="*" element={<ErrorPage message="That page isn’t part of this studio." />} /></Routes></>;
}
