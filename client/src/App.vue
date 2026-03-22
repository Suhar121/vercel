<template>
  <div class="container">
    <h1>Developer Platform</h1>
    <div class="upload-section">
      <input v-model="name" placeholder="App Name" />
      <input type="file" @change="onFileChange" accept=".zip" />
      <button @click="upload" :disabled="up">{{ up ? '...' : 'Deploy' }}</button>
    </div>
    <div v-for="d in deps" :key="d.id" class="card">
      <div class="head">
        <strong>{{ d.name }}</strong>
        <span :class="['status', d.status.toLowerCase()]">{{ d.status }}</span>
      </div>
      <div v-if="d.status === 'RUNNING'">
        <a :href="d.url" target="_blank">{{ d.url }}</a>
      </div>
      <button @click="viewLogs(d.id)">Logs</button>
      <div v-if="lid === d.id" class="logs">
        <div v-for="(l, i) in logs" :key="i">{{ l.message }}</div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue'
const api = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const name = ref(''), file = ref(null), up = ref(false), deps = ref([]), lid = ref(null), logs = ref([])
let es = null

const onFileChange = (e) => {
  file.value = e.target.files[0]
}

const fetchDeps = async () => {
  try {
    const res = await fetch(`${api}/deployments`)
    if (!res.ok) throw new Error('Fetch failed')
    deps.value = await res.json()
  } catch (e) {
    console.error('Fetch deployments error:', e)
  }
}

const upload = async () => {
  if (!file.value || !name.value) {
    alert('Please provide name and file')
    return
  }
  up.value = true
  const fd = new FormData(); fd.append('file', file.value); fd.append('name', name.value)
  try {
    const res = await fetch(`${api}/upload`, { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json()
      alert('Upload failed: ' + (err.error || 'Unknown error'))
    } else {
      name.value = ''; file.value = null; fetchDeps()
    }
  } catch (e) {
    console.error('Upload error:', e)
    alert('Upload failed: Connection error')
  } finally {
    up.value = false
  }
}

const viewLogs = id => {
  if (es) es.close()
  lid.value = id; logs.value = []
  es = new EventSource(`${api}/logs/${id}`)
  es.onmessage = e => logs.value.push(JSON.parse(e.data))
  es.onerror = e => console.error('SSE Error:', e)
}

onMounted(() => { fetchDeps(); setInterval(fetchDeps, 5000) })
</script>
<style>
.container { max-width: 600px; margin: auto; font-family: sans-serif; }
.upload-section { margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; }
.card { border: 1px solid #eee; padding: 10px; margin-bottom: 10px; border-radius: 4px; }
.head { display: flex; justify-content: space-between; margin-bottom: 5px; }
.status { font-weight: bold; font-size: 12px; }
.status.building { color: orange; }
.status.running { color: green; }
.status.failed { color: red; }
.logs { background: #111; color: #ccc; padding: 5px; height: 150px; overflow: auto; font-family: monospace; font-size: 11px; margin-top: 5px; }
</style>
