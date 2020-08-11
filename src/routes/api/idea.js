const Sequelize 		= require('sequelize');
const express 			= require('express');
const moment				= require('moment');
const createError 	= require('http-errors')
const config 				= require('config');
const db 						= require('../../db');
const auth 					= require('../../middleware/sequelize-authorization-middleware');
const mail 					= require('../../lib/mail');
const pagination 		= require('../../middleware/pagination');
const searchResults = require('../../middleware/search-results');

const router = express.Router({mergeParams: true});

// scopes: for all get requests
router
	.all('*', function(req, res, next) {

		req.scope = ['api', 'includeArgsCount'];

		req.scope.push('includeSite');

		var sort = (req.query.sort || '').replace(/[^a-z_]+/i, '') || (req.cookies['idea_sort'] && req.cookies['idea_sort'].replace(/[^a-z_]+/i, ''));
		if (sort) {
			//res.cookie('idea_sort', sort, { expires: 0 });

			if (sort == 'votes_desc' || sort == 'votes_asc') {
				req.scope.push('includeVoteCount'); // het werkt niet als je dat in de sort scope functie doet...
			}
			req.scope.push({ method: ['sort', req.query.sort]});
		}

		if (req.query.mapMarkers) {
			req.scope.push('mapMarkers');
		}

		if (req.query.filters) {
			req.scope.push({ method: ['filter', req.query.filters]});
		}

		if (req.query.exclude) {
			req.scope.push({ method: ['exclude', req.query.exclude]});
		}

		if (req.query.running) {
			req.scope.push('selectRunning');
		}

		if (req.query.includeArguments) {
			req.scope.push({ method: ['includeArguments', req.user.id]});
		}

		if (req.query.includeTags) {
			req.scope.push('includeTags');
		}

		if (req.query.tags) {
      let tags = req.query.tags;
			req.scope.push({ method: ['selectTags', tags]});
			req.scope.push('includeTags');
		}

		if (req.query.includeMeeting) {
			req.scope.push('includeMeeting');
		}

		if (req.query.includePosterImage) {
			req.scope.push('includePosterImage');
		}

		if (req.query.includeUser) {
			req.scope.push('includeUser');
		}

		// in case the votes are archived don't use these queries
		// this means they can be cleaned up from the main table for performance reason
		if (!req.site.config.archivedVotes) {
			if (req.query.includeVoteCount && req.site && req.site.config && req.site.config.votes && req.site.config.votes.isViewable) {
				req.scope.push('includeVoteCount');
			}

			if (req.query.includeUserVote && req.site && req.site.config && req.site.config.votes && req.site.config.votes.isViewable && req.user && req.user.id) {
				// ik denk dat je daar niet het hele object wilt?
				req.scope.push({ method: ['includeUserVote', req.user.id]});
			}
		}

		// todo? volgens mij wordt dit niet meer gebruikt
		// if (req.query.highlighted) {
		//  	query = db.Idea.getHighlighted({ siteId: req.params.siteId })
		// }

		return next();

	})

router.route('/')

// list ideas
// ----------
	.get(auth.can('Idea', 'list'))
	.get(auth.useReqUser)
	.get(pagination.init)
	// add filters
	.get(function(req, res, next) {

		let queryConditions = req.queryConditions ? req.queryConditions : {};
		queryConditions = Object.assign(queryConditions, { siteId: req.params.siteId });

		db.Idea
			.scope(...req.scope)
			.findAndCountAll({ where: queryConditions, offset: req.pagination.offset, limit: req.pagination.limit })
			.then(function( result ) {
        req.results = result.rows;
        req.pagination.count = result.count;
        return next();
			})
			.catch(next);
	})
	.get(searchResults)
	.get(pagination.paginateResults)
	.get(function(req, res, next) {
		res.json(req.results);
  })

// create idea
// -----------
	.post(auth.can('Idea', 'create'))
	.post(function(req, res, next) {
		if (!req.site) return next(createError(401, 'Site niet gevonden'));
		return next();
	})
	.post(function( req, res, next ) {
		if (!(req.site.config && req.site.config.ideas && req.site.config.ideas.canAddNewIdeas)) return next(createError(401, 'Inzenden is gesloten'));
		return next();
	})
	.post(function(req, res, next) {

    try {
      req.body.location = JSON.parse(req.body.location || null);
    } catch(err) {}
    if ( typeof req.body.location == 'object' && !Object.keys(req.body.location).length ) req.body.location = undefined;

		const data = {
      ...req.body,
			siteId      : req.params.siteId,
			userId      : req.user.id,
		  startDate:  new Date(),
		}

    // TODO: dit moet ook nog ergens in auth
    if (auth.hasRole(req.user, 'editor')) {
      if (data.modBreak) {
        data.modBreakUserId = req.body.modBreakUserId = req.user.id;
        data.modBreakDate = req.body.modBreakDate = new Date().toString();
      } else {
        data.modBreak = '';
				data.modBreakUserId = null;
				data.modBreakDate = null;
      }
    }

    let responseData;
		db.Idea
			.authorizeData(data, 'create', req.user, null, req.site)
			.create(data)
			.then(ideaInstance => {

		    db.Idea
			    .scope(...req.scope)
					.findByPk(ideaInstance.id)
          .then(result => {
            req.results = result;
            return next();
          })

			})
			.catch(function( error ) {
				// todo: dit komt uit de oude routes; maak het generieker
				if( typeof error == 'object' && error instanceof Sequelize.ValidationError ) {
					let errors = [];
					error.errors.forEach(function( error ) {
						// notNull kent geen custom messages in deze versie van sequelize; zie https://github.com/sequelize/sequelize/issues/1500
						// TODO: we zitten op een nieuwe versie van seq; vermoedelijk kan dit nu wel
						errors.push(error.type === 'notNull Violation' && error.path === 'location' ? 'Kies een locatie op de kaart' : error.message);
					});
				//	res.status(422).json(errors);

					next(createError(422, errors.join(', ') ));
				} else {
					next(error);
				}
			});

	})
	.post(function(req, res, next) {

    // tags
    if (!req.body.tags) return next();

 		let ideaInstance = req.results;
		ideaInstance
		  .setTags(req.body.tags)
			.then(ideaInstance => {
		    // refetch. now with tags
		    let scope = [...req.scope, 'includeVoteCount', 'includeTags']
			  return db.Idea
				  .scope(...scope)
				  .findOne({
					  where: { id: ideaInstance.id, siteId: req.params.siteId }
				  })
				  .then(found => {
					  if ( !found ) throw new Error('Idea not found');
					  req.results = found;
		        return next();
				  })
				  .catch(next);
		  })
	})
	.post(function(req, res, next) {
		res.json(req.results);
		mail.sendThankYouMail(req.results, req.user, req.site) // todo: optional met config?
	})

// one idea
// --------
router.route('/:ideaId(\\d+)')
	.all(function(req, res, next) {
		var ideaId = parseInt(req.params.ideaId) || 1;

		db.Idea
			.scope(...req.scope, 'includeVoteCount')
			.findOne({
				where: { id: ideaId, siteId: req.params.siteId }
			})
			.then(found => {
				if ( !found ) throw new Error('Idea not found');

				req.idea = found;
		    req.results = req.idea;
				next();
			})
			.catch((err) => {
				console.log('errr', err)
				next(err);
			});
	})

// view idea
// ---------
	.get(auth.can('Idea', 'view'))
	.get(auth.useReqUser)
	.get(function(req, res, next) {
		res.json(req.results);
	})

// update idea
// -----------
	.put(auth.useReqUser)
	.put(function(req, res, next) {
    req.tags = req.body.tags;
    return next()
	})
	.put(function(req, res, next) {

    var idea = req.results;
    if (!( idea && idea.can && idea.can('update') )) return next( new Error('You cannot update this Idea') );

    if (req.body.location) {
      try {
        req.body.location = JSON.parse(req.body.location || null);
      } catch(err) {}
      if ( typeof req.body.location == 'object' && !Object.keys(req.body.location).length ) req.body.location = undefined;
    } else {
      req.body.location = JSON.parse(null);
    }

		let data = {
      ...req.body,
		}

    // TODO: dit moet ook nog ergens in auth
    if (auth.hasRole(req.user, 'editor')) {
      if (data.modBreak) {
        data.modBreakUserId = req.body.modBreakUserId = req.user.id;
        data.modBreakDate = req.body.modBreakDate = new Date().toString();
      } 
    }

		console.log('ideaa data', data)

		idea
			.authorizeData(data, 'update')
			.update(data)
			.then(result => {
				req.results = result;
        next()
			})
			.catch(next);
	})
	.put(function(req, res, next) {

    // tags
    if (!req.tags) return next();

    let tagIds = [];
    let responseData;
    let ideaInstance = req.results;

		ideaInstance
			.setTags(req.tags)
			.then(ideaInstance => {
        // refetch. now with tags
        let scope = [...req.scope, 'includeVoteCount', 'includeTags']
		    return db.Idea
			    .scope(...scope)
			    .findOne({
				    where: { id: ideaInstance.id, siteId: req.params.siteId }
			    })
			    .then(found => {
				    if ( !found ) throw new Error('Idea not found');
				    req.results = found;
            next();
			    })
			    .catch(next);
	    })

	})
	.put(function(req, res, next) {
		res.json(req.results);
	})

// delete idea
// ---------
	.delete(auth.can('Idea', 'delete'))
	.delete(function(req, res, next) {
		req.results
			.destroy()
			.then(() => {
				res.json({ "idea": "deleted" });
			})
			.catch(next);
	})

module.exports = router;
