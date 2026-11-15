import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WEB_PORT: この Web の dev ポート / API_PORT: 接続先 API(Bolt ごとに変える)
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    fs: { allow: ['..'] }, // ../contracts を読むため
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3000}`,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
