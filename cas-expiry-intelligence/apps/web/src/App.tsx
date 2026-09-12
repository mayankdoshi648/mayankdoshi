import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { TerminalPage } from './pages/TerminalPage';
import { SettingsPage } from './pages/SettingsPage';
import { BacktestsPage, HistoryPage, OptionChainPage } from './pages/MiscPages';

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<TerminalPage />} />
          <Route path="/option-chain" element={<OptionChainPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/backtests" element={<BacktestsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
