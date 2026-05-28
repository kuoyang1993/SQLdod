const express = require('express');
const router = express.Router();
const dbManager = require('../db');

// 创建表
router.post('/create', async (req, res) => {
  const { tableName, columns, foreignKeys, database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    // 用反引号/双引号包裹标识符的辅助函数
    const quote = (name) => {
      if (conn.type === 'mysql') return `\`${name}\``;
      return `"${name}"`;
    };

    const columnDefs = columns.map(col => {
      let def = '';
      const name = col.name;

      if (conn.type === 'mysql') {
        def = `\`${name}\` ${col.type}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
        if (col.notNull) def += ' NOT NULL';
        if (col.primary) def += ' PRIMARY KEY';
        if (col.autoIncrement) def += ' AUTO_INCREMENT';
        if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
          def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue.replace(/'/g, "\\'")}'` : col.defaultValue}`;
        }
        if (col.comment) def += ` COMMENT '${col.comment.replace(/'/g, "\\'")}'`;
      } else if (conn.type === 'postgresql') {
        const pgType = mapToPgType(col.type);
        def = `"${name}" ${pgType}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
        if (col.notNull) def += ' NOT NULL';
        if (col.primary) def += ' PRIMARY KEY';
        if (col.autoIncrement) {
          if (col.type === 'INT' || col.type === 'INTEGER' || col.type === 'BIGINT') {
            def = `"${name}" SERIAL`;
            if (col.primary) def += ' PRIMARY KEY';
            if (col.notNull) def += ' NOT NULL';
          }
        }
        if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
          def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue.replace(/'/g, "''")}'` : col.defaultValue}`;
        }
      } else if (conn.type === 'sqlite') {
        def = `"${name}" ${col.type}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
        if (col.primary) def += ' PRIMARY KEY';
        if (col.autoIncrement) def += ' AUTOINCREMENT';
        if (col.notNull) def += ' NOT NULL';
        if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
          def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue.replace(/'/g, "''")}'` : col.defaultValue}`;
        }
      }

      return def;
    });

    // 外键约束定义
    const fkDefs = [];
    if (foreignKeys && foreignKeys.length > 0) {
      foreignKeys.forEach((fk, idx) => {
        const fkName = `fk_${tableName}_${fk.column}`;
        let fkSql;
        if (conn.type === 'mysql') {
          fkSql = `CONSTRAINT \`${fkName}\` FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\` (\`${fk.refField}\`)`;
          if (fk.onDelete) fkSql += ` ON DELETE ${fk.onDelete}`;
          if (fk.onUpdate) fkSql += ` ON UPDATE ${fk.onUpdate}`;
        } else if (conn.type === 'postgresql') {
          fkSql = `CONSTRAINT "${fkName}" FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}" ("${fk.refField}")`;
          if (fk.onDelete) fkSql += ` ON DELETE ${fk.onDelete}`;
          if (fk.onUpdate) fkSql += ` ON UPDATE ${fk.onUpdate}`;
        } else if (conn.type === 'sqlite') {
          fkSql = `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}"("${fk.refField}")`;
          if (fk.onDelete) fkSql += ` ON DELETE ${fk.onDelete}`;
          if (fk.onUpdate) fkSql += ` ON UPDATE ${fk.onUpdate}`;
        }
        if (fkSql) fkDefs.push(fkSql);
      });
    }

    // 根据数据库类型使用正确的标识符引号
    let tableIdentifier;
    if (conn.type === 'mysql') {
      tableIdentifier = `\`${tableName}\``;
    } else if (conn.type === 'postgresql' || conn.type === 'sqlite') {
      tableIdentifier = `"${tableName}"`;
    } else {
      tableIdentifier = `"${tableName}"`;
    }

    // SQLite 需要手动开启外键约束
    if (conn.type === 'sqlite' && fkDefs.length > 0) {
      await dbManager.query('PRAGMA foreign_keys = ON');
    }

    const allDefs = [...columnDefs, ...fkDefs];
    const sql = `CREATE TABLE ${tableIdentifier} (${allDefs.join(', ')})`;
    console.log('[CREATE TABLE] 生成的完整SQL:', sql);
    await dbManager.query(sql);

    const tables = await dbManager.getTables(database || conn.config.database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 修改表 - 获取表结构用于设计
router.get('/design/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);
    const structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
    res.json({ success: true, structure });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 修改表 - 执行 ALTER
router.post('/alter', async (req, res) => {
  const { tableName, database, operations } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    for (const op of operations) {
      if (op.action === 'addColumn') {
        const col = op.column;
        let def = '';
        if (conn.type === 'mysql') {
          def = `\`${col.name}\` ${col.type}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
          if (col.notNull) def += ' NOT NULL';
          if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue}'` : col.defaultValue}`;
          }
          if (col.comment) def += ` COMMENT '${col.comment}'`;
          await dbManager.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${def}`);
        } else if (conn.type === 'postgresql') {
          const pgType = mapToPgType(col.type);
          def = `"${col.name}" ${pgType}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
          if (col.notNull) def += ' NOT NULL';
          if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue}'` : col.defaultValue}`;
          }
          await dbManager.query(`ALTER TABLE "${tableName}" ADD COLUMN ${def}`);
        } else if (conn.type === 'sqlite') {
          def = `"${col.name}" ${col.type}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
          if (col.notNull) def += ' NOT NULL';
          if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue}'` : col.defaultValue}`;
          }
          await dbManager.query(`ALTER TABLE "${tableName}" ADD COLUMN ${def}`);
        }
      } else if (op.action === 'dropColumn') {
        if (conn.type === 'mysql') {
          await dbManager.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${op.columnName}\``);
        } else if (conn.type === 'postgresql') {
          await dbManager.query(`ALTER TABLE "${tableName}" DROP COLUMN "${op.columnName}"`);
        } else if (conn.type === 'sqlite') {
          // SQLite 不支持直接删除列，需要用重建表的方式
          throw new Error('SQLite 不支持直接删除列，请使用重建表的方式');
        }
      } else if (op.action === 'modifyColumn') {
        const col = op.column;
        if (conn.type === 'mysql') {
          let def = `\`${col.oldName || col.name}\` ${col.type}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
          if (col.notNull) def += ' NOT NULL';
          if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue}'` : col.defaultValue}`;
          }
          if (col.comment) def += ` COMMENT '${col.comment}'`;
          const targetName = col.oldName || col.name;
          await dbManager.query(`ALTER TABLE \`${tableName}\` MODIFY COLUMN ${def}`);
          if (col.oldName && col.name !== col.oldName) {
            await dbManager.query(`ALTER TABLE \`${tableName}\` RENAME COLUMN \`${col.oldName}\` TO \`${col.name}\``);
          }
        } else if (conn.type === 'postgresql') {
          const pgType = mapToPgType(col.type);
          let def = `${pgType}${col.length ? '(' + col.length + (col.decimals ? ',' + col.decimals : '') + ')' : ''}`;
          if (col.notNull) def += ' NOT NULL';
          if (col.defaultValue !== '' && col.defaultValue !== null && col.defaultValue !== undefined) {
            def += ` DEFAULT ${isNaN(col.defaultValue) ? `'${col.defaultValue}'` : col.defaultValue}`;
          }
          const targetName = col.oldName || col.name;
          await dbManager.query(`ALTER TABLE "${tableName}" ALTER COLUMN "${targetName}" TYPE ${def}`);
          if (col.oldName && col.name !== col.oldName) {
            await dbManager.query(`ALTER TABLE "${tableName}" RENAME COLUMN "${col.oldName}" TO "${col.name}"`);
          }
        }
      }
    }

    const tables = await dbManager.getTables(database || conn.config.database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 删除表
router.post('/drop', async (req, res) => {
  const { tableName, database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    if (conn.type === 'mysql') {
      await dbManager.query(`DROP TABLE \`${tableName}\``);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`DROP TABLE "${tableName}"`);
    } else if (conn.type === 'sqlite') {
      await dbManager.query(`DROP TABLE IF EXISTS "${tableName}"`);
    }

    const tables = await dbManager.getTables(database || conn.config.database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 重命名表
router.post('/rename', async (req, res) => {
  const { oldName, newName, database } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    if (conn.type === 'mysql') {
      await dbManager.query(`RENAME TABLE \`${oldName}\` TO \`${newName}\``);
    } else if (conn.type === 'postgresql' || conn.type === 'sqlite') {
      await dbManager.query(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
    }

    const tables = await dbManager.getTables(database || conn.config.database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 获取表结构
router.get('/structure/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);
    const structure = await dbManager.getTableStructure(database || conn.config.database, tableName);
    res.json({ success: true, structure });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==================== 外键管理 ====================

// 获取表的外键列表
router.get('/foreign-keys/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    let foreignKeys = [];

    if (conn.type === 'mysql') {
      const { rows } = await dbManager.query(`
        SELECT 
          CONSTRAINT_NAME as constraintName,
          COLUMN_NAME as columnName,
          REFERENCED_TABLE_NAME as refTable,
          REFERENCED_COLUMN_NAME as refColumn,
          DELETE_RULE as deleteRule,
          UPDATE_RULE as updateRule
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [database, tableName]);
      foreignKeys = rows;
    } else if (conn.type === 'postgresql') {
      const { rows } = await dbManager.query(`
        SELECT
          tc.constraint_name AS "constraintName",
          kcu.column_name AS "columnName",
          ccu.table_name AS "refTable",
          ccu.column_name AS "refColumn",
          rc.delete_rule AS "deleteRule",
          rc.update_rule AS "updateRule"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
      `, [tableName]);
      foreignKeys = rows;
    } else if (conn.type === 'sqlite') {
      const { rows } = await dbManager.query(`PRAGMA foreign_key_list("${tableName}")`);
      foreignKeys = rows.map(r => ({
        constraintName: `fk_${tableName}_${r.from}`,
        columnName: r.from,
        refTable: r.table,
        refColumn: r.to,
        deleteRule: r.on_delete || 'NO ACTION',
        updateRule: r.on_update || 'NO ACTION'
      }));
    }

    res.json({ success: true, foreignKeys });
  } catch (err) {
    res.json({ success: false, error: err.message, foreignKeys: [] });
  }
});

// 添加外键
router.post('/foreign-key/add', async (req, res) => {
  const { tableName, database, column, refTable, refColumn, onDelete, onUpdate } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    const constraintName = `fk_${tableName}_${column}`;

    if (conn.type === 'mysql') {
      let sql = `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\` (\`${refColumn}\`)`;
      if (onDelete) sql += ` ON DELETE ${onDelete}`;
      if (onUpdate) sql += ` ON UPDATE ${onUpdate}`;
      await dbManager.query(sql);
    } else if (conn.type === 'postgresql') {
      let sql = `ALTER TABLE "${tableName}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY ("${column}") REFERENCES "${refTable}" ("${refColumn}")`;
      if (onDelete) sql += ` ON DELETE ${onDelete}`;
      if (onUpdate) sql += ` ON UPDATE ${onUpdate}`;
      await dbManager.query(sql);
    } else if (conn.type === 'sqlite') {
      // SQLite 不支持 ALTER TABLE ADD CONSTRAINT，需要重建表
      throw new Error('SQLite 不支持直接添加外键约束，请通过重建表的方式添加');
    }

    res.json({ success: true, message: '外键添加成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 删除外键
router.post('/foreign-key/drop', async (req, res) => {
  const { tableName, database, constraintName } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    if (conn.type === 'mysql') {
      await dbManager.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`ALTER TABLE "${tableName}" DROP CONSTRAINT "${constraintName}"`);
    } else if (conn.type === 'sqlite') {
      throw new Error('SQLite 不支持直接删除外键约束');
    }

    res.json({ success: true, message: '外键删除成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==================== 触发器管理 ====================

// 获取表的触发器列表
router.get('/triggers/:tableName', async (req, res) => {
  const { tableName } = req.params;
  const { database } = req.query;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    let triggers = [];

    if (conn.type === 'mysql') {
      const { rows } = await dbManager.query(`SHOW TRIGGERS WHERE \`Table\` = ?`, [tableName]);
      triggers = rows.map(r => ({
        name: r.Trigger,
        timing: r.Timing,
        event: r.Event,
        statement: r.Statement
      }));
    } else if (conn.type === 'postgresql') {
      const { rows } = await dbManager.query(`
        SELECT 
          trigger_name AS name,
          action_timing AS timing,
          event_manipulation AS event,
          action_statement AS statement
        FROM information_schema.triggers
        WHERE event_object_table = $1
        ORDER BY trigger_name
      `, [tableName]);
      triggers = rows;
    } else if (conn.type === 'sqlite') {
      const { rows } = await dbManager.query(`SELECT name, sql as statement FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`, [tableName]);
      triggers = rows.map(r => {
        let timing = 'BEFORE';
        let event = 'INSERT';
        const upperSql = (r.statement || '').toUpperCase();
        if (upperSql.includes('AFTER')) timing = 'AFTER';
        if (upperSql.includes('BEFORE')) timing = 'BEFORE';
        if (upperSql.includes('DELETE')) event = 'DELETE';
        if (upperSql.includes('UPDATE')) event = 'UPDATE';
        if (upperSql.includes('INSERT')) event = 'INSERT';
        return {
          name: r.name,
          timing,
          event,
          statement: r.statement || ''
        };
      });
    }

    res.json({ success: true, triggers });
  } catch (err) {
    res.json({ success: false, error: err.message, triggers: [] });
  }
});

// 创建触发器
router.post('/trigger/create', async (req, res) => {
  const { tableName, database, triggerName, timing, event, body } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    let sql;
    if (conn.type === 'mysql') {
      sql = `CREATE TRIGGER \`${triggerName}\` ${timing} ${event} ON \`${tableName}\` FOR EACH ROW ${body}`;
    } else if (conn.type === 'postgresql') {
      // PostgreSQL 触发器需要先创建函数
      sql = `
        CREATE OR REPLACE FUNCTION trigger_func_${triggerName}() RETURNS TRIGGER AS $$
        ${body}
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER "${triggerName}" ${timing} ${event} ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION trigger_func_${triggerName}();
      `;
    } else if (conn.type === 'sqlite') {
      sql = `CREATE TRIGGER "${triggerName}" ${timing} ${event} ON "${tableName}" FOR EACH ROW ${body}`;
    }

    await dbManager.query(sql);
    res.json({ success: true, message: '触发器创建成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 更新触发器
router.post('/trigger/update', async (req, res) => {
  const { tableName, database, triggerName, oldTriggerName, timing, event, body } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    // 先删除旧触发器
    if (conn.type === 'mysql') {
      await dbManager.query(`DROP TRIGGER IF EXISTS \`${oldTriggerName}\``);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`DROP TRIGGER IF EXISTS "${oldTriggerName}" ON "${tableName}"`);
      await dbManager.query(`DROP FUNCTION IF EXISTS trigger_func_${oldTriggerName}()`);
    } else if (conn.type === 'sqlite') {
      await dbManager.query(`DROP TRIGGER IF EXISTS "${oldTriggerName}"`);
    }

    // 再创建新触发器
    let sql;
    if (conn.type === 'mysql') {
      sql = `CREATE TRIGGER \`${triggerName}\` ${timing} ${event} ON \`${tableName}\` FOR EACH ROW ${body}`;
    } else if (conn.type === 'postgresql') {
      sql = `
        CREATE OR REPLACE FUNCTION trigger_func_${triggerName}() RETURNS TRIGGER AS $$
        ${body}
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER "${triggerName}" ${timing} ${event} ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION trigger_func_${triggerName}();
      `;
    } else if (conn.type === 'sqlite') {
      sql = `CREATE TRIGGER "${triggerName}" ${timing} ${event} ON "${tableName}" FOR EACH ROW ${body}`;
    }

    await dbManager.query(sql);
    res.json({ success: true, message: '触发器更新成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 删除触发器
router.post('/trigger/drop', async (req, res) => {
  const { tableName, database, triggerName } = req.body;
  const conn = dbManager.getActiveConnection();
  if (!conn) return res.json({ success: false, error: '没有活跃连接' });

  try {
    if (database) await dbManager.switchDatabase(database);

    if (conn.type === 'mysql') {
      await dbManager.query(`DROP TRIGGER IF EXISTS \`${triggerName}\``);
    } else if (conn.type === 'postgresql') {
      await dbManager.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${tableName}"`);
      await dbManager.query(`DROP FUNCTION IF EXISTS trigger_func_${triggerName}()`);
    } else if (conn.type === 'sqlite') {
      await dbManager.query(`DROP TRIGGER IF EXISTS "${triggerName}"`);
    }

    res.json({ success: true, message: '触发器删除成功' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// PostgreSQL 类型映射
function mapToPgType(mysqlType) {
  const typeMap = {
    'INT': 'INTEGER',
    'INTEGER': 'INTEGER',
    'BIGINT': 'BIGINT',
    'SMALLINT': 'SMALLINT',
    'TINYINT': 'SMALLINT',
    'VARCHAR': 'VARCHAR',
    'CHAR': 'CHAR',
    'TEXT': 'TEXT',
    'LONGTEXT': 'TEXT',
    'MEDIUMTEXT': 'TEXT',
    'DATE': 'DATE',
    'DATETIME': 'TIMESTAMP',
    'TIMESTAMP': 'TIMESTAMP',
    'TIME': 'TIME',
    'FLOAT': 'REAL',
    'DOUBLE': 'DOUBLE PRECISION',
    'DECIMAL': 'DECIMAL',
    'NUMERIC': 'NUMERIC',
    'BOOLEAN': 'BOOLEAN',
    'BOOL': 'BOOLEAN',
    'BLOB': 'BYTEA',
    'LONGBLOB': 'BYTEA',
    'JSON': 'JSON'
  };
  return typeMap[mysqlType.toUpperCase()] || mysqlType.toUpperCase();
}

module.exports = router;
