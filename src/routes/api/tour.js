const Promise = require('bluebird');
const Sequelize = require('sequelize');
const express = require('express');
const moment = require('moment');
const createError = require('http-errors')
const config = require('config');
const db = require('../../db');
const auth = require('../../middleware/sequelize-authorization-middleware');
const mail = require('../../lib/mail');
const pagination = require('../../middleware/pagination');
const {Op} = require('sequelize');
const Pusher = require("pusher");


const router = express.Router({mergeParams: true});

// scopes: for all get requests
/*
router
	.all('*', function(req, res, next) {
		next();
	})
*/

router
  .all('*', function (req, res, next) {
    req.scope = [];
    //	if ()
    //	req.scope = ['includeTags'];
    req.scope.push({method: ['forSiteId', req.params.siteId]});

    if (req.query.userId) {
      req.scope.push({method: ['forUserId', req.query.userId]});
    }
    next();
  });

router.route('/')

  // list users
  // ----------
  .get(auth.can('Tour', 'list'))
  .get(pagination.init)
  .get(function (req, res, next) {
    const {dbQuery} = req;

    dbQuery.where = {
      ...req.queryConditions,
      ...dbQuery.where,
    };

    db.Tour
      .scope(...req.scope)
      .findAndCountAll(dbQuery)
      .then(function (result) {
        req.results = result.rows;
        req.dbQuery.count = result.count;
        return next();
      })
      .catch(next);
  })
  .get(auth.useReqUser)
  //	.get(searchResults)
  .get(pagination.paginateResults)
  .get(function (req, res, next) {
    res.json(req.results);
  })

  // create
  // -----------
  .post(auth.can('Tour', 'create'))
  .post(function (req, res, next) {
    if (!req.site) return next(createError(403, 'Site niet gevonden'));
    return next();
  })
  .post(function (req, res, next) {
    if (!(req.site.config && req.site.config.tour && req.site.config.tour.canCreateNewTours)) return next(createError(403, 'Tour mogen niet aangemaakt worden'));
    return next();
  })
  /**
   * Check which accountId should be added
   */
  .post(function (req, res, next) {
    const siteTourConfig = req.site && req.site.config && req.site.config.tour ? req.site.config.tour : {};

    // if site has fixed to one accountId make it static
    if (siteTourConfig.fixedAccountId) {
      req.body.accountId = siteTourConfig.fixedAccountId;
      next();
      // tours and accounts can be created with an account
    } else if (siteTourConfig.allowNotAuthenticatedAccount && req.body.accountHash) {
      db.Account
        .findOne({
          where: {
            accountHash: accountHash
          }
        })
        .then((account) => {
          req.body.accountId = account.id;
          req.account = account;
          next();
        })
        .catch((err) => {
          next(err)
        });
    } else if (req.user) {
      req.body.accountId = req.user.accountId;
      next();
    }


  })
  .post(function (req, res, next) {
    console.log('create', req.body);

    const data = {
      ...req.body,
      userId: req.user.id
    }

    db.Tour
      .authorizeData(data, 'create', req.user)
      .create(data)
      .then(result => {
        console.log('result', result)

        req.results = result;
        next();
      })
      .catch(function (error) {
        console.log(error)
        // todo: dit komt uit de oude routes; maak het generieker
        if (typeof error == 'object' && error instanceof Sequelize.ValidationError) {
          let errors = [];
          error.errors.forEach(function (error) {
            errors.push(error.message);
          });
          res.status(422).json(errors);
        } else {
          next(error);
        }
      });
  })
  .post(function (req, res, next) {
    if (!req.body.tags) return next();

    let instance = req.results;

    instance
      .setTags(req.body.tags)
      .then((instance) => {
        console.log('updated')
        return next();
      })
      .catch((err) => {
        console.log('errr', err);
        next(err);
      });
  })
  .post(auth.useReqUser)
  .post(function (req, res, next) {
    console.log('req.results', req.results)
    res.json(req.results);
    //mail.sendThankYouMail(req.results, req.user, req.site) // todo: optional met config?
  })


// one user
// --------
router.route('/:tourId(\\d+)')
  .all(function (req, res, next) {
    const tourId = parseInt(req.params.tourId);

    db.Tour
      .scope(...req.scope)
      .findOne({
        where: {id: tourId}
      })
      .then(found => {
        if (!found) throw new Error('tour not found');
        req.results = found;
        next();
      })
      .catch(next);


  })

  // view idea
  // ---------
  .get(auth.can('Tour', 'view'))
  .get(auth.useReqUser)
  .get(function (req, res, next) {
    //
    if (req.query.resource) {
      const revisions = req.results.revisions;
      const latestRevision = revisions && revisions.length > 0 && revisions[revisions.length - 1] && revisions[revisions.length - 1] ? revisions[revisions.length - 1] : {};
      const resources = latestRevision && latestRevision.resources ? latestRevision.resources : [];
      const resourceData = resources.find(resource => resource.name === req.query.resource);

      res.json(resourceData ? resourceData : [])
    } else {
      res.json(req.results);
    }
  })

  // update user
  // -----------
  .put(auth.useReqUser)
  .put(function (req, res, next) {
    const tour = req.results;

    if (!(tour && tour.can && tour.can('update'))) return next(new Error('You cannot update this tour'));
    //	console.log('333', req.user.role)

    let data = {
      ...req.body,
    }

    tour
      //  .authorizeData(data, 'update')
      .update(data)
      .then(async (result) => {

        const pusher = new Pusher({
          appId: "1254886",
          key: "0dbd27bc173d515e4499",
          secret: "c2395c84ee290c1286d8",
          cluster: "eu",
          useTLS: true
        });

        const response = await pusher.trigger('editor-update', 'editor-refresh-resources', {
          resources: req.query.resourcesChanged,
          editorSession: req.query.editorSession
        });

        req.results = result;

        next()
      })
      .catch(next);
  })
  .put(function (req, res, next) {
    res.json(req.results);
  })
  // delete idea
  // ---------
  .delete(auth.can('Tour', 'delete'))
  .delete(function (req, res, next) {
    req.results
      .destroy()
      .then(() => {
        res.json({"tour": "deleted"});
      })
      .catch(next);
  })

router.route('/:tourId(\\d+)/publish')
  .all(function (req, res, next) {
    const tourId = parseInt(req.params.tourId);

    db.Tour
      .scope(...req.scope)
      .findOne({
        where: {id: tourId}
      })
      .then(found => {
        if (!found) throw new Error('tour not found');
        req.results = found;
        next();
      })
      .catch(next);
  })
  .put(auth.useReqUser)
  .put(function (req, res, next) {
    const tour = req.results;

    if (!(tour && tour.can && tour.can('update'))) return next(new Error('You cannot update this tour'));
    //	console.log('333', req.user.role)

    let version = tour.get('versionNumber');
    version  = version ? version + 1 : 1;

    tour
      //  .authorizeData(data, 'update')
      .update({
        live: tour.get('revisions'),
        versionNumber: version,
        lastPublishedAt: db.sequelize.literal('NOW()'),
      })
      .then(async (result) => {
        req.results = result;
        next()
      })
      .catch(next);
  })
  .put(function (req, res, next) {
    res.json(req.results);
  })

module.exports = router;