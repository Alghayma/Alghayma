var fbgraph = require('fbgraph');
var path = require('path');
var config = require(path.join(process.cwd(), 'config'));
var fs = require('fs')

var mongoose = require('mongoose');

var FBUser  = mongoose.model('FBUser', require('./models').FBUser)
var FBPost  = mongoose.model('FBPost', require('./models').FBPost)
var FBFeed  = mongoose.model('FBFeed', require('./models').FBFeed)

var kue = require('kue');
var jobs = kue.createQueue();

exports.config = {
	shortname: "fb",
	fullname: "Facebook"
}

function refreshToken(callback){
	FBUser.find(function(err, users){
		if (err){
			console.log('Error while changing access token:\n' + err);
			return;
		}
		var numUsers = users.length;
		var chosenUserIndex = Math.floor(Math.random() * numUsers);
		var selectedUser = users[chosenUserIndex];
		fbgraph.setAccessToken(selectedUser.accessToken);
		if (callback && typeof callback == 'function') callback();
	});
}
refreshToken();

exports.validator = function isFbUrl(path){
	if (typeof path != "string") {return false};
	var apiRoute = path.split("?")[0];
	// non-escaped regex ^(https|http)://(www|m).facebook.com/(pages/)?(([0-9a-zA-Z._-]*)(/)?$|([0-9a-zA-Z_-]*)/[0-9]*(/)?$)
	var matches = (apiRoute.match(/^(https|http):\/\/(www|m).facebook.com\/(pages\/)?(([0-9a-zA-Z._-]*)(\/)?$|([0-9a-zA-Z_-]*)\/[0-9]*(\/)?$)/))	
	if (matches) {
		var match = matches[0]
		if (match === apiRoute) {
			return true;
		} else{
			return false;
		}
	};
}

exports.getFBPath = function getFbPath(path, removeEdges){
	var apiRoute = path.split("?")[0];
	// non-escaped regex (?!(https|http)://(www|m).facebook.com/(pages/)?)(([0-9a-zA-Z-.]*)$|(?!([0-9a-zA-Z_\.-]*)/)[0-9]*$)
	var path = (apiRoute.match(/(?!(https|http):\/\/(www|m)(.|\n)facebook(.|\n)com\/(pages\/)?)(([0-9a-zA-Z-(.|\n)]*)$|(?!([0-9a-zA-Z_\.-]*)\/)[0-9]*$)/))[0]
	return path
}

exports.setupRoutes = function(express, ext){
	var path = require('path');
	var shortname = require(path.join(__dirname, ext)).config.shortname
	express.get('/'+ shortname +'/p', this.viewpage);
	express.get('/' + shortname +'/chunk', this.chunk);
	express.get('/' + shortname + '/media/:postid', this.media);
	express.post('/' + shortname + '/backup', this.backup);
	express.get('/' + shortname + '/auth', this.fbauth);
	console.log("Routes for Facebook initialized")
}

// To-Do : front-end regex matching

var isFBURL = this.validator
var getPath = this.getFBPath

exports.viewpage = function(req, res){
	var sourceUrl = req.query.sourceUrl;
	//Checking that the user-provided URL is from facebook. Beware this is very dirty.
	if (!isFBURL(sourceUrl)){
		res.render('message', {title: 'Error', message: 'Sorry, but this address doesn\'t seem to come from Facebook...'});
	}

	FBFeed.findOne().or([{url: getPath(sourceUrl)}, {id: getPath(sourceUrl)}]).exec(function(err, feed){
		if (err){
			throw err;
			res.send(500, 'Internal error');
			return;
		}
		if (feed){
			var FBPost = mongoose.model('FBPost')
			FBPost.find({feedId: feed.id}).sort({postDate: -1}).limit(25).exec(function(err, posts){
				if (err){
					throw err;
					res.send(500, 'Internal error');
					return;
				}
				if (posts && posts.length > 0){
					var description = "We " + ((feed.didBackupHead) ? " did sucesfully complete a full backup of " + feed.name + ". The last backup was performed " + feed.lastBackup + "." : " do not have yet a full backup of " + feed.name +". Here is what we have so far")
					// Improvement: add the date of the next scheduled backup.
					res.render('feed', {title: feed.name + ' - Alghayma', feed: feed, posts: posts, feedDescription:description});
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
	var FBPost = mongoose.model('FBPost');

	if (!feedId){
		res.send(400, 'No feedId provided');
		return;
	}
	if (!limit) limit = 25;
	if (!offset) offset = 0;
	FBPost.find({feedId: feedId}).sort({postDate: -1}).skip(offset * limit).limit(limit).exec(function(err, posts){
		if (err){
			console.log('Error while getting chunk ' + offset + ' with width ' + limit + ' for feedId ' + feedId);
			return;
		}
		res.send(200, posts);
	});
};

exports.media = function(req, res){
	var postId = req.param('postid');
	var mediaPath = path.join(process.cwd(), config.mediafolder);
	var postMediaPath = path.join(mediaPath, postId);
	if (!fs.existsSync(postMediaPath)){
		res.send(404, 'Post media not found');
		return;
	}
	var fileListForPost = fs.readdirSync(postMediaPath);
	if (fileListForPost.length == 0){
		res.send(404, 'Post media not found');
		return;
	}
	res.sendfile(path.join(postMediaPath, fileListForPost[0]));
};

exports.backup = function(req, res){
	console.log(req.body)
	if (!req.body.sourceUrl){
		res.send(400, 'You didn\'t give us an address to backup');
		return;
	}
	var sourceUrl = decodeURIComponent(req.body.sourceUrl);
	if (!isFBURL(sourceUrl)){
		res.send(400, 'The address you gave isn\'t from Facebook');
		return;
	}

	exports.addFeed(sourceUrl, function(pageName){
		res.send(200, pageName + ' was saved in Alghayma and will be backed up soon');
	});
};

exports.fbauth = function(req, res){
	//FB Graph API authentication model is confusing me...
	if (!req.query.code){
		var authUrl = fbgraph.getOauthUrl({
			"client_id": config.fbappid,
			"redirect_uri": 'http://localhost:3000/fb/auth'
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
		redirect_uri: 'http://localhost:3000/fb/auth',
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

			FBUser.count({id: idRes.id}, function(err, count){
				if (err){
					console.log('Error when counting FB users with a given ID:\n' + JSON.stringify(err));
					res.render('message', {title: 'Error', message: 'Error in FB authentication process. Sorry for that', goHome: true});
					return;
				}
				if (count > 0){
					FBUser.update({id: idRes.id}, {accessToken: facebookRes.access_token}, function(err){
						if (err) console.log('Error when updating FB User list:\n' + JSON.stringify(err));
						res.redirect('/');
					});
				} else {
					var newFBUser = new FBUser({
						id: idRes.id,
						accessToken: facebookRes.access_token
					});
					newFBUser.save();
					res.redirect('/');
				}
			});
		});
	});
}

exports.addFeed = function(feedUrl, callback){
	var isFbUrl = exports.validator
	var getFbPath = exports.getFBPath
	if (!isFbUrl(feedUrl)) throw new TypeError('As of now, only FB pages are supported');
	if (callback && typeof callback != 'function') throw new TypeError('When defined, callback must be a function');
	var fbPath = getFbPath(feedUrl);
	if (fbPath.lastIndexOf('/') != fbPath.length - 1){
		fbPath += '/';
	}
	fbPath += '?fields=id,name,link,picture';
	fbgraph.get(fbPath, function(err, res){
		if (err){
			console.log('Error when getting info of: ' + fbPath + '\n' + JSON.stringify(err));
			return;
		}
		//Check that the feed doesn't exist yet
		FBFeed.find({id: res.id}, function(err, feed){
			if (err){
				console.log('Error when checking whether ' + res.name + ' is already being backed up or not');
				return;
			}
			if (!feed.id){
				var newFeed = new FBFeed({
					id: res.id,
					name: res.name,
					type: 'fbpage',
					url: getFbPath(feedUrl),
					profileImage: res.picture.data.url,
					didBackupHead: false
				});
				console.log("A new feed was added : " + res.name);
				newFeed.save();
				
				// Start Queuing this feed
				jobs.create('facebookJob', {title: "Backup of " + newFeed.name, feed: newFeed}).save();
			}
			if (callback) callback(res.name);
		});
	});
}