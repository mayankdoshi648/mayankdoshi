import { HashRouter, BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { TerminalPage } from './pages/TerminalPage';
import { SettingsPage } from './pages/SettingsPage';
import { BacktestsPage, HistoryPage, OptionChainPage } from './pages/MiscPages';
import { isStaticDemo } from './lib/staticDemo';

const Router = isStaticDemo() ? HashRouter : BrowserRouter;
const basename = import.meta.env.BASE_URL?.replace(/\/$/, '') || undefined;

export default function App() {
  return (
    <Router basename={isStaticDemo() ? undefined : basename}>
      <AppShell>
        {isStaticDemo() ? (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            STATIC DEMO (MOCK) — mobile share link. Not live NSE/Dhan. For live data run the CAS API
            locally.
          </div>
        ) : null}
        <Routes>
          <Route path="/" element={<TerminalPage />} />
          <Route path="/option-chain" element={<OptionChainPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/backtests" element={<BacktestsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </Router>
  );
}
