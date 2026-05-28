const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 配置文件上传
const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.sql') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 CSV 和 SQL 文件'));
    }
  }
});

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

// ============ 工具函数：CSV 序列化/反序列化 ============

function csvStringify(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function csvParse(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] !== undefined ? values[idx] : '';
    });
    records.push(record);
  }
  return records;
}

// ============ 导出 ============

// 导出表为 CSV
router.post('/export-csv', async (req, res) => {
  const { database, tableName } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    let dataResult;
    if (conn.type === 'mysql') {
      const [rows] = await conn.pool.query(`SELECT * FROM \`${tableName}\``);
      dataResult = { rows };
    } else if (conn.type === 'postgresql') {
      dataResult = await conn.pool.query(`SELECT * FROM "${tableName}"`);
    } else if (conn.type === 'sqlite') {
      const stmt = conn.sqlite.prepare(`SELECT * FROM "${tableName}"`);
      dataResult = { rows: stmt.all() };
    }

    // 格式化日期字段
    try {
      const structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
      dataResult.rows = formatDateFields(dataResult.rows, structure);
    } catch (e) {}

    const csvContent = '\uFEFF' + csvStringify(dataResult.rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(tableName)}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 判断 MySQL 列类型是否为数值类型
function isNumericColumnType(colType) {
  if (!colType) return false;
  const upper = colType.toUpperCase();
  return upper.includes('INT') || upper.includes('DECIMAL') || upper.includes('NUMERIC') ||
         upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('REAL') ||
         upper.includes('BIT') || upper === 'BOOLEAN' || upper === 'BOOL';
}

// 生成 MySQL INSERT 值（纯兼容格式：数值不加引号，其他加单引号）
function mysqlFormatInsertValue(val, colType) {
  if (val === null || val === undefined) return 'NULL';
  // 日期字段先格式化
  if (isDateColumnType(colType)) {
    val = formatDateValue(val);
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  // 如果列是数值类型但值是字符串形式的数字，不加引号
  if (isNumericColumnType(colType) && typeof val === 'string' && val.trim() !== '' && !isNaN(val.trim())) {
    return String(Number(val));
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

// 导出表为 SQL
router.post('/export-sql', async (req, res) => {
  const { database, tableName, exportMode } = req.body;
  const includeCreate = exportMode !== 'dataOnly'; // 默认完整导出

  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    // 获取表结构（供日期格式化和类型判断使用）
    let structure;
    try {
      structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
    } catch (e) {
      structure = [];
    }

    // 根据数据库类型决定标识符引号（仅非 MySQL 使用）
    const quote = conn.type === 'mysql' ? '`' : '"';

    // 获取建表语句（仅完整导出模式）
    let createSQL = '';
    if (includeCreate) {
      let dropSQL = `DROP TABLE IF EXISTS ${quote}${tableName}${quote};`;

      if (conn.type === 'mysql') {
        const [rows] = await conn.pool.query(`SHOW CREATE TABLE \`${tableName}\``);
        createSQL = dropSQL + '\n' + rows[0]['Create Table'] + ';\n\n';
      } else if (conn.type === 'postgresql') {
        const colDefs = structure.map(col => {
          let def = `  ${quote}${col.Field}${quote} ${col.Type}`;
          if (col.Null === 'NO') def += ' NOT NULL';
          if (col.Default !== null && col.Default !== undefined) def += ` DEFAULT ${col.Default}`;
          return def;
        });
        createSQL = dropSQL + '\nCREATE TABLE ' + quote + tableName + quote + ' (\n' + colDefs.join(',\n');
        if (structure.some(c => c.Key === 'PRI')) {
          const pkCols = structure.filter(c => c.Key === 'PRI').map(c => `${quote}${c.Field}${quote}`);
          createSQL += ',\n  PRIMARY KEY (' + pkCols.join(', ') + ')';
        }
        createSQL += '\n);\n\n';
      } else if (conn.type === 'sqlite') {
        const { rows } = await dbManager.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
        createSQL = dropSQL + '\n' + (rows[0]?.sql || '') + ';\n\n';
      }
    }

    // 获取数据
    let dataResult;
    if (conn.type === 'mysql') {
      const [rows] = await conn.pool.query(`SELECT * FROM \`${tableName}\``);
      dataResult = { rows };
    } else if (conn.type === 'postgresql') {
      dataResult = await conn.pool.query(`SELECT * FROM "${tableName}"`);
    } else if (conn.type === 'sqlite') {
      const stmt = conn.sqlite.prepare(`SELECT * FROM "${tableName}"`);
      dataResult = { rows: stmt.all() };
    }

    // 格式化日期字段
    dataResult.rows = formatDateFields(dataResult.rows, structure);

    // 生成 INSERT 语句
    let insertSQL = '';
    if (dataResult.rows.length > 0) {
      const columns = Object.keys(dataResult.rows[0]);
      // 构建列名到类型的映射
      const colTypeMap = {};
      for (const col of structure) {
        colTypeMap[col.Field] = col.Type;
      }

      if (conn.type === 'mysql') {
        // MySQL：纯兼容格式，无列名、无引号
        insertSQL = dataResult.rows.map(row => {
          const vals = columns.map(c => mysqlFormatInsertValue(row[c], colTypeMap[c] || ''));
          return `INSERT INTO ${tableName} VALUES (${vals.join(', ')});`;
        }).join('\n');
      } else {
        insertSQL = dataResult.rows.map(row => {
          const vals = columns.map(c => {
            let val = row[c];
            if (val === null || val === undefined) return 'NULL';
            // 日期字段：强制转换为 YYYY-MM-DD 纯字符串格式
            if (isDateColumnType(colTypeMap[c] || '')) {
              val = formatDateValue(val);
            }
            if (typeof val === 'number') return String(val);
            if (typeof val === 'boolean') return val ? '1' : '0';
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          return `INSERT INTO ${quote}${tableName}${quote} VALUES (${vals.join(', ')});`;
        }).join('\n');
      }
    }

    const sqlContent = createSQL + insertSQL;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(tableName)}.sql"`);
    res.send(sqlContent);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 导出数据库为 SQL
router.post('/export-database-sql', async (req, res) => {
  const { database, exportMode } = req.body;
  const includeCreate = exportMode !== 'dataOnly'; // 默认完整导出

  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);
    const tables = await dbManager.getTables(database || conn.config.database);
    // 根据数据库类型决定标识符引号（仅非 MySQL 使用）
    const quote = conn.type === 'mysql' ? '`' : '"';
    let fullSQL = `-- 数据库导出: ${database || conn.config.database}\n-- 导出模式: ${includeCreate ? '完整导出（含建表语句）' : '仅数据导出'}\n-- 导出时间: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}\n\n`;

    for (const tableName of tables) {
      // 获取表结构
      let structure;
      try {
        structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
      } catch (e) {
        structure = [];
      }

      // 建表语句（仅完整导出模式）
      if (includeCreate) {
        let dropSQL = `DROP TABLE IF EXISTS ${quote}${tableName}${quote};`;

        if (conn.type === 'mysql') {
          const [rows] = await conn.pool.query(`SHOW CREATE TABLE \`${tableName}\``);
          fullSQL += dropSQL + '\n' + rows[0]['Create Table'] + ';\n\n';
        } else if (conn.type === 'sqlite') {
          const { rows } = await dbManager.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
          fullSQL += dropSQL + '\n' + (rows[0]?.sql || '') + ';\n\n';
        } else if (conn.type === 'postgresql') {
          fullSQL += dropSQL + '\nCREATE TABLE ' + quote + tableName + quote + ' (\n';
          const colDefs = structure.map(col => {
            let def = `  ${quote}${col.Field}${quote} ${col.Type}`;
            if (col.Null === 'NO') def += ' NOT NULL';
            if (col.Default !== null && col.Default !== undefined) def += ` DEFAULT ${col.Default}`;
            return def;
          });
          fullSQL += colDefs.join(',\n');
          if (structure.some(c => c.Key === 'PRI')) {
            const pkCols = structure.filter(c => c.Key === 'PRI').map(c => `${quote}${c.Field}${quote}`);
            fullSQL += ',\n  PRIMARY KEY (' + pkCols.join(', ') + ')';
          }
          fullSQL += '\n);\n\n';
        }
      }

      // 获取数据
      let dataResult;
      if (conn.type === 'mysql') {
        const [rows] = await conn.pool.query(`SELECT * FROM \`${tableName}\``);
        dataResult = { rows };
      } else if (conn.type === 'postgresql') {
        dataResult = await conn.pool.query(`SELECT * FROM "${tableName}"`);
      } else if (conn.type === 'sqlite') {
        const stmt = conn.sqlite.prepare(`SELECT * FROM "${tableName}"`);
        dataResult = { rows: stmt.all() };
      }

      // 格式化日期字段
      dataResult.rows = formatDateFields(dataResult.rows, structure);

      if (dataResult.rows.length > 0) {
        const columns = Object.keys(dataResult.rows[0]);
        // 构建列名到类型的映射
        const colTypeMap = {};
        for (const col of structure) {
          colTypeMap[col.Field] = col.Type;
        }

        if (conn.type === 'mysql') {
          // MySQL：纯兼容格式，无列名、无引号
          for (const row of dataResult.rows) {
            const vals = columns.map(c => mysqlFormatInsertValue(row[c], colTypeMap[c] || ''));
            fullSQL += `INSERT INTO ${tableName} VALUES (${vals.join(', ')});\n`;
          }
        } else {
          for (const row of dataResult.rows) {
            const vals = columns.map(c => {
              let val = row[c];
              if (val === null || val === undefined) return 'NULL';
              if (isDateColumnType(colTypeMap[c] || '')) {
                val = formatDateValue(val);
              }
              if (typeof val === 'number') return String(val);
              if (typeof val === 'boolean') return val ? '1' : '0';
              return `'${String(val).replace(/'/g, "''")}'`;
            });
            fullSQL += `INSERT INTO ${quote}${tableName}${quote} VALUES (${vals.join(', ')});\n`;
          }
        }
        fullSQL += '\n';
      }
    }

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(database || 'database')}.sql"`);
    res.send(fullSQL);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ============ 导入 ============

// 导入 CSV 文件
router.post('/import-csv', upload.single('file'), async (req, res) => {
  const { database, tableName } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) {
    return res.json({ success: false, error: '没有活跃连接' });
  }

  try {
    if (database) await dbManager.switchDatabase(database);

    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    // 去除 BOM
    const cleanContent = fileContent.replace(/^\uFEFF/, '');
    const records = csvParse(cleanContent);

    if (records.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.json({ success: false, error: 'CSV 文件为空' });
    }

    const columns = Object.keys(records[0]);
    let imported = 0;

    for (const record of records) {
      const values = columns.map(c => {
        const val = record[c];
        return (val === '' || val === undefined) ? null : val;
      });
      const placeholders = values.map(() => '?').join(', ');

      let sql;
      if (conn.type === 'mysql') {
        sql = `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${placeholders})`;
      } else {
        sql = `INSERT INTO "${tableName}" ("${columns.join('", "')}") VALUES (${placeholders})`;
      }

      await dbManager.query(sql, values);
      imported++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, imported, total: records.length });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.json({ success: false, error: err.message });
  }
});

// 导入 SQL 文件
router.post('/import-sql', upload.single('file'), async (req, res) => {
  const { database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) {
    return res.json({ success: false, error: '没有活跃连接' });
  }

  try {
    if (database) await dbManager.switchDatabase(database);

    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    const results = await dbManager.executeMultiple(fileContent);

    fs.unlinkSync(req.file.path);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    res.json({
      success: true,
      total: results.length,
      successCount,
      failCount,
      results
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
