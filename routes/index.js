var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('../config');

var Feed = mongoose.model('Feed');
var Post = mongoose.model('Post');
var FbUser = mongoose.model('FbUser');

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
			if (path.indexOf('/pages/') == 0){ // Taking the /Page-Name from https://facebook.com/pages/Page-Name/batikhNumber (when a page doesn't have a vanity name)
				path = path.replace('/pages', '');
				var batikhNumberLocation = path.indexOf('/');
				path = path.substring(0, batikhNumberLocation);
			}
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
};

exports.viewpage = function(req, res){
	var sourceUrl = req.query.sourceUrl;
	//Checking that the user-provided URL is from facebook. Beware this is very dirty.
	if (!isFbUrl(sourceUrl)){
		res.render('message', {title: 'Error', message: 'Sorry, but this address doesn\'t seem to come from Facebook...'});
	}
	Feed.findOne({url: sourceUrl}, function(err, feed){
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
			fbgraph.
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
	if (!req.query.code){
		var authUrl = fbgraph.getOauthUrl({
			"client_id": config.fbappid,
			"redirect_uri": 'http://localhost:3000/auth'
		});
		if (!req.query.error){
			res.redirect(authUrl);
		} else {
			console.log('Fb auth error : ' + req.query.error)
			res.render('message', {title: 'Error', message: 'An error occured in the authentication process', goHome: true});
		}
		return;
	}
	//Code defined, authorize login process
	fbgraph.authorize({
		client_id: config.fbappid,
		client_secret: config.fbapptoken,
		code: req.query.code,
		redirect_uri: 'http://localhost:3000/auth',
	}, function(err, facebookRes){
		if (err){
			console.log('Error in FB authorization:\n' + JSON.stringify(err));
			res.render('message', {title: 'Error', message: 'Error in FB authentication process. Sorry for that', goHome: true});
			return;
		}
		fbgraph.setAccessToken(facebookRes.access_token);
		fbgraph.get('/me?fields=id', function(err, idRes){
			if (err){
				console.log('Error when getting userID from FB:\n' + JSON.stringify(err));
				res.render('message', {title: 'Error', message: 'Error in FB authentication process. Sorry for that', goHome: true});
				return;
			}
			FbUser.count({id: idRes.id}, function(err, count){
				if (err){
					console.log('Error when counting FB users with a given ID:\n' + JSON.stringify(err));
					res.render('message', {title: 'Error', message: 'Error in FB authentication process. Sorry for that', goHome: true});
					return;
				}
				if (count > 0){
					FbUser.update({id: idRes.id}, {accessToken: facebookRes.access_token}, function(err){
						if (err) console.log('Error when updating FB User list:\n' + JSON.stringify(err));
						res.redirect('/');
					});
				} else {
					var newFbUser = new FbUser({
						id: idRes.id,
						accessToken: facebookRes.access_token
					});
					newFbUser.save();
					res.redirect('/');
				}
			});
		});
	});
};