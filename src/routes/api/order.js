const Promise = require('bluebird');
const Sequelize = require('sequelize');
const express = require('express');
const moment			= require('moment');
const createError = require('http-errors')
const config = require('config');
const db = require('../../db');
const auth = require('../../middleware/sequelize-authorization-middleware');
const mail = require('../../lib/mail');
const pagination = require('../../middleware/pagination');
const {Op} = require('sequelize');
const { createMollieClient } = require('@mollie/api-client');

const mollieClient = createMollieClient({ apiKey: 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' });

const router = express.Router({mergeParams: true});

const calculateOrderTotal = (orderItems, orderFees) => {
	totals = 0.00;

	orderItems.forEach(item => {
			let price = item.price;
			let qty = item.quantity;
			let amount = price * qty;

			totals += amount;
	});

	orderFees.forEach(fee => {
			let price = fee.price;
			let qty = fee.quantity;
			let amount = price * qty;

			totals += amount;
	});

}

// scopes: for all get requests
/*
router
	.all('*', function(req, res, next) {
		next();
	})
*/

router
	.all('*', function(req, res, next) {
		req.scope = ['includeLog', 'includeItems', 'includeTransaction', forSiteId];
		req.scope.push({method: ['forSiteId', req.params.siteId]});
		next();
	});

router.route('/')

// list users
// ----------
	.get(auth.can('Order', 'list'))
	.get(pagination.init)
	.get(function(req, res, next) {
		let queryConditions = req.queryConditions ? req.queryConditions : {};

		db.Order
			.scope(...req.scope)
		//	.scope()
		//	.findAll()
			.findAndCountAll({
				where:queryConditions,
			 	offset: req.pagination.offset,
			 	limit: req.pagination.limit
			})
			.then(function( result ) {
				req.results = result.rows;
				req.pagination.count = result.count;
				return next();
			})
			.catch(next);
	})
	.get(auth.useReqUser)
//	.get(searchResults)
	.get(pagination.paginateResults)
	.get(function(req, res, next) {
		res.json(req.results);
	})

// create
// -----------
	.post(auth.can('Order', 'create'))
	.post(function(req, res, next) {
		if (!req.site) return next(createError(401, 'Site niet gevonden'));
		return next();
	})
	.post(function( req, res, next ) {
		if (!(req.site.config && req.site.config.order && req.site.config.order.canCreateNewOrders)) return next(createError(401, 'Order mogen niet aangemaakt worden'));
		return next();
	})
	.post(function(req, res, next) {
		const orderSiteConfig = req.site.config && req.site.config.order && orderSiteConfig ? orderSiteConfig : {};

		req.orderFees = orderSiteConfig && orderSiteConfig.orderFees ? orderSiteConfig.orderFees : [{
			price: '2.95',
			name: 'Verzendkosten',
			quantity: 1
		}];

		next();
	})
	.post(async function(req, res, next) {
		if (req.body.orderItems) {
			req.body.orderItems.forEach((orderItem) => {
				const product = await db.Product.findOne({ where: { id: orderItem.productId } });
				orderItem.product = product;
			})
		}

		next();
	})
	/*
		Coupons is for later, basic logic is simple,
		buttt, needs some rules, tracking etc.

	.post(async function(req, res, next) {
		const coupon = req.body.coupon ?  await db.OrderCoupon.findOne({ where: { coupon: req.body.coupon, claimed: null } }) : null;

		if (coupon) {
			const amount = coupon.type === 'percentage' ? calculateOrderTotal(req.body.orderItems, req.orderFees) * (coupon.amount / 10) : coupon.amount;

			req.orderFees.push([
				price: amount,
				name: 'Kortingscode',
				quantity: 1
			])
		}

		next();
	})
	*/
	.post(function(req, res, next) {

		const data = {
			siteId: req.site.id,
			email: req.body.email,
			firstName:req.body.firstName,
			lastName: req.body.lastName,
			phoneNumber: req.body.phoneNumber,
			streetName: req.body.streetName,
			houseNumber: req.body.houseNumber,
			postcode: req.body.postcode,
			city: req.body.city,
			suffix: req.body.suffix,
			phoneNumber: req.body.phoneNumber,
			paymentStatus: req.body.paymentStatus,
			total: calculateOrderTotal(req.body.orderItems, req.orderFees),
		}

		db.Order
			.create(req.body)
			.then(result => {
				req.results = result;
				next();
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
	.post(function(req, res, next) {
		if (req.body.orderItems) {
			req.body.orderItems.forEach((orderItem) => {
				actions.push(function() {
					return new Promise((resolve, reject) => {

						const data = {
							vat: product.vat,
							quantity: orderItem.quantity,
					    orderId: req.results.id,
							productId: product.id,
							price: product.price,
							extraData: {
								product: product
							},
						};

						db.OrderItem
						 .authorizeData(data, 'update', req.user)
						 .create(data)
						 .then((result) => {
							 resolve();
						 })
						 .catch((err) => {
							 console.log('err', err)
							 reject(err);
						 })

				 })}())
			});
		}

		return Promise.all(actions)
			 .then(() => { next(); })
			 .catch(next)
	})
	.post(function(req, res, next) {
		mollieClient.payments.create({
			amount: {
				value:    req.results.total,
				currency: 'EUR'
			},
			description: 'Bestelling bij ' + req.site,
			redirectUrl: 'https://'+req.site.domain+'/thankyou',
			webhookUrl:  'https://'+req.site.domain+'/api/site/'+req.params.siteId+'/order/'+req.params.orderId+'/payment-status'
		})
			.then(payment => {
				req.results.extraData.paymentIds = result.extraData.paymentIds ? result.extraData.paymentIds : [];
				req.results.extraData.paymentIds.push(payment.id);
				req.results.extraData.paymentUrl = payment.getCheckoutUrl();
				next();
			})
			.catch(err => {
				// Handle the errorz
				next(err);
			});

	})
	.post(function(req, res, next) {
		result
			.update(result)
			.then(result => {
				res.json(req.results);
				mail.sendThankYouMail(req.results, req.user, req.site) // todo: optional met config?
			})
			.catch(next);
	})

// one user
// --------
router.route('/:orderId(\\d+)')
	.all(function(req, res, next) {
		const orderId = parseInt(req.params.orderId) || 1;
		db.Order
			.scope(...req.scope)
			.findOne({
					where: { id: orderId }
					//where: { id: userId }
			})
			.then(found => {
				if ( !found ) throw new Error('User not found');
				req.results = found;
				next();
			})
			.catch(next);
	})

// view idea
// ---------
	.get(auth.can('Order', 'view'))
	.get(auth.useReqUser)
	.get(function(req, res, next) {
		res.json(req.results);
	})
	.post('/payment-status', function(req, res, next) {
		// update payment status
		console.log('update payment st')
		res.json({
			'what to do?' : 'Pay'
		});

	})

// update user
// -----------
	.put(auth.useReqUser)
	.put(function(req, res, next) {

    const order = req.results;
    if (!( order && order.can && order.can('update') )) return next( new Error('You cannot update this Order') );

    let data = {
      ...req.body,
		}

    order
      .authorizeData(data, 'update')
      .update(data)
      .then(result => {
        req.results = result;
        next()
      })
      .catch(next);
	})
	.put(function(req, res, next) {
		if (req.body.orderItems) {
			req.body.orderItems.forEach((orderItem) => {
				actions.push(function() {
					return new Promise((resolve, reject) => {
					db.OrderItem
					 .authorizeData(data, 'update', req.user)
					 .update(data)
					 .then((result) => {
						 resolve();
					 })
					 .catch((err) => {
						 console.log('err', err)
						 reject(err);
					 })
				 })}())
			});
		}

		return Promise.all(actions)
			 .then(() => { next(); })
			 .catch(next)
	})

// delete idea
// ---------
  .delete(auth.can('Order', 'delete'))
	.delete(function(req, res, next) {
		req.results
			.destroy()
			.then(() => {
				res.json({ "order": "deleted" });
			})
			.catch(next);
	})

module.exports = router;
