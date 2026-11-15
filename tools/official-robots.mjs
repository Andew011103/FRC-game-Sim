import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Development only: lets the robot builder's "Save as official" button write
 * a robot straight into src/robots/builtin/, where the game picks it up.
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
    },
  };
}
