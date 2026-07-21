<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { booksState, loadBooks } from '@/stores/books';

const error = ref('');

onMounted(async () => {
  try {
    await loadBooks();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <div class="home">
    <header class="home-header">
      <h1>文档书架</h1>
      <p class="muted">选择一本书开始阅读、标记与备注</p>
    </header>

    <div v-if="error" class="error-box">加载失败：{{ error }}</div>

    <div v-else-if="booksState.booksLoaded && booksState.books.length === 0" class="empty-hint">
      <p>还没有任何书。</p>
      <p class="muted">
        把符合《示例手册》写法规范的书放进 <code>books/</code> 目录即可出现在这里。
      </p>
    </div>

    <div v-else class="book-grid">
      <router-link
        v-for="b in booksState.books"
        :key="b.id"
        :to="`/books/${b.id}`"
        class="book-card"
      >
        <div class="book-cover">{{ b.title.slice(0, 1) }}</div>
        <div class="book-info">
          <div class="book-title">{{ b.title }}</div>
          <div v-if="b.description" class="book-desc muted">{{ b.description }}</div>
          <div class="book-meta muted">{{ b.chapterCount }} 章</div>
        </div>
      </router-link>
    </div>
  </div>
</template>
