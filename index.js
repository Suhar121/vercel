const express = require('express');
const multer = require('multer');
const admZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const BASE_DIR = '/home/user/platform';
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const PROJECTS_DIR = path.join(BASE_DIR, 'projects');
const DEPLOYMENTS_FILE = path.join(BASE_DIR, 'deployments.json');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(PROJECTS_DIR);
if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    fs.writeJsonSync(DEPLOYMENTS_FILE, []);
}

const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, `${uuidv4()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const logsMap = new Map();

function getDeployments() {
    return fs.readJsonSync(DEPLOYMENTS_FILE);
}

function saveDeployments(deployments) {
    fs.writeJsonSync(DEPLOYMENTS_FILE, deployments);
}

function addLog(id, message) {
    if (!logsMap.has(id)) logsMap.set(id, []);
    logsMap.get(id).push({ timestamp: new Date().toISOString(), message: message.toString() });
}

app.get('/deployments', (req, res) => res.json(getDeployments()));

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const id = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, id);
    try {
        const zip = new admZip(req.file.path);
        zip.extractAllTo(projectPath, true);
        const pkgPath = path.join(projectPath, 'package.json');
        if (!fs.existsSync(pkgPath)) throw new Error('No package.json');
        const pkg = fs.readJsonSync(pkgPath);
        if (!pkg.dependencies?.react) throw new Error('Not React');

        const deployments = getDeployments();
        deployments.push({ id, name: req.body.name || 'App', status: 'BUILDING', port: null, createdAt: new Date().toISOString() });
        saveDeployments(deployments);
        buildAndRun(id, projectPath);
        res.json({ id });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

async function buildAndRun(id, projectPath) {
    addLog(id, 'Building...');
    const dockerfile = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm install -g serve
CMD ["sh", "-c", "if [ -d 'dist' ]; then serve -s dist -l 3000; else serve -s build -l 3000; fi"]
`;
    fs.writeFileSync(path.join(projectPath, 'Dockerfile'), dockerfile);
    const build = spawn('docker', ['build', '-t', `project-${id}`, '.'], { cwd: projectPath });
    build.stdout.on('data', d => addLog(id, d));
    build.stderr.on('data', d => addLog(id, d));
    build.on('close', async code => {
        if (code !== 0) {
            updateStatus(id, 'FAILED');
            return;
        }
        const port = 4000 + getDeployments().length;
        const run = spawn('docker', ['run', '-d', '-p', `${port}:3000`, '--name', `container-${id}`, `project-${id}`]);
        run.on('close', rcode => {
            updateStatus(id, rcode === 0 ? 'RUNNING' : 'FAILED', { port });
        });
    });
}

function updateStatus(id, status, extra = {}) {
    const deps = getDeployments();
    const i = deps.findIndex(d => d.id === id);
    if (i !== -1) {
        deps[i] = { ...deps[i], status, ...extra };
        saveDeployments(deps);
    }
}

app.listen(port, () => console.log('Server on 3001'));
