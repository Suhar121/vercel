<template>
  <div class="page">
    <main class="shell">
      <header class="hero">
        <p class="hero-kicker">Deployment Control Center</p>
        <h1>Developer Platform</h1>
        <p class="hero-subtitle">
          Upload a zipped React app, watch build logs live, and open deployments when they are ready.
        </p>
      </header>

      <section class="panel">
        <form class="upload-form" @submit.prevent="upload">
          <label>
            App Name
            <input v-model.trim="name" type="text" placeholder="My App" />
          </label>
          <label>
            Project ZIP
            <input ref="fileInputRef" type="file" accept=".zip,application/zip" @change="onFileChange" />
          </label>
          <button type="submit" :disabled="isUploading">
            {{ isUploading ? 'Deploying...' : 'Deploy App' }}
          </button>
        </form>
        <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
        <p v-if="successMessage" class="notice success">{{ successMessage }}</p>
      </section>

      <section class="panel">
        <div class="section-header">
          <h2>Deployments</h2>
          <button class="ghost" :disabled="loadingDeployments" @click="fetchDeployments">
            {{ loadingDeployments ? 'Refreshing...' : 'Refresh' }}
          </button>
        </div>

        <p v-if="loadingDeployments && !sortedDeployments.length" class="muted">Loading deployments...</p>
        <p v-else-if="!sortedDeployments.length" class="muted">No deployments yet. Upload a ZIP to get started.</p>

        <article v-for="deployment in sortedDeployments" :key="deployment.id" class="deployment-card">
          <div class="deployment-head">
            <div>
              <h3>{{ deployment.name || 'Untitled App' }}</h3>
              <p class="meta">Created {{ formatTimestamp(deployment.createdAt) }}</p>
            </div>
            <span :class="['status-pill', statusClass(deployment.status)]">
              {{ deployment.status }}
            </span>
          </div>

          <a
            v-if="deployment.status === 'RUNNING' && deployment.url"
            class="app-link"
            :href="deployment.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Deployment
          </a>

          <div class="actions">
            <button class="ghost" @click="toggleLogs(deployment.id)">
              {{ activeLogDeploymentId === deployment.id ? 'Hide Logs' : 'View Logs' }}
            </button>
          </div>

          <div v-if="activeLogDeploymentId === deployment.id" class="logs">
            <p v-if="!logs.length" class="muted">Waiting for log stream...</p>
            <div v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" class="log-line">
              <span class="log-time">{{ formatLogTime(entry.timestamp) }}</span>
              <span class="log-message">{{ entry.message }}</span>
            </div>
          </div>
        </article>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';

const api = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const name = ref('');
const selectedFile = ref(null);
const isUploading = ref(false);
const deployments = ref([]);
const loadingDeployments = ref(false);
const activeLogDeploymentId = ref(null);
const logs = ref([]);
const errorMessage = ref('');
const successMessage = ref('');
const fileInputRef = ref(null);

let eventSource = null;
let pollIntervalId = null;

const sortedDeployments = computed(() =>
  [...deployments.value].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
);

function statusClass(status) {
  const normalizedStatus = (status || '').toUpperCase();
  if (normalizedStatus === 'RUNNING') return 'running';
  if (normalizedStatus === 'FAILED') return 'failed';
  return 'building';
}

function formatTimestamp(value) {
  if (!value) return 'unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toLocaleString();
}

function formatLogTime(value) {
  if (!value) return '--:--:--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString();
}

function onFileChange(event) {
  selectedFile.value = event.target.files?.[0] || null;
  errorMessage.value = '';
}

function closeLogStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

async function fetchDeployments() {
  loadingDeployments.value = true;
  try {
    const response = await fetch(`${api}/deployments`);
    if (!response.ok) throw new Error(`Failed to load deployments (${response.status})`);
    deployments.value = await response.json();
  } catch (error) {
    errorMessage.value = error.message || 'Unable to fetch deployments.';
  } finally {
    loadingDeployments.value = false;
  }
}

async function upload() {
  errorMessage.value = '';
  successMessage.value = '';

  if (!name.value) {
    errorMessage.value = 'Enter an app name before deploying.';
    return;
  }
  if (!selectedFile.value) {
    errorMessage.value = 'Select a ZIP file to upload.';
    return;
  }

  isUploading.value = true;
  try {
    const payload = new FormData();
    payload.append('name', name.value);
    payload.append('file', selectedFile.value);

    const response = await fetch(`${api}/upload`, { method: 'POST', body: payload });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Upload failed (${response.status})`);
    }

    successMessage.value = 'Deployment started. Open logs to watch progress.';
    name.value = '';
    selectedFile.value = null;
    if (fileInputRef.value) fileInputRef.value.value = '';
    await fetchDeployments();
  } catch (error) {
    errorMessage.value = error.message || 'Deployment failed to start.';
  } finally {
    isUploading.value = false;
  }
}

function toggleLogs(id) {
  if (activeLogDeploymentId.value === id) {
    activeLogDeploymentId.value = null;
    logs.value = [];
    closeLogStream();
    return;
  }

  errorMessage.value = '';
  activeLogDeploymentId.value = id;
  logs.value = [];
  closeLogStream();

  eventSource = new EventSource(`${api}/logs/${id}`);
  eventSource.onmessage = event => {
    try {
      logs.value.push(JSON.parse(event.data));
    } catch (error) {
      logs.value.push({ timestamp: new Date().toISOString(), message: 'Unable to parse log line.' });
    }
  };
  eventSource.onerror = () => {
    errorMessage.value = 'Log stream disconnected. Click "View Logs" to reconnect.';
    closeLogStream();
  };
}

onMounted(() => {
  fetchDeployments();
  pollIntervalId = setInterval(fetchDeployments, 5000);
});

onUnmounted(() => {
  if (pollIntervalId) clearInterval(pollIntervalId);
  closeLogStream();
});
</script>

<style>
:root {
  --bg-top: #f7f4ee;
  --bg-bottom: #e8eff8;
  --panel: rgba(255, 255, 255, 0.9);
  --ink: #20222b;
  --muted: #6b7180;
  --accent: #0f8f84;
  --accent-strong: #0d756c;
  --warning: #d88f21;
  --danger: #b6453b;
  --success: #197d50;
  --outline: #d6dbe5;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.page {
  min-height: 100vh;
  padding: 2.5rem 1rem 3.5rem;
  background:
    radial-gradient(1200px 500px at 10% -10%, #ffe4bc 0%, transparent 60%),
    radial-gradient(1000px 400px at 90% 0%, #d6e6ff 0%, transparent 55%),
    linear-gradient(180deg, var(--bg-top), var(--bg-bottom));
  color: var(--ink);
  font-family: "Space Grotesk", "Trebuchet MS", "Segoe UI", sans-serif;
}

.shell {
  max-width: 920px;
  margin: 0 auto;
  display: grid;
  gap: 1.1rem;
}

.hero {
  padding: 0.5rem 0.2rem;
}

.hero-kicker {
  margin: 0;
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-strong);
  font-weight: 600;
}

.hero h1 {
  margin: 0.25rem 0;
  font-size: clamp(1.8rem, 4.5vw, 2.6rem);
  line-height: 1.1;
}

.hero-subtitle {
  margin: 0;
  color: var(--muted);
  max-width: 60ch;
}

.panel {
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 16px;
  padding: 1rem;
  box-shadow: 0 10px 30px rgba(24, 36, 53, 0.08);
  backdrop-filter: blur(4px);
}

.upload-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
  align-items: end;
}

.upload-form label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.88rem;
  font-weight: 600;
}

.upload-form input {
  width: 100%;
  border: 1px solid var(--outline);
  border-radius: 10px;
  padding: 0.65rem 0.7rem;
  font-size: 0.95rem;
}

button {
  border: 0;
  border-radius: 10px;
  padding: 0.72rem 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--accent);
  color: white;
  transition: background 0.2s ease, transform 0.18s ease;
}

button:hover:not(:disabled) {
  background: var(--accent-strong);
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.ghost {
  background: transparent;
  color: var(--accent-strong);
  border: 1px solid var(--outline);
}

.ghost:hover:not(:disabled) {
  background: rgba(15, 143, 132, 0.08);
}

.notice {
  margin: 0.8rem 0 0;
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  font-size: 0.88rem;
}

.notice.error {
  background: rgba(182, 69, 59, 0.09);
  color: var(--danger);
}

.notice.success {
  background: rgba(25, 125, 80, 0.11);
  color: var(--success);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.9rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.92rem;
}

.deployment-card {
  border: 1px solid var(--outline);
  border-radius: 12px;
  padding: 0.85rem;
  margin-bottom: 0.7rem;
  background: white;
}

.deployment-head {
  display: flex;
  justify-content: space-between;
  gap: 0.7rem;
  align-items: center;
}

.deployment-head h3 {
  margin: 0;
  font-size: 1.02rem;
}

.meta {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.83rem;
}

.status-pill {
  font-size: 0.76rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  letter-spacing: 0.02em;
}

.status-pill.building {
  background: rgba(216, 143, 33, 0.15);
  color: #8e5f12;
}

.status-pill.running {
  background: rgba(25, 125, 80, 0.15);
  color: var(--success);
}

.status-pill.failed {
  background: rgba(182, 69, 59, 0.14);
  color: var(--danger);
}

.app-link {
  display: inline-flex;
  margin-top: 0.55rem;
  color: var(--accent-strong);
  font-weight: 600;
  text-decoration: none;
}

.app-link:hover {
  text-decoration: underline;
}

.actions {
  margin-top: 0.65rem;
}

.logs {
  margin-top: 0.75rem;
  max-height: 240px;
  overflow: auto;
  padding: 0.6rem;
  background: #131a28;
  color: #dde7f8;
  border-radius: 9px;
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.79rem;
}

.log-line {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 0.5rem;
  line-height: 1.35;
}

.log-time {
  color: #84b6ff;
}

.log-message {
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 880px) {
  .upload-form {
    grid-template-columns: 1fr;
  }
}
</style>
