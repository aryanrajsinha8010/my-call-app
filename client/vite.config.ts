import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('@supabase') || id.includes('websocket') || id.includes('socket.io-client') || id.includes('socket.io-parser') || id.includes('engine.io-client')) {
              return 'vendor-network';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-lucide';
            }
            if (id.includes('livekit')) {
              return 'vendor-livekit';
            }
            if (id.includes('fabric')) {
              return 'vendor-fabric';
            }
            return 'vendor-others';
          }
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
});
