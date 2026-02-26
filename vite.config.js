import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          faceapi: ['@vladmandic/face-api'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
