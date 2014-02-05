var fs = require('fs');
var os = require('os');
var path = require('path');

var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('../config');

var Feed = mongoose.model('Feed');
var Post = mongoose.model('Post');
var FbUser = mongoose.model('FbUser');

var backupJobInstance;

var mediaPath = path.join(process.cwd(), config.mediafolder);
var folderSeperator;
if (os.platform().toString().toLowerCase().indexOf('win') > -1){
	folderSeperator = '\\';
} else {
	folderSeperator = '/';
}

var validFbPaths = ['http://facebook.com', 'https://facebook.com', 'http://www.facebook.com', 'https://www.facebook.com', 'http://m.facebook.com', 'https://m.facebook.com'];

function isFbUrl(path){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0) return true;
	}
	return false;
}

//Getting the page name (vanity and non-vanity)
function getFbPath(path, removeEdges){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0){
			path = path.replace(validFbPaths[i], '');
			if (path.indexOf('/pages/') == 0){ // Taking the Page-Name from https://facebook.com/pages/Page-Name/batikhNumber (when a page doesn't have a vanity name)
				path = path.replace('/pages/', '');
				if (removeEdges){
					var batikhNumberLocation = path.indexOf('/');
					path = path.substring(0, batikhNumberLocation);
				}
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
	Feed.findOne().or([{url: getFbPath(sourceUrl)}, {id: getFbPath(sourceUrl)}]).exec(function(err, feed){
		if (err){
			throw err;
			res.send(500, 'Internal error');
			return;
		}
		if (feed){
			Post.find({feedId: feed.id}).sort({postDate: -1}).limit(25).exec(function(err, posts){
				if (err){
					throw err;
					res.send(500, 'Internal error');
					return;
				}
				if (posts && posts.length > 0){
					res.render('feed', {title: feed.name + ' - Alghayma', feed: feed, posts: posts});
				} else {
					res.render('message', {title: 'Error', message: 'Sorry. This feed is registered on Alghayma, but it hasn\'t been backed up yet. Please come back later.'});
				}
			});
		} else {
			res.render('feed', {title: 'Back it up!'});
		}
	});
};

exports.chunk = function(req, res){
	var feedId = req.query.feedId;
	var offset = req.query.offset; //Beware : chunk offest, and not post offset
	var limit = req.query.limit;
	if (!feedId){
		res.send(400, 'No feedId provided');
		return;
	}
	if (!limit) limit = 25;
	if (!offset) offset = 0;
	Post.find({feedId: feedId}).sort({postDate: -1}).skip(offset * limit).limit(limit).exec(function(err, posts){
		if (err){
			console.log('Error while getting chunk ' + offset + ' with width ' + limit + ' for feedId ' + feedId);
			return;
		}
		res.send(200, posts);
	});
};

exports.media = function(req, res){
	var postId = req.param('postid');
	var mediaId = req.param('mediaid');
	var postMediaPath = path.join(mediaPath, postId);
	if (!fs.existsSync(postMediaPath)){
		res.send(404, 'Post media not found');
		return;
	}
	var mediaElementPath = path.join(postMediaPath, mediaId);
	if (!fs.existsSync(mediaElementPath)){
		res.send(404, 'Media element not found');
		return;
	}
	var fileListForMediaElem = fs.readdirSync(mediaElementPath);
	res.sendfile(path.join(mediaElementPath, fileListForMediaElem[0]));
};

exports.backup = function(req, res){
	if (!req.body.sourceUrl){
		res.send(400, 'You didn\'t give us an address to backup');
		return;
	}
	var sourceUrl = decodeURIComponent(req.body.sourceUrl);
	if (!isFbUrl(sourceUrl)){
		res.send(400, 'The address you gave isn\'t from Facebook');
		return;
	}
	if (!backupJobInstance) {
		throw new TypeError('no backupJobInstance referenced!');
		process.exit();
	}
	backupJobInstance.addFeed(sourceUrl, function(pageName){
		res.send(200, pageName + ' was saved in Alghayma and will be backed up soon');
	});
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

exports.setBackupJobInstance = function(instance){
	if (!instance) throw new TypeError('"instance" was undefined');
	if (typeof instance != 'object') throw new TypeError('"instance" must be an object');
	backupJobInstance = instance;
};