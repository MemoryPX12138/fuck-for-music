<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="markup"></svg>
</template>

<script setup>
import { computed } from 'vue';
import { icons } from './icons.js';
const props = defineProps({ name: String, size: { type: [Number, String], default: 24 } });
const markup = computed(() => icons[props.name] || '');
</script>
