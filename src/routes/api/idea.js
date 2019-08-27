const Promise = require('bluebird');
const Sequelize = require('sequelize');
const express = require('express');
const createError = require('http-errors')
const config = require('config');
const db = require('../../db');
const auth = require('../../auth');
const mail = require('../../lib/mail');

let router = express.Router({mergeParams: true});

// scopes: for all get requests
router
	.all('*', function(req, res, next) {

		req.scope = ['api'];

		var sort = (req.query.sort || '').replace(/[^a-z_]+/i, '') || ( req.cookies['idea_sort'] && req.cookies['idea_sort'].replace(/[^a-z_]+/i, '') );
		if( sort ) {
			res.cookie('idea_sort', sort, { expires: 0 });
			if (sort == 'votes_desc' || sort == 'votes_asc') {
				req.scope.push('includeVoteCount'); // het werkt niet als je dat in de sort scope functie doet...
			}
			req.scope.push({ method: ['sort', req.query.sort]});
		}

		if (req.query.mapMarkers) {
			req.scope.push('mapMarkers');
		}

		if (req.query.running) {
			req.scope.push('selectRunning');
		}

		if (req.query.includeArguments) {
			req.scope.push({ method: ['includeArguments', req.user.id]});
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

		if (req.query.includeVoteCount && req.site && req.site.config && req.site.config.votes && req.site.config.votes.isViewable) {
			req.scope.push('includeVoteCount');
		}

		if (req.query.includeUserVote && req.site && req.site.config && req.site.config.votes && req.site.config.votes.isViewable) {
			// ik denk dat je daar niet het hele object wilt?
			req.scope.push({ method: ['includeUserVote', req.user.id]});
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
	.get(auth.can('ideas:list'))
	.get(function(req, res, next) {
		db.Idea
			.scope(...req.scope)
			.findAll({ where: { siteId: req.params.siteId } })
			.then( found => {
				return found.map( entry => {
          console.log(entry.progress);
					let json = entry.toJSON();
          console.log(json.progress);
					if (json.user && typeof json.user == 'object') {
						json.user = {
							nickName: json.user.nickName,
							firstName: json.user.firstName,
							lastName: json.user.lastName,
							email: req.user.role == 'admin' ? json.user.email : undefined,
						}
					}
					return json;
				});
			})
			.then(function( found ) {
				res.json(found);
			})
			.catch(next);
	})

// create idea
// -----------
	.post(auth.can('idea:create'))
	.post(function(req, res, next) {
		if (!req.site) return next(createError(401, 'Site niet gevonden'));
		return next();
	})
	.post(function( req, res, next ) {
		if (!(req.site.config && req.site.config.ideas && req.site.config.ideas.canAddNewIdeas)) return next(createError(401, 'Inzenden is gesloten'));
		return next();
	})
	.post(function(req, res, next) {
		filterBody(req)
		req.body.siteId = parseInt(req.params.siteId);
		req.body.userId = req.user.id;
		req.body.startDate = new Date();

		try {
			req.body.location = JSON.parse(req.body.location || null);
		} catch(err) {}

		db.Idea
			.create(req.body)
			.then(result => {
				res.json(result);
				mail.sendThankYouMail(result, req.user, req.site) // todo: optional met config?
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
					res.status(422).json(errors);
				} else {
					next(error);
				}
			});
	})

// one idea
// --------
router.route('/:ideaId(\\d+)')
	.all(function(req, res, next) {
		var ideaId = parseInt(req.params.ideaId) || 1;

		db.Idea
			.scope(...req.scope)
			.findOne({
				where: { id: ideaId, siteId: req.params.siteId }
			})
			.then(found => {
				if ( !found ) throw new Error('Idea not found');
				req.idea = found;
				next();
			})
			.catch(next);
	})

// view idea
// ---------
	.get(auth.can('idea:view'))
	.get(function(req, res, next) {
		let json = req.idea.toJSON();
		if (json.user && typeof json.user == 'object') {
			json.user = {
				nickName: json.user.nickName,
				firstName: json.user.firstName,
				lastName: json.user.lastName,
				email: req.user.role == 'admin' ? json.user.email : undefined,
			}
		}
		res.json(json);
	})

// update idea
// -----------
	.put(auth.can('idea:edit'))
	.put(function(req, res, next) {
		filterBody(req)
		if (req.body.location) {
			try {
				req.body.location = JSON.parse(req.body.location || null);
			} catch(err) {}
		} else {
			req.body.location = undefined;
		}

		req.idea
			.update(req.body)
			.then(result => {
				res.json(result);
			})
			.catch(next);
	})

// delete idea
// ---------
	.delete(auth.can('idea:delete'))
	.delete(function(req, res, next) {
		req.idea
			.destroy()
			.then(() => {
				res.json({ "idea": "deleted" });
			})
			.catch(next);
	})

// extra functions
// ---------------

function filterBody(req) {
	let filteredBody = {};

	let keys;
	if (req.user.isAdmin()) {
		keys = [ 'siteId', 'meetingId', 'userId', 'startDate', 'endDate', 'sort', 'status', 'title', 'posterImageUrl', 'summary', 'description', 'budget', 'extraData', 'location', 'modBreak', 'modBreakUserId', 'modBreakDate' ];
	} else {
		keys = [ 'title', 'summary', 'description', 'extraData', 'location' ];
	}

	keys.forEach((key) => {
		if (req.body[key]) {
			filteredBody[key] = req.body[key];
		}
	});

	req.body = filteredBody;
}

module.exports = router;
