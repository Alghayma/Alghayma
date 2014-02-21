/**
 * Facebook extension for Alghayma
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var SHA3 = require('sha3');
var domain = require('domain');
var async = require('async');
var testing = false;

exports.setTesting = function(){
	testing = true;
}

var fbgraph = require('fbgraph');
var config = require(path.join(__dirname, "..", "..", 'config'));
var http = require('http');
var https = require('https');
var mongoose = require('mongoose');
var FBUser, FBFeed, FBPost;
exports.mongoConnect = function(){
	var connectionString = 'mongodb://';
	if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
	connectionString += config.dbhost + ':' + config.dbport + '/';
	connectionString += (testing)?config.testDBName:config.dbname;
	mongoose.connect(connectionString, function(err){ if (err) throw err; });
	require("./models.js").initializeDBModels(mongoose);
	FBUser = mongoose.model('FBUser');
	FBFeed = mongoose.model('FBFeed');
	FBPost = mongoose.model('FBPost');
}

var fbUtil = require('./fbUtils');
var shouldEnd = false;

var Throttle = require('redis-throttle');

Throttle.configure({
  port: 6379,
  host: '127.0.0.1'
});

var incrementKey = "fbAPI";

var throttle = new Throttle(incrementKey, {
  span: 600 * 1000, // 600 seconds
  accuracy: 1000       // margin of error = span / accuracy
});

//Creating the media folder, if it doesn't exist
var mediaPath = path.join(process.cwd(), config.mediafolder);
if (!fs.existsSync(config.mediafolder)) fs.mkdirSync(mediaPath);

function refreshToken (callback) {
	fbUtil.refreshToken(fbgraph, mongoose, callback);
}

exports.setToken = function (callback) {
	refreshToken(callback);
}

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
				if (err) {job.log("Error retreiving metadata : " + JSON.stringify(err))};
				FBFeed.update({id: feeds.id}, {name: fbRes.name, picture: fbRes.picture.data.url}).exec();
			});
		}
	});
}

//Getting all the posts, with an optional interval (since or until parameter)
function navigatePage(pageId, until, since, cb, job, done){
	if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
	if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
	var reqText = pageId + '/posts';

  	function rateLimitedFBGet(path, until, since){
    	throttle.increment(1, function(err, count) {
	    	if (err) {console.log("We had an error with rate limiting : " + err); process.exit(1)};
	    	function wait (){
				throttle.read(function(err, newCount) {
					if (err){
						done(err)
						console.log("An error occured during the fetching of the rate limiting count : " + err);
					} else{
						if (newCount>550){
							if(Math.random()*10 > 7){job.log("Hitting Facebook's rate limit, slowing down" + newCount)}; // We want some of them to be logged but not too much otherwise it's spamming the logs.
							setTimeout(wait, 10000);
						} else{
							if(Math.random()*10 > 7){job.log("Processing next request" + newCount)};
							fbGet(path, until, since);
						} 
			   		}
			   	});
			}
			if (count>550){
				setTimeout(wait, 10000);
			} else{
				fbGet(path, until, since);
			} 
    	});
  	}

	function fbGet(path, until, since){
	
		if (shouldEnd) {
			process.exit(0)
		}
		var options = {};
		if (until){
			if (!(until instanceof Date)) until = new Date(until);
			options.until = Math.ceil(until.getTime() / 1000); //Number of seconds, and not milliseconds. MUST BE A FREAKING INTEGER
		}
		if (since){
			if (!(since instanceof Date)) since = new Date(since);
			options.since = Math.floor(since.getTime() / 1000);
		}

	    fbgraph.get(path, options, function(err, fbRes){
	      	if (err) {
		        if (err.code == 1 || err.code == 2){ //Internal FB errors
		        	job.log(JSON.stringify(err));
		        } else if (err.code == 17){
		        	job.log("Hitting the maximum rate limit " + JSON.stringify(err));
		        	console.log("Hitting the maximum rate limit " + JSON.stringify(err));
		        } else if (err.code == 100) {
		        	console.log("Feed "+ path + " couldn't be retreived (100), crashing");
		        }	else {
		          job.log('Error while getting updates from : ' + pageId + '\n' + JSON.stringify(err));
		        }
		        done ("Couldn't fetch from graph" + JSON.stringify(err) + " path : " + path + " since : " + since + " until " + until);
		        process.exit(0);
	      	}

	     	 if (!fbRes.data){ //If no error and no data was returned, then end of feed (or whatever)
	      		console.log("The Facebook feed stopped responding with data !")
	        	if (cb) cb();
	        		return;
	      	}

	      	var tasksToExecute = [];
	     	 for (var i = 0; i < fbRes.data.length; i++){
	        //Backup a post if it meets the conditions and go to the next one

	        var postCreationDate = new Date(fbRes.data[i].created_time);
	        if ((!until || postCreationDate.getTime() < until.getTime()) && (!since || postCreationDate.getTime() > since.getTime())) {
	          	
	          	var postData = fbRes.data[i];
	          	function closure (apostData){
	          		tasksToExecute.unshift(function (callback){
	          			backupFbPost(apostData, callback, job);
	          		})
	          	};
	          	closure(postData);

	        } else if (since && postCreationDate.getTime() < since.getTime()){
	        	console.log("The date of the post is older than what we asked!");
	        	if (cb) cb();
	          	return;
	        } else{
	        	console.log(">>>>> This case is unhandled: " + fbRes);
	        }
	      }
	      	// debug -> //async.series(tasksToExecute, function (err, results){
	      	async.parallelLimit(tasksToExecute, 8, function (err, results){
	      		if (err) {
	      			console.log("Error occured while backup a post : " + err);
	      			process.exit(1);
	      		} else {
		      		if (fbRes.paging && fbRes.paging.next){
		      			job.log("Finished processing batch, requesting next one.")
		        		rateLimitedFBGet(fbRes.paging.next, until, since);
		      		} else {
		      			console.log("We are done with this post, skipping to callback");
		        		if (cb) cb();
		    		}
	      		}
	    	});
	  	});
  	}

	rateLimitedFBGet(reqText, until, since);

}

//Saving a single fb post on the server
/*
* BEWARE : IT MIGHT LOOK VERY VERY DIRTY. It could be optimized
*/
function backupFbPost(postObj, callback, job){
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

	if (!fs.existsSync(path.join(mediaPath, feedId))) fs.mkdirSync(path.join(mediaPath, feedId));

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
		var postMediaPath = path.join(mediaPath, feedId, postId);
		if (!fs.existsSync(postMediaPath)) fs.mkdirSync(postMediaPath);
		//Getting the photoID from the story link. Then getting that photoID in the Graph API
		var photoId = getSearchKey(storyLink, 'fbid');
		
	  	function rateLimitedFBGetImage(){
	    	throttle.increment(1, function(err, count) {
		    	if (err) {console.log("We had an error with rate limiting : " + err); process.exit(1)};
		    	function wait (){
					throttle.read(function(err, newCount) {
						if (err){
							callback(err)
							console.log("An error occured during the fetching of the rate limiting count : " + err);
						} else{
							if (newCount>550){
								//if(Math.random()*10 > 7){console.log("Hitting Facebook's rate limit, slowing down" + newCount)}; // We want some of them to be logged but not too much otherwise it's spamming the logs.
								setTimeout(wait, 10000);
							} else{
								getFBImage();
							} 
				   		}
				   	});
				}		

				if (count>550){
					setTimeout(wait, 10000);
				} else{
					getFBImage();
				} 
	    	});
	  	}

    	function getFBImage () {
			fbgraph.get(photoId, function(err, fbImageRes){
				if (err){
					if (err.code == 100) {
						//That image couldn't be retreived.
						console.log("Image "+ photoId + " couldn't be retreived (100), continuing archiving");
						postInDb.picture = pictureLink;
						saveInDb(postInDb);
						callback();
						return;

					} else {
						console.log("An unknown error happened while getting photo " + photoId + ". Error " + err);
						callback();
						return;
					}
				}
				//Getting the URL where the full size image is stored. OMG, gotta do lots of hops in Facebook before getting what you want... And yes, it's getting late in the night..
				var pictureLink = fbImageRes.source;
				var pictureName = pictureLink.split('/'); //Assuming that the url finishes with the image's file name
				pictureName = pictureName[pictureName.length - 1];
				var fsWriter = fs.createWriteStream(verifyPathLength(path.join(postMediaPath, pictureName))); //Creating after the picture name, in the posts media folder
				if (pictureLink.indexOf('https://') == 0){ //Checking whether the image path is https or not.
					https.get(pictureLink, function(imgRes){
						if (imgRes.statusCode >= 200 && imgRes.statusCode < 400) { //image found, then save it
							imgRes.on('data', function(data){
								fsWriter.write(data);
							});
							imgRes.on('end', function(){
								fsWriter.end();
								pictureLink = '/fb/media/' + feedId + "/" + postId;
								postInDb.picture = pictureLink;
								saveInDb(postInDb);
								callback();
							});
						} else {
							//Error while getting the picture. Saving the data we have
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
							callback();
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
								pictureLink = '/fb/media/' + feedId + "/" + postId;
								postInDb.picture = pictureLink;
								saveInDb(postInDb);
								callback();
							});
						} else {
							//Error while getting the picture. Saving the data we have
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
							callback();
						}
					});
				}
			});
		}

		rateLimitedFBGetImage();

	} else {
		var pictureLink = postObj.picture;
		if (isFbUrl(pictureLink, true) && pictureLink.indexOf('safe_image.php') > 0 && getSearchKey(pictureLink, 'url')){
			//Creating a media folder for the post
			var postMediaPath = path.join(mediaPath, feedId, postId);
			if (!fs.existsSync(postMediaPath)) fs.mkdirSync(postMediaPath);
			//Creating the image file
			var theoricImageUrl = decodeURIComponent(getSearchKey(pictureLink, "url"));
			var theoricImageUrlParts = theoricImageUrl.split('/');
			var imageName = theoricImageUrlParts[theoricImageUrlParts.length - 1];
			var fsWriter = fs.createWriteStream(verifyPathLength(path.join(postMediaPath, imageName)));
			//console.log("Getting from URL " + theoricImageUrl);

			var networkDomain = domain.create();

			networkDomain.on('error', function(er) {
 				console.log("We had issues retreiving " + theoricImageUrl);
 				postInDb.picture = pictureLink;
				saveInDb(postInDb);
				callback();
			});

			networkDomain.run(function() {

				if (theoricImageUrl.indexOf('https://') == 0){
					https.get(theoricImageUrl, function(imgRes){
						if (imgRes.statusCode >= 200 && imgRes.statusCode < 400){
							imgRes.on('data', function(data){
								fsWriter.write(data);
							});
							imgRes.on('end', function(){
								fsWriter.end();
								pictureLink = '/fb/media/' + feedId + "/" + postId;
								postInDb.picture = pictureLink;
								saveInDb(postInDb);
								callback();
							});
						} else {
							//Error while getting the picture. Saving what we have
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
							callback();
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
								pictureLink = '/fb/media/' + feedId + "/" + postId;
								postInDb.picture = pictureLink;
								saveInDb(postInDb);
								callback();
							});
						} else {
							//Error while getting the picture. Saving what we have
							postInDb.picture = pictureLink;
							saveInDb(postInDb);
							callback();
						}
					});
				}
			});
		} else {
			job.log("The following kinds of posts are not supported");
			job.log(postObj);
			callback();
		}
	}
}

function scheduleNextOne(job, queue, done){
	job.log("Scheduling next backup of " + job.data.feed.name + " in " + config.postsBackupInterval + " milliseconds." )
	if (testing) {
		console.log("In principle a job should be rescheduled here. ");
		done();
	} else{
		queue.create('facebookJob', {title: "Backup of " + job.data.feed.name, feed: job.data.feed}).delay(config.postsBackupInterval).save()
		done();
	}
}

exports.scheduleAllFeeds = function(queue){
	FBFeed.find(function(err, feeds){
		if (err){
			console.log('Can\'t update feeds metadata:\n' + err);
			return;
		}
		for (var i = feeds.length - 1; i >= 0; i--) {
			queue.create('facebookJob', {title: "Backup of " + feeds[i].name, feed: feeds[i]}).save()
		};
	});
}

exports.setKiller = function(){
	shouldEnd = true;
}

//Launching a feed backup process
exports.launchFeedBackup = function(job, queue, done){
	var feedObj = job.data.feed;
	if (!(feedObj && typeof feedObj == 'object')) throw new TypeError('feedObj must be an object');

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

				scheduleNextOne(job, queue, done, callback)
			})
		}, job, done);

	} else {
		// Find last post that was added and continue from there.
		FBPost.find({feedId:feedObj.id}).sort({postDate: 'asc'}).limit(1).exec(function(err, post){
        		if (err) {
        			job.log('Issue fetching post from DB : ' + err);
        		} else if (!(post && post.length > 0)) {
        			job.log("Page " + feedObj.name + " has no post yet. Let's start backing up");
        			navigatePage(feedObj.id, undefined, undefined, function(){
						FBFeed.update({id: feedObj.id}, {lastBackup: Date.now(), didBackupHead: true}).exec(function(err){
							if (err){
								job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
								return;
							}
							refreshToken ();
							job.log('Succesfully backed up the Facebook page : ' + feedObj.name);
							scheduleNextOne(job, queue, done)
						})
					}, job, done);
        		}else{
        			job.log("Resuming backup of page : " + feedObj.name + " at date : " + post[0].postDate + ' for post ' + post[0]);
        			navigatePage(feedObj.id, post[0].postDate, undefined, function(){
						FBFeed.update({id: feedObj.id}, {lastBackup: Date.now(), didBackupHead: true}).exec(function(err){
							if (err){
								job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
								return;
							}
							refreshToken ();
							job.log('Succesfully backed up the Facebook page : ' + feedObj.name);
							scheduleNextOne(job, queue, done)
						})
					}, job, done);
        		}
        	}
		);
	}
}

function verifyPathLength(path){
	var lengthOfFileSystemMax = 256;
	if (path.length > lengthOfFileSystemMax){
		var extension = path.split('.').pop();
		var folders = path.split('/');
		var filenameWithExt = folders.pop();
		var filename = filenameWithExt.substring(0, filenameWithExt.length - extension.length-1);

		var truncationLength = lengthOfFileSystemMax - folders.join("/").length - extension.length - 1;
		var sha3 = new SHA3.SHA3Hash();
		sha3.update(filename ,"utf8");
		var truncatedHash = sha3.digest('hex').substring(0, truncationLength);

		var shorterPath = folders.join("/")+"/"+truncatedHash+"."+extension;

		if (shorterPath.length > lengthOfFileSystemMax) {console.log("Truncated string is too long");process.exit(1)};
		return shorterPath;
	} else {
		return path;
	}
}

