const express = require('express');
const router = express.Router();
const dbManager = require('../db');

// 新建数据库
router.post('/create', async (req, res) => {
  const { databaseName, charset, collation } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (conn.type === 'mysql') {
      let sql = `CREATE DATABASE \`${databaseName}\``;
      if (charset) sql += ` CHARACTER SET ${charset}`;
      if (collation) sql += ` COLLATE ${collation}`;
      await dbManager.query(sql);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`CREATE DATABASE "${databaseName}"`);
    } else if (conn.type === 'sqlite') {
      // SQLite 通过 ATTACH 创建新数据库文件
      const dbPath = require('path').join(__dirname, '..', 'data', databaseName + '.db');
      await dbManager.query(`ATTACH DATABASE '${dbPath.replace(/\\/g, '/')}' AS "${databaseName}"`);
    }
    const databases = await dbManager.getDatabases();
    res.json({ success: true, databases });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 删除数据库
router.post('/drop', async (req, res) => {
  const { databaseName } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (conn.type === 'mysql') {
      await dbManager.query(`DROP DATABASE \`${databaseName}\``);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`DROP DATABASE "${databaseName}"`);
    } else if (conn.type === 'sqlite') {
      const dbPath = require('path').join(__dirname, '..', 'data', databaseName + '.db');
      await dbManager.query(`DETACH DATABASE "${databaseName}"`);
      const fs = require('fs');
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
    const databases = await dbManager.getDatabases();
    res.json({ success: true, databases });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 获取数据库列表
router.get('/list', async (req, res) => {
  try {
    const databases = await dbManager.getDatabases();
    res.json({ success: true, databases });
  } catch (err) {
    res.json({ success: false, error: err.message, databases: [] });
  }
});

// 获取指定库下的表列表（不切换数据库）
router.get('/tables/:database', async (req, res) => {
  try {
    const tables = await dbManager.getTablesReadOnly(req.params.database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message, tables: [] });
  }
});

// 获取所有数据库及其表（用于树状导航初始化）
router.get('/all-with-tables', async (req, res) => {
  try {
    const databases = await dbManager.getDatabases();
    const result = [];
    for (const db of databases) {
      try {
        const tables = await dbManager.getTablesReadOnly(db);
        result.push({ name: db, tables });
      } catch (e) {
        result.push({ name: db, tables: [], error: e.message });
      }
    }
    res.json({ success: true, databases: result });
  } catch (err) {
    res.json({ success: false, error: err.message, databases: [] });
  }
});

module.exports = router;
