let db = require('../src/db').sequelize;

module.exports = {
  up: function() {
    try {
      return db.query(`
        DROP TABLE externalSites;
			`);
    } catch(e) {
      return true;
    }
  }
}
