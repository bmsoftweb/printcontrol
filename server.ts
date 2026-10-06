import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { poolAdmin } from './server/db.js';

/** Entrada para execução local (npm run dev / start). Na Vercel quem serve as rotas é api/index.ts */
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = createApp();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`PrintControl rodando em http://0.0.0.0:${PORT}`);
    // Os bancos de trabalho vêm do Servidor digitado no login; aqui só confere o banco administrativo
    try {
      const [[r]] = await poolAdmin.query<any[]>('SELECT DATABASE() AS db, COUNT(*) AS n FROM servidores');
      console.log(`MySQL: ${process.env.MYSQL_HOST} / ${r.db} (${r.n} servidor(es))`);
    } catch (err: any) {
      console.log(`MySQL administrativo indisponível: ${err.message}`);
    }
  });
}

startServer().catch((err) => {
  console.error('Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
