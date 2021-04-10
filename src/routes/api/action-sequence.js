const db = require('../../db');
const auth = require('../../middleware/sequelize-authorization-middleware');
const pagination = require('../../middleware/pagination');
const searchResults = require('../../middleware/search-results');
const convertDbPolygonToLatLng = require('../../util/convert-db-polygon-to-lat-lng');
const {formatGeoJsonToPolygon} = require('../../util/geo-json-formatter');

const router = require('express-promise-router')({ mergeParams: true });
var createError = require('http-errors');

// scopes: for all get requests
router
    .all('*', function(req, res, next) {
        req.scope = ['api'];
        req.scope.push('includeSite');
        return next();
    });

router.route('/')
    .get(auth.can('Area', 'list'))
    .get(pagination.init)
    .get(function(req, res, next) {
        let { dbQuery } = req;

        return db.Area
            .findAndCountAll(dbQuery)
            .then(function(result) {
                req.results = result.rows || [];
                req.dbQuery.count = result.count;
                return next();
            })
            .catch(next);
    })
    .get(searchResults)
    .get(pagination.paginateResults)
    .get(function(req, res, next) {
        res.json(req.results);
    })

    // Persist an area
    .post(auth.can('Area', 'create'))
    .post(function(req, res, next) {
        // if geodata is set transform to polygon format this api expects
        if (req.body.geoJSON) {
            req.body.polygon = formatGeoJsonToPolygon(req.body.geoJSON);
        }

        next();
    })
    .post(function(req, res, next) {
        if (!req.body.name) return next(createError(401, 'Geen naam opgegeven'));
        if (!req.body.polygon) return next(createError(401, 'Geen polygoon opgegeven'));
        return next();
    })
    .post(function(req, res, next) {
        db.Area
            .create(req.body)
            .catch((err) => {
                console.log('errr', err);
                next(err);
            })
            .then(function(result) {
                res.json({ success: true, id: result.id });
            });
    });

router.route('/:actionSequenceId(\\d+)')
    .all(function(req, res, next) {
        const actionSequenceId = parseInt(req.params.actionSequenceId) || 1;

        db.ActionSequence
            .findOne({
                // where: { id: areaId, siteId: req.params.siteId }
                where: { id: actionSequenceId },
            })
            .then(found => {
                if (!found) throw new Error('Action Sequence not found for id: ' + actionSequenceId);

                req.actionSequence = found;
                req.results = req.area;
                next();
            })
            .catch((err) => {
                console.log('errr', err);
                next(err);
            });
    })

    // view area
    // ---------
    // .get(auth.can('area', 'view'))
    .get(async (req, res, next) => {
        const actions = await db.Action.findAll({
            where: {
                actionSequenceId: parseInt(req.params.actionSequenceId)
            },
            order: [ [ 'priority', 'DESC' ], [ 'createdAt', 'DESC' ]],
        });

        if (actions && actions.length > 0) {
            for (var i; i < actions.length; i++) {
                const action = actions[i];

                const actionType = db.Actions.types.find(actionType => actionType.name === action.type);

                if (!actionType) {
                    throw new Error(`Action type ${action.type} not found in ActionSequence with id ${self.id}`);
                }

                const lastRunDate = new Date().toISOString().slice(0, 19).replace('T', ' ');

                const actionRun = async (selectedResource) => {
                    try {
                        // cron runs req, res will be empty, this will cause request actions to fail in case people try to run them as cron
                        // which is perfectly fine, the act method should properly display an error here.
                        await actionType.act(action, selectedResource, req, res);

                        await db.ActionLog.create({
                            actionId: action.id,
                            settings: settings,
                            status: 'success'
                        });
                    } catch (e) {
                        await db.ActionLog.create({
                            actionId: action.id,
                            settings: settings,
                            status: 'error'
                        });
                    }
                }

                const selectionToActUpon = await action.getSelection(lastRunDate);

                if (selectionToActUpon.length > 0) {
                    for (var j; j < selectionToActUpon.length; j++) {
                        await actionRun(selectionToActUpon[j]);
                    }
                } else {
                    await actionRun([]);
                }

            }
        }
    })

module.exports = router;
