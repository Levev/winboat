<template>
    <RouterView v-slot="{ Component, route }">
        <Transition mode="out-in" name="config-route">
            <component :is="Component" :key="route.fullPath" />
        </Transition>
    </RouterView>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { addNavigationEvents, type RemoveNavigationEvents } from "../utils/navigation";

const router = useRouter();
let removeNavigationEvents: RemoveNavigationEvents | undefined;

onMounted(() => {
    removeNavigationEvents = addNavigationEvents(() => router.back());
});

onUnmounted(() => {
    removeNavigationEvents?.();
});
</script>

<style>
.config-route-enter-active,
.config-route-leave-active {
    transition:
        opacity 200ms ease,
        transform 200ms ease;
}

.config-route-enter-from {
    opacity: 0;
    transform: translateX(1rem);
}

.config-route-leave-to {
    opacity: 0;
    transform: translateX(-1rem);
}

.devices-move,
.devices-enter-active,
.devices-leave-active,
.menu-move,
.menu-enter-active,
.menu-leave-active {
    transition: all 0.5s ease;
}

.devices-enter-from,
.devices-leave-to {
    opacity: 0;
    transform: translateX(30px);
}

.devices-leave-active,
.menu-leave-active {
    position: absolute;
}

.menu-enter-from,
.menu-leave-to {
    opacity: 0;
    transform: translateX(20px) scale(0.9);
}
</style>
