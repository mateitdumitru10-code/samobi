import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // strictPort: the port is in Supabase's redirect allow-list. Silently moving
  // to 5174 would break invitation links in a way that looks like a Supabase bug.
  server: { port: 5173, strictPort: true },
})
