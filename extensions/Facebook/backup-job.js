/**
 * Facebook extension for Alghayma
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var mongoose = require('mongoose');
var fbgraph = require('fbgraph');
var config = require(path.join(process.cwd(), 'config'));
var http = require('http');
var https = require('https');

var FBUser = mongoose.model('FBUser');
var Feed = mongoose.model('FBFeed');
var Post = mongoose.model('FBPost');

//Creating the media folder, if it doesn't exist
var mediaPath = path.join(process.cwd(), config.mediafolder);
if (!fs.existsSync(config.mediafolder)) fs.mkdirSync(mediaPath);
//Setting up folderSeperator character
var folderSeperator;
if (os.platform().toString().toLowerCase().indexOf('win') > -1){
	folderSeperator = '\\';
} else {
	folderSeperator = '/';
}

//Replacing the current accessToken by an other one from the DB
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
				Feed.update({id: feeds.id}, {name: fbRes.name, picture: fbRes.picture.data.url}).exec();
			});
		}
	});
}

var validFbPaths = ['http://facebook.com', 'https://facebook.com', 'http://www.facebook.com', 'https://www.facebook.com', 'http://m.facebook.com', 'https://m.facebook.com'];

//Checking whether the given path is a Facebook url
function isFbUrl(path){
	if (typeof path != 'string')  return false;
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
	if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
	if (typeof until != 'undefined' && typeof since != 'since') throw new TypeError('You can use only one time pagination parameter at a time');
	var reqText = pageId + '/posts';

	function fbGet(path, until, since){
		var options = {};
		if (until) options.until = until.getTime();
		if (since) options.since = since.getTime();
		fbgraph.get(path, options, function(err, fbRes){
			if (err) {
				if (err.code == 1 || err.code == 2){ //Internal FB errors
					setTimeout(fbGet(path, until, since), 2000); //Waiting for 2 seconds before retrying
				} else console.log('Error while getting updates from : ' + pageId + '\n' + JSON.stringify(err));
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
/*
* BEWARE : IT MIGHT LOOK VERY DIRTY
*/
function backupFbPost(postObj){
	function getSearchKey(path, keyName){
		var search = path.substring(path.indexOf('?'));
		return decodeURI(search.replace(new RegExp("^(?:.*[&\\?]" + encodeURI(keyName).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
	}
	if (typeof postObj !== 'object') throw new TypeError('postObj must be an object');

	function saveInDb(obj){
		if (typeof obj != 'object') throw new TypeError('obj must be an object');
		var newPost = new Post(obj);
		newPost.save();
	}

	var feedId = postObj.from.id;
	var postId = postObj.id;
	var postText = postObj.message;
	var postDate = postObj.created_time;
	var storyLink = postObj.link;
	var story = postObj.story;

	//Pre-modelling the object before saving it in the DB 
	var postInDb = {
		postId: postId,
		feedId: feedId,
		postDate: postDate,
		postText: postText,
		storyLink: storyLink,
		story: story
	}
	//Getting the story link. Backup it up if it's a picture on facebook. (Assuming that a facebook page that gets deleted, all its posted content goes away with it... Pictures included)
	if (isFbUrl(storyLink) && storyLink.indexOf('photo.php') > 0 && getSearchKey(storyLink, 'fbid')){
		//Creating a media folder for the post
		var postMediaPath = path.join(mediaPath, postId);
		fs.mkdirSync(postMediaPath);
		//Getting the photoID from the story link. Then getting that photoID in the Graph API
		var photoId = getSearchKey(storyLink, 'fbid');
		fbgraph.get(photoId, function(err, fbImageRes){
			if (err){
				//If an error occurs while trying to get the post picture, give up and save the data you already have
				var pictureLink = postObj.picture;
				postInDb.picture = pictureLink;
				saveInDb(postInDb);
				return;
			}
			//Getting the URL where the full size image is stored. OMG, gotta do lots of hops in Facebook before getting what you want... And yes, it's getting late in the night..
			var pictureLink = fbImageRes.source;
			var pictureName = pictureLink.split('/'); //Assuming that the url finishes with the image's file name
			pictureName = pictureName[pictureName.length - 1];
			var fsWriter = fs.createWriteStream(path.join(postMediaPath, pictureName)); //Creating after the picture name, in the posts media folder
			if (pictureLink.indexOf('https://') == 0){ //Checking whether the image path is batikh (ie, https) or not.
				https.get(pictureLink, function(imgRes){
					if (imgRes.statusCode == 200){ //image found, then save it
						imgRes.on('data', function(data){
							fsWriter.write(data);
						});
						imgRes.on('end', function(){
							fsWriter.end();
							pictureLink = '/fb/media/' + postId;
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
						});
					} else {
						//Error while getting the picture. Saving the data we have
						postInDb.picture = pictureLink;
						saveInDb(postInDb);
					}
				});
			} else {
				http.get(pictureLink, function(imgRes){
					if (imgRes.statusCode == 200){
						imgRes.on('data', function(data){
							fsWriter.write(data);
						});
						imgRes.on('end', function(){
							fsWriter.end();
							pictureLink = '/fb/media/' + postId;
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
						});
					} else {
						//Error while getting the picture. Saving the data we have
						postInDb.picture = pictureLink;
						saveInDb(postInDb);
					}
				});
			}
		});
	} else {
		var pictureLink = postObj.picture;
		postInDb.picture = pictureLink;
		saveInDb(postInDb);
	}
}

function backupAllFeeds(){
	refreshToken(function(){
		Feed.find(function(err, feeds){
			if (err){
				console.log('Can\'t update feeds metadata:\n' + err);
				return;
			}
			if (!(feeds && feeds.length > 0)) return;
			//Magical queuing. Hopefully it works and doesn't ever reach the maxCallStack
			var feedsIndex = 0;
			var backupAFeed = function(callback){
				exports.launchFeedBackup(feeds[feedsIndex], callback);
			};
			var feedBackupCallback = function(){
				feedsIndex++;
				if (feedsIndex < feeds.length) backupAFeed(feedBackupCallback);
			};
			backupAFeed(feedBackupCallback);
			/*for (var i = 0; i < feeds.length; i++){
				exports.launchFeedBackup(feeds[i]);
			}*/
		});
	});
}
exports.backupAllFeeds = backupAllFeeds;

//Launching a feed backup process
exports.launchFeedBackup = function(feedObj, callback){
	if (!(feedObj && typeof feedObj == 'object')) throw new TypeError('feedObj must be an object')
	if (callback && typeof callback != 'function') throw new TypeError('When defined, callback must be a parameter');
	console.log('Backing up : "' + feedObj.name + '"');
	navigatePage(feedObj.id, undefined, feedObj.lastBackup, function(){
		Feed.update({id: feedObj.id}, {lastBackup: Date.now()}).exec(function(err){
			if (err){
				console.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
				return;
			}
			console.log('Backup finished : "' + feedObj.name + '"');
			if (callback) callback();
		})
	});
};

//Adding a feed a that will be backed up by the system
exports.addFeed = function(feedUrl, callback){
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
		Feed.find({id: res.id}, function(err, feed){
			if (err){
				console.log('Error when checking whether ' + res.name + ' is already being backed up or not');
				return;
			}
			if (!feed.id){
				var newFeed = new Feed({
					id: res.id,
					name: res.name,
					type: 'fbpage',
					url: getFbPath(feedUrl),
					profileImage: res.picture.data.url
				});
				newFeed.save();
				exports.launchFeedBackup(newFeed);
			}
			if (callback) callback(res.name);
		});
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