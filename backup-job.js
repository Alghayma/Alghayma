var fs = require('fs');
var os = require('os');
var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require('./config');
//var http = require('http');
//var https = require('https');

var FbUser = mongoose.model('FbUser');
var Feed = mongoose.model('Feed');
var Post = mongoose.model('Post');

//Creating the media folder, if it doesn't exist
if (!fs.existsSync(config.mediafolder)) fs.mkdirSync(config.mediafolder);
//Setting up folderSeperator character
var folderSeperator;
if (os.platform().toString().toLowerCase().indexOf('win') > -1){
	folderSeperator = '\\';
} else {
	folderSeperator = '/';
}

//Replacing the current accessToken by an other one from the DB
function refreshToken(callback){
	FbUser.find(function(err, users){
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

//Refreshing feeds' metadata
function refreshMetadata(){
	Feed.find(function(err, feeds){
		if (err){
			console.log('Error while trying to reload feeds metadata:\n' + err);
			return;
		}
		if (!(feeds && feeds.length > 0)) return;
		for (var i = 0; i < feeds.length; i++){
			fbgraph.get(feeds.id, {fields: 'id,name,link,picture'}, function(err, fbRes){
				Feed.update({id: feeds.id}, {name: fbRes.name, }).exec();
			});
		}
	});
}

var validFbPaths = ['http://facebook.com', 'https://facebook.com', 'http://www.facebook.com', 'https://www.facebook.com', 'http://m.facebook.com', 'https://m.facebook.com'];

//Checking whether the given path is a Facebook url
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

//Getting all the posts, with an optional interval (since or until parameter)
function navigatePage(pageId, until, since, cb){
	if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
	if (typeof until != 'undefined' && !(typeof until == 'number' || typeof until == 'date')) throw new TypeError('When defined, "until" must be a number or a date');
	if (typeof since != 'undefined' && !(typeof since == 'number' || typeof since == 'date')) throw new TypeError('When defined, "since" must be a number or a date');
	if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
	if (typeof until != 'undefined' && typeof since != 'since') throw new TypeError('You can use only one time pagination parameter at a time');
	var reqText = pageId + '/posts';

	function fbGet(path, until, since){
		var options = {};
		if (typeof until == 'date') options.until = until.getTime();
		if (typeof until == 'number') options.until = until;
		if (typeof since == 'date') options.since = since.getTime();
		if (typeof since == 'number') options.since = since;
		fbgraph.get(path, options, function(err, fbRes){
			if (err) {
				console.log('Error while getting updates from : ' + pageId + '\n' + JSON.stringify(err));
				if (cb) cb();
				return;
			}
			if (!fbRes.data){ //If no error and no data was returned, then end of feed (or whatever)
				if (cb) cb();
				return;
			}
			for (var i = 0; i < fbRes.data.length; i++){
				backupFbPost(fbRes.data[i]);
			}
			if (fbRes.paging && fbRes.paging.next){
				fbGet(fbRes.paging.next);
			} else {
				if (cb) cb();
			}
		})
	}

	fbGet(reqText);
}

//Saving a single fb post on the server
function backupFbPost(postObj){
	if (typeof postObj !== 'object') throw new TypeError('postObj must be an object');
	var feedId = postObj.from.id;
	var postId = postObj.id;
	var postText = postObj.message;
	var postDate = postObj.created_date;
	var storyLink = postObj.link;
	// LATER : Getting the story link. Backup it up if it's a picture, or a facebook post
	/*if (isFbUrl(storyLink)){

	} else if {
		var 
	}*/
	// LATER : Backing up the picture
	var pictureLink = postObj.picture;
	var newPost = new Post({
		postId: postId,
		feedId: feedId,
		postDate: postDate,
		postText: postText,
		storyLink: storyLink,
		picture: pictureLink
	});
	newPost.save();
}

function backupAllFeeds(){
	refreshToken(function(){
		Feed.find(function(err, feeds){
			if (err){
				console.log('Can\'t update feeds metadata:\n' + err);
				return;
			}
			if (!(feeds && feeds.length > 0)) return;
			for (var i = 0; i < feeds.length; i++){
				exports.launchFeedBackup(feeds[i]);
			}
		});
	});
}

//Launching a feed backup process
exports.launchFeedBackup = function(feedObj, callback){
	if (!feedObj) throw new TypeError('feedObj must be an object')
	if (callback && typeof callback != 'function') throw new TypeError('When defined, callback must be a parameter');
	/*Feed.findOne({id: feedObj.id}, function(err, _feed){
		if (err){
			console.log('Error when checking if a certain feed exists:\n' + err);
			return;
		}
		if (_feed){
			console.log('Backing up : "' + _feed.name + '"');
			navigatePage(_feed.id, undefined, _feed.lastBackup, function(){
				console.log('Backup finished : "' + _feed.name + "'");
			});
		} else {
			if (callback) callback(false);
		}
	});*/
	console.log('Backing up : "' + feedObj.name + '"');
	navigatePage(feedObj.id, undefined, feedObj.lastBackup, function(){
		console.log('Backup finished : "' + feedObj.name + "'");
	});
};

//Adding a feed a that will be backed up by the system
exports.addFeed = function(feedUrl){
	if (!isFbUrl(feedUrl)) throw new TypeError('As of now, only FB pages are supported');
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
		var newFeed = new Feed({
			id: res.id,
			name: res.name,
			type: 'fbpage',
			url: res.link,
			profileImage: res.picture.data.url
		});
		newFeed.save();
		exports.launchFeedBackup(newFeed);
	});
};

var backupInterval;
var reloadFeedMetadataInterval;

//Creating the auto backup job
exports.start = function(){
	reloadFeedMetadataInterval = setInterval(function(){
		refreshMetadata();
	}, config.metadataRefreshInterval);
	backupInterval = setInterval(function(){
		backupAllFeeds();
	}, config.postsBackupInterval);
};

//Stopping the backup process
exports.stop = function(){
	clearInterval(reloadFeedMetadataInterval);
	clearInterval(backupInterval);
};