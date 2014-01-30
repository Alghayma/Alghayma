var fs = require('fs');
var mongooose = require('mongoose');
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

function refreshToken(){
	//Replacing the current accessToken by an other one from the DB
	FbUser.find(function(err, users){
		if (err){
			console.log('Error while changing access token:\n' + err);
			return;
		}
		var numUsers = users.length;
		var chosenUserIndex = Math.floor(Math.random() * numUsers);
		var selectedUser = users[chosenUserIndex];
		fbgraph.setAccessToken(selectedUser.accessToken);
	})
}
refreshToken();

var validFbPaths = ['http://facebook.com', 'https://facebook.com', 'http://www.facebook.com', 'https://www.facebook.com', 'http://m.facebook.com', 'https://m.facebook.com'];

function isFbUrl(path){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0) return true;
	}
	return false;
}

function getFbPath(path, removeEdges){
	if (typeof path != 'string') throw new TypeError('path must be a string');
	for (var i = 0; i < validFbPaths.length; i++){
		if (path.indexOf(validFbPaths[i]) == 0){
			path = path.replace(validFbPaths[i], '');
			if (path.indexOf('/pages/') == 0){ // Taking the Page-Name from https://facebook.com/pages/Page-Name/batikhNumber (when a page doesn't have a vanity name)
				path = path.replace('/pages/', '');
				var batikhNumberLocation = path.indexOf('/');
				path = path.substring(0, batikhNumberLocation);
			}
			return path;
		}
	}
	throw new TypeError('The given path isn\'t from facebook');
}

function navigatePage(pageId, until, cb){
	if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
	if (until && !(typeof until == 'number' || typeof until == 'date')) throw new TypeError('When defined, "until" must be a number or a date');
	if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
	var reqText = pageId + '/posts/';
	if (until)  
}

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

module.exports = {};

exports.launchFeedBackup = function(feedId){
	Feed.count({id: feedId}, function(err, feedCount){
		if (err){
			console.log('Error when checking if a certain feed exists:\n' + err);
			return;
		}

	});
};

exports.addFeed = function(feedUrl){
	if (!isFbUrl(feedUrl)) throw new TypeError('As of now, only FB pages are supported');
	var fbPath = getFbPath(feedUrl);
	if (fbPath.lastIndexOf('/') != fbPath.length - 1){
		fbPath += '/';
	}
	fbPath += '?fields=id,name,picture';
	fbgraph.get(fbPath, function(err, res){
		if (err){
			console.log('Error when getting info of: ' + fbPath + '\n' + err);
			return;
		}
		var newFeed = new Feed({
			id: res.id,
			name: res.name,
			type: 'fbpage',
			url: feedUrl,
			profileImage: res.data.url
		});
		newFeed.save();
		exports.launchFeedBackup(res.id);
	});
};