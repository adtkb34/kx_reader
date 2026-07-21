import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/HomePage.vue') },
    { path: '/books/:bookId/:chapterId?', component: () => import('./pages/BookView.vue') },
  ],
});
