require('dotenv').config();
const { query } = require('../src/db');

(async () => {
  const rows = await query(`
    SELECT
      DB_NAME() AS db,
      SYSTEM_USER AS usr,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE') AS tables,
      (SELECT COUNT(*) FROM [Vecsa Hidalgo$Sales Invoice Header]) AS sales_invoices
  `);
  console.log(JSON.stringify(rows[0], null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
