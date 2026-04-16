# Deployment

## What changed

- Backend config now reads database, CORS, ML, and port settings from environment variables.
- Frontend API calls now use `REACT_APP_API_BASE_URL` instead of hard-coded localhost URLs.
- ML wait-time service can run locally or be disabled and hosted separately.

## Deployment files

- `render.yaml` defines the Render blueprint for the backend, ML service, and Postgres.
- `backend/railway.json` defines the Railway config for the Node backend.
- `ml/railway.json` defines the Railway config for the Flask ML service.
- `frontend/railway.json` defines the Railway config for the React frontend.

## Required environment variables

### Backend

- `PORT` - backend port, usually set by the host.
- `DATABASE_URL` - preferred PostgreSQL connection string.
- `PGSSL=true` - enable SSL when your hosted database requires it.
- `JWT_SECRET` - required for auth.
- `OCM_API_KEY` - OpenChargeMap API key.
- `ORS_API_KEY` - OpenRouteService API key.
- `CORS_ORIGIN` - comma-separated frontend origin(s), for example `https://your-frontend.com`.
- `ML_SERVICE_URL` - URL of the wait-time prediction service, for example `http://localhost:5002` or `https://your-ml-service.com`.
- `START_ML_SERVICE=false` - set this if you host the ML service separately.
- `ML_PYTHON` - optional Python executable name or path, defaults to `python3`.

### Frontend

- `REACT_APP_API_BASE_URL` - backend API base URL, for example `https://api.yourdomain.com/api`.

### ML service

- `PORT` - ML service port, defaults to `5002`.
- `FLASK_DEBUG=1` - optional local debugging.

## Recommended deployment layout

1. Host the React app on Vercel, Netlify, or any static host.
2. Host the Node backend on Render or Railway.
3. Host the ML service separately on Render or Railway.
4. Host the React frontend as a Render static site or a Railway service.
5. Use a PostgreSQL database with PostGIS enabled.

## Setup checklist

1. Create the PostgreSQL database and enable `postgis` and `btree_gist` extensions.
2. Set `DATABASE_URL`, `JWT_SECRET`, `OCM_API_KEY`, and `ORS_API_KEY` on the backend.
3. Set `REACT_APP_API_BASE_URL` on the frontend to your backend API URL.
4. If deploying ML separately, set `START_ML_SERVICE=false` on the backend and set `ML_SERVICE_URL` to the ML host.
5. Build the frontend with `npm run build` and deploy the generated static files.
6. Start the backend with `npm start` in `backend/`.
7. Start the ML service with `python app.py` in `ml/` if you are hosting it separately.

## Frontend

For Render, the frontend is included in `render.yaml` as a static site named `evassist-frontend`.
It builds with `REACT_APP_API_BASE_URL` already pointed at the Render backend service.

For Railway, deploy `frontend/` as a separate service using [frontend/railway.json](/Users/sudhanshu/Desktop/Evassist/frontend/railway.json). The service builds the React app and serves the compiled `build/` folder with `serve`.

Set `REACT_APP_API_BASE_URL` to your deployed backend API URL, for example `https://your-backend.onrender.com/api`.

## Render

The root `render.yaml` blueprint creates:

- a Postgres database
- a Node backend service rooted at `backend/`
- a Python ML service rooted at `ml/`

Set these backend environment variables in Render if they are not injected automatically:

- `JWT_SECRET`
- `OCM_API_KEY`
- `ORS_API_KEY`
- `CORS_ORIGIN`

Set `CORS_ORIGIN` to the URL of your deployed frontend.

## Railway

Deploy `backend/` and `ml/` as separate Railway services using the included config files.

- `backend/railway.json` for the backend
- `ml/railway.json` for the ML service
- `frontend/railway.json` for the frontend

Set these backend variables in Railway:

- `DATABASE_URL`
- `PGSSL=true`
- `JWT_SECRET`
- `OCM_API_KEY`
- `ORS_API_KEY`
- `ML_SERVICE_URL`
- `CORS_ORIGIN`
- `START_ML_SERVICE=false`

Set `REACT_APP_API_BASE_URL` on the Railway frontend service to your Railway backend URL, for example `https://your-backend.up.railway.app/api`.

## Local run

- Backend: `cd backend && npm install && npm start`
- Frontend: `cd frontend && npm install && npm start`
- ML: `cd ml && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python app.py`
