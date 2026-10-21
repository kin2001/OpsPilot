import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const privateDocumentHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: privateDocumentHeaders },
  preview: { headers: privateDocumentHeaders },
});
