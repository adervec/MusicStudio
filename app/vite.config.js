import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';

// Dev-only endpoint so the app (served by the launcher's dev server, i.e. running on THIS machine)
// can open a folder in the OS file manager. The browser sandbox can't do this itself. Absent in a
// built/preview build, so the client falls back to copying the path.
function openFolderPlugin() {
  return {
    name: 'open-folder',
    configureServer(server) {
      server.middlewares.use('/__open-folder', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
        req.on('end', () => {
          let path = '';
          try { path = String(JSON.parse(body).path || ''); } catch { /* bad json */ }
          if (!path) { res.statusCode = 400; return res.end('no path'); }
          try {
            const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            spawn(cmd, [path], { detached: true, stdio: 'ignore' }).unref(); // args array → no shell injection
            res.statusCode = 200; res.end('ok');
          } catch (e) { res.statusCode = 500; res.end(String(e)); }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [react(), openFolderPlugin()] });
