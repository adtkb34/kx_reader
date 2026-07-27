import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./features/home/HomePage.vue') },
    {
      path: '/books/:bookId/:chapterId?',
      component: () => import('./features/book/BookView.vue'),
    },
  ],
});
