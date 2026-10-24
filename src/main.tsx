import { captureAuthRedirect } from './app/auth/capture-url';

const authRedirect = captureAuthRedirect(window.location.pathname, window.location.search, window.location.hash, window.history);

const [{ createElement }, { createRoot }, { App }] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('./app/app'),
]);

createRoot(document.getElementById('root')!).render(createElement(App, { authRedirect }));
