import { Provider, ToastContainer, defaultTheme } from '@adobe/react-spectrum';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'dockview-react/dist/styles/dockview.css';
import { App } from './App';
import { loadInitial } from './state/app';
import './styles.css';

function Root() {
  return (
    <Provider theme={defaultTheme} colorScheme="dark" scale="medium" locale="fr-FR" height="100%">
      <App />
      <ToastContainer placement="bottom end" />
    </Provider>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

void loadInitial();
