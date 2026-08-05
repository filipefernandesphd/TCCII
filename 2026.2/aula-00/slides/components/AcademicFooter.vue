<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed } from 'vue'
import { academicConfig } from '../academic.config'

const { currentSlideNo, total } = useNav()

const currentPage = computed(() => Number(currentSlideNo.value))
const totalSlides = computed(() => Number(total.value))
const isVisible = computed(() => currentPage.value > 1)

function formatPage(page: number): string {
  return String(page).padStart(2, '0')
}
</script>

<template>
  <footer
    v-if="isVisible"
    class="academic-footer"
    aria-label="Informações da apresentação e número do slide"
  >
    <div class="academic-footer__metadata">
      <span class="academic-footer__title">
        {{ academicConfig.presentationTitle }}
      </span>
      <span aria-hidden="true">·</span>
      <span>{{ academicConfig.subjectAcronym }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ academicConfig.professorName }}</span>
    </div>

    <div class="academic-footer__pages" aria-label="Número do slide">
      <span class="academic-footer__current">
        {{ formatPage(currentPage) }}
      </span>
      <span aria-hidden="true">/</span>
      <span>{{ formatPage(totalSlides) }}</span>
    </div>
  </footer>
</template>
