const convertDbPolygonToLatLng = require ('../util/convert-db-polygon-to-lat-lng');
const {formatPolygonToGeoJson} = require('../util/geo-json-formatter');

module.exports = function( db, sequelize, DataTypes ) {
    var ActionRun = sequelize.define('action_log', {
        status: {
            type         : DataTypes.ENUM('success', 'error', 'info'),
            defaultValue : 'info',
            allowNull    : false
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        type: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        email: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        userId : {
            type         : DataTypes.INTEGER,
            defaultValue : 0,
        },

        actionId : {
            type         : DataTypes.INTEGER,
            defaultValue : 0,
        },

        extraData : {
            type: DataTypes.JSON,
            allowNull : true,
            defaultValue : {},
        }
    });

    ActionRun.associate = function( models ) {
        this.belongsTo(models.User);
    }

    ActionRun.auth = Event.prototype.auth = {
        listableBy: 'admin',
        viewableBy: 'admin',
        createableBy: ['editor','owner', 'admin'],
        updateableBy: ['editor','owner', 'admin'],
        deleteableBy: ['editor','owner', 'admin'],
        toAuthorizedJSON: function(user, data) {
            return data;
        }
    }


    return Event;
}
