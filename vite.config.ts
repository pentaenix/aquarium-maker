import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets make the same build work at username.github.io,
  // username.github.io/repository-name, and custom domains.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
