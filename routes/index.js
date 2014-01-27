var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('../config');

var Feed = mongoose.model('Feed');
var Post = mongoose.model('Post');

var validFbPaths = ['http://facebook.com', 'https://facebook.com', 'http://www.facebook.com', 'https://www.facebook.com', 'http://m.facebook.com', 'https://m.facebook.com'];

function isFbUrl(path){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0) return true;
	}
	return false;
}

function getFbPath(path){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0){
			path = path.replace(validFbPaths[i], '');
			if (path.indexOf('/Pages/') == 0) path = path.replace('/Pages', '');
			return path;
		}
	}
	throw new TypeError('The given path isn\'t from facebook');
}

/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: 'Alghayma' });
  console.log('Req body :\n' + JSON.stringify(req.body));
  console.log('Req query:\n' + JSON.stringify(req.query));
};

exports.viewpage = function(req, res){
	var sourceUrl = req.query.sourceUrl;
	//Checking that the user-provided URL is from facebook. Beware this is very dirty.
	if (!isFbUrl(sourceUrl)){
		res.render('message', {title: 'Error', message: 'Sorry, but this address doesn\'t seem to come from Facebook...'});
	}
	Feed.findOne(sourceUrl, function(err, feed){
		if (err){
			throw err;
			res.send(500, 'Internal error');
			return;
		}
		if (feed){
			Post.find({name: feed.name}, function(err, posts){
				if (err){
					throw err;
					res.send(500, 'Internal error');
					return;
				}
				if (posts && posts.length > 0){
					res.render('feed', {title: feed.name + ' - Alghayma', posts: posts})
				} else {
					res.render('message', {title: 'Error', message: 'Sorry. This feed is registered on Alghayma, but it hasn\'t been backed up yet. Please come back later.'});
				}
			});
		} else {
			res.render('feed', {title: 'Back it up!'});
		}
	})
};

exports.backup = function(req, res){
	var sourceUrl = req.body.sourceUrl;
	if (!isFbUrl(sourceUrl)){
		res.render('message', {title: 'Error', message: 'Sorry, but this address doesn\'t seem to come from Facebook...'});
	}
	var feedAddress = sourceUrl.replace('facebook.com')
	fbgraph.setAccessToken(config.fbusertokens[0].token);
	//fbgraph.
};

exports.fbauth = function(req, res){
	//FB Graph API authentication model is confusing me...
	if (!req.query['access_token']){
		var authUrl = fbgraph.getOauthUrl({
			"client_id": config.fbappid,
			"redirect_uri": 'http://localhost:3000/auth',
			"response_type": 'token'
		});
		if (!req.query.error){
			res.redirect(authUrl);
		} else {
			console.log('Fb auth error : ' + req.query.error)
			res.render('message', {title: 'Error', message: 'An error occured in the authentication process'});
		}
		return;
	}
	//Code defined, authorize login process
	fbgraph.authorize({
		client_id: config.fbappid,
		client_secret: config.fbapptoken,
		access_token: req.query['access_token'],
		redirect_uri: 'http://localhost:3000/auth',
	}, function(err, facebookRes){
		if (err){
			console.log('Error in FB authorization:\n' + JSON.stringify(err));
			return;
		}
		console.log('FB Res, query:\n' + facebookRes.query);
		console.log('FB Res, body:\n' + JSON.stringify(facebookRes.body));
		res.redirect('/');
	});
};