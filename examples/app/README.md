This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Fluid HTN (C# → WASM)

This app integrates a Fluid HTN planner compiled to WebAssembly. Build the WASM AppBundle and sync it into `public/fluidhtn/_framework` with:

```bash
npm run build:fluidhtn
```

- This runs the repo script `scripts/build_fluidhtn_docker.sh` via Docker and copies the generated AppBundle to `examples/app/public/fluidhtn/`.
- Rebuild any time you change `scripts/fluidhtn/PlannerBridge.cs`.

## Tests (Node + worker threads)

Tests run the planner on a separate Node worker thread to avoid blocking and to respect timeouts.

```bash
npm test
```

- Demo test verifies `PlannerBridge.RunDemo()` end-to-end.
- Bunker tests exercise goal-based plans; some may currently return TIMEOUT until the domain logic is finalized.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
