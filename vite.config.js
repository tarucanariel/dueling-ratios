import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built files work whether this ends up at
  // https://username.github.io/ (user/org site) or
  // https://username.github.io/repo-name/ (project site) —
  // no need to know the repo name in advance.
  base: './',
});
