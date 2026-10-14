const fs = require('fs');
const path = require('path');

function loadSample() {
  const dir = path.join(__dirname, '..', 'samples');
  return {
    name: 'Legacy customers to CRM',
    sourceCsv: fs.readFileSync(path.join(dir, 'legacy_customers.csv'), 'utf8'),
    targetSchema: JSON.parse(fs.readFileSync(path.join(dir, 'target_schema.json'), 'utf8')),
    keyField: 'customer_id'
  };
}

module.exports = { loadSample };
