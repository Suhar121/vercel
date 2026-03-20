# Developer Platform v1

A developer platform for React apps.

## Setup

### Backend
1. `cd server`
2. `npm install`
3. Configure `.env` (copy from `.env.example`):
   - `PORT`: Backend port (default: 3001)
   - `CORS_ORIGIN`: URL of your frontend
   - `PUBLIC_IP`: IP or domain for generated URLs
4. `node index.js`

### Frontend
1. `cd client`
2. `npm install`
3. Configure `.env` (copy from `.env.example`):
   - `VITE_API_URL`: URL of your backend
4. `npm run dev`

## Deployment
Upload a ZIP of your React app (must contain `package.json` with `react` dependency). The platform will build it and serve it on a unique port.
