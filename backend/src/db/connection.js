/**
 * Database connection factory.
 * Exports:
 *  - getConnection()      => app connection (restricted user if configured)
 *  - getAdminConnection() => admin connection (for migrations)
 *
 * Both set time_zone='+00:00' on each connection so all DATETIME values
 * are stored and returned as UTC (INC-0318 requirement).
 */
import { Sequelize } from 'sequelize';
import { config } from '../config/env.js';

function makeOptions(database, username, password, host, port) {
  return {
    dialect: 'mysql',
    host,
    port,
    database,
    username,
    password,
    timezone: '+00:00',
    dialectOptions: {
      // Ensure the connection session uses UTC
      // and returns DATETIME as strings (not JS Date) so we control parsing
      timezone: '+00:00',
    },
    logging: config.nodeEnv === 'development' ? console.log : false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
  };
}

function parseDatabaseUrl(url) {
  // mysql://user:pass@host:port/dbname
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || '3306', 10),
    database: u.pathname.replace(/^\//, ''),
    username: u.username,
    password: u.password,
  };
}

let _appConnection = null;

export async function getConnection() {
  if (_appConnection) return _appConnection;

  let opts;
  if (config.databaseUrl) {
    const p = parseDatabaseUrl(config.databaseUrl);
    opts = makeOptions(p.database, p.username, p.password, p.host, p.port);
  } else {
    opts = makeOptions(
      config.dbName,
      config.dbUser,
      config.dbPass,
      config.dbHost,
      config.dbPort
    );
  }

  const seq = new Sequelize(opts);
  // Force UTC on every new connection
  seq.addHook('afterConnect', async (conn) => {
    await conn.query("SET time_zone = '+00:00'");
  });
  await seq.authenticate();
  _appConnection = seq;
  return seq;
}

export async function getAdminConnection() {
  // For migrations: use ADMIN_DATABASE_URL or same creds as app
  const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  let opts;
  if (adminUrl) {
    const p = parseDatabaseUrl(adminUrl);
    opts = makeOptions(p.database, p.username, p.password, p.host, p.port);
  } else {
    opts = makeOptions(
      config.dbName,
      process.env.DB_ADMIN_USER || config.dbUser,
      process.env.DB_ADMIN_PASS || config.dbPass,
      config.dbHost,
      config.dbPort
    );
  }
  const seq = new Sequelize(opts);
  seq.addHook('afterConnect', async (conn) => {
    await conn.query("SET time_zone = '+00:00'");
  });
  await seq.authenticate();
  return seq;
}

export function closeConnection() {
  if (_appConnection) {
    return _appConnection.close();
  }
}
