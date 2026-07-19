<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/14c85672-779a-484a-b7a3-7efb62cb4fb0

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Copy `.env.example` to `.env.local`, configure PostgreSQL, and initialize authentication:
   `npm run db:generate && npm run db:migrate && npm run db:seed`
4. Configure the environment-specific S3 variables described in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).
5. Run the S3 conditional-write compatibility test:
   `npm run storage:test-conditional`
6. Run the app:
   `npm run dev`

## Storage architecture

The granular object layout, optimistic-locking contract, circuit breaker, and one-time migration procedure are documented in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).

## Authentication

PostgreSQL/Prisma setup, national-ID login, session security, first-login password change, and the head-nurse password-reset workflow are documented in [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).
