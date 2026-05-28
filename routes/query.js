const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const fs = require('fs');
const path = require('path');

const QUERY_FILE = path.join(__dirname, '..', 'data', 'saved_queries.json');

// 读取保存的查询
function loadSavedQueries() {
  try {
    if (fs.existsSync(QUERY_FILE)) {
      return JSON.parse(fs.readFileSync(QUERY_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

// 保存查询
function saveQueries(queries) {
  fs.writeFileSync(QUERY_FILE, JSON.stringify(queries, null, 2));
}

// 执行 SQL 查询
router.post('/execute', async (req, res) => {
  const { sql, database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    const result = await dbManager.query(sql);
    res.json({
      success: true,
      rows: result.rows,
      fields: result.fields,
      rowCount: result.rows.length
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 批量执行 SQL
router.post('/execute-batch', async (req, res) => {
  const { sql, database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);
    const results = await dbManager.executeMultiple(sql);
    res.json({ success: true, results });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 保存 SQL 查询
router.post('/save', (req, res) => {
  const { name, sql, database } = req.body;
  const queries = loadSavedQueries();
  const query = {
    id: Date.now().toString(),
    name,
    sql,
    database,
    createdAt: new Date().toISOString()
  };
  queries.push(query);
  saveQueries(queries);
  res.json({ success: true, query });
});

// 获取保存的查询列表
router.get('/saved', (req, res) => {
  const queries = loadSavedQueries();
  res.json({ success: true, queries });
});

// 删除保存的查询
router.post('/delete-saved', (req, res) => {
  const { id } = req.body;
  let queries = loadSavedQueries();
  queries = queries.filter(q => q.id !== id);
  saveQueries(queries);
  res.json({ success: true });
});

module.exports = router;
