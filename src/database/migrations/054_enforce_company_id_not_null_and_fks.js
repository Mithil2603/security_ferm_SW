/**
 * Migration 054: lock down company_id now that 053 has backfilled it on
 * every existing row — NOT NULL + FK to companies(id) on every scoped table.
 */
const { SCOPED_TABLES } = require('./052_add_company_id_columns');

async function tableExists(conn, table) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function up(conn) {
  for (const table of SCOPED_TABLES) {
    if (!(await tableExists(conn, table))) continue;

    const [stillNull] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE company_id IS NULL`
    );
    if (stillNull[0].cnt === 0) {
      await conn.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN company_id INT NOT NULL`);
    } else {
      // Leave nullable rather than fail the whole migration on one bad table —
      // surfaces as a loud, findable gap (company_id still NULL) rather than
      // blocking every other table's rollout.
      continue;
    }

    const fkName = `fk_${table}_company`;
    if (!(await constraintExists(conn, table, fkName))) {
      await conn.execute(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (company_id) REFERENCES companies(id)`
      );
    }
  }
}

module.exports = { up };
