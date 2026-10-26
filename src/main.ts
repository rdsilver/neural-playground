import './ui/styles.css';
import { App } from './ui/app';

void App.create(document.querySelector<HTMLElement>('#app')!).then((app) => {
  // Development builds expose the app for debugging and browser scripts.
  if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
});
