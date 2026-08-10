<template>
    <div
        class="grid flex-1 min-h-0 grid-cols-1 grid-rows-4 gap-2 md:grid-cols-2 md:grid-rows-2 xl:grid-cols-1 xl:grid-rows-4 xl:mt-12"
    >
        <ConfigButton
            v-for="(route, key) in subRoutes"
            :key="key"
            :icon="(route.meta!.icon as string)"
            :title="route.path"
            :desc="(route.meta!.desc as string)"
            :nav="route"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import ConfigButton from "../../components/ConfigButton.vue";
import { useRoute } from "vue-router";

const route = useRoute();
const subRoutes = computed(() => {
    const currRoute = route.matched.find(route => route.children.length > 0)!;
    const subRoutes = currRoute.children.filter(route => route.meta!);

    return subRoutes
});

onMounted(() => {
    console.log(route.matched)
})
</script>
