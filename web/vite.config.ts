import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {rollupOptions:{output:{manualChunks(id){if(!id.includes('node_modules'))return;if(/node_modules\/(?:@firebase|firebase)\//.test(id))return 'firebase-vendor';if(/node_modules\/(?:react|react-dom|scheduler)\//.test(id))return 'react-vendor';if(id.includes('node_modules/leaflet/'))return 'maps-vendor';}}}},
  server: { port: 5186, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') } } },
});
