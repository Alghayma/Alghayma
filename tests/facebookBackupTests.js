

// IMPORTANT - FOR TESTS TO BE ABLE TO RUN MAKE SURE YOU HAVE A VALID fbuser with a token in your test database.
var path = require('path');
var dropOnLaunch = true;
var assert = require('assert');
var fbBgWorker = require(path.join(__dirname, ".." , 'extensions', 'Facebook', 'backgroundJob'));
fbBgWorker.setTesting();
var config = require(path.join(__dirname, "..", 'config'));
// For the test page we use a small page because it's more convenient.

// Testpage : https://www.facebook.com/kafrev

var mongoose = require('mongoose');
var connectionString = 'mongodb://';
if (config.dbuser && config.dbpass) connectionString += config.dbuser + ':' + config.dbpass + '@';

connectionString += config.dbhost + ':' + config.dbport + '/' + "alghayma";

var FBUser, FBFeed, FBPost;

mongoose.createConnection(connectionString, function(err){ 
	if (err){
		throw err; 
	} else{
		require(path.join(__dirname, "..", "extensions", "Facebook", "models.js")).initializeDBModels(mongoose);
		FBUser = mongoose.model('FBUser');
		FBFeed = mongoose.model('FBFeed');
		FBPost = mongoose.model('FBPost');
		dropPostTable(initializeFetchAll);
	}
});

function dropPostTable(callback){
	if (dropOnLaunch) {
		mongoose.connection.collections['fbposts'].drop( function(err) {
			mongoose.connection.collections['fbfeeds'].drop( function(err) {
				callback();
			});
		});
	} else {
		callback()
	}
}

var job = {};
job.log = console.log;  // We want to log the queuing functions as well

var queue = {};
var feed;

function initializeFetchAll(){
	
	feed = new FBFeed ({                                                                                                                                                                                                        
        "__v" : 0,
        "didBackupHead" : false,
        "id" : "537011102992127",
        "name" : "Kafranbel Syrian Revolution",
        "profileImage" : "https://fbcdn-profile-a.akamaihd.net/hprofile-ak-prn2/t5/203542_537011102992127_1421717180_q.jpg",
        "type" : "fbpage",
        "url" : "kafrev"
    });

    feed.save(function(err){
    	if (err) {console.log("Failed to save feed!");}
    });

	job.data = {};
	job.data.feed = feed;
	console.log("Check run");
	fbBgWorker.setToken(function(){
		fetchAll();
	});

}

function fetchAll (){
	fbBgWorker.launchFeedBackup(job, queue, assertAll);
}

function assertAll (err){
	if (err) {
		console.log("We failed to backup all posts. Failed with error: " +  err);
	} else {
		console.log("Backup task completed without error messages ");
		FBFeed.findOne({feedId:feed.id}).exec(function(err, feed){
  			assert.equal(feed.didBackupHead, true, "The backup head flag has NOT been changed");
  			feed.didBackupHead = false;
  			feed.save(function(err){
  				if (err) {throw err};
	  			FBPost.count({feedId:feed.id}).exec(function (err, count){
					if (err) {throw err};
					// As right now we know that Kafranbel has more than 
					console.log("We backed up a total of " + count + " posts.");
					if (count < 749){
						console.log("There are obviously posts missing (unless Kafranbel deleted many)");
					} else{
						//Verify that the first post is the one it should be. 
						FBPost.find({feedId:feed.id}).sort({postDate:'asc'}).limit(1).exec(function(err, posts) {
		  					assert.equal(posts[0].postId, "537011102992127_584219408271296", "Oldest post is not the one we thought it would be. Has https://www.facebook.com/photo.php?fbid=584219394937964&set=a.584219388271298.153069.537011102992127&type=1&relevant_count=1%27 been deleted?");
		  					FBPost.find({feedId:feed.id}).sort({postDate:'desc'}).limit(1).exec(function(err, posts) {
		  						console.log("Was the most recent post posted on the " + posts[0].postDate + " and is containing " + posts[0].postText + " ?");
		  						prepareFetchTail();
		  					});
						});
					}
				});
			});
  		});
	}
}

var postsIDs;

function prepareFetchHead(){
	// Alright. So if previous tests passed, we have now a full backup of the Kafranbel page. Let's screw a few things up and see if it works.

	// In this test we are going to change the flag in the database to "didBackupHead false", delete the 5 oldest posts and run an update to see what happens.
	FBFeed.findOne({feedId: feed.id}).exec(function(err, theFeed){
		FBPost.find({feedId:feed.id}).sort({postDate:'asc'}).limit(5).exec(function(err, posts) {
			if (err) {throw err};

			postsIDs = [];

			for (var i = posts.length - 1; i >= 0; i--) {
				postsIDs.push(posts[i].postId);
				posts[i].remove();
			};
			// Now that posts are deleted let's run the fetch tail method
			fetchHead();
		});
	});
}

function fetchHead(){
	console.log("Fetching posts!")
	fbBgWorker.launchFeedBackup(job, queue, assertHead);
}

function assertHead (){
	
	FBFeed.findOne({feedId: feed.id}).exec(function(err, theFeed){
		
		assert.equal(theFeed.didBackupHead, true, "Wait, I don't think the fetching from head works!");

		FBPost.find({feedId:feed.id}).sort({postDate:'asc'}).limit(5).exec(function(err, posts) {
			if (err) {throw err};

			console.log(posts);
			console.log(postsIDs);

			process.exit(0)
			for (var i = posts.length - 1; i >= 0; i--) {
				
			};
			// Now that posts are deleted let's run the fetch Head method
			fetchTail();
		});
	});	
}


