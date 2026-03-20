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

const UPLOADS_DIR = path.join(__dirname, '../uploads');
const PROJECTS_DIR = path.join(__dirname, '../projects');
const DEPLOYMENTS_FILE = path.join(__dirname, '../deployments.json');

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
    try {
        return fs.readJsonSync(DEPLOYMENTS_FILE);
    } catch (e) {
        return [];
    }
}

function saveDeployments(deployments) {
    fs.writeJsonSync(DEPLOYMENTS_FILE, deployments);
}

function addLog(id, message) {
    if (!logsMap.has(id)) {
        logsMap.set(id, []);
    }
    const logEntry = { timestamp: new Date().toISOString(), message: message.toString() };
    logsMap.get(id).push(logEntry);
}

async function findFreePort() {
    const deployments = getDeployments();
    const usedPorts = deployments.filter(d => d.status === 'RUNNING').map(d => d.port);
    let port = 4000;
    while (usedPorts.includes(port)) {
        port++;
    }
    return port;
}

app.get('/deployments', (req, res) => {
    res.json(getDeployments());
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const projectName = req.body.name || 'Untitled Project';
    const deployments = getDeployments();

    const id = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, id);

    try {
        const zip = new admZip(req.file.path);
        zip.extractAllTo(projectPath, true);

        const pkgPath = path.join(projectPath, 'package.json');
        if (!fs.existsSync(pkgPath)) throw new Error('No package.json found');
        const pkg = fs.readJsonSync(pkgPath);
        if (!pkg.dependencies || !pkg.dependencies.react) throw new Error('Not a React project');

        const existingIndex = deployments.findIndex(d => d.name === projectName);
        let existingPort = null;
        if (existingIndex !== -1) {
            const existing = deployments[existingIndex];
            existingPort = existing.port;
            try {
                spawn('docker', ['stop', `container-${existing.id}`]);
                spawn('docker', ['rm', `container-${existing.id}`]);
            } catch (e) {}
        }

        const newDeployment = {
            id,
            name: projectName,
            status: 'BUILDING',
            port: existingPort,
            createdAt: new Date().toISOString()
        };

        if (existingIndex !== -1) {
            deployments[existingIndex] = newDeployment;
        } else {
            deployments.push(newDeployment);
        }
        saveDeployments(deployments);

        buildAndRun(id, projectPath, existingPort);

        res.json({ id, message: 'Upload successful, building...' });
    } catch (err) {
        // if (fs.existsSync(projectPath)) fs.removeSync(projectPath);
        res.status(400).json({ error: err.message });
    }
});

app.get('/logs/:id', (req, res) => {
    const { id } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastSentIndex = 0;
    const interval = setInterval(() => {
        const logs = logsMap.get(id) || [];
        if (logs.length > lastSentIndex) {
            for (let i = lastSentIndex; i < logs.length; i++) {
                res.write(`data: ${JSON.stringify(logs[i])}\n\n`);
            }
            lastSentIndex = logs.length;
        }
    }, 1000);

    req.on('close', () => clearInterval(interval));
});

function updateStatus(id, status, extra = {}) {
    const deployments = getDeployments();
    const index = deployments.findIndex(d => d.id === id);
    if (index !== -1) {
        deployments[index] = { ...deployments[index], status, ...extra };
        saveDeployments(deployments);
    }
}

async function buildAndRun(id, projectPath, existingPort) {
    addLog(id, 'Starting build process...');

    const dockerfile = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm install -g serve
CMD ["sh", "-c", "if [ -d 'dist' ]; then serve -s dist -l 3000; elif [ -d 'build' ]; then serve -s build -l 3000; else echo 'Build directory not found'; fi"]
`;

    fs.writeFileSync(path.join(projectPath, 'Dockerfile'), dockerfile);

    const build = spawn('docker', ['build', '-t', `project-${id}`, '.'], { cwd: projectPath });

    build.stdout.on('data', (data) => {
        console.log(`[BUILD ${id}]:`, data.toString());
        addLog(id, data.toString());
    });
    build.stderr.on('data', (data) => {
        console.error(`[BUILD ERROR ${id}]:`, data.toString());
        addLog(id, data.toString());
    });

    build.on('close', async (code) => {
        if (code !== 0) {
            addLog(id, `Build failed with code ${code}`);
            updateStatus(id, 'FAILED');
            return;
        }

        addLog(id, 'Build successful. Starting container...');
        const port = existingPort || await findFreePort();

        const run = spawn('docker', ['run', '-d', '-p', `${port}:3000`, '--name', `container-${id}`, `project-${id}`]);

        run.on('close', (runCode) => {
            if (runCode === 0) {
                addLog(id, `App is running at http://localhost:${port}`);
                updateStatus(id, 'RUNNING', { port });
            } else {
                addLog(id, `Failed to start container`);
                updateStatus(id, 'FAILED');
            }
        });
    });
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
