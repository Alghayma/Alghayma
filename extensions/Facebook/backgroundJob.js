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

exports.setTesting = function () {
  testing = true;
}

var fbgraph = require('fbgraph');
var config = require(path.join(__dirname, "..", "..", 'config'));
var request = require('request');
var mongoose = require('mongoose');
var FBUser, FBFeed, FBPost;
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';
connectionString += config.dbhost + ':' + config.dbport + '/';
connectionString += config.dbname;
mongoose.connect(connectionString, function(err){ if (err) throw err; });
require("./models.js").initializeDBModels(mongoose);
FBUser = mongoose.model('FBUser');
FBFeed = mongoose.model('FBFeed');
FBPost = mongoose.model('FBPost');

var fbUtil = require('./fbUtils');
var shouldEnd = false; // variable used to stop the worker at the desired moment
exports.setKiller = function(){
  shouldEnd = true;
}

var Throttle = require('redis-throttle');

Throttle.configure({
  port: 6379,
  host: '127.0.0.1'
});

var throttle;

//Creating the media folder, if it doesn't exist
var mediaPath = path.join(process.cwd(), config.mediafolder);
if (!fs.existsSync(config.mediafolder)) fs.mkdirSync(mediaPath);

function refreshToken (callback) {
  fbUtil.refreshToken(fbgraph, mongoose, function(token){
    var incrementKey = "fbAPI" + token;
    throttle = new Throttle(incrementKey, {
      span: 600 * 1000, // 600 seconds
      accuracy: 1000    // margin of error = span / accuracy
    });
    if (callback){
      callback();
    };
  });
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
function navigatePage (pageId, Until, Since, cb, job, done) {
  if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
  if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
  var reqText = pageId + '/posts';

  function rateLimitedFBGet(path, until, since){
    throttle.increment(1, function(err, count) {
      if (err) {
        console.log("We had an error with rate limiting : " + err); 
        process.exit(1)
      };
      function wait (){
        throttle.read(function(err, newCount) {
          if (err){
            done(err)
            console.log("An error occured during the fetching of the rate limiting count : " + err);
            process.exit(0);
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
      console.log("Goodbye, committing suicide");
      process.exit(0);
    }
    var options = {};
    if (until){
      if (!(until instanceof Date)) until = new Date(until);
      options.until = Math.ceil(until.getTime() / 1000); //Number of seconds, and not milliseconds. MUST BE A FREAKING INTEGER
    }
    if (since){
      if (!(since instanceof Date)) since = new Date(since);
      options.since = Math.floor(since.getTime() / 1000) - 1;
    }
    
    fbgraph.get(path, options, function(err, fbRes){
      if (err) {
        if (err.code == 1 || err.code == 2){ //Internal FB errors
          job.log(JSON.stringify(err));
        } else if (err.code == 17){
          job.log("Hitting the maximum rate limit " + JSON.stringify(err));
        } else if (err.code == 100) {
          job.log("Feed "+ path + " couldn't be retreived (100), crashing");
        }	else {
          job.log('Error while getting updates from : ' + pageId + '\n' + JSON.stringify(err));
        }
        console.log("The Facebook graph API is not playing nice. Let's wait and reschedule that request");
        done("Couldn't fetch from graph" + JSON.stringify(err) + " path : " + path + " since : " + since + " until: " + until);
        return;
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
        if ((!Until || postCreationDate.getTime() < Until.getTime() ) && (!Since || postCreationDate.getTime() > Since.getTime())) {

          var postData = fbRes.data[i];
          function closure (apostData){
            tasksToExecute.unshift(function (callback){
              backupFbPost(apostData, callback, job);
            });
          };
          closure(postData);

        } else if ((Since && postCreationDate.getTime() < Since.getTime()) || (Until && postCreationDate.getTime() > Until.getTime()) ){
          console.log("The date of the post is older than what we asked! We just reached the end of the backup");
          if (cb) cb();
          return;
        } else if ((Until && (postCreationDate.getTime() == Until.getTime()))||(Since && (postCreationDate.getTime() == Since.getTime()))){
          job.log("We requested the last post we had too");
        } else {
          job.log(">>>>> This case is unhandled: ")
          job.log(fbRes.data[i]);
        }
      }
      //async.series(tasksToExecute, function (err){
      async.parallelLimit(tasksToExecute,7, function (err, results){
        if (err) {
          console.log("Error occured while backup a post : " + err);
          process.exit(1);
        } else {
          if (fbRes.paging && fbRes.paging.next && fbRes.paging.previous){
            if (!Until && !Since) {
              job.log("Finished processing batch, requesting next one.");
              rateLimitedFBGet(fbRes.paging.next);
              return;
            } else if (Until){
              job.log("Finished processing batch (Until checked), requesting next one.");
              rateLimitedFBGet(fbRes.paging.next);
              return;
            } else if (Since){
            	job.log("Requesting next batched updates")
              rateLimitedFBGet(fbRes.paging.next);
            } else {
              job.log("Shouldn't happen");
              process.exit(1);
            }
          } else {
            job.log("We are done with this page, skipping to callback");
            if (cb){
              cb();
            }
          }
        }
      });
    });
  }

  rateLimitedFBGet(reqText, Until, Since);

}

//Saving a single fb post on the server

function backupFbPost(postObj, callback, job){

  // It turns out the callbacks are called more than once causing a variety of issues.
  // This is a temporary hack to fix it.
  var didSendCallback = false;
  function sendCallback() {
    if (!didSendCallback){
      callback();
      didSendCallback = true
    } else {
      job.log("We are having duplicates callbacks :/");
    }
  }

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
    newPost.save(function(err){
      if (err) {
        console.log("We had an issue saving " + err);
      }
    });
  }

  var feedId = postObj.from.id;
  var postId = postObj.id;
  var postText = postObj.message;
  var postDate = postObj.created_time;
  var storyLink = postObj.link;
  var story = postObj.story;
  var initialPic = postObj.picture;

  if (!fs.existsSync(path.join(mediaPath, feedId))) fs.mkdirSync(path.join(mediaPath, feedId));

  //Pre-modelling the object before saving it in the DB
  var postInDb = {
    postId: postId,
    feedId: feedId,
    postDate: postDate,
    postText: postText,
    storyLink: storyLink,
    story: story,
    picture: initialPic
  }

  var postMediaPath = path.join(mediaPath, feedId, postId);
  if (!fs.existsSync(postMediaPath)) fs.mkdirSync(postMediaPath);

  //Getting the story link. Backup it up if it's a picture on facebook. (Assuming that a facebook page that gets deleted, all its posted content goes away with it... Pictures included)
  if (isFbUrl(storyLink, true) && (storyLink.indexOf('photo.php') > 0 && getSearchKey(storyLink, 'fbid'))) {
    //Creating a media folder for the post
    //Getting the photoID from the story link. Then getting that photoID in the Graph API
    var photoId = getSearchKey(storyLink, 'fbid');

    function rateLimitedFBGetImage(){
      throttle.increment(1, function(err, count) {
        if (err) {console.log("We had an error with rate limiting : " + err); process.exit(1)};
        function wait (){
          throttle.read(function(err, newCount) {
            if (err){
              console.log("An error occured during the fetching of the rate limiting count : " + err);
              sendCallback();
              return;
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
            //postInDb.picture = pictureLink;
            saveInDb(postInDb);
            sendCallback();
            return;

          } else {
            console.log("An unknown error happened while getting photo " + photoId + ". Error " + JSON.stringify(err));
            saveInDb(postInDb);
            sendCallback();
            return;
          }
        }
        //Getting the URL where the full size image is stored. OMG, gotta do lots of hops in Facebook before getting what you want... And yes, it's getting late in the night..
        var pictureLink = fbImageRes.source;
        var fsWriter = fs.createWriteStream(path.join(postMediaPath, nameForPictureAtPath(pictureLink))); //Creating after the picture name, in the posts media folder
        
        requestGetter (pictureLink, postInDb, saveInDb, fsWriter, callback);
        
        return;
      });
    }

    rateLimitedFBGetImage();

  } else if (postObj.picture){
    var pictureLink = postObj.picture;
    if (isFbUrl(pictureLink, true) && pictureLink.indexOf('safe_image.php') > 0 && getSearchKey(pictureLink, 'url')){
      //Creating a media folder for the post
      
      try{
        var theoricImageUrl = decodeURIComponent(getSearchKey(pictureLink, "url"));
      } catch (e) {
        saveInDb(postInDb);
        sendCallback();
        return;
      }
      
      try{
        //var pictureName = postObj.picture.split('/'); //Assuming that the url finishes with the image's file name
        //pictureName = pictureName[pictureName.length - 1];
        //console.log('Picture : ' + pictureName);
        postMediaPath = path.join(postMediaPath, nameForPictureAtPath(theoricImageUrl));
      } catch(e){
        saveInDb(postInDb);
        sendCallback();
        return;
      }

      if (!theoricImageUrl) {
        saveInDb(postInDb);
        sendCallback();
        return;
      };

      var fsWriter = fs.createWriteStream(postMediaPath);
      
      //console.log("Getting from URL " + theoricImageUrl);

      requestGetter (theoricImageUrl, postInDb, saveInDb, fsWriter, callback);
    
    } else {
      saveInDb(postInDb);
      sendCallback();
      return;
    }
  } else {
      saveInDb(postInDb);
      sendCallback();
      return;
  }
}

function requestGetter (url, postInDb, saveInDb, fsWriter, callback){
  var didSendCallback = false;
  
  function sendCallback() {
    if (!didSendCallback){
      callback();
      didSendCallback = true;
      return;
    } else {
      console.log("We are having duplicates callbacks :/");
      return;
    }
  }

  if (url.indexOf('fbstaging://') == 0){
    fsWriter.end();
    sendCallback();
    return;
  }

  var options = { 
    url: url,
    timeout: 15000
  }

  /*function query(error, response, body) {
  	if (!response){
  		console.log('No reponse for ' + url);
      fsWriter.end();
      saveInDb(postInDb);
      sendCallback();
      return;
    } else if (error) {
    	console.log('Error for ' + url);
      fsWriter.end();
      saveInDb(postInDb);
      sendCallback();
      return;
    } else if (!error && response.statusCode >= 200 && response.statusCode < 300) {
    	console.log("Closed socket. Body size : " + response.body.length);
    	response.on('data', function(chunk){
    		console.log('Bzzbzz writing on disk');
    		fsWriter.write(chunk);
    	});
    	response.on('end', function(){
    		postInDb.picture = '/fb/media/' + postInDb.feedId + "/" + postInDb.postId;
    		fsWriter.end();
    		saveInDb(postInDb);
    		sendCallback();
    	});
  	} else {
  		console.log('unhandled case');
	    fsWriter.end();
	    saveInDb(postInDb);
	    sendCallback();
	    return;
  	}
  }*/

  var r = request(options);
  r.pipe(fsWriter);
  r.on('response', function(res){
  	if (!res){
  		console.log('No reponse for ' + url);
      fsWriter.end();
      saveInDb(postInDb);
      sendCallback();
  	} else if (res.statusCode >= 200 && res.statusCode < 300){
  		postInDb.picture = '/fb/media/' + postInDb.feedId + "/" + postInDb.postId;	
  		saveInDb(postInDb);
  		sendCallback();
  	} else {
  		saveInDb(postInDb);
  		sendCallback();
  	}
  });
  r.on('error', function(error){
  	console.log('Error for ' + url);
    fsWriter.end();
    saveInDb(postInDb);
    sendCallback();
  });
}

function scheduleNextOne(job, queue, done){
  job.log("Scheduling next backup")
  if (testing) {
    console.log("In principle a job should be rescheduled here. ");
    done();
  } else{
    queue.create('facebookJob', {title: "Backup of " + job.data.feedname, feedID: job.data.feedID, feedname: job.data.feedname}).delay(config.postsBackupInterval).save()
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
      queue.create('facebookJob', {title: "Backup of " + feeds[i].name, feedname: feeds[i].name, feedID:feeds[i].id}).save()
    };
  });
}

//Launching a feed backup process
exports.launchFeedBackup = function(job, queue, done){
  var feedID = job.data.feedID;
  if (!(feedID && typeof feedID == 'string')) throw new TypeError('feedID must be an string');

  FBFeed.findOne({id:feedID}).exec(function(err, feedObj){
    if (err || (!feedObj)) {
      console.log("Feed to backup couldn't be found! " + err);
    } else {
      // We need to differentiate page updates, initial backups and the resuming of initial backups.
      job.data.feedname = feedObj.name;

      if (feedObj.didBackupHead) {
        // Just proceed to an update to fetch newest post since the most recent one.
        FBPost.find({feedId:feedID}).sort({postDate:'desc'}).limit(1).exec(function(err, posts) {
          if (err) {throw err};
          if (!posts[0]){
            console.log("There is no post for that feed in the database!");
            FBFeed.update({id: feedObj.id}, {didBackupHead: false}).exec(function(err){
              scheduleNextOne(job, queue, done);
            });
            return;
          }
          if (!posts[0].postDate) {
            console.log("Head is backed but no posts");
            FBFeed.update({id: feedObj.id}, {didBackupHead: false}).exec(function(err){
              scheduleNextOne(job, queue, done);
            });
            return;
          };

          job.log('Updating Facebook page : ' + feedObj.name + " for posts since " + posts[0].postDate + " named " + posts[0].postText);

          navigatePage(feedObj.id, undefined, posts[0].postDate, function(){
            FBFeed.update({id: feedObj.id}, {lastBackup: Date.now()}).exec(function(err){
              if (err){
                console.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
                process.exit(1);
              }
              console.log('Succesfully completed the update of the Facebook page : ' + feedObj.name);

              scheduleNextOne(job, queue, done);
            })
          }, job, done, true);
        });

      } else {
        // Find last post that was added and continue from there.
        FBPost.find({feedId:feedObj.id}).sort({postDate: 'asc'}).limit(1).exec(function(err, post){
          if (err) {
            job.log('Issue fetching post from DB : ' + err);
            process.exit(1);
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
                scheduleNextOne(job, queue, done);
              })
            }, job, done);
          }
        });
      }
    }
  });
}

function nameForPictureAtPath(path){
  var lengthOfFileSystemMax = 50;
  var folders = path.split('/');
  var filenameWithExt = folders.pop();
  var extension = filenameWithExt.split('.').pop().split('?')[0];

  var filename = (extension)?filenameWithExt.substring(0, filenameWithExt.length - extension.length-1):filenameWithExt;
  var truncationLength = lengthOfFileSystemMax - extension.length - 1;
  var sha3 = new SHA3.SHA3Hash();
  sha3.update(filename ,"utf8");
  var truncatedHash = sha3.digest('hex').substring(0, truncationLength);

  var shorterPath = (extension)?truncatedHash+"."+extension:truncatedHash;

  if (shorterPath.length > lengthOfFileSystemMax) {
    
    if (extension) {
      if (extension.length < 5) {
        return truncatedHash.substring(0,30) + "." + extension;
      }
    } else{
      return truncatedHash.substring(0,20)
    }
  };
  return shorterPath;
} 