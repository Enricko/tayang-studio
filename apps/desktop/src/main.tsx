import React from 'react';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import App from './App';
import { WebGate } from '@/components/WebGate';
import './i18n';
import './styles/tokens.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <WebGate>
        <App />
      </WebGate>
    </TooltipProvider>
  </React.StrictMode>,
);
