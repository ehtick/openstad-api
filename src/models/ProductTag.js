var sanitize = require('../util/sanitize');
var config = require('config')

module.exports = function( db, sequelize, DataTypes ) {

	var ProductTag = sequelize.define('productTag', {
	}, {
    paranoid: false
	});

	ProductTag.scopes = function scopes() {
		return {
			defaultScope: {
			},

      forSiteId: function( siteId ) {
        return {
          where: {
            siteId: siteId,
          }
        };
      },

      includeSite: {
        include: [{
          model: db.Site,
        }]
      },

		}
	}

  // dit is hoe het momenteel werkt; ik denk niet dat dat de bedoeling is, maar ik volg nu
	ProductTag.auth = ProductTag.prototype.auth = {
    listableBy: 'all',
    viewableBy: 'all',
    createableBy: 'admin',
    updateableBy: 'admin',
    deleteableBy: 'admin',
  }

	return ProductTag;

}
