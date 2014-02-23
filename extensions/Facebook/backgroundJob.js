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
var http = require('http');
var https = require('https');
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
function navigatePage (pageId, Until, Since, cb, job, done, trollCall) {
  if (typeof pageId != 'string') throw new TypeError('pageId must be a string');
  if (cb && typeof cb != 'function') throw new TypeError('When defined, "cb" must be a function');
  var reqText = pageId + '/posts';
  var didMakeUselessCall = trollCall?true:false;

  function rateLimitedFBGet(path, until, since){
    throttle.increment(1, function(err, count) {
      if (err) {console.log("We had an error with rate limiting : " + err); process.exit(1)};
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
      options.since = Math.floor(since.getTime() / 1000) - 1 ;
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
        done("Couldn't fetch from graph" + JSON.stringify(err) + " path : " + path + " since : " + since + " until " + until);
        process.exit(0);
      }

      if (!fbRes.data){ //If no error and no data was returned, then end of feed (or whatever)
        console.log("The Facebook feed stopped responding with data !")
        if (cb) cb();
        return;
      }

      if (trollCall){
        trollCall = false;
        rateLimitedFBGet(fbRes.paging.previous);
        return;
      }

      var tasksToExecute = [];
      for (var i = 0; i < fbRes.data.length; i++){
        //Backup a post if it meets the conditions and go to the next one

        var postCreationDate = new Date(fbRes.data[i].created_time);
        if ((!Until || postCreationDate.getTime() < Until.getTime() || (didMakeUselessCall && postCreationDate.getTime() > Until.getTime())) && (!Since || postCreationDate.getTime() > Since.getTime())) {

          var postData = fbRes.data[i];
          function closure (apostData){
            tasksToExecute.unshift(function (callback){
              backupFbPost(apostData, callback, job);
            });
          };
          closure(postData);

        } else if ((Since && postCreationDate.getTime() < Since.getTime()) || (Until && postCreationDate.getTime() > Until.getTime()) ){
          console.log("The date of the post is older than what we asked!");
          process.exit(1);
        } else if ((Until && (postCreationDate.getTime() == Until.getTime()))||(Since && (postCreationDate.getTime() == Since.getTime()))){
          job.log("We requested the last post we had too");
        }
          else{
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
              if (didMakeUselessCall) {
                rateLimitedFBGet(fbRes.paging.previous);
                return;
              }
              job.log("Finished processing batch (Until checked), requesting next one.");
              rateLimitedFBGet(fbRes.paging.next);
              return;
            } else {
              console.log("Shouldn't happen");
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
      console.log("There was an issue saving the object, maybe a duplicate");
    });
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
            callback();
            return;

          } else {
            console.log("An unknown error happened while getting photo " + photoId + ". Error " + err);
            saveInDb(postInDb);
            callback();
            return;
          }
        }
        //Getting the URL where the full size image is stored. OMG, gotta do lots of hops in Facebook before getting what you want... And yes, it's getting late in the night..
        var pictureLink = fbImageRes.source;
        var pictureName = pictureLink.split('/'); //Assuming that the url finishes with the image's file name
        pictureName = pictureName[pictureName.length - 1];
        var fsWriter = fs.createWriteStream(verifyPathLength(path.join(postMediaPath, pictureName))); //Creating after the picture name, in the posts media folder
        
        requestGetter (pictureLink, postInDb, saveInDb, fsWriter, callback);
        
        return;
      });
    }

    rateLimitedFBGetImage();

  } else if (postObj.picture){
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

      requestGetter (theoricImageUrl, postInDb, saveInDb, fsWriter, callback);
    
    } else {
      saveInDb(postInDb);
      callback()
      return;
    }
  } else {
      saveInDb(postInDb);
      callback()
      return;
  }
}

function requestGetter (url, postInDb, saveInDb, fsWriter, callback){

  var requestProcessing = function(imgRes){
    if (imgRes.statusCode >= 200 && imgRes.statusCode < 400) { //image found, then save it
      imgRes.on('data', function(data){
        fsWriter.write(data);
      });
      
      imgRes.on('end', function(){
        fsWriter.end();
        postInDb.picture = '/fb/media/' + postInDb.feedId + "/" + postInDb.postId;
        saveInDb(postInDb);
        callback();
        return;
      });
    } else {
      reqClient.abort();
      fsWriter.end();
      saveInDb(postInDb);
      callback();
      return;
    }
  };
  
  var reqClient;
  
  if (url.indexOf('https://') == 0){
    reqClient = https.get(url, requestProcessing);
  } else if (url.indexOf('http://') == 0){
    reqClient = http.get(url, requestProcessing);
  } else{
    console.log("How should we process " + url);
    process.exit(1);
  }

  reqClient.on('error', function(e) {
    console.log("Got error: " + e.message);
    fsWriter.end();
    saveInDb(postInDb);
    callback();
    return;
  });

  reqClient.setTimeout( 10000, function() {
    console.log("time out");
    saveInDb(postInDb);
    fsWriter.end();
    reqClient.abort();
    callback();
    return;
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
          if (!posts[0]){job.log("There is no post for that feed in the database!"); process.exit(1);}
          if (!posts[0].postDate) {
            console.log("Head is backed but no posts");
            process.exit(1);
          };

          job.log('Updating Facebook page : ' + feedObj.name + " for posts since "+ posts[0].postDate + " named " + posts[0].postText);

          navigatePage(feedObj.id, posts[0].postDate, undefined, function(){
            FBFeed.update({id: feedObj.id}, {lastBackup: Date.now()}).exec(function(err){
              if (err){
                job.log('Error while updating "lastBackup" date for "' + feedObj.name + '"');
                process.exit(1);
              }
              job.log('Succesfully completed the update of the Facebook page : ' + feedObj.name);

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
