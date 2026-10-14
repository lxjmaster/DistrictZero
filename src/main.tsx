import { createRoot } from 'react-dom/client';
import { GameController } from './app/controller';
import { App } from './ui/App';
import './ui/styles.css';

const controller = new GameController();
createRoot(document.getElementById('root')!).render(<App controller={controller} />);
controller.start();
if (import.meta.hot) import.meta.hot.dispose(() => controller.stop());
