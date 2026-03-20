# Developer Platform v1 (Vercel-like)

A simple developer platform where users can deploy React applications by uploading a ZIP file.

## Features
- **ZIP Upload**: Accept React project uploads.
- **Automatic Detection**: Validates `package.json` and React dependency.
- **Isolated Builds**: Builds projects inside Docker containers.
- **Auto-Running**: Automatically runs the built app on a unique port.
- **Real-time Logs**: View build and run logs via Server-Sent Events (SSE).
- **Dashboard**: Web-based UI for managing deployments.

## Prerequisites
- Node.js (v18+)
- Docker
- npm

## Setup & Running

### 1. Start the Backend
1. Go to the `server/` directory.
2. Run `npm install`.
3. Start with `node index.js`.

The backend runs on `http://localhost:3001`.

### 2. Start the Frontend
1. Go to the `client/` directory.
2. Run `npm install`.
3. Start with `npm run dev`.

The dashboard runs on `http://localhost:5173`.

## Deployment Workflow
1. Open the dashboard.
2. Enter a project name and select a ZIP file of your React app.
3. Click "Deploy Now".
4. Monitor the status and logs in real-time.
5. Once running, click the provided link to access your live app.

## Project Structure
- `server/`: Express backend handling uploads, builds, and logs.
- `client/`: Vue-based dashboard.
- `uploads/`: Temporary storage for uploaded ZIPs.
- `projects/`: Extracted project source code and Dockerfiles.
- `deployments.json`: Simple persistence for project statuses.
