# Checkpoint marketing website

The public Checkpoint marketing website is an independently buildable Astro project inside the product repository. It is intentionally isolated from `frontend/`, `backend/`, and `api/`, which continue to power the existing application.

## Architecture

- Astro statically renders pages, navigation, editorial sections, FAQ content, and SEO metadata.
- React islands power only the interactive fake-data product demonstrations. The hero island loads immediately; below-fold islands hydrate when visible.
- Production brand assets are mirrored from `frontend/public/brand/` into `public/brand/` so this project deploys independently and never relies on a local development path.
- All demonstration records live inside `src/components/ProductDemo.jsx`. They are fictional and deterministic. No production API, database, payment, or member data is accessed.
- The canonical marketing URL is configured as `https://checkpoint.cc.cd`, but PR20 is preview-only. Domain attachment and application-domain migration are intentionally deferred.

## Commands

```bash
npm install
npm run dev
npm run check
npm run build
npm run preview
```

For Vercel, create a separate project with **Root Directory** set to `marketing`. Do not reuse the existing Checkpoint application project and do not attach production domains during PR20 review.

## Routes

- `/`
- `/product`
- `/how-it-works`
- `/for-groups`
- `/about`
- `/contact`

Deeper product, resources, security, legal, and governance-hub routes are intentionally deferred until they contain real product content or approved policy copy.
