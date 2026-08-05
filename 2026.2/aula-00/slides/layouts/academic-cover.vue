<script setup lang="ts">
import { academicConfig } from '../academic.config'
</script>

<template>
  <main class="slidev-layout academic-cover">
    <div class="academic-cover__rule" aria-hidden="true" />

    <div class="academic-cover__content">
      <p class="academic-cover__course">
        {{ academicConfig.courseName }}
      </p>

      <h1>{{ academicConfig.presentationTitle }}</h1>

      <p class="academic-cover__subject">
        {{ academicConfig.subjectName }}
        <span>{{ academicConfig.subjectAcronym }}</span>
      </p>
    </div>

    <div class="academic-cover__details">
      <div>
        <p class="academic-cover__label">Professor</p>
        <p class="academic-cover__professor">
          {{ academicConfig.professorName }}
        </p>
        <p class="academic-cover__contact">
          {{ academicConfig.professorContact }}
        </p>
      </div>

      <div class="academic-cover__code">
        <p class="academic-cover__label">Disciplina</p>
        <p>{{ academicConfig.subjectCode }}</p>
      </div>
    </div>
  </main>
</template>

