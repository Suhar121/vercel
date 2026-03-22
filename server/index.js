require('dotenv').config();
const express = require('express');
const multer = require('multer');
const admZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const port = process.env.PORT || 3001;
const corsOrigin = process.env.CORS_ORIGIN || '*';
const publicIp = process.env.PUBLIC_IP || 'localhost';

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, '../uploads');
const PROJECTS_DIR = path.join(__dirname, '../projects');
const DEPLOYMENTS_FILE = path.join(__dirname, '../deployments.json');

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(PROJECTS_DIR);
if (!fs.existsSync(DEPLOYMENTS_FILE)) fs.writeJsonSync(DEPLOYMENTS_FILE, []);

const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage });

const logsMap = new Map();

function getDeployments() {
    try { return fs.readJsonSync(DEPLOYMENTS_FILE); } catch (e) { return []; }
}
function saveDeployments(d) { fs.writeJsonSync(DEPLOYMENTS_FILE, d); }
function addLog(id, msg) {
    if (!logsMap.has(id)) logsMap.set(id, []);
    logsMap.get(id).push({ timestamp: new Date().toISOString(), message: msg.toString() });
}
function resolveProjectPath(projectPath) {
    const rootPackagePath = path.join(projectPath, 'package.json');
    if (fs.existsSync(rootPackagePath)) return projectPath;

    const topLevelEntries = fs.readdirSync(projectPath, { withFileTypes: true });
    if (topLevelEntries.length === 1 && topLevelEntries[0].isDirectory()) {
        const nestedPath = path.join(projectPath, topLevelEntries[0].name);
        if (fs.existsSync(path.join(nestedPath, 'package.json'))) return nestedPath;
    }

    throw new Error('Could not find package.json at the zip root');
}
function hasReactDependency(pkg) {
    const dependencyGroups = [
        pkg.dependencies,
        pkg.devDependencies,
        pkg.peerDependencies,
        pkg.optionalDependencies
    ];
    return dependencyGroups.some(group => Boolean(group?.react));
}
function getNextAvailablePort(startPort = 4000) {
    const usedPorts = new Set(
        getDeployments()
            .map(dep => Number(dep.port))
            .filter(Number.isInteger)
    );
    let candidatePort = startPort;
    while (usedPorts.has(candidatePort)) candidatePort += 1;
    return candidatePort;
}

app.get('/deployments', (req, res) => res.json(getDeployments()));

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const id = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, id);
    try {
        const zip = new admZip(req.file.path);
        zip.extractAllTo(projectPath, true);
        const deployablePath = resolveProjectPath(projectPath);
        const pkg = fs.readJsonSync(path.join(deployablePath, 'package.json'));
        if (!hasReactDependency(pkg)) throw new Error('Not a React project');

        const deployments = getDeployments();
        deployments.push({ id, name: req.body.name || 'App', status: 'BUILDING', port: null, createdAt: new Date().toISOString() });
        saveDeployments(deployments);
        buildAndRun(id, deployablePath);
        res.json({ id });
    } catch (err) {
        if (fs.existsSync(projectPath)) fs.removeSync(projectPath);
        res.status(400).json({ error: err.message });
    } finally {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.removeSync(req.file.path);
    }
});

app.get('/logs/:id', (req, res) => {
    const { id } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    let lastIndex = 0;
    const interval = setInterval(() => {
        const logs = logsMap.get(id) || [];
        if (logs.length > lastIndex) {
            for (let i = lastIndex; i < logs.length; i++) res.write(`data: ${JSON.stringify(logs[i])}\n\n`);
            lastIndex = logs.length;
        }
    }, 1000);
    req.on('close', () => clearInterval(interval));
});

async function buildAndRun(id, projectPath) {
    addLog(id, 'Starting build...');
    const dockerfile = "FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nRUN npm run build\nRUN npm install -g serve\nCMD [\"sh\", \"-c\", \"if [ -d 'dist' ]; then serve -s dist -l 3000; else serve -s build -l 3000; fi\"]";
    fs.writeFileSync(path.join(projectPath, 'Dockerfile'), dockerfile);

    let buildErrored = false;
    let build;
    try {
        build = spawn('docker', ['build', '-t', `p-${id}`, '.'], { cwd: projectPath });
    } catch (err) {
        addLog(id, `Docker build failed to start: ${err.message}`);
        updateStatus(id, 'FAILED');
        return;
    }
    build.stdout.on('data', d => addLog(id, d));
    build.stderr.on('data', d => addLog(id, d));
    build.on('error', err => {
        buildErrored = true;
        addLog(id, `Docker build failed to start: ${err.message}`);
        updateStatus(id, 'FAILED');
    });
    build.on('close', async code => {
        if (buildErrored) return;
        if (code !== 0) {
            addLog(id, `Docker build exited with code ${code}`);
            return updateStatus(id, 'FAILED');
        }

        const hostPort = getNextAvailablePort();
        let runErrored = false;
        let run;
        try {
            run = spawn('docker', ['run', '-d', '-p', `${hostPort}:3000`, '--name', `c-${id}`, `p-${id}`]);
        } catch (err) {
            addLog(id, `Docker run failed to start: ${err.message}`);
            updateStatus(id, 'FAILED');
            return;
        }
        run.stdout.on('data', d => addLog(id, d));
        run.stderr.on('data', d => addLog(id, d));
        run.on('error', err => {
            runErrored = true;
            addLog(id, `Docker run failed to start: ${err.message}`);
            updateStatus(id, 'FAILED');
        });
        run.on('close', rcode => {
            if (runErrored) return;
            if (rcode === 0) {
                updateStatus(id, 'RUNNING', { port: hostPort, url: `http://${publicIp}:${hostPort}` });
            } else {
                addLog(id, `Docker run exited with code ${rcode}`);
                updateStatus(id, 'FAILED');
            }
        });
    });
}

function updateStatus(id, status, extra = {}) {
    const deps = getDeployments();
    const i = deps.findIndex(d => d.id === id);
    if (i !== -1) { deps[i] = { ...deps[i], status, ...extra }; saveDeployments(deps); }
}

app.listen(port, () => console.log(`Server on ${port}, CORS origin: ${corsOrigin}`));
