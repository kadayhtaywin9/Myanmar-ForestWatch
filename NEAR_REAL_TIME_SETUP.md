# Activate Recent fires on Vercel
1. Extract the whole project. Deploy the folder containing package.json, api/, lib/, and public/ as a Vite project. The repository configuration pins Node.js 22, runs npm ci and npm run build, and publishes dist. Select the extracted project directory containing vercel.json as the project root.
2. Request a fresh NASA FIRMS map key at https://firms.modaps.eosdis.nasa.gov/api/map_key/.
3. In Vercel project settings, add FIRMS_MAP_KEY to the Production environment and to Preview if you want live data there, then redeploy. Keep the key server-side.
4. The map opens with Hotspots set to Project datasets. Select Retrieve from NASA FIRMS to open Recent fires. Select Project datasets again to stop polling and return to your historical map. The browser requests the selected window immediately and every 15 minutes while the view is open. Refresh map requests an immediate update. Browser background tabs may throttle timers.
5. Check Satellite feed status for retrieval times and errors. A successful empty result means no matching observations. When a refresh fails, available previous results for the same window stay in browser memory until the view closes.
6. To check the production API directly, open /api/recent?hours=24 on your deployment. HTTP 200 returns the feed statuses and observations. HTTP 502 means all feeds failed. HTTP 503 indicates missing configuration or a server error.

This version needs only the FIRMS key for Recent fires. Each visitor refresh requests four satellite feeds. The seven-day window uses two requests per feed. Updates and alerts stop when the view closes. For local full-stack testing use vercel dev. Plain Vite serves only the frontend.
