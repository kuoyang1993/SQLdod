const express = require('express');
const router = express.Router();
const dbManager = require('../db');

// ============ 工具函数：日期格式化 ============

/**
 * 将 ISO 日期字符串 / Date 对象 / 任意值 转换为 YYYY-MM-DD 格式
 * 支持格式：
 *   - 2026-02-02T16:00:00.000Z  ->  2026-02-02
 *   - 2026-02-02 16:00:00       ->  2026-02-02
 *   - 2026-02-02                ->  2026-02-02
 *   - Date 对象                  ->  YYYY-MM-DD
 *   - 非日期值                    ->  原值
 */
function formatDateValue(val) {
  if (val === null || val === undefined) return val;
  // 已经是纯日期格式 YYYY-MM-DD
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  let d = null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    d = val;
  } else if (typeof val === 'string') {
    // 尝试匹配日期字符串（处理 ISO 格式、带时区、带时间等）
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      // 使用本地时间构造，避免 UTC 时区偏移问题
      d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    }
  } else if (typeof val === 'number') {
    // 可能是时间戳
    d = new Date(val);
  }

  if (d && !isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return val;
}

/**
 * 判断列类型是否是日期类型
 */
function isDateColumnType(colType) {
  if (!colType) return false;
  const upper = colType.toUpperCase();
  return upper === 'DATE' || upper === 'DATETIME' || upper === 'TIMESTAMP' || upper === 'TIMESTAMPTZ' || upper === 'TIME';
}

/**
 * 根据表结构信息，格式化数据行中的日期字段
 * @param {Array} rows - 数据行数组
 * @param {Array} columns - 列结构数组 [{Field, Type}, ...]
 * @returns {Array} 格式化后的数据行
 */
function formatDateFields(rows, columns) {
  if (!rows || !columns || rows.length === 0 || columns.length === 0) return rows;
  const dateFields = columns.filter(c => isDateColumnType(c.Type)).map(c => c.Field);
  if (dateFields.length === 0) return rows;

  return rows.map(row => {
    const newRow = { ...row };
    for (const field of dateFields) {
      if (field in newRow) {
        newRow[field] = formatDateValue(newRow[field]);
      }
    }
    return newRow;
  });
}

// 获取表数据（支持分页）
router.get('/table/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database, page = 1, pageSize = 20 } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    const currentPage = parseInt(page);
    const size = parseInt(pageSize);
    const offset = (currentPage - 1) * size;

    // 获取总数
    let countSql;
    let countResult;
    if (conn.type === 'mysql') {
      countSql = `SELECT COUNT(*) as total FROM \`${tableName}\``;
      const [rows] = await conn.pool.query(countSql);
      countResult = { rows };
    } else if (conn.type === 'postgresql') {
      countSql = `SELECT COUNT(*) as total FROM "${tableName}"`;
      countResult = await conn.pool.query(countSql);
    } else if (conn.type === 'sqlite') {
      countSql = `SELECT COUNT(*) as total FROM "${tableName}"`;
      const stmt = conn.sqlite.prepare(countSql);
      countResult = { rows: stmt.all() };
    }
    const total = countResult.rows[0]?.total || 0;

    // 获取数据
    let dataSql;
    let dataResult;
    if (conn.type === 'mysql') {
      dataSql = `SELECT * FROM \`${tableName}\` LIMIT ${size} OFFSET ${offset}`;
      const [rows] = await conn.pool.query(dataSql);
      dataResult = { rows };
    } else if (conn.type === 'postgresql') {
      dataSql = `SELECT * FROM "${tableName}" LIMIT ${size} OFFSET ${offset}`;
      dataResult = await conn.pool.query(dataSql);
    } else if (conn.type === 'sqlite') {
      dataSql = `SELECT * FROM "${tableName}" LIMIT ${size} OFFSET ${offset}`;
      const stmt = conn.sqlite.prepare(dataSql);
      dataResult = { rows: stmt.all() };
    }

    // 格式化日期字段
    try {
      const structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
      dataResult.rows = formatDateFields(dataResult.rows, structure);
    } catch (e) {
      // 获取表结构失败不影响主流程，跳过日期格式化
    }

    const totalPages = Math.ceil(total / size);

    res.json({
      success: true,
      data: dataResult.rows,
      total,
      page: currentPage,
      pageSize: size,
      totalPages
    });
  } catch (err) {
    res.json({ success: false, error: err.message, data: [], total: 0 });
  }
});

// 获取表结构（列信息）
router.get('/columns/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);
    const structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
    res.json({ success: true, columns: structure });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 插入数据
router.post('/insert/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database, data: rowData } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    const columns = Object.keys(rowData);
    const values = Object.values(rowData);
    const placeholders = values.map(() => '?').join(', ');

    let sql;
    if (conn.type === 'mysql') {
      sql = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
    } else {
      sql = `INSERT INTO "${tableName}" ("${columns.join('", "')}") VALUES (${placeholders})`;
    }

    await dbManager.query(sql, values);
    res.json({ success: true, message: '数据插入成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 更新数据
router.post('/update/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database, data: rowData, primaryKey, primaryValue } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    const setClauses = Object.keys(rowData).map(key => {
      if (conn.type === 'mysql') return `\`${key}\` = ?`;
      return `"${key}" = ?`;
    }).join(', ');

    const values = Object.values(rowData);

    let sql;
    if (conn.type === 'mysql') {
      sql = `UPDATE \`${tableName}\` SET ${setClauses} WHERE \`${primaryKey}\` = ?`;
    } else {
      sql = `UPDATE "${tableName}" SET ${setClauses} WHERE "${primaryKey}" = ?`;
    }
    values.push(primaryValue);

    await dbManager.query(sql, values);
    res.json({ success: true, message: '数据更新成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 删除数据
router.post('/delete/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database, primaryKey, primaryValue } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    let sql;
    if (conn.type === 'mysql') {
      sql = `DELETE FROM \`${tableName}\` WHERE \`${primaryKey}\` = ?`;
    } else {
      sql = `DELETE FROM "${tableName}" WHERE "${primaryKey}" = ?`;
    }

    await dbManager.query(sql, [primaryValue]);
    res.json({ success: true, message: '数据删除成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
