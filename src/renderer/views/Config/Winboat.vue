<template>
    <div class="flex flex-col mt-12" :class="{ hidden: !maxNumCores }">
        <div class="flex flex-col gap-4 opening-transition self-center max-w-full w-[84rem] ease-in">
            <!-- RAM Allocation -->
            <ConfigCard
                icon="game-icons:ram"
                title="RAM Allocation"
                desc="How many gigabytes of RAM are allocated to the Windows virtual machine"
                type="number"
                unit="GB"
                :min="MIN_VM_RAM_GB"
                :max="maxRamGB"
                v-model:value="ramGB"
            />

            <!-- CPU Cores -->
            <ConfigCard
                icon="solar:cpu-bold"
                title="CPU Cores"
                desc="How many CPU Cores are allocated to the Windows virtual machine"
                type="number"
                unit="Cores"
                :min="2"
                :max="maxNumCores"
                v-model:value="numCores"
            />

            <!-- Shared Home Folder -->
            <ConfigCard
                icon="fluent:folder-link-32-filled"
                title="Shared Folder"
                type="switch"
                v-model:value="shareFolder"
            >
                <template v-slot:desc>
                    If enabled, you will be able to access your selected folder within Windows under
                    <span class="font-mono bg-neutral-700 rounded-md px-1 py-0.5">Network\host.lan</span>
                </template>
            </ConfigCard>

            <!-- Shared Folder Location -->
            <ConfigCard v-if="shareFolder" icon="mdi:folder-cog" title="Shared Folder Location" type="custom">
                <template v-slot:desc>
                    <span v-if="sharedFolderPath">
                        Currently sharing:
                        <span class="font-mono bg-neutral-700 rounded-md px-1 py-0.5">{{ sharedFolderPath }}</span>
                    </span>
                    <span v-else> Select a folder to share with Windows </span>
                </template>
                <x-button @click="selectSharedFolder"> Browse </x-button>
            </ConfigCard>

            <!-- Auto Start Container -->
            <ConfigCard
                icon="clarity:power-solid"
                title="Auto Start Container"
                desc="If enabled, the Windows container will automatically be started when the system boots up"
                type="switch"
                v-model:value="autoStartContainer"
            />

            <ConfigCard
                v-if="gpuEnabled"
                icon="mdi:gpu"
                title="GPU Render Device"
                desc="The host GPU used to render accelerated graphics for Windows"
                type="custom"
            >
                <x-select
                    :key="renderDevice"
                    :value="renderDevice"
                    class="w-80 max-w-[40vw]"
                    @change="(e: any) => (renderDevice = e.detail.newValue)"
                >
                    <x-menu>
                        <x-menuitem
                            v-for="device in renderDevices"
                            :key="device.path"
                            :value="device.path"
                            :toggled="renderDevice === device.path"
                        >
                            <x-label class="block max-w-72 truncate" :title="device.name">
                                {{ device.name }} —
                                {{ device.vramGB ? `${device.vramGB} GB` : "shared memory" }}
                            </x-label>
                        </x-menuitem>
                    </x-menu>
                </x-select>
            </ConfigCard>

            <!-- GPU Video Memory -->
            <ConfigCard
                v-if="gpuEnabled"
                icon="mdi:memory"
                title="GPU Video Memory"
                desc="The maximum amount of video memory made available to Windows"
                type="number"
                unit="GB"
                :min="1"
                :max="gpuVramMaxGB"
                v-model:value="gpuVramGB"
            />

            <div class="flex flex-col">
                <p class="my-0 text-yellow-500" v-for="(warning, k) of warnings" :key="`warning-${k}`">
                    ⚠ {{ warning }}
                </p>
                <p class="my-0 text-red-500" v-for="(error, k) of errors" :key="`error-${k}`">❗ {{ error }}</p>
            </div>
            <x-button
                :disabled="saveButtonDisabled || isUpdatingUSBPrerequisites"
                @click="saveCompose()"
                class="w-24"
            >
                <span v-if="!isApplyingChanges || isUpdatingUSBPrerequisites">Save</span>
                <x-throbber v-else class="w-10"></x-throbber>
            </x-button>
        </div>
    </div>
</template>

<script setup lang="ts">
import ConfigCard from "../../components/ConfigCard.vue";
import { computed, onMounted, ref, watch } from "vue";
import { Winboat } from "../../lib/winboat";
import type { ComposeConfig } from "../../../types";
import { getSpecs } from "../../lib/specs";
import {
    getGpuVramMaxGB,
    getRenderDevices,
    hasNvidiaContainerSupport,
    shouldCheckNvidiaContainerSupport,
    type RenderDevice,
} from "../../lib/gpu";
import { configureGpuContainer, gpuContainerConfigNeedsUpdate } from "../../lib/gpu-container";
import {
    RESTART_UNLESS_STOPPED,
    RESTART_NO,
    MIN_VM_RAM_GB,
    RECOMMENDED_VM_RAM_GB,
    DEFAULT_GPU_VRAM_GB,
} from "../../lib/constants";
const electron: typeof import("electron") = require("electron").remote || require("@electron/remote");
const os: typeof import("os") = require("node:os");


// For Resources
const compose = ref<ComposeConfig | null>(null);
const numCores = ref(0);
const origNumCores = ref(0);
const maxNumCores = ref(0);
const ramGB = ref(0);
const origRamGB = ref(0);
const maxRamGB = ref(0);
const gpuEnabled = ref(false);
const gpuVramGB = ref(DEFAULT_GPU_VRAM_GB);
const origGpuVramGB = ref(DEFAULT_GPU_VRAM_GB);
const renderDevices = ref<RenderDevice[]>([]);
const renderDevice = ref("");
const origRenderDevice = ref("");
const nvidiaContainerSupportAvailable = ref(false);
const selectedGpu = computed(() => renderDevices.value.find(device => device.path === renderDevice.value));
const gpuVramMaxGB = computed(() => getGpuVramMaxGB(selectedGpu.value?.vramGB));
const nvidiaGpuError = computed(() => {
    if (!shouldCheckNvidiaContainerSupport(gpuEnabled.value, selectedGpu.value)) return "";
    if (!selectedGpu.value?.nvidiaUuid) {
        return "WinBoat could not map this render node to an NVIDIA GPU through nvidia-smi";
    }
    if (!nvidiaContainerSupportAvailable.value) {
        return "NVIDIA Container Toolkit is not exposing this GPU to Docker through a runtime or CDI";
    }
    return "";
});
const shareFolder = ref(false);
const origShareFolder = ref(false);
const sharedFolderPath = ref("");
const origSharedFolderPath = ref("");
const origAutoStartContainer = ref(false);
const autoStartContainer = ref(false);
const isApplyingChanges = ref(false);
const isUpdatingUSBPrerequisites = ref(false);

// Singleton classes
const winboat = Winboat.getInstance();

// Constants
const RENDER_DEVICE_MAPPING = /^\/dev\/dri\/renderD\d+(?::|$)/;
let nvidiaSupportCheckSequence = 0;

onMounted(async () => {
    await assignValues();
});

/**
 * Assigns the initial values from the Compose file to the reactive refs
 * so we can display them and track when a change has been made
 */
async function assignValues() {
    compose.value = Winboat.readCompose(winboat.containerMgr!.composeFilePath);
    const environment = compose.value.services.windows.environment;

    numCores.value = Number(environment.CPU_CORES);
    origNumCores.value = numCores.value;

    ramGB.value = Number(environment.RAM_SIZE.split("G")[0]);
    origRamGB.value = ramGB.value;

    gpuEnabled.value = environment.HELIOS?.toUpperCase() === "Y";
    if (gpuEnabled.value) {
        try {
            renderDevices.value = await getRenderDevices();
        } catch (error) {
            console.error("Failed to detect GPU render devices", error);
            renderDevices.value = [];
            nvidiaContainerSupportAvailable.value = false;
        }

        renderDevice.value = environment.RENDERNODE || findConfiguredRenderDevice();
        origRenderDevice.value = renderDevice.value;
        gpuVramGB.value = parseGpuVramGB(environment.HELIOS_HOSTMEM);
        gpuVramGB.value = Math.min(gpuVramGB.value, gpuVramMaxGB.value);
        origGpuVramGB.value = gpuVramGB.value;
    }

    // Find any volume that ends with /shared
    const sharedVolume = compose.value.services.windows.volumes.find(v => v.includes("/shared"));
    if (sharedVolume) {
        shareFolder.value = true;
        // Extract the path before :/shared
        const [hostPath] = sharedVolume.split(":");
        sharedFolderPath.value = hostPath.replace("${HOME}", os.homedir());
    } else {
        shareFolder.value = false;
        sharedFolderPath.value = "";
    }
    origShareFolder.value = shareFolder.value;
    origSharedFolderPath.value = sharedFolderPath.value;

    autoStartContainer.value = compose.value.services.windows.restart === RESTART_UNLESS_STOPPED;
    origAutoStartContainer.value = autoStartContainer.value;

    const specs = await getSpecs();
    maxRamGB.value = specs.ramGB;
    maxNumCores.value = specs.cpuCores;
}

function isRenderDeviceMapping(device: string) {
    return RENDER_DEVICE_MAPPING.test(device);
}

function findConfiguredRenderDevice() {
    return compose.value?.services.windows.devices.find(isRenderDeviceMapping)?.split(":")[0] || "";
}

function parseGpuVramGB(value?: string) {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_GPU_VRAM_GB;
}

/**
 * Saves the currently specified values to the Compose file
 * and then re-assigns the initial values to the reactive refs
 */
async function saveCompose() {
    const windows = compose.value!.services.windows;
    windows.environment.RAM_SIZE = `${ramGB.value}G`;
    windows.environment.CPU_CORES = `${numCores.value}`;

    if (gpuEnabled.value) {
        const vramBytes = gpuVramGB.value * 1024 ** 3;
        Object.assign(windows.environment, {
            HELIOS_HOSTMEM: `${gpuVramGB.value}G`,
            HELIOS_BLOB_LIMIT: `${gpuVramGB.value}G`,
            RENDERNODE: renderDevice.value,
            VKR_DEVICE_MEMORY_LIMIT_BYTES: `${vramBytes}`,
            override_vram_size: `${gpuVramGB.value * 1024}`,
        });
        windows.devices = windows.devices.filter(device => !isRenderDeviceMapping(device));
        windows.devices.push(renderDevice.value);
        configureGpuContainer(windows, selectedGpu.value!);
    }

    // Remove any existing shared volume
    const existingSharedVolume = compose.value!.services.windows.volumes.find(v => v.includes("/shared"));
    if (existingSharedVolume) {
        compose.value!.services.windows.volumes = compose.value!.services.windows.volumes.filter(
            v => !v.includes("/shared"),
        );
    }

    // Add the new shared volume if enabled
    if (shareFolder.value && sharedFolderPath.value) {
        const volumeStr = `${sharedFolderPath.value}:/shared`;
        compose.value!.services.windows.volumes.push(volumeStr);
    }

    compose.value!.services.windows.restart = autoStartContainer.value ? RESTART_UNLESS_STOPPED : RESTART_NO;

    isApplyingChanges.value = true;
    try {
        await winboat.replaceCompose(compose.value!);
        await assignValues();
    } catch (e) {
        console.error("Failed to apply changes");
        console.error(e);
    } finally {
        isApplyingChanges.value = false;
    }
}

/**
 * Opens a dialog to select a folder to share with Windows
 */
function selectSharedFolder() {
    electron.dialog
        .showOpenDialog({
            title: "Select Folder to Share",
            properties: ["openDirectory"],
            defaultPath: sharedFolderPath.value || os.homedir(),
        })
        .then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                sharedFolderPath.value = result.filePaths[0];
            }
        });
}

const errors = computed(() => {
    let errCollection: string[] = [];

    if (!numCores.value || numCores.value < 2) {
        errCollection.push("You must allocate at least two CPU cores for Windows to run properly");
    }

    if (numCores.value > maxNumCores.value) {
        errCollection.push("You cannot allocate more CPU cores to Windows than you have available");
    }

    if (!ramGB.value || ramGB.value < MIN_VM_RAM_GB) {
        errCollection.push(`You must allocate at least ${MIN_VM_RAM_GB} GB of RAM for Windows to run properly`);
    }

    if (ramGB.value > maxRamGB.value) {
        errCollection.push("You cannot allocate more RAM to Windows than you have available");
    }

    if (gpuEnabled.value && !selectedGpu.value) {
        errCollection.push("You must select an available GPU render device");
    }

    if (
        gpuEnabled.value &&
        (!Number.isInteger(gpuVramGB.value) || gpuVramGB.value < 1 || gpuVramGB.value > gpuVramMaxGB.value)
    ) {
        errCollection.push(`GPU video memory must be between 1 and ${gpuVramMaxGB.value} GB`);
    }

    if (gpuEnabled.value && nvidiaGpuError.value) {
        errCollection.push(nvidiaGpuError.value);
    }

    return errCollection;
});

const warnings = computed(() => {
    if (ramGB.value >= MIN_VM_RAM_GB && ramGB.value < RECOMMENDED_VM_RAM_GB) {
        return [
            `Allocating less than the recommended ${RECOMMENDED_VM_RAM_GB} GB of RAM may limit Windows performance`,
        ];
    }

    return [];
});

const saveButtonDisabled = computed(() => {
    const gpuContainerConfigChanged =
        gpuEnabled.value &&
        !!compose.value &&
        gpuContainerConfigNeedsUpdate(compose.value.services.windows, selectedGpu.value);
    const hasResourceChanges =
        origNumCores.value !== numCores.value ||
        origRamGB.value !== ramGB.value ||
        (gpuEnabled.value &&
            (origGpuVramGB.value !== gpuVramGB.value || origRenderDevice.value !== renderDevice.value)) ||
        gpuContainerConfigChanged ||
        shareFolder.value !== origShareFolder.value ||
        sharedFolderPath.value !== origSharedFolderPath.value ||
        autoStartContainer.value !== origAutoStartContainer.value;

    const shouldBeDisabled = errors.value?.length || !hasResourceChanges || isApplyingChanges.value;

    return shouldBeDisabled;
});

// Watch for when shared folder is enabled and set default path
watch(shareFolder, newValue => {
    if (newValue && !sharedFolderPath.value) {
        sharedFolderPath.value = os.homedir();
    }
});

async function refreshNvidiaContainerSupport() {
    const sequence = ++nvidiaSupportCheckSequence;
    const device = selectedGpu.value;
    nvidiaContainerSupportAvailable.value = false;

    if (!shouldCheckNvidiaContainerSupport(gpuEnabled.value, device) || !device?.nvidiaUuid) {
        return;
    }

    const available = await hasNvidiaContainerSupport(device.nvidiaUuid);
    if (sequence === nvidiaSupportCheckSequence) nvidiaContainerSupportAvailable.value = available;
}

watch(renderDevice, () => {
    gpuVramGB.value = Math.min(gpuVramGB.value, gpuVramMaxGB.value);
});

watch([gpuEnabled, selectedGpu], () => {
    void refreshNvidiaContainerSupport();
});
</script>