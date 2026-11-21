/**
 * Database connection factory.
 * Exports:
 *  - getConnection()      => app connection (restricted user if configured)
 *  - getAdminConnection() => admin connection (for migrations)
 *
 * Both set time_zone='+00:00' on each connection so all DATETIME values
 * are stored and returned as UTC (INC-0318 requirement).
 *
 * SSL: If DB_SSL_CA env var is set (path to Aiven CA certificate), SSL is
 * enabled with full certificate verification.  Local docker-compose dev
 * leaves DB_SSL_CA unset so no SSL is required there.
 */
import fs from 'fs';
import { Sequelize } from 'sequelize';
import { config } from '../config/env.js';

function makeSslOptions() {
  const caContent = process.env.DB_SSL_CA_CONTENT;
  const caPath = process.env.DB_SSL_CA;
  if (!caContent && !caPath) return null; // local dev without SSL

  return {
    ssl: {
      ca: caContent ? Buffer.from(caContent, 'utf-8') : fs.readFileSync(caPath),
      // Do NOT set rejectUnauthorized: false — that defeats the whole point.
      // Aiven's CA cert is verified explicitly.
      rejectUnauthorized: true,
    },
  };
}

function makeOptions(database, username, password, host, port, extra = {}) {
  const ssl = makeSslOptions();
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
      timezone: '+00:00',
      // SSL config (null-spread is ignored if no SSL needed)
      ...(ssl || {}),
      // Allow callers (migration runner) to enable multipleStatements
      ...extra,
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
  // Force UTC on every new connection.
  // afterConnect receives the raw mysql2 connection (non-promise), so use
  // conn.promise().query() — do NOT await conn.query() directly.
  seq.addHook('afterConnect', async (conn) => {
    await conn.promise().query("SET time_zone = '+00:00'");
  });
  await seq.authenticate();
  _appConnection = seq;
  return seq;
}

export async function getAdminConnection() {
  // For migrations: use ADMIN_DATABASE_URL or same creds as app.
  // multipleStatements: true is needed so the runner can send multi-statement SQL files.
  const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
  let opts;
  if (adminUrl) {
    const p = parseDatabaseUrl(adminUrl);
    opts = makeOptions(p.database, p.username, p.password, p.host, p.port, { multipleStatements: true });
  } else {
    opts = makeOptions(
      config.dbName,
      process.env.DB_ADMIN_USER || config.dbUser,
      process.env.DB_ADMIN_PASS || config.dbPass,
      config.dbHost,
      config.dbPort,
      { multipleStatements: true }
    );
  }
  const seq = new Sequelize(opts);
  seq.addHook('afterConnect', async (conn) => {
    await conn.promise().query("SET time_zone = '+00:00'");
  });
  await seq.authenticate();
  return seq;
}

export function closeConnection() {
  if (_appConnection) {
    return _appConnection.close();
  }
}
