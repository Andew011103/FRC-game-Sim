import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Development only: lets the robot builder's "Save as official" button write
 * a robot straight into src/robots/builtin/, where the game picks it up, and
 * the Drive Pass editor save the pass to src/pass/drive-pass.json.
 * It is not part of the published site.
 */
export function officialRobots() {
  return {
    name: 'official-robots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__official-robot', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          try {
            const robot = JSON.parse(body);
            // The id becomes the file name, so it may only be lower-case letters, digits and dashes.
            if (typeof robot.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(robot.id)) throw new Error('bad id');
            const file = resolve(server.config.root, 'src/robots/builtin', `${robot.id}.json`);
            writeFileSync(file, `${JSON.stringify({ ...robot, official: true }, null, 2)}\n`);
            response.statusCode = 200;
            response.end('saved');
          } catch {
            response.statusCode = 400;
            response.end('not saved');
          }
        });
      });

      // The Drive Pass screen's editor saves the whole road of rewards here.
      server.middlewares.use('/__changelog', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          try {
            const log = JSON.parse(body);
            if (!Array.isArray(log.entries)) throw new Error('not a changelog');
            const entries = log.entries.map((entry) => {
              if (typeof entry.title !== 'string' || !entry.title.trim() || !Array.isArray(entry.changes)) throw new Error('bad entry');
              const changes = entry.changes.filter((change) => typeof change === 'string' && change.trim());
              const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : undefined;
              return { title: entry.title.trim(), ...(date ? { date } : {}), changes };
            });
            const file = resolve(server.config.root, 'src/changelog.json');
            writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`);
            response.statusCode = 200;
            response.end('saved');
          } catch {
            response.statusCode = 400;
            response.end('not saved');
          }
        });
      });
      server.middlewares.use('/__shop', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          try {
            const shop = JSON.parse(body);
            if (!Array.isArray(shop.items)) throw new Error('not a shop');
            for (const item of shop.items) {
              if (typeof item.price !== 'number' || typeof item.reward?.id !== 'string' || typeof item.reward?.type !== 'string') {
                throw new Error('bad item');
              }
            }
            const file = resolve(server.config.root, 'src/pass/shop.json');
            writeFileSync(file, `${JSON.stringify({ items: shop.items }, null, 2)}\n`);
            response.statusCode = 200;
            response.end('saved');
          } catch {
            response.statusCode = 400;
            response.end('not saved');
          }
        });
      });
      server.middlewares.use('/__drive-pass', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          try {
            const pass = JSON.parse(body);
            if (typeof pass.name !== 'string' || !Array.isArray(pass.tiers)) throw new Error('not a pass');
            for (const tier of pass.tiers) {
              if (typeof tier.rp !== 'number' || typeof tier.reward?.id !== 'string' || typeof tier.reward?.type !== 'string') {
                throw new Error('bad tier');
              }
            }
            const file = resolve(server.config.root, 'src/pass/drive-pass.json');
            writeFileSync(file, `${JSON.stringify(pass, null, 2)}\n`);
            response.statusCode = 200;
            response.end('saved');
          } catch {
            response.statusCode = 400;
            response.end('not saved');
          }
        });
      });
    },
  };
}
