var fbgraph = require('fbgraph');
var path = require('path');
var config = require(path.join(process.cwd(), 'config'));
var fs = require('fs')
var mongooseInstance;
var backupJobInstance;

exports.config = {
	shortname: "fb",
	fullname: "Facebook"
}

exports.initializeDBModels = function(mongoose){
	var FBFeed = new mongoose.Schema({
		id: String, //Fb ID (which are digits only) or random alphanumerical string for other feed types
		name: String,
		type: String,
		url: String, //Vanity name
		profileImage: String,
		lastBackup: Date
	});

	var FBPost = new mongoose.Schema({
		postId: String, //Fb post id, or random alphanumerical string for other post types
		feedId: String, //From Feed collection, or random alphanumerical
		postDate: Date,
		postText: String,
		story: String,
		storyLink: String, //Link preview text
		picture: String //if a unique picture exists
	});

	var FBUser = new mongoose.Schema({
		id: String,
		accessToken: String
	});

	mongoose.model('FBFeed', FBFeed);
	mongoose.model('FBPost', FBPost);
	mongoose.model('FBUser', FBUser);

	console.log("Mongoose models for Facebook initialized")

	mongooseInstance = mongoose
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

var validator = function getFacebookPath(url){
	// URL pasted can contain parameters, let's get rid of those
	var apiRoute = url.split("?")[0];
	var match = (apiRoute.match(/(https|http):\/\/(www|m)(.|\n)facebook(.|\n)com\/(pages\/)?(([0-9a-zA-Z_(.|\n)-]*)$|([0-9a-zA-Z_(.|\n)-]*)\/[0-9]*$)/))[0]
	if (match === apiRoute) {
		return true;
	} else{
		return false;
	}
}

var getPath = function getFbPath(path, removeEdges){ // Not sure of what removeEdges is supposed to do besides removing the page number
		return ((path.match(/(?!((https|http):\/\/(www|m)(.|\n)facebook(.|\n)com\/))(pages\/)?(([0-9a-zA-Z_(.|\n)-]*)$|([0-9a-zA-Z_(.|\n)-]*)\/[0-9]*$)/))[0])
}

exports.viewpage = function(req, res){
	var sourceUrl = req.query.sourceUrl;
	//Checking that the user-provided URL is from facebook. Beware this is very dirty.
	if (!validator(sourceUrl)){
		res.render('message', {title: 'Error', message: 'Sorry, but this address doesn\'t seem to come from Facebook...'});
	}
	var FBFeed = mongooseInstance.model('FBFeed')

	FBFeed.findOne().or([{url: getPath(sourceUrl)}, {id: getPath(sourceUrl)}]).exec(function(err, feed){
		if (err){
			throw err;
			res.send(500, 'Internal error');
			return;
		}
		if (feed){
			var FBPost = mongooseInstance.model('FBPost')
			FBPost.find({feedId: feed.id}).sort({postDate: -1}).limit(25).exec(function(err, posts){
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
	var FBPost = mongooseInstance.model('FBPost');

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
	if (!validator(sourceUrl)){
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

			var FBUser = mongooseInstance.model('FBUser')

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
};


exports.setBackupJobInstance = function(instance){
	if (!instance) throw new TypeError('"instance" was undefined');
	if (typeof instance != 'object') throw new TypeError('"instance" must be an object');
	backupJobInstance = instance;
	backupJobInstance.start();
};