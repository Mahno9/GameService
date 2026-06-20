import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

if (import.meta.env.DEV) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) {
    fetch(link.href)
      .then(r => r.blob())
      .then(blob => createImageBitmap(blob))
      .then(bitmap => {
        const c = document.createElement('canvas');
        c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(220, 0, 0, 0.55)';
        ctx.fillRect(0, 0, c.width, c.height);
        link.href = c.toDataURL();
      })
      .catch(() => {});
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
