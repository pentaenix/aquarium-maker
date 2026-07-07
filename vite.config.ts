import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  // Relative URLs work on a custom domain, a GitHub project page, /docs,
  // the included static archive, and the generated standalone page.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'assets/app.css' : 'assets/[name][extname]',
        chunkFileNames: 'assets/[name].js',
      },
    },
  },
});
