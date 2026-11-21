/**
 * Migration runner
 * Reads SQL files from migrations/ in sorted order.
 * Each file is executed as a single query (no DELIMITER needed).
 * Trigger DDL files each contain exactly one CREATE TRIGGER statement.
 * Uses schema_migrations table to skip already-applied files.
 *
 * Run: node src/db/runner.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAdminConnection } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const sequelize = await getAdminConnection();
  try {
    // Ensure tracking table exists (run 000 manually first)
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Get already-applied migrations
    const [applied] = await sequelize.query(
      'SELECT filename FROM schema_migrations'
    );
    const appliedSet = new Set(applied.map((r) => r.filename));

    // Read and sort migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').trim();
      console.log(`  apply ${file}`);

      // Execute the entire file as one query (triggers have BEGIN...END but no DELIMITER)
      await sequelize.query(sql);

      await sequelize.query(
        'INSERT INTO schema_migrations (filename) VALUES (?)',
        { replacements: [file] }
      );
      console.log(`  done  ${file}`);
    }

    console.log('All migrations applied.');
  } finally {
    await sequelize.close();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
