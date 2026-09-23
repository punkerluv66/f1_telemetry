import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { SessionSelect } from "./pages/SessionSelect";
import { DriverSelect } from "./pages/DriverSelect";

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <div className="app-header__inner">
          <Link to="/" className="app-brand" aria-label="F1 Telemetry home">
            <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
              <path d="M3 18h5l4-11 5 17 4-11h4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
            F1 <span>Telemetry</span>
          </Link>
          <Link to="/" className="app-header__link">Session library</Link>
          <span className="app-header__note">Historical lap analysis</span>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<SessionSelect />} />
        <Route path="/session/:id" element={<DriverSelect />} />
      </Routes>
    </BrowserRouter>
  );
}
