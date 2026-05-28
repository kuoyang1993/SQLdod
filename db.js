const mysql = require('mysql2/promise');
const { Pool: PgPool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class ConnectionManager {
  constructor() {
    this.connections = {};
    this.activeConnectionId = null;
  }

  // 获取连接信息
  getConnectionInfo(connectionId) {
    return this.connections[connectionId] || null;
  }

  // 获取活跃连接
  getActiveConnection() {
    if (!this.activeConnectionId) return null;
    return this.connections[this.activeConnectionId] || null;
  }

  // 创建 MySQL 连接池
  createMySQLPool(config) {
    return mysql.createPool({
      host: config.host || 'localhost',
      port: parseInt(config.port) || 3306,
      user: config.user || 'root',
      password: config.password || '',
      database: config.database || '',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4'
    });
  }

  // 创建 PostgreSQL 连接池
  createPgPool(config) {
    return new PgPool({
      host: config.host || 'localhost',
      port: parseInt(config.port) || 5432,
      user: config.user || 'postgres',
      password: config.password || '',
      database: config.database || 'postgres',
      max: 10
    });
  }

  // 创建 SQLite 连接
  createSQLiteConnection(config) {
    const dbPath = config.filePath || path.join(__dirname, 'data', config.database || 'sqlite.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  }

  // 添加连接
  addConnection(id, config) {
    this.connections[id] = {
      id,
      type: config.type,
      name: config.name || config.host || '未命名连接',
      config: { ...config },
      pool: null,
      sqlite: null,
      connected: false
    };
    return this.connections[id];
  }

  // 连接数据库
  async connect(connectionId) {
    const conn = this.connections[connectionId];
    if (!conn) throw new Error('连接不存在');

    try {
      if (conn.type === 'mysql') {
        conn.pool = this.createMySQLPool(conn.config);
        // 测试连接
        const [rows] = await conn.pool.query('SELECT 1 AS test');
        conn.connected = true;
      } else if (conn.type === 'postgresql') {
        conn.pool = this.createPgPool(conn.config);
        const result = await conn.pool.query('SELECT 1 AS test');
        conn.connected = true;
      } else if (conn.type === 'sqlite') {
        conn.sqlite = this.createSQLiteConnection(conn.config);
        conn.sqlite.prepare('SELECT 1 AS test').get();
        conn.connected = true;
      }
      this.activeConnectionId = connectionId;
      return true;
    } catch (err) {
      conn.connected = false;
      throw err;
    }
  }

  // 断开连接
  async disconnect(connectionId) {
    const conn = this.connections[connectionId];
    if (!conn) return;

    try {
      if (conn.type === 'mysql' && conn.pool) {
        await conn.pool.end();
      } else if (conn.type === 'postgresql' && conn.pool) {
        await conn.pool.end();
      } else if (conn.type === 'sqlite' && conn.sqlite) {
        conn.sqlite.close();
      }
    } catch (e) {
      // 忽略关闭错误
    }
    conn.pool = null;
    conn.sqlite = null;
    conn.connected = false;
    if (this.activeConnectionId === connectionId) {
      this.activeConnectionId = null;
    }
  }

  // 获取活跃连接池
  getPool() {
    const conn = this.getActiveConnection();
    if (!conn || !conn.connected) return null;
    return conn;
  }

  // 执行查询
  async query(sql, params = []) {
    const conn = this.getActiveConnection();
    if (!conn) throw new Error('没有活跃的数据库连接');

    if (conn.type === 'mysql') {
      const [rows, fields] = await conn.pool.query(sql, params);
      return { rows, fields: fields ? fields.map(f => ({ name: f.name })) : [] };
    } else if (conn.type === 'postgresql') {
      const result = await conn.pool.query(sql, params);
      return { rows: result.rows, fields: result.fields ? result.fields.map(f => ({ name: f.name })) : [] };
    } else if (conn.type === 'sqlite') {
      const stmt = conn.sqlite.prepare(sql);
      // 判断是否是 SELECT 查询
      if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('PRAGMA') || sql.trim().toUpperCase().startsWith('EXPLAIN')) {
        const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
        return { rows, fields: [] };
      } else {
        const info = params.length > 0 ? stmt.run(...params) : stmt.run();
        return { rows: [{ changes: info.changes, lastInsertRowid: info.lastInsertRowid }], fields: [] };
      }
    }
  }

  // 执行多条SQL（批量）
  async executeMultiple(sqlStatements) {
    const conn = this.getActiveConnection();
    if (!conn) throw new Error('没有活跃的数据库连接');

    const results = [];
    const statements = sqlStatements.split(';').filter(s => s.trim());

    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;

      try {
        if (conn.type === 'mysql') {
          const [rows] = await conn.pool.query(trimmed);
          results.push({ sql: trimmed, success: true, rows: Array.isArray(rows) ? rows : [] });
        } else if (conn.type === 'postgresql') {
          const result = await conn.pool.query(trimmed);
          results.push({ sql: trimmed, success: true, rows: result.rows || [] });
        } else if (conn.type === 'sqlite') {
          const s = conn.sqlite.prepare(trimmed);
          if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('PRAGMA')) {
            const rows = s.all();
            results.push({ sql: trimmed, success: true, rows });
          } else {
            const info = s.run();
            results.push({ sql: trimmed, success: true, rows: [{ changes: info.changes }] });
          }
        }
      } catch (err) {
        results.push({ sql: trimmed, success: false, error: err.message });
      }
    }
    return results;
  }

  // 获取数据库列表
  async getDatabases() {
    const conn = this.getActiveConnection();
    if (!conn) return [];

    if (conn.type === 'mysql') {
      const { rows } = await this.query('SHOW DATABASES');
      return rows.map(r => r.Database);
    } else if (conn.type === 'postgresql') {
      const { rows } = await this.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
      return rows.map(r => r.datname);
    } else if (conn.type === 'sqlite') {
      return ['main'];
    }
    return [];
  }

  // 获取表列表
  async getTables(database) {
    const conn = this.getActiveConnection();
    if (!conn) return [];

    if (conn.type === 'mysql') {
      await this.query(`USE \`${database}\``);
      const { rows } = await this.query('SHOW TABLES');
      const key = Object.keys(rows[0] || {})[0];
      return rows.map(r => r[key]);
    } else if (conn.type === 'postgresql') {
      const { rows } = await this.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
      );
      return rows.map(r => r.table_name);
    } else if (conn.type === 'sqlite') {
      const { rows } = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      return rows.map(r => r.name);
    }
    return [];
  }

  // 获取指定数据库的表列表（不切换数据库，只读查询）
  async getTablesReadOnly(database) {
    const conn = this.getActiveConnection();
    if (!conn) return [];

    if (conn.type === 'mysql') {
      // 使用 SHOW TABLES FROM 而不是 USE，避免影响当前选中的数据库
      const [rows] = await conn.pool.query(`SHOW TABLES FROM \`${database}\``);
      const key = Object.keys(rows[0] || {})[0];
      return rows.map(r => r[key]);
    } else if (conn.type === 'postgresql') {
      const { rows } = await this.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
      );
      return rows.map(r => r.table_name);
    } else if (conn.type === 'sqlite') {
      const { rows } = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      return rows.map(r => r.name);
    }
    return [];
  }

  // 获取表结构
  async getTableStructure(database, tableName) {
    const conn = this.getActiveConnection();
    if (!conn) return [];

    if (conn.type === 'mysql') {
      await this.query(`USE \`${database}\``);
      const { rows } = await this.query(`DESCRIBE \`${tableName}\``);
      return rows.map(r => ({
        Field: r.Field,
        Type: r.Type,
        Null: r.Null,
        Key: r.Key,
        Default: r.Default,
        Extra: r.Extra
      }));
    } else if (conn.type === 'postgresql') {
      const { rows } = await this.query(`
        SELECT 
          c.column_name AS "Field",
          c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS "Type",
          c.is_nullable AS "Null",
          CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS "Key",
          c.column_default AS "Default",
          '' AS "Extra"
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_name = $1
        ORDER BY c.ordinal_position
      `, [tableName]);
      return rows;
    } else if (conn.type === 'sqlite') {
      const { rows } = await this.query(`PRAGMA table_info(\`${tableName}\`)`);
      return rows.map(r => ({
        Field: r.name,
        Type: r.type || 'TEXT',
        Null: r.notnull === 0 ? 'YES' : 'NO',
        Key: r.pk === 1 ? 'PRI' : '',
        Default: r.dflt_value || null,
        Extra: ''
      }));
    }
    return [];
  }

  // 切换数据库
  async switchDatabase(database) {
    const conn = this.getActiveConnection();
    if (!conn) throw new Error('没有活跃连接');

    if (conn.type === 'mysql') {
      await this.query(`USE \`${database}\``);
      conn.config.database = database;
    } else if (conn.type === 'postgresql') {
      await conn.pool.end();
      conn.config.database = database;
      conn.pool = this.createPgPool(conn.config);
      await conn.pool.query('SELECT 1');
    } else if (conn.type === 'sqlite') {
      // SQLite 不需要切换数据库
    }
    return true;
  }
}

// 单例
const manager = new ConnectionManager();
module.exports = manager;
