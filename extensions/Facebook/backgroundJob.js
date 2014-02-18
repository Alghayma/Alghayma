/**
 * Facebook extension for Alghayma
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var fbgraph = require('fbgraph');
var config = require(path.join(process.cwd(), 'config'));
var http = require('http');
var https = require('https');

var mongoose = require('mongoose');
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
connectionString += config.dbhost + ':' + config.dbport + '/' + config.dbname;
mongoose.connect(connectionString, function(err){ if (err) throw err; });
require("./models.js").initializeDBModels(mongoose);

var FBUser = mongoose.model('FBUser');
var FBFeed = mongoose.model('FBFeed');
var FBPost = mongoose.model('FBPost');

//Creating the media folder, if it doesn't exist
var mediaPath = path.join(process.cwd(), config.mediafolder);
if (!fs.existsSync(config.mediafolder)) fs.mkdirSync(mediaPath);

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
	FBFeed.find(function(err, feeds){
		if (err){
			console.log('Error while trying to reload feeds metadata:\n' + err);
			return;
		}
		if (!(feeds && feeds.length > 0)) return;
		for (var i = 0; i < feeds.length; i++){
			fbgraph.get(feeds.id, {fields: 'id,name,link,picture'}, function(err, fbRes){
				FBFeed.update({id: feeds.id}, {name: fbRes.name, picture: fbRes.picture.data.url}).exec();
			});
		}
	});
}

//Getting all the posts, with an optional interval (since or until parameter)
function navigatePage(pageId, until, since, cb, job){
	if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
	if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
	var reqText = pageId + '/posts';

	function fbGet(path, until, since){
		var options = {};
		if (until) options.until = until.getTime() / 1000; //Number of seconds, and not milliseconds
		if (since) options.since = since.getTime() / 1000;
		fbgraph.get(path, options, function(err, fbRes){
			if (err) {
				if (err.code == 1 || err.code == 2){ //Internal FB errors
					setTimeout(fbGet(path, until, since), 2000); //Waiting for 2 seconds before retrying
				} else job.log('Error while getting updates from : ' + pageId + '\n' + JSON.stringify(err));
				if (cb) cb();
				return;
			}
			if (!fbRes.data){ //If no error and no data was returned, then end of feed (or whatever)
				if (cb) cb();
				return;
			}
			for (var i = 0; i < fbRes.data.length; i++){
				//Backup a post if it meets the conditions and go to the next one
				if ((!until || fbRes.data[i].created_time < until.getTime() / 1000) && (!since || fbRes.data[i].created_time > since.getTime() / 1000)){
					backupFbPost(fbRes.data[i]);
					continue;
				}
				//If we went beyond the "until" clause, stop paging
				if (until && fbRes.data[i].created_time < until.getTime() / 1000){
					if (cb) cb();
					return;
				}
			}
			if (fbRes.paging && fbRes.paging.next){
				fbGet(fbRes.paging.next, until, since);
			} else {
				if (cb) cb();
			}
		})
	}

	fbGet(reqText, until, since);
}

//Saving a single fb post on the server
/*
* BEWARE : IT MIGHT LOOK VERY VERY DIRTY. It could be optimized
*/
function backupFbPost(postObj){
	var isFbUrl = require("./Facebook").validator
	var getFbPath = require("./Facebook").getFBPath
	function getSearchKey(path, keyName){
		var search = path.substring(path.indexOf('?'));
		return decodeURI(search.replace(new RegExp("^(?:.*[&\\?]" + encodeURI(keyName).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
	}
	if (typeof postObj !== 'object') throw new TypeError('postObj must be an object');

	function saveInDb(obj){
		if (typeof obj != 'object') throw new TypeError('obj must be an object');
		var newPost = new FBPost(obj);
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
	if (isFbUrl(storyLink, true) && (storyLink.indexOf('photo.php') > 0 && getSearchKey(storyLink, 'fbid'))) {
		//Creating a media folder for the post
		var postMediaPath = path.join(mediaPath, postId);
		if (!fs.existsSync(postMediaPath)) fs.mkdirSync(postMediaPath);
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
			if (pictureLink.indexOf('https://') == 0){ //Checking whether the image path is https or not.
				https.get(pictureLink, function(imgRes){
					if (imgRes.statusCode >= 200 && imgRes.statusCode < 400) { //image found, then save it
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
					if (imgRes.statusCode >= 200 && imgRes.statusCode < 400){
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
		if (isFbUrl(pictureLink, true) && pictureLink.indexOf('safe_image.php') > 0 && getSearchKey(pictureLink, 'url')){
			//Creating a media folder for the post
			var postMediaPath = path.join(mediaPath, postId);
			if (!fs.existsSync(postMediaPath)) fs.mkdirSync(postMediaPath);
			//Creating the image file
			var theoricImageUrl = decodeURIComponent(getSearchKey(pictureLink, "url"));
			var theoricImageUrlParts = theoricImageUrl.split('/');
			var imageName = theoricImageUrlParts[theoricImageUrlParts.length];
			var fsWriter = fs.createWriteStream(path.join(postMediaPath, imageName));
			if (theoricImageUrl.indexOf('https://') == 0){
				https.get(theoricImageUrl, function(imgRes){
					if (imgRes.statusCode >= 200 && imgRes.statusCode < 400){
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
						//Error while getting the picture. Saving what we have
						postInDb.picture = pictureLink;
						saveInDb(postInDb);
					}
				});
			} else {
				http.get(theoricImageUrl, function(imgRes){
					if (imgRes.statusCode >= 200 && imgRes.statusCode < 400){
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
						//Error while getting the picture. Saving what we have
						postInDb.picture = pictureLink;
						saveInDb(postInDb);
					}
				});
			}
		} else {
			postInDb.picture = pictureLink;
			saveInDb(postInDb);
		}
	}
}

function scheduleNextOne(job, queue, done){
	job.log("Scheduling next backup of " + job.data.feed.name + " in " + config.postsBackupInterval + " milliseconds." )
	queue.create('facebookJob', {title: "Backup of " + job.data.feed.name, feed: job.data.feed}).delay(config.postsBackupInterval).save()
	done();
}

//Launching a feed backup process
exports.launchFeedBackup = function(job, queue, done){
	var feedObj = job.data.feed; 
	if (!(feedObj && typeof feedObj == 'object')) throw new TypeError('feedObj must be an object');
	//if (callback && typeof callback != 'function') throw new TypeError('When defined, callback must be a function');
	
	// We need to differentiate page updates, initial backups and the resuming of initial backups.

	if (feedObj.didBackupHead) {
		// Just proceed to an update to fetch newest post since the most recent one.
		job.log('Updating Facebook page : ' + feedObj.name);

		// Navigate page from undefined to the last backup we had
		navigatePage(feedObj.id, undefined, feedObj.lastBackup, function(){
			FBFeed.update({id: feedObj.id}, {lastBackup: Date.now()}).exec(function(err){
				if (err){
					job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
					return;
				}
				
				job.log('Succesfully completed the update of the Facebook page : ' + feedObj.name);
			
				//if (callback) callback();
				scheduleNextOne(job, queue, done)
			})
		}, job);

	} else {
		// Find last that was added and continue from there.
		FBPost.findOne().where({feedId:feedObj.id}).sort('postDate').exec(function(err, post){
        		if (err) {
        			job.log('Issue fetching post from DB : ' + err);
        		} else if (!post) {
        			job.log("Page " + feedObj.name + " has no post yet. Let's start backing up");
        			navigatePage(feedObj.id, undefined, undefined, function(){
						FBFeed.update({id: feedObj.id}, {lastBackup: Date.now(), didBackupHead: true}).exec(function(err){
							if (err){
								job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
								return;
							}
							
							job.log('Succesfully backed up the Facebook page : ' + feedObj.name);
							//if (callback) callback();
							scheduleNextOne(job, queue, done)
						})
					}, job);
        		}else{
        			job.log("Resuming backup of page : " + feedObj.name + " at date : " + post.postDate)
        			navigatePage(feedObj.id, post.postDate, undefined, function(){
						FBFeed.update({id: feedObj.id}, {lastBackup: Date.now(), didBackupHead: true}).exec(function(err){
							if (err){
								job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
								return;
							}
							
							job.log('Succesfully backed up the Facebook page : ' + feedObj.name);
							//if (callback) callback();
							scheduleNextOne(job, queue, done)
						})
					}, job);
        		}
        	}
		);
	}
}



/*
	Commented out for now because not used

function backupAllFeeds(){
	refreshToken(function(){
		FBFeed.find(function(err, feeds){
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
		});
	});
}

*/





