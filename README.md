# Researcher App — Production-ready deployment for Gemini research app

This repo contains a static front-end and server-side API endpoints for Google Gemini. The front-end is configured to call the backend via relative paths, so a deployed URL can serve the app and API together without requiring `npm start`.

## Key updates

- Front-end now calls `/api/gemini` relatively, not `http://localhost:3000`.
- Backend API routes are implemented as Vercel Serverless Functions in `api/gemini.js` and `api/health.js`.
- A health check endpoint is available at `/api/health`.
- Environment variables are loaded securely from `.env` locally and from Vercel project settings in production.
- Vercel deployment config is provided in `vercel.json`.
- `.env` is ignored via `.gitignore`.

## Local development

1. Copy `.env.example` to `.env` and set your Gemini API key:

```bash
copy .env.example .env
# edit .env and set GEMINI_API_KEY
```

2. Install dependencies:

```bash
npm install
```

3. Start the local server (optional local dev):

```bash
npm run dev
```

4. Open the local URL shown in your terminal. The app uses relative routes and will call `/api/gemini` on the same origin.

## Deployment to Vercel

1. Sign in to Vercel and connect this repository.
2. Ensure the root project is selected.
3. Add the environment variable in Vercel:
   - `GEMINI_API_KEY`
4. Deploy. Your app will be available at the assigned Vercel URL.

The front-end will automatically use the deployed backend because it uses the relative route `/api/gemini`.

## Health check

Use this endpoint to verify the deployment is live:

```bash
curl https://<your-deployment-url>/api/health
```

Expected JSON response:

```json
{ "status": "ok", "service": "researcher-app", "timestamp": "..." }
```

## Testing

### Local API test

Set `API_BASE_URL` to your app URL before running the test. For example:

```bash
API_BASE_URL=https://your-app-url.vercel.app node test_full_prompt.js
```

### Mock test

Run the local proxy in mock mode and set `API_BASE_URL` to the local or deployed app URL:

```bash
MOCK_MODE=true npm run dev
API_BASE_URL=https://your-app-url.vercel.app node test_mock_run.js
```

## Security

- Do not commit `.env`.
- Use Vercel environment variables for production secrets.
- `.env.example` provides an example template only.
