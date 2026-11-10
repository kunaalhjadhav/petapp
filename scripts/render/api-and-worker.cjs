// The API and the background worker in one Node process, for Render's free plan (512 MB): sharing one runtime
// uses about half the memory of two processes. Started by scripts/render/start-api.mjs.
require('../../apps/backend/dist/main.js');
if (process.env.RUN_WORKER !== 'false') require('../../apps/backend/dist/worker.js');
